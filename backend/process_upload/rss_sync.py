"""RSS incremental sync poller (DESIGN §2.4, D9).

Reads each opted-in member's PUBLIC Letterboxd RSS feed, appends new diary entries,
and recomputes their stat snapshot — so they don't have to re-upload. The stats are
all-time aggregates, so there's no incremental shortcut: we re-read the user's existing
watches/watchlist/films, merge the new entries, and recompute the whole snapshot.

Politeness (DESIGN §2.4): honest User-Agent, short timeout, daily cadence (the schedule
is in infra), and per-user errors are captured (a private profile 404s) so one bad feed
doesn't stop the rest. Stdlib only; reuses enricher/persist/stats/rss.
"""
from __future__ import annotations

import os
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from typing import Callable, Optional

from . import stats
from .enricher import FilmCache, SupabaseFilmCache, TmdbClient
from .models import Profile, Watch, WatchlistEntry
from .persist import SupabaseWriter, watch_rows
from .rss import parse_rss

RSS_UA = "BoxdStats/1.0 (+https://boxd.haneeftaher.com; daily RSS sync)"
RSS_TIMEOUT = 15.0


def fetch_rss(username: str) -> str:
    """Fetch a user's public diary RSS. Raises on HTTP/network error (private = 404)."""
    url = f"https://letterboxd.com/{username.lower()}/rss/"
    req = urllib.request.Request(url, headers={"User-Agent": RSS_UA})
    with urllib.request.urlopen(req, timeout=RSS_TIMEOUT) as resp:
        return resp.read().decode("utf-8", "replace")


def _new_entries(existing: list[Watch], incoming: list[Watch]) -> list[Watch]:
    """RSS entries not already among `existing`. Keyed on (tmdb_id, watched_at) because
    the RSS link doesn't match the CSV export's diary URI. Skips entries with no tmdb_id
    and dedups within the incoming batch."""
    seen = {(w.tmdb_id, w.watched_at) for w in existing}
    out: list[Watch] = []
    for w in incoming:
        key = (w.tmdb_id, w.watched_at)
        if w.tmdb_id is None or key in seen:
            continue
        seen.add(key)
        out.append(w)
    return out


def sync_user(
    user_id: str,
    lb_username: str,
    *,
    writer: SupabaseWriter,
    client: TmdbClient,
    cache: FilmCache,
    fetch: Callable[[str], str] = fetch_rss,
) -> int:
    """Sync one user. Returns the number of new entries appended. Raises on fetch/parse
    error so the caller can record it; a no-op (0 new) still succeeds."""
    incoming = parse_rss(fetch(lb_username))
    existing = [_watch_from_row(r) for r in
                writer.select(f"/watches?user_id=eq.{user_id}&select=*")]
    new = _new_entries(existing, incoming)
    if not new:
        return 0

    # RSS hands us the tmdb_id, so no search — just warm the shared cache for films we
    # haven't seen before (write-once, like the upload path).
    for tid in {w.tmdb_id for w in new}:
        if tid is not None and cache.get(tid) is None:
            cache.put(client.movie_details(tid))

    all_watches = existing + new
    watchlist = [_watchlist_from_row(r) for r in
                 writer.select(f"/watchlist?user_id=eq.{user_id}&select=*")]
    # Read films for watched AND watchlist titles. The watchlist actuary (Movie night
    # picks / Address the elephant) reads watchlist films' runtimes from `films`; if we
    # fetch only watched films, any watchlist-only title is absent and _watchlist_enriched
    # returns None, silently dropping that whole section from the recomputed snapshot.
    film_ids = {w.tmdb_id for w in all_watches if w.tmdb_id is not None}
    film_ids |= {e.tmdb_id for e in watchlist if e.tmdb_id is not None}
    films = _read_films(writer, film_ids)
    snap_rows = writer.select(f"/stat_snapshots?user_id=eq.{user_id}&select=payload")
    profile = _profile_from_snapshot(snap_rows[0]["payload"] if snap_rows else None)

    snapshot = stats.compute_snapshot(all_watches, films=films or None,
                                      watchlist=watchlist, profile=profile)
    writer.insert("watches", watch_rows(user_id, new))
    writer.upsert("stat_snapshots", [{"user_id": user_id, "payload": snapshot}])
    return len(new)


def lambda_handler(event=None, context=None) -> dict:  # noqa: ARG001 — EventBridge cron entry
    return run()


def run(fetch: Callable[[str], str] = fetch_rss) -> dict:
    """Poll every opted-in user. Records rss_last_synced_at / rss_last_error per user;
    one user's failure doesn't stop the rest. Returns a summary."""
    writer = SupabaseWriter.from_env()
    client = TmdbClient(os.environ["TMDB_API_KEY"])
    cache = SupabaseFilmCache.from_env()
    users = writer.select(
        "/profiles?rss_sync_enabled=eq.true&lb_username=not.is.null&select=id,lb_username"
    )
    synced = failed = added = 0
    for u in users:
        try:
            n = sync_user(u["id"], u["lb_username"], writer=writer, client=client,
                          cache=cache, fetch=fetch)
            writer.upsert("profiles", [{
                "id": u["id"], "rss_last_synced_at": _now(), "rss_last_error": None,
            }])
            synced += 1
            added += n
        except Exception as e:  # one bad feed shouldn't stop the rest
            writer.upsert("profiles", [{"id": u["id"], "rss_last_error": str(e)[:500]}])
            failed += 1
    return {"users": len(users), "synced": synced, "failed": failed, "entries_added": added}


# ---------------------------------------------------------------------------
# Row -> domain reconstructors (inverse of persist's row mappers)
# ---------------------------------------------------------------------------

def _read_films(writer: SupabaseWriter, ids: set[int]) -> dict[int, dict]:
    """Read the films rows for `ids`, chunked to keep the PostgREST `in.()` URL short."""
    films: dict[int, dict] = {}
    idlist = list(ids)
    for i in range(0, len(idlist), 150):
        chunk = idlist[i:i + 150]
        rows = writer.select(f"/films?tmdb_id=in.({','.join(map(str, chunk))})&select=*")
        for r in rows:
            films[r["tmdb_id"]] = r
    return films


def _watch_from_row(r: dict) -> Watch:
    return Watch(
        title=r.get("title") or "",
        year=r.get("year"),
        lb_uri=r.get("lb_uri"),
        watched_at=_d(r.get("watched_at")),
        rating=r.get("rating"),
        is_rewatch=bool(r.get("is_rewatch")),
        review_text=r.get("review_text"),
        tags=r.get("tags") or [],
        tmdb_id=r.get("tmdb_id"),
    )


def _watchlist_from_row(r: dict) -> WatchlistEntry:
    return WatchlistEntry(
        name=r.get("title") or "",
        year=r.get("year"),
        lb_uri=r.get("lb_uri"),
        added_at=_d(r.get("added_at")),
        tmdb_id=r.get("tmdb_id"),
    )


def _profile_from_snapshot(snap: Optional[dict]) -> Optional[Profile]:
    """Profile's date_joined/favorite_films aren't stored as columns — preserve them
    from the prior snapshot so an RSS recompute doesn't drop them."""
    p = (snap or {}).get("profile") or {}
    return Profile(
        username=p.get("username"),
        date_joined=_d(p.get("date_joined")),
        favorite_films=p.get("favorite_films") or [],
    )


def _d(s: Optional[str]) -> Optional[date]:
    return date.fromisoformat(s) if s else None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

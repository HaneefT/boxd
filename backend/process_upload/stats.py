"""Compute the Tier-1 stat_snapshot payload (DESIGN.md §3.2).

The output is a plain JSON-serialisable dict stored in `stat_snapshots.payload`
and read whole by the dashboard. Two sections:

  payload["core"]     — computable from the CSV export alone (no TMDB).
  payload["enriched"] — needs TMDB film metadata; present only when films are
                        supplied and at least one watch is matched.

Everything here is pure: (watches, films, watchlist, profile) -> dict. Stdlib only.
"""
from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Optional

from .models import Profile, Watch, WatchlistEntry

# Rating buckets 0.5 .. 5.0 in half-star steps.
_RATING_BUCKETS = [round(0.5 * i, 1) for i in range(1, 11)]
_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _film_key(w: Watch) -> str:
    # Film identity = title + year, never the Letterboxd URI: diary/review URIs
    # are per-viewing, so URI-keying would split one film into several. See
    # parser._film_key for the full rationale.
    return f"nm:{(w.title or '').strip().lower()}|{w.year or ''}"


def _round(x: Optional[float], n: int = 2) -> Optional[float]:
    return round(x, n) if x is not None else None


# ---------------------------------------------------------------------------
# Core (CSV-only) stats
# ---------------------------------------------------------------------------

def _totals(watches: list[Watch]) -> dict:
    unique = {_film_key(w) for w in watches}
    rated = [w for w in watches if w.rating is not None]
    reviewed = [w for w in watches if w.review_text]
    dated = [w for w in watches if w.watched_at]
    return {
        "unique_films": len(unique),
        "total_logged": len(watches),          # includes rewatches
        "rated_count": len(rated),
        "reviewed_count": len(reviewed),
        "dated_count": len(dated),
        "unmatched_to_tmdb": sum(1 for w in watches if w.tmdb_id is None),
    }


def _rating_stats(watches: list[Watch]) -> dict:
    ratings = [w.rating for w in watches if w.rating is not None]
    hist = {f"{b:.1f}": 0 for b in _RATING_BUCKETS}
    for r in ratings:
        key = f"{r:.1f}"
        if key in hist:
            hist[key] += 1
    return {
        "count": len(ratings),
        "mean": _round(statistics.fmean(ratings)) if ratings else None,
        "median": _round(statistics.median(ratings)) if ratings else None,
        "stdev": _round(statistics.pstdev(ratings)) if len(ratings) > 1 else None,
        "histogram": hist,
    }


def _era_stats(watches: list[Watch]) -> dict:
    years = [w.year for w in watches if w.year]
    decades: Counter = Counter()
    for y in years:
        decades[(y // 10) * 10] += 1
    # Average film age at time of watching.
    ages = [w.watched_at.year - w.year
            for w in watches if w.watched_at and w.year and w.watched_at.year >= w.year]
    return {
        "by_decade": {str(d): decades[d] for d in sorted(decades)},
        "oldest_year": min(years) if years else None,
        "newest_year": max(years) if years else None,
        "avg_film_age_at_watch": _round(statistics.fmean(ages)) if ages else None,
    }


def _rewatch_stats(watches: list[Watch]) -> dict:
    counts: Counter = Counter()
    titles: dict[str, str] = {}
    for w in watches:
        k = _film_key(w)
        counts[k] += 1
        titles.setdefault(k, w.title)
    rewatched = {k: c for k, c in counts.items() if c > 1}
    total = len(watches)
    most = sorted(rewatched.items(), key=lambda kv: kv[1], reverse=True)[:10]
    return {
        "rewatch_rate": _round(sum(c - 1 for c in counts.values()) / total) if total else None,
        "films_rewatched": len(rewatched),
        "most_rewatched": [{"title": titles[k], "times": c} for k, c in most],
    }


def _activity_stats(watches: list[Watch]) -> dict:
    dates = sorted(w.watched_at for w in watches if w.watched_at)
    if not dates:
        return {"heatmap": {}, "by_weekday": {}, "by_month": {},
                "longest_streak_days": 0, "biggest_day": None,
                "by_year": {}, "first_logged": None, "last_logged": None}

    per_day: Counter = Counter(dates)
    heatmap = {d.isoformat(): per_day[d] for d in sorted(per_day)}

    by_weekday = {wd: 0 for wd in _WEEKDAYS}
    by_month = {m: 0 for m in _MONTHS}
    by_year: Counter = Counter()
    for d in dates:
        by_weekday[_WEEKDAYS[d.weekday()]] += 1
        by_month[_MONTHS[d.month - 1]] += 1
        by_year[d.year] += 1

    # Longest streak of consecutive calendar days with >=1 watch.
    unique_days = sorted(per_day)
    longest = run = 1
    for prev, cur in zip(unique_days, unique_days[1:]):
        run = run + 1 if cur - prev == timedelta(days=1) else 1
        longest = max(longest, run)

    biggest_day, biggest_n = per_day.most_common(1)[0]
    return {
        "heatmap": heatmap,
        "by_weekday": by_weekday,
        "by_month": by_month,
        "by_year": {str(y): by_year[y] for y in sorted(by_year)},
        "longest_streak_days": longest,
        "biggest_day": {"date": biggest_day.isoformat(), "films": biggest_n},
        "first_logged": unique_days[0].isoformat(),
        "last_logged": unique_days[-1].isoformat(),
    }


def _watchlist_stats(
    watchlist: Optional[list[WatchlistEntry]],
    watches: Optional[list[Watch]] = None,
) -> dict:
    """Watchlist actuary, CSV-only half (DESIGN §3.2 Tier 2): counts plus `velocity`
    — your add-vs-watch pace and a projected clear date. Runtime-to-clear needs TMDB,
    so it lives in the enriched section (see `_enriched_stats`)."""
    if not watchlist:
        return {"count": 0}
    years = [e.year for e in watchlist if e.year]
    dated = [e for e in watchlist if e.added_at]
    added = sorted(e.added_at for e in dated)
    today = date.today()
    cutoff = today - timedelta(days=730)
    # Backlog timeline: the single oldest still-unwatched add (the one you keep
    # deferring), the most recent add, and the average age of everything on the list.
    oldest = min(dated, key=lambda e: e.added_at, default=None)
    newest = max(dated, key=lambda e: e.added_at, default=None)
    ages = [(today - e.added_at).days for e in dated]
    return {
        "count": len(watchlist),
        "avg_year": _round(statistics.fmean(years), 0) if years else None,
        "oldest_year": min(years) if years else None,
        "first_added": added[0].isoformat() if added else None,
        "last_added": added[-1].isoformat() if added else None,
        # Still-unwatched items added 2+ years ago — the export only keeps unwatched
        # films, so a long-stale add is one you've realistically abandoned.
        "stale_count": sum(1 for d in added if d < cutoff),
        "backlog": {
            "oldest": {
                "title": oldest.name,
                "added_at": oldest.added_at.isoformat(),
                "years_ago": _round((today - oldest.added_at).days / 365, 1),
            } if oldest else None,
            "newest": {
                "title": newest.name,
                "added_at": newest.added_at.isoformat(),
            } if newest else None,
            "avg_age_days": _round(statistics.fmean(ages), 0) if ages else None,
        },
        "velocity": _watchlist_velocity(
            len(watchlist), added,
            sorted(w.watched_at for w in (watches or []) if w.watched_at),
        ),
    }


def _watchlist_velocity(remaining: int, added: list, watched: list) -> Optional[dict]:
    """Add rate vs watch rate (items/month, each over its own dated span). Watch
    faster than you add → project months-to-clear into a YYYY-MM date; if the list
    grows at least as fast as you clear it, there's no finite date ("never")."""
    def per_month(dates: list) -> Optional[float]:
        if len(dates) < 2:
            return None
        span = (dates[-1] - dates[0]).days
        return len(dates) / (span / 30.44) if span > 0 else None

    add_rate = per_month(added)        # `added` is pre-sorted by the caller
    watch_rate = per_month(watched)
    if add_rate is None or watch_rate is None:
        return None
    net = watch_rate - add_rate
    months = remaining / net if net > 0 else None
    projected = None
    if months is not None:
        t = date.today()
        idx = t.year * 12 + (t.month - 1) + round(months)
        projected = f"{idx // 12}-{idx % 12 + 1:02d}"
    return {
        "added_per_month": _round(add_rate, 1),
        "watched_per_month": _round(watch_rate, 1),
        "net_per_month": _round(net, 1),
        "months_to_clear": _round(months, 1) if months is not None else None,
        "projected_clear": projected,
    }


# ---------------------------------------------------------------------------
# Enriched (TMDB) stats
# ---------------------------------------------------------------------------

def _watchlist_taste_gap(wl_genres: Counter, watched_genres: dict) -> Optional[dict]:
    """Genres your watchlist over-indexes on vs what you actually watch — the gap
    between aspirational and real taste. index = watchlist share / watched share
    (None = a genre you never watch but keep adding). Thin genres (<3 on the list)
    are dropped as noise; returns the 3 most over-represented (never-watched first)."""
    wl_total = sum(wl_genres.values())
    watched_total = sum(watched_genres.values())
    if not wl_total or not watched_total:
        return None
    rows = []
    for g, c in wl_genres.items():
        if c < 3:                                   # too thin to read into
            continue
        watched_share = watched_genres.get(g, 0) / watched_total
        index = (c / wl_total) / watched_share if watched_share > 0 else None
        if index is None or index > 1.2:            # hoarded relative to your viewing
            rows.append({
                "genre": g,
                "index": _round(index, 1) if index is not None else None,
                "watchlist_count": c,
            })
    # Never-watched genres (index None) first, then by descending over-index.
    rows.sort(key=lambda r: (r["index"] is not None, -(r["index"] or 0)))
    return {"over": rows[:3]} if rows else None


def _watchlist_enriched(
    watchlist: Optional[list[WatchlistEntry]],
    films: dict[int, dict],
    watched_genres: dict,
) -> Optional[dict]:
    """TMDB-derived watchlist actuary — runtime-to-clear, quick wins, the longest
    commitment, and the aspirational-vs-actual taste gap. Needs the watchlist's own
    films matched (009's watchlist pass) and is independent of the diary, so it
    survives a snapshot with no matched diary watch (unlike `_enriched_stats`).
    `watched_genres` (genre -> count of what you've seen) powers the taste gap and is
    empty when there's nothing to compare against. None when no watchlist film matched."""
    wl_films = [(films[e.tmdb_id], e.name) for e in (watchlist or []) if e.tmdb_id in films]
    if not wl_films:
        return None
    # Runtime-to-clear, summing only films we have a runtime for; `matched` says how
    # much of the list that estimate covers.
    with_rt = [(f["runtime"], name) for f, name in wl_films if f.get("runtime")]
    runtime = None
    if with_rt:
        tot = sum(rt for rt, _ in with_rt)
        runtime = {
            "matched": len(with_rt),
            "total_minutes": tot,
            "total_hours": _round(tot / 60, 1),
            "total_days": _round(tot / 1440, 1),
        }
    shortest = sorted(with_rt)[:5]                  # quick wins
    longest = max(with_rt) if with_rt else None     # the single biggest commitment
    wl_genres: Counter = Counter()
    for f, _ in wl_films:
        for g in (f.get("genres") or []):
            wl_genres[g] += 1
    return {
        "runtime": runtime,
        "shortest": [{"title": t, "runtime": rt} for rt, t in shortest],
        "longest": {"title": longest[1], "runtime": longest[0]} if longest else None,
        "taste_gap": _watchlist_taste_gap(wl_genres, watched_genres),
    }


def _enriched_stats(watches: list[Watch], films: dict[int, dict]) -> Optional[dict]:
    matched = [w for w in watches if w.tmdb_id is not None and w.tmdb_id in films]
    if not matched:
        return None

    # One representative viewing per film (prefer a rated one) for the breadth /
    # taste stats; `matched` (every viewing) drives the volume stats.
    unique_by_film: dict[str, Watch] = {}
    for w in matched:
        k = _film_key(w)
        cur = unique_by_film.get(k)
        if cur is None or (cur.rating is None and w.rating is not None):
            unique_by_film[k] = w
    unique = list(unique_by_film.values())

    # Runtime is per-viewing: a rewatch genuinely adds hours.
    runtimes = [films[w.tmdb_id].get("runtime") for w in matched
                if films[w.tmdb_id].get("runtime")]
    total_minutes = sum(runtimes)

    # Genre-by-year is temporal: count each dated viewing in its watch year.
    genre_by_year: dict[int, Counter] = defaultdict(Counter)
    for w in matched:
        if w.watched_at:
            for g in (films[w.tmdb_id].get("genres") or []):
                genre_by_year[w.watched_at.year][g] += 1

    # Breadth stats (genres/countries/languages/directors) are per unique film.
    genres: Counter = Counter()
    countries: Counter = Counter()
    languages: Counter = Counter()
    director_films: dict[str, set] = defaultdict(set)
    director_ratings: dict[str, list] = defaultdict(list)
    # Actor leaderboard mirrors directors, fanning out over each film's top-billed
    # cast (top_cast, migration 009). Same per-unique-film basis so a rewatch doesn't
    # double-count an actor; avg ★ is over the films of theirs you actually rated.
    actor_films: dict[str, set] = defaultdict(set)
    actor_ratings: dict[str, list] = defaultdict(list)
    for w in unique:
        f = films[w.tmdb_id]
        for g in (f.get("genres") or []):
            genres[g] += 1
        if f.get("country"):
            countries[f["country"]] += 1
        if f.get("language"):
            languages[f["language"]] += 1
        d = f.get("director")
        if d:
            director_films[d].add(w.tmdb_id)
            if w.rating is not None:
                director_ratings[d].append(w.rating)
        for name in (f.get("top_cast") or []):
            actor_films[name].add(w.tmdb_id)
            if w.rating is not None:
                actor_ratings[name].append(w.rating)

    # Harsh-critic comparison on a 5-star scale: your rating vs TMDB's community
    # vote average, rescaled from TMDB's 0..10 to the 0..5 star scale you rate on.
    # One row per film so the lists aren't padded with repeat viewings. Films
    # without a TMDB vote (vote_average 0/None) drop out.
    deltas = []
    scored = []
    for w in unique:
        f = films[w.tmdb_id]
        vote = f.get("vote_average")
        community = vote / 2 if vote else None
        if w.rating is not None and community is not None:
            you = w.rating
            delta = you - community
            deltas.append(delta)
            scored.append({"title": w.title, "you": you,
                           "community": round(community, 2),
                           "delta": round(delta, 2)})
    overrated = sorted(scored, key=lambda s: s["delta"], reverse=True)[:10]
    underrated = sorted(scored, key=lambda s: s["delta"])[:10]

    # Longest / shortest film actually sat through (per unique film).
    with_rt = [(films[w.tmdb_id]["runtime"], w.title) for w in unique
               if films[w.tmdb_id].get("runtime")]
    longest = max(with_rt) if with_rt else None
    shortest = min(with_rt) if with_rt else None

    directors = sorted(
        director_films.items(), key=lambda kv: len(kv[1]), reverse=True
    )[:15]
    actors = sorted(
        actor_films.items(), key=lambda kv: len(kv[1]), reverse=True
    )[:15]

    return {
        "matched_films": len(unique),
        "runtime": {
            "total_minutes": total_minutes,
            "total_hours": _round(total_minutes / 60, 1),
            "total_days": _round(total_minutes / 1440, 1),
            "avg_minutes": _round(statistics.fmean(runtimes)) if runtimes else None,
            "longest": {"minutes": longest[0], "title": longest[1]} if longest else None,
            "shortest": {"minutes": shortest[0], "title": shortest[1]} if shortest else None,
        },
        "genres": dict(genres.most_common()),
        "genre_by_year": {str(y): dict(c) for y, c in sorted(genre_by_year.items())},
        "countries": dict(countries.most_common(25)),
        "languages": dict(languages.most_common(25)),
        "top_directors": [
            {
                "director": d,
                "films": len(films_set),
                "avg_rating": _round(statistics.fmean(director_ratings[d]))
                if director_ratings[d] else None,
            }
            for d, films_set in directors
        ],
        "top_actors": [
            {
                "actor": a,
                "films": len(films_set),
                "avg_rating": _round(statistics.fmean(actor_ratings[a]))
                if actor_ratings[a] else None,
            }
            for a, films_set in actors
        ],
        "unique_actors": len(actor_films),
        "vs_community": {
            "mean_delta": _round(statistics.fmean(deltas)) if deltas else None,
            "verdict": (
                "harsh critic" if deltas and statistics.fmean(deltas) < -0.25
                else "generous" if deltas and statistics.fmean(deltas) > 0.25
                else "in line with the crowd"
            ) if deltas else None,
            "you_overrate": overrated,   # you >> community
            "you_underrate": underrated, # you << community
        },
    }


# ---------------------------------------------------------------------------
# Assemble
# ---------------------------------------------------------------------------

def compute_snapshot(
    watches: list[Watch],
    films: Optional[dict[int, dict]] = None,
    watchlist: Optional[list[WatchlistEntry]] = None,
    profile: Optional[Profile] = None,
) -> dict:
    """Build the full stat_snapshot payload."""
    enriched = _enriched_stats(watches, films) if films else None
    # The watchlist's TMDB stats only need its own films matched, not a matched diary,
    # so they're a section of their own — computed even when `enriched` is None (no
    # diary film matched). taste_gap still wants your watched genres, falling back to
    # nothing-to-compare when there are none.
    watched_genres = enriched["genres"] if enriched else {}
    payload: dict = {
        "schema_version": 1,
        "profile": {
            "username": profile.username if profile else None,
            "date_joined": profile.date_joined.isoformat()
            if profile and profile.date_joined else None,
            "favorite_films": profile.favorite_films if profile else [],
        },
        "core": {
            "totals": _totals(watches),
            "ratings": _rating_stats(watches),
            "era": _era_stats(watches),
            "rewatches": _rewatch_stats(watches),
            "activity": _activity_stats(watches),
            "watchlist": _watchlist_stats(watchlist, watches),
        },
        "enriched": enriched,
        "watchlist_enriched": _watchlist_enriched(watchlist, films, watched_genres) if films else None,
    }
    return payload

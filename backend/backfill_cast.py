"""One-off: backfill films.top_cast for rows enriched before migration 009.

The shared `films` cache is write-once — the enricher fetches TMDB details only on a
cold cache miss, so films already cached keep top_cast = null indefinitely (existing
rows are never re-touched). This re-fetches credits *by tmdb_id* (no re-matching) for
the null rows and fills in the top-8 billed cast.

Cursor-paginates by tmdb_id so a film that errors doesn't re-loop; safe to re-run
(already-filled rows leave the null set; cast-less films get [] and won't re-select).

    cd backend
    python backfill_cast.py --limit 25     # try a handful first
    python backfill_cast.py                # all remaining null rows

Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TMDB_API_KEY from env or repo-root .env.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from process_upload.enricher import SupabaseFilmCache, TmdbClient  # noqa: E402


def _load_env() -> None:
    # Existing env wins; otherwise fall back to the repo-root .env (like local_run).
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _patch_top_cast(cache: SupabaseFilmCache, tmdb_id: int, top_cast: list) -> None:
    # PATCH only top_cast — don't disturb vote_average/popularity that feed snapshots.
    req = urllib.request.Request(
        f"{cache.rest_url}?tmdb_id=eq.{int(tmdb_id)}",
        data=json.dumps({"top_cast": top_cast}).encode("utf-8"),
        method="PATCH",
        headers=cache._headers({"Content-Type": "application/json", "Prefer": "return=minimal"}),
    )
    with urllib.request.urlopen(req, timeout=10):
        pass


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Backfill films.top_cast for pre-009 rows.")
    ap.add_argument("--limit", type=int, help="max films to process this run")
    ap.add_argument("--batch", type=int, default=200, help="rows fetched per page")
    args = ap.parse_args(argv)

    _load_env()
    cache = SupabaseFilmCache.from_env()
    client = TmdbClient(os.environ["TMDB_API_KEY"])

    done = failed = 0
    last = -1  # tmdb_id cursor; advances past every row we touch, success or fail
    while args.limit is None or done < args.limit:
        page = args.batch if args.limit is None else min(args.batch, args.limit - done)
        rows = cache._request(
            "GET",
            f"{cache.rest_url}?top_cast=is.null&tmdb_id=gt.{last}"
            f"&select=tmdb_id,title&order=tmdb_id.asc&limit={page}",
        )
        if not rows:
            break
        for r in rows:
            last = r["tmdb_id"]
            try:
                details = client.movie_details(last)
                _patch_top_cast(cache, last, details.get("top_cast") or [])
                done += 1
            except Exception as e:  # one bad film shouldn't stop the run
                failed += 1
                print(f"  skip {last} ({r.get('title')!r}): {e!r}")
        print(f"… {done} updated, {failed} failed (cursor tmdb_id>{last})")

    print(f"Done. {done} films backfilled, {failed} failed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

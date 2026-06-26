"""One-off: recompute every user's stat snapshot from data already in the database
(watches + watchlist + films), with NO re-upload and NO TMDB calls.

Use after a stats.py change that adds or fixes snapshot fields — e.g. `enriched.films`
(genre drill-down) or the `watchlist_enriched` RSS regression — so existing users get
the new data without each having to re-export. The raw rows are already stored; only the
precomputed snapshot is stale, so we just recompute and upsert it.

    python -m process_upload.recompute_snapshots --dry-run   # list users, write nothing
    python -m process_upload.recompute_snapshots             # recompute everyone

Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment (service role, so it
can read/write every user's rows — same key the Lambda uses; never ships to the frontend).
"""
from __future__ import annotations

import argparse

from . import stats
from .persist import SupabaseWriter
# Reuse the RSS poller's row -> domain reconstructors (inverse of persist's row mappers).
from .rss_sync import _watch_from_row, _watchlist_from_row, _read_films, _profile_from_snapshot


def recompute_user(user_id: str, writer: SupabaseWriter) -> bool:
    """Rebuild and upsert one user's snapshot from their stored rows. Returns False
    (skip) if they have no watches yet."""
    watches = [_watch_from_row(r) for r in
               writer.select(f"/watches?user_id=eq.{user_id}&select=*")]
    if not watches:
        return False
    watchlist = [_watchlist_from_row(r) for r in
                 writer.select(f"/watchlist?user_id=eq.{user_id}&select=*")]
    # Films for watched AND watchlist titles (the watchlist actuary needs the latter).
    film_ids = {w.tmdb_id for w in watches if w.tmdb_id is not None}
    film_ids |= {e.tmdb_id for e in watchlist if e.tmdb_id is not None}
    films = _read_films(writer, film_ids)
    # Preserve profile fields (date_joined / favorite_films / username) that aren't stored
    # as columns — they only live in the prior snapshot.
    snap_rows = writer.select(f"/stat_snapshots?user_id=eq.{user_id}&select=payload")
    profile = _profile_from_snapshot(snap_rows[0]["payload"] if snap_rows else None)
    snapshot = stats.compute_snapshot(watches, films=films or None,
                                      watchlist=watchlist, profile=profile)
    writer.upsert("stat_snapshots", [{"user_id": user_id, "payload": snapshot}])
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Recompute all users' stat snapshots from stored DB data.")
    ap.add_argument("--dry-run", action="store_true", help="List users only; write nothing.")
    args = ap.parse_args(argv)

    writer = SupabaseWriter.from_env()
    users = writer.select("/profiles?select=id,lb_username")
    done = skipped = 0
    for u in users:
        uid, name = u["id"], u.get("lb_username")
        if args.dry_run:
            print(f"  would recompute {name or '(no username)'}  [{uid}]")
            done += 1
            continue
        if recompute_user(uid, writer):
            done += 1
            print(f"  recomputed {name or '(no username)'}  [{uid}]")
        else:
            skipped += 1
            print(f"  skipped {name or '(no username)'} — no watches  [{uid}]")

    verb = "would recompute" if args.dry_run else "recomputed"
    print(f"\n{verb} {done} user(s), skipped {skipped}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

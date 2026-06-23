"""Run the Phase 1 pipeline locally against your own export — no AWS/Supabase.

    python local_run.py path/to/letterboxd-export.zip --out out/stats.json
    python local_run.py path/to/export.zip --tmdb-key $TMDB_API_KEY --out out/stats.json
    python local_run.py path/to/unzipped_export_dir/                 # directory works too

Without --tmdb-key you still get the full "core" stats (totals, ratings, eras,
heatmap, rewatches). With a key you additionally get the "enriched" section
(runtime/hours, genres, directors, countries, harsh-critic comparison).

This mirrors what the Lambda will do; here the shared films cache is in-memory
and nothing is persisted except the JSON snapshot.

Run as a module from backend/:  python -m process_upload.local_run ...
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Allow running as a script (python local_run.py) or a module (-m).
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from process_upload import enricher, parser, stats
else:
    from . import enricher, parser, stats


def _resolve_tmdb_key(explicit: str | None) -> str | None:
    """Key precedence: --tmdb-key > TMDB_API_KEY env var > repo-root .env file."""
    if explicit:
        return explicit
    if os.environ.get("TMDB_API_KEY"):
        return os.environ["TMDB_API_KEY"]
    # repo root is two levels up from this file (backend/process_upload/).
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("TMDB_API_KEY=") and "=" in line:
                val = line.split("=", 1)[1].strip().strip('"').strip("'")
                if val:
                    return val
    return None


def main(argv: list[str] | None = None) -> int:
    # Console-print fallback: Windows consoles default to cp1252 and choke on
    # the summary's box-drawing chars. Switch stdout to UTF-8 where supported.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    ap = argparse.ArgumentParser(description="Parse a Letterboxd export and emit a stats JSON snapshot.")
    ap.add_argument("export", help="Path to the export .zip or an unzipped export directory")
    ap.add_argument("--tmdb-key", help="TMDB API key; enables the enriched stats section")
    ap.add_argument("--out", default="out/stats.json", help="Where to write the JSON snapshot")
    ap.add_argument("--limit", type=int, help="(debug) only enrich the first N unique films")
    args = ap.parse_args(argv)

    src = Path(args.export)
    if not src.exists():
        print(f"error: no such path: {src}", file=sys.stderr)
        return 2

    print(f"Parsing {src} ...")
    export = parser.parse_export(str(src))
    watches = parser.build_watches(export)
    print(f"  diary={len(export.diary)} ratings={len(export.ratings)} "
          f"reviews={len(export.reviews)} watched={len(export.watched)} "
          f"watchlist={len(export.watchlist)}")
    print(f"  -> {len(watches)} canonical watch rows")

    tmdb_key = _resolve_tmdb_key(args.tmdb_key)
    films: dict[int, dict] = {}
    unmatched: list = []
    if tmdb_key:
        if args.limit:
            watches = watches[: args.limit]
        client = enricher.TmdbClient(tmdb_key)
        cache = enricher.InMemoryFilmCache()

        def _progress(i: int, n: int) -> None:
            if i % 25 == 0 or i == n:
                print(f"\r  enriching {i}/{n} films ...", end="", flush=True)

        print("Enriching via TMDB ...")
        resolved: dict = {}
        films, unmatched = enricher.enrich_watches(watches, client, cache, _progress, resolved=resolved)
        print(f"\n  matched {len(films)} films; {len(unmatched)} unmatched")
        # Enrich the watchlist on the same pass (shared search memo) so the actuary's
        # runtime-to-clear has film runtimes. Skipped under --limit (debug) to keep
        # the run fast — that path only samples the diary anyway.
        if not args.limit and export.watchlist:
            print(f"Enriching watchlist ({len(export.watchlist)} entries) ...")
            enricher.enrich_watchlist(export.watchlist, client, cache,
                                      resolved=resolved, films_used=films)
    else:
        print("Skipping TMDB enrichment (no --tmdb-key); core stats only.")

    snapshot = stats.compute_snapshot(
        watches, films=films or None,
        watchlist=export.watchlist, profile=export.profile,
    )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, indent=2, default=str), encoding="utf-8")
    print(f"Wrote {out}")

    # Quick human-readable summary.
    core = snapshot["core"]
    print("\n── summary ──────────────────────────────")
    print(f"  unique films : {core['totals']['unique_films']}")
    print(f"  total logged : {core['totals']['total_logged']}")
    print(f"  mean rating  : {core['ratings']['mean']}")
    if snapshot["enriched"]:
        rt = snapshot["enriched"]["runtime"]
        print(f"  hours watched: {rt['total_hours']}")
        top = list(snapshot["enriched"]["genres"].items())[:3]
        print(f"  top genres   : {', '.join(f'{g} ({n})' for g, n in top)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

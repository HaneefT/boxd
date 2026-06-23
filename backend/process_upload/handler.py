"""AWS Lambda entry point for processing a Letterboxd export upload.

Async, two-mode design (DESIGN §4.1) so we never hit API Gateway's hard 30s
integration timeout on a cold first upload (whole-library TMDB enrichment > 30s):

  DISPATCH (sync, behind API GW HTTP API + Supabase JWT authorizer):
    POST /process   (Authorization: Bearer <supabase access token>)
      body: { "path": "<user_id>/export.zip" }   # object key in the `exports` bucket
      -> marks upload_jobs = processing, async self-invokes in WORKER mode, 202

  WORKER (async self-invocation, no HTTP):
    event: { "worker": true, "user_id": ..., "path": ... }
      -> downloads ZIP from Supabase Storage, runs the pipeline, writes the
         snapshot, deletes the ZIP, sets upload_jobs = done | failed

The SPA polls public.upload_jobs for status.
"""
from __future__ import annotations

import json
import os
from typing import Optional

from . import parser, stats, storage
from .enricher import SupabaseFilmCache, TmdbClient, enrich_watches, enrich_watchlist
from .persist import SupabaseWriter


def run_pipeline(zip_bytes: bytes, user_id: str, *,
                 client=None, cache=None, writer=None) -> dict:
    """parse -> merge -> enrich (TMDB) -> compute -> persist.

    Dependencies are injectable so this is testable without TMDB or Supabase.
    """
    export = parser.parse_export(zip_bytes)
    watches = parser.build_watches(export)

    client = client or TmdbClient(os.environ["TMDB_API_KEY"])
    cache = cache or SupabaseFilmCache.from_env()
    # Share the search memo so a film on both the diary and the watchlist is
    # resolved once; watchlist enrichment fills WatchlistEntry.tmdb_id in place.
    resolved: dict[str, Optional[int]] = {}
    films, unmatched = enrich_watches(watches, client, cache, resolved=resolved)
    enrich_watchlist(export.watchlist, client, cache, resolved=resolved, films_used=films)

    snapshot = stats.compute_snapshot(
        watches, films=films or None,
        watchlist=export.watchlist, profile=export.profile,
    )

    writer = writer or SupabaseWriter.from_env()
    writer.persist(user_id, export.profile, watches, export.watchlist, unmatched, snapshot)

    totals = snapshot["core"]["totals"]
    return {
        "unique_films": totals["unique_films"],
        "total_logged": totals["total_logged"],
        "unmatched": len(unmatched),
    }


# ---------------------------------------------------------------------------
# Worker: runs async, off the HTTP request path.
# ---------------------------------------------------------------------------

def _run_worker(user_id: str, path: str) -> None:
    writer = SupabaseWriter.from_env()
    try:
        zip_bytes = storage.download_export(path)
        run_pipeline(zip_bytes, user_id, writer=writer)
        try:
            storage.delete_export(path)  # don't retain the raw ZIP (DESIGN §2.6)
        except Exception as e:
            print(f"warning: could not delete {path}: {e!r}")
        writer.set_job(user_id, "done")
    except Exception as e:
        print(f"worker failed for user {user_id}, path {path}: {e!r}")
        writer.set_job(user_id, "failed", str(e))


# ---------------------------------------------------------------------------
# Dispatch: validate the request, kick off the worker, return immediately.
# ---------------------------------------------------------------------------

def _user_id(event: dict) -> str:
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    return claims["sub"]


def _resp(status: int, obj: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(obj),
    }


def _dispatch(event: dict) -> dict:
    try:
        user_id = _user_id(event)
    except (KeyError, TypeError):
        return _resp(401, {"error": "unauthorized"})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _resp(400, {"error": "invalid JSON body"})

    path = body.get("path")
    # Guard: a user may only process objects under their own folder.
    if not path or path.split("/", 1)[0] != user_id:
        return _resp(400, {"error": "path must be '<your user id>/<file>'"})

    writer = SupabaseWriter.from_env()
    writer.set_job(user_id, "processing")

    import boto3  # provided by the Lambda runtime
    boto3.client("lambda").invoke(
        FunctionName=os.environ["AWS_LAMBDA_FUNCTION_NAME"],
        InvocationType="Event",  # async; returns without waiting
        Payload=json.dumps({"worker": True, "user_id": user_id, "path": path}).encode(),
    )
    return _resp(202, {"ok": True, "status": "processing"})


def lambda_handler(event: dict, context: Optional[object] = None) -> dict:
    # Worker mode: async self-invocation carries this marker (no HTTP envelope).
    if isinstance(event, dict) and event.get("worker"):
        _run_worker(event["user_id"], event["path"])
        return {"ok": True}
    return _dispatch(event)

"""AWS Lambda entry point for processing a Letterboxd export upload.

Invoked behind API Gateway HTTP API with a Supabase JWT authorizer (DESIGN D4/D8),
so the caller's identity arrives as validated JWT claims — no token verification
here. The request body is the raw export ZIP (base64 for binary media types).

    POST /upload   (Authorization: Bearer <supabase access token>)
      body: the export .zip
      -> 200 { ok, unique_films, total_logged, unmatched }
"""
from __future__ import annotations

import base64
import json
import os
from typing import Optional

from . import parser, stats
from .enricher import SupabaseFilmCache, TmdbClient, enrich_watches
from .persist import SupabaseWriter


def run_pipeline(zip_bytes: bytes, user_id: str, *,
                 client=None, cache=None, writer=None) -> dict:
    """parse -> merge -> enrich (shared cache) -> compute -> persist.

    Dependencies are injectable so this is testable without TMDB or Supabase.
    """
    export = parser.parse_export(zip_bytes)
    watches = parser.build_watches(export)

    client = client or TmdbClient(os.environ["TMDB_API_KEY"])
    cache = cache or SupabaseFilmCache.from_env()
    films, unmatched = enrich_watches(watches, client, cache)

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
# Lambda glue
# ---------------------------------------------------------------------------

def _user_id(event: dict) -> str:
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    return claims["sub"]


def _body_bytes(event: dict) -> bytes:
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        return base64.b64decode(body)
    return body.encode("utf-8") if isinstance(body, str) else body


def _resp(status: int, obj: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(obj),
    }


def lambda_handler(event: dict, context: Optional[object] = None) -> dict:
    try:
        user_id = _user_id(event)
    except (KeyError, TypeError):
        return _resp(401, {"error": "unauthorized"})

    try:
        zip_bytes = _body_bytes(event)
        if not zip_bytes:
            return _resp(400, {"error": "empty body; expected an export .zip"})
        result = run_pipeline(zip_bytes, user_id)
        return _resp(200, {"ok": True, **result})
    except Exception as e:  # surface a clean error; full trace goes to CloudWatch
        print(f"upload pipeline failed for user {user_id}: {e!r}")
        return _resp(500, {"error": str(e)})

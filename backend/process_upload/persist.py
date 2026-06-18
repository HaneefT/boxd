"""Persist a processed upload to Supabase via PostgREST (stdlib only).

The Lambda uses the service_role key, which bypasses RLS. Re-uploads are made
idempotent by delete-and-replace per user_id (we can't dedup on lb_uri because
Letterboxd's diary/review URIs are per-viewing, not per-film — see
parser._film_key). The shared films table is written by the enricher, not here.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from .models import Profile, Watch, WatchlistEntry


# ---------------------------------------------------------------------------
# Pure domain -> table-row mappers (columns mirror db/migrations/001_init.sql).
# ---------------------------------------------------------------------------

def _iso(d) -> Optional[str]:
    return d.isoformat() if d is not None else None


def watch_rows(user_id: str, watches: list[Watch]) -> list[dict]:
    return [
        {
            "user_id": user_id,
            "tmdb_id": w.tmdb_id,
            "lb_uri": w.lb_uri,
            "title": w.title,
            "year": w.year,
            "watched_at": _iso(w.watched_at),
            "rating": w.rating,
            "is_rewatch": w.is_rewatch,
            "review_text": w.review_text,
            "tags": w.tags or None,
        }
        for w in watches
    ]


def watchlist_rows(user_id: str, entries: list[WatchlistEntry]) -> list[dict]:
    # PK is (user_id, lb_uri): skip rows without a URI and dedup on it.
    seen: set[str] = set()
    rows: list[dict] = []
    for e in entries:
        if not e.lb_uri or e.lb_uri in seen:
            continue
        seen.add(e.lb_uri)
        rows.append({
            "user_id": user_id,
            "tmdb_id": None,
            "lb_uri": e.lb_uri,
            "title": e.name,
            "year": e.year,
            "added_at": _iso(e.added_at),
        })
    return rows


def unmatched_rows(user_id: str, unmatched: list[Watch]) -> list[dict]:
    # Collapse repeat viewings so the fix-up UI lists each film once.
    seen: set[tuple] = set()
    rows: list[dict] = []
    for w in unmatched:
        key = ((w.title or "").strip().lower(), w.year)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "user_id": user_id,
            "raw_title": w.title,
            "raw_year": w.year,
            "lb_uri": w.lb_uri,
        })
    return rows


def profile_row(user_id: str, profile: Profile) -> dict:
    # Only the columns we own here; upsert leaves display_name/share_token intact.
    return {"id": user_id, "lb_username": profile.username}


# ---------------------------------------------------------------------------
# PostgREST writer
# ---------------------------------------------------------------------------

class SupabaseWriteError(Exception):
    pass


class SupabaseWriter:
    def __init__(self, base_url: str, service_key: str, timeout: float = 15.0,
                 chunk: int = 500):
        self.base = base_url.rstrip("/") + "/rest/v1"
        self.service_key = service_key
        self.timeout = timeout
        self.chunk = chunk

    @classmethod
    def from_env(cls) -> "SupabaseWriter":
        try:
            return cls(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        except KeyError as e:
            raise SupabaseWriteError(f"missing env var {e}") from e

    def persist(self, user_id: str, profile: Profile, watches: list[Watch],
                watchlist: list[WatchlistEntry], unmatched: list[Watch],
                snapshot: dict) -> None:
        # Order matters: films (FK target) are already upserted by the enricher.
        self.upsert("profiles", [profile_row(user_id, profile)])
        self.replace_user_rows("watches", user_id, watch_rows(user_id, watches))
        self.replace_user_rows("watchlist", user_id, watchlist_rows(user_id, watchlist))
        self.replace_user_rows("unmatched", user_id, unmatched_rows(user_id, unmatched))
        self.upsert("stat_snapshots", [{"user_id": user_id, "payload": snapshot}])

    def set_job(self, user_id: str, status: str, error: Optional[str] = None) -> None:
        """Upsert the user's upload_jobs row so the SPA can poll progress."""
        now = datetime.now(timezone.utc).isoformat()
        self.upsert("upload_jobs", [{
            "user_id": user_id, "status": status, "error": error,
            "updated_at": now,
        }])

    def replace_user_rows(self, table: str, user_id: str, rows: list[dict]) -> None:
        self._request("DELETE", f"/{table}?user_id=eq.{user_id}",
                      headers={"Prefer": "return=minimal"})
        self._insert_chunked(table, rows)

    def upsert(self, table: str, rows: list[dict]) -> None:
        self._insert_chunked(table, rows,
                             prefer="resolution=merge-duplicates,return=minimal")

    def _insert_chunked(self, table: str, rows: list[dict],
                        prefer: str = "return=minimal") -> None:
        for i in range(0, len(rows), self.chunk):
            self._request("POST", f"/{table}", body=rows[i:i + self.chunk],
                          headers={"Content-Type": "application/json", "Prefer": prefer})

    def _headers(self, extra: Optional[dict] = None) -> dict:
        h = {"apikey": self.service_key,
             "Authorization": f"Bearer {self.service_key}",
             "Accept": "application/json"}
        if extra:
            h.update(extra)
        return h

    def _request(self, method: str, path: str, body: Optional[list] = None,
                 headers: Optional[dict] = None) -> None:
        data = json.dumps(body, default=str).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers=self._headers(headers))
        try:
            with urllib.request.urlopen(req, timeout=self.timeout):
                return
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            raise SupabaseWriteError(f"Supabase {e.code} on {method} {path}: {detail}") from e
        except urllib.error.URLError as e:
            raise SupabaseWriteError(f"Supabase network error on {method} {path}: {e}") from e

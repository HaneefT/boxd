"""TMDB enrichment

Match each unique film to a TMDB id by (title, year), then fetch metadata once
and store it in the shared films cache.

The cache is abstract so the same enricher backs:
  - local runs  -> InMemoryFilmCache
  - the Lambda  -> a Supabase-backed cache (the shared public.films table)

Matching ~95% is expected; misses are returned for the `unmatched` fix-up UI.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Callable, Optional, Protocol

from .models import Watch

TMDB_BASE = "https://api.themoviedb.org/3"


# ---------------------------------------------------------------------------
# Shared films cache interface
# ---------------------------------------------------------------------------

class FilmCache(Protocol):
    def get(self, tmdb_id: int) -> Optional[dict]: ...
    def put(self, film: dict) -> None: ...
    def as_dict(self) -> dict[int, dict]: ...


class InMemoryFilmCache:
    """Trivial cache for local runs (and tests)."""

    def __init__(self, seed: Optional[dict[int, dict]] = None):
        self._films: dict[int, dict] = dict(seed or {})

    def get(self, tmdb_id: int) -> Optional[dict]:
        return self._films.get(tmdb_id)

    def put(self, film: dict) -> None:
        self._films[film["tmdb_id"]] = film

    def as_dict(self) -> dict[int, dict]:
        return dict(self._films)


class SupabaseError(Exception):
    pass


class SupabaseFilmCache:
    """FilmCache backed by the shared public.films table via PostgREST.

    One row per TMDB id, shared across every user, so a film is fetched from
    TMDB at most once ever. Reads/writes use the service_role key, which
    bypasses RLS (the films table has no anon/auth write policy — see
    db/migrations/002_rls.sql). `as_dict` returns only the films touched in this
    invocation, which is all `enrich_watches` needs.
    """

    # Columns mirror db/migrations/001_init.sql (minus *_at, server-set).
    _COLS = ("tmdb_id", "title", "year", "runtime", "genres", "director",
             "country", "language", "popularity", "vote_average", "poster_path")

    def __init__(self, base_url: str, service_key: str, timeout: float = 10.0):
        self.rest_url = base_url.rstrip("/") + "/rest/v1/films"
        self.service_key = service_key
        self.timeout = timeout
        self._seen: dict[int, dict] = {}

    @classmethod
    def from_env(cls) -> "SupabaseFilmCache":
        try:
            return cls(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        except KeyError as e:
            raise SupabaseError(f"missing env var {e}") from e

    def get(self, tmdb_id: int) -> Optional[dict]:
        if tmdb_id in self._seen:
            return self._seen[tmdb_id]
        cols = ",".join(self._COLS)
        rows = self._request(
            "GET", f"{self.rest_url}?tmdb_id=eq.{int(tmdb_id)}&select={cols}&limit=1"
        )
        if not rows:
            return None
        film = self._coerce(rows[0])
        self._seen[tmdb_id] = film
        return film

    def put(self, film: dict) -> None:
        row = {k: film.get(k) for k in self._COLS}
        # PostgREST upsert keyed on the films primary key (tmdb_id).
        self._request(
            "POST", self.rest_url, body=[row],
            headers={"Content-Type": "application/json",
                     "Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        self._seen[int(film["tmdb_id"])] = self._coerce(row)

    def as_dict(self) -> dict[int, dict]:
        return dict(self._seen)

    def _coerce(self, row: dict) -> dict:
        film = {k: row.get(k) for k in self._COLS}
        # numeric columns can arrive as JSON strings depending on PostgREST config.
        for k in ("popularity", "vote_average"):
            if film.get(k) is not None:
                film[k] = float(film[k])
        return film

    def _headers(self, extra: Optional[dict] = None) -> dict:
        h = {"apikey": self.service_key,
             "Authorization": f"Bearer {self.service_key}",
             "Accept": "application/json"}
        if extra:
            h.update(extra)
        return h

    def _request(self, method: str, url: str, body: Optional[list] = None,
                 headers: Optional[dict] = None) -> list:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method,
                                     headers=self._headers(headers))
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else []
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            raise SupabaseError(f"Supabase {e.code} on {method} films: {detail}") from e
        except urllib.error.URLError as e:
            raise SupabaseError(f"Supabase network error on {method} films: {e}") from e


# ---------------------------------------------------------------------------
# TMDB client
# ---------------------------------------------------------------------------

class TmdbError(Exception):
    pass


class TmdbClient:
    def __init__(self, api_key: str, min_interval: float = 0.025, timeout: float = 10.0):
        # min_interval ~= 40 req/s, within TMDB's limit (DESIGN §4.4).
        self.api_key = api_key
        self.min_interval = min_interval
        self.timeout = timeout
        self._last_call = 0.0

    def _get(self, path: str, params: dict) -> dict:
        params = {**params, "api_key": self.api_key}
        url = f"{TMDB_BASE}{path}?{urllib.parse.urlencode(params)}"
        for attempt in range(4):
            wait = self.min_interval - (time.monotonic() - self._last_call)
            if wait > 0:
                time.sleep(wait)
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    self._last_call = time.monotonic()
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                self._last_call = time.monotonic()
                if e.code == 429:  # rate limited -> honor Retry-After then retry
                    time.sleep(float(e.headers.get("Retry-After", "1")) + 0.5)
                    continue
                raise TmdbError(f"TMDB {e.code} for {path}") from e
            except urllib.error.URLError as e:
                if attempt == 3:
                    raise TmdbError(f"TMDB network error for {path}: {e}") from e
                time.sleep(0.5 * (attempt + 1))
        raise TmdbError(f"TMDB exhausted retries for {path}")

    def search_movie(self, title: str, year: Optional[int]) -> Optional[int]:
        params = {"query": title, "include_adult": "false"}
        if year:
            params["year"] = year
        results = self._get("/search/movie", params).get("results", [])
        if not results and year:  # retry without the year constraint
            results = self._get("/search/movie", {"query": title,
                                                  "include_adult": "false"}).get("results", [])
        return results[0]["id"] if results else None

    def movie_details(self, tmdb_id: int) -> dict:
        """Fetch details + credits and shape them to the `films` table row."""
        d = self._get(f"/movie/{tmdb_id}", {"append_to_response": "credits"})
        director = next(
            (c["name"] for c in d.get("credits", {}).get("crew", [])
             if c.get("job") == "Director"),
            None,
        )
        countries = d.get("production_countries") or []
        release = d.get("release_date") or ""
        return {
            "tmdb_id": d["id"],
            "title": d.get("title"),
            "year": int(release[:4]) if release[:4].isdigit() else None,
            "runtime": d.get("runtime") or None,
            "genres": [g["name"] for g in d.get("genres", [])],
            "director": director,
            "country": countries[0]["name"] if countries else None,
            "language": d.get("original_language"),
            "popularity": d.get("popularity"),
            "vote_average": d.get("vote_average"),
            "poster_path": d.get("poster_path"),
        }


# ---------------------------------------------------------------------------
# Enrichment driver
# ---------------------------------------------------------------------------

def _film_id(name: Optional[str], year: Optional[int]) -> str:
    # Stable film identity = normalised title + year (matches parser._film_key).
    return f"nm:{(name or '').strip().lower()}|{year or ''}"


def _film_key(w: Watch) -> str:
    # Group viewings of one film by (title, year) — the same basis TMDB matches
    # on — so each film is searched once. Letterboxd's per-viewing diary/review
    # URIs must not be used here (see parser._film_key).
    return _film_id(w.title, w.year)


def enrich_watches(
    watches: list[Watch],
    client: TmdbClient,
    cache: FilmCache,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> tuple[dict[int, dict], list[Watch]]:
    """Resolve TMDB ids for every watch and populate the cache.

    Mutates each Watch's `tmdb_id` in place. Returns (films_by_tmdb, unmatched)
    where `unmatched` is the list of watches TMDB couldn't resolve.
    """
    # One match attempt per unique film, then fan out to its watches.
    by_film: dict[str, list[Watch]] = {}
    for w in watches:
        by_film.setdefault(_film_key(w), []).append(w)

    films_used: dict[int, dict] = {}
    unmatched: list[Watch] = []
    total = len(by_film)

    for i, (_key, group) in enumerate(by_film.items(), start=1):
        sample = group[0]
        tmdb_id = client.search_movie(sample.title, sample.year)
        if tmdb_id is None:
            unmatched.extend(group)
        else:
            film = cache.get(tmdb_id)
            if film is None:                       # cold cache -> fetch once
                film = client.movie_details(tmdb_id)
                cache.put(film)
            films_used[tmdb_id] = film
            for w in group:
                w.tmdb_id = tmdb_id
        if on_progress:
            on_progress(i, total)

    return films_used, unmatched

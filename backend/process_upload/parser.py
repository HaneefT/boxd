"""Parse a Letterboxd data-export ZIP into typed records (stdlib only).

The export (Settings -> Data -> Export your data) is a ZIP of CSVs. Real column
layouts this parser targets:

    profile.csv    Date Joined, Username, Given Name, Family Name, Email,
                   Location, Website, Bio, Pronoun, Favorite Films
    watched.csv    Date, Name, Year, Letterboxd URI
    diary.csv      Date, Name, Year, Letterboxd URI, Rating, Rewatch, Tags, Watched Date
    ratings.csv    Date, Name, Year, Letterboxd URI, Rating
    reviews.csv    Date, Name, Year, Letterboxd URI, Rating, Rewatch, Review, Tags, Watched Date
    watchlist.csv  Date, Name, Year, Letterboxd URI

Files are matched by basename, so a flat ZIP or an unzipped directory both work.
Missing files are tolerated (not every account has reviews, etc.).
"""
from __future__ import annotations

import csv
import io
import os
import zipfile
from datetime import date, datetime
from pathlib import Path
from typing import Iterable, Iterator, Optional, Union

from .models import (
    DiaryEntry,
    ParsedExport,
    Profile,
    RatingEntry,
    ReviewEntry,
    Watch,
    WatchedEntry,
    WatchlistEntry,
)

PathLike = Union[str, os.PathLike]


# ---------------------------------------------------------------------------
# Field coercion helpers — all tolerant of blanks/garbage (never raise).
# ---------------------------------------------------------------------------

def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%SZ", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _parse_int(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        return int(value.strip())
    except ValueError:
        return None


def _parse_rating(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        r = float(value.strip())
    except ValueError:
        return None
    return r if 0.5 <= r <= 5.0 else None


def _parse_bool(value: Optional[str]) -> bool:
    return (value or "").strip().lower() in ("yes", "true", "1")


def _parse_tags(value: Optional[str]) -> list[str]:
    if not value:
        return []
    return [t.strip() for t in value.split(",") if t.strip()]


def _parse_favorites(value: Optional[str]) -> list[str]:
    if not value:
        return []
    return [f.strip() for f in value.split(",") if f.strip()]


# ---------------------------------------------------------------------------
# ZIP / directory access
# ---------------------------------------------------------------------------

class ExportSource:
    """Uniform reader over an export, whether a ZIP path, ZIP bytes, or a
    directory of CSVs. Yields decoded text streams keyed by basename."""

    def __init__(self, src: Union[PathLike, bytes]):
        self._zip: Optional[zipfile.ZipFile] = None
        self._dir: Optional[Path] = None
        # Map of lowercase basename/relative-path -> member name.
        self._members: dict[str, str] = {}

        if isinstance(src, bytes):
            self._zip = zipfile.ZipFile(io.BytesIO(src))
        else:
            p = Path(src)
            if p.is_dir():
                self._dir = p
            else:
                self._zip = zipfile.ZipFile(p)

        if self._zip is not None:
            for name in self._zip.namelist():
                if not name.endswith("/"):
                    self._members[name.lower()] = name

    def _find(self, basename: str) -> Optional[str]:
        """Find a member by basename (e.g. 'diary.csv'), ignoring any folder prefix."""
        target = basename.lower()
        if self._dir is not None:
            for path in self._dir.rglob(basename):
                if path.is_file():
                    return str(path)
            return None
        for key, original in self._members.items():
            if key == target or key.endswith("/" + target):
                return original
        return None

    def open_csv(self, basename: str) -> Optional[Iterator[dict]]:
        """Return a DictReader over the named CSV, or None if absent."""
        member = self._find(basename)
        if member is None:
            return None
        if self._dir is not None:
            text = Path(member).read_text(encoding="utf-8-sig", errors="replace")
        else:
            assert self._zip is not None
            raw = self._zip.read(member)
            text = raw.decode("utf-8-sig", errors="replace")
        return csv.DictReader(io.StringIO(text))

    def list_subfiles(self, folder: str) -> list[str]:
        """Member names under a subfolder (e.g. 'lists', 'likes'). For future use."""
        prefix = folder.lower().rstrip("/") + "/"
        if self._dir is not None:
            base = self._dir / folder
            return [str(p) for p in base.rglob("*.csv")] if base.is_dir() else []
        return [orig for key, orig in self._members.items() if key.startswith(prefix)]

    def close(self) -> None:
        if self._zip is not None:
            self._zip.close()

    def __enter__(self) -> "ExportSource":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


# ---------------------------------------------------------------------------
# Per-file parsers
# ---------------------------------------------------------------------------

def _g(row: dict, *keys: str) -> Optional[str]:
    """Get the first present, non-None column among `keys` (header tolerance)."""
    for k in keys:
        if k in row and row[k] is not None:
            return row[k]
    return None


def _parse_profile(rows: Optional[Iterable[dict]]) -> Profile:
    if not rows:
        return Profile()
    for row in rows:  # profile.csv has a single data row
        return Profile(
            username=_g(row, "Username"),
            given_name=_g(row, "Given Name"),
            family_name=_g(row, "Family Name"),
            date_joined=_parse_date(_g(row, "Date Joined")),
            location=_g(row, "Location"),
            bio=_g(row, "Bio"),
            favorite_films=_parse_favorites(_g(row, "Favorite Films")),
        )
    return Profile()


def _parse_diary(rows: Optional[Iterable[dict]]) -> list[DiaryEntry]:
    out: list[DiaryEntry] = []
    for row in rows or []:
        out.append(DiaryEntry(
            name=_g(row, "Name") or "",
            year=_parse_int(_g(row, "Year")),
            lb_uri=_g(row, "Letterboxd URI"),
            logged_at=_parse_date(_g(row, "Date")),
            watched_at=_parse_date(_g(row, "Watched Date")),
            rating=_parse_rating(_g(row, "Rating")),
            is_rewatch=_parse_bool(_g(row, "Rewatch")),
            tags=_parse_tags(_g(row, "Tags")),
        ))
    return out


def _parse_ratings(rows: Optional[Iterable[dict]]) -> list[RatingEntry]:
    out: list[RatingEntry] = []
    for row in rows or []:
        out.append(RatingEntry(
            name=_g(row, "Name") or "",
            year=_parse_int(_g(row, "Year")),
            lb_uri=_g(row, "Letterboxd URI"),
            rated_at=_parse_date(_g(row, "Date")),
            rating=_parse_rating(_g(row, "Rating")),
        ))
    return out


def _parse_watched(rows: Optional[Iterable[dict]]) -> list[WatchedEntry]:
    out: list[WatchedEntry] = []
    for row in rows or []:
        out.append(WatchedEntry(
            name=_g(row, "Name") or "",
            year=_parse_int(_g(row, "Year")),
            lb_uri=_g(row, "Letterboxd URI"),
            watched_at=_parse_date(_g(row, "Date")),
        ))
    return out


def _parse_reviews(rows: Optional[Iterable[dict]]) -> list[ReviewEntry]:
    out: list[ReviewEntry] = []
    for row in rows or []:
        out.append(ReviewEntry(
            name=_g(row, "Name") or "",
            year=_parse_int(_g(row, "Year")),
            lb_uri=_g(row, "Letterboxd URI"),
            watched_at=_parse_date(_g(row, "Watched Date")),
            rating=_parse_rating(_g(row, "Rating")),
            is_rewatch=_parse_bool(_g(row, "Rewatch")),
            review_text=_g(row, "Review"),
            tags=_parse_tags(_g(row, "Tags")),
        ))
    return out


def _parse_watchlist(rows: Optional[Iterable[dict]]) -> list[WatchlistEntry]:
    out: list[WatchlistEntry] = []
    for row in rows or []:
        out.append(WatchlistEntry(
            name=_g(row, "Name") or "",
            year=_parse_int(_g(row, "Year")),
            lb_uri=_g(row, "Letterboxd URI"),
            added_at=_parse_date(_g(row, "Date")),
        ))
    return out


# ---------------------------------------------------------------------------
# Top-level parse + merge
# ---------------------------------------------------------------------------

def parse_export(src: Union[PathLike, bytes]) -> ParsedExport:
    """Parse an export ZIP (path or bytes) or an unzipped directory."""
    with ExportSource(src) as source:
        return ParsedExport(
            profile=_parse_profile(source.open_csv("profile.csv")),
            diary=_parse_diary(source.open_csv("diary.csv")),
            ratings=_parse_ratings(source.open_csv("ratings.csv")),
            watched=_parse_watched(source.open_csv("watched.csv")),
            reviews=_parse_reviews(source.open_csv("reviews.csv")),
            watchlist=_parse_watchlist(source.open_csv("watchlist.csv")),
        )


def _film_key(name: str, year: Optional[int]) -> str:
    """Stable film identity = normalised title + year.

    Deliberately NOT keyed on the Letterboxd URI: diary.csv and reviews.csv
    carry a *per-viewing* URI while watched.csv/ratings.csv carry the film's
    *canonical* URI, so URI-keying would treat one film as several and break
    dedup + rewatch detection. (title, year) is also what TMDB matches on.
    """
    return f"nm:{(name or '').strip().lower()}|{year or ''}"


def build_watches(export: ParsedExport) -> list[Watch]:
    """Merge diary + reviews + ratings + watched into canonical Watch rows.

    Strategy:
      - diary.csv is authoritative for dated viewings (incl. rewatches) -> one
        Watch each.
      - reviews.csv supplies review_text, matched onto the diary viewing with
        the same film + watched date; unmatched reviews become their own Watch.
      - ratings.csv supplies the current rating for films never diarised
        (watched_at unknown).
      - watched.csv backfills films marked watched but neither diarised nor
        rated, so total film count is complete.
    """
    watches: list[Watch] = []

    # 1) Diary -> Watch (the spine).
    diary_index: dict[tuple[str, Optional[date]], Watch] = {}
    seen_films: set[str] = set()
    for d in export.diary:
        w = Watch(
            title=d.name,
            year=d.year,
            lb_uri=d.lb_uri,
            watched_at=d.watched_at or d.logged_at,
            rating=d.rating,
            is_rewatch=d.is_rewatch,
            tags=list(d.tags),
        )
        watches.append(w)
        key = _film_key(d.name, d.year)
        seen_films.add(key)
        diary_index[(key, w.watched_at)] = w

    # 2) Reviews -> attach text, or add as standalone viewings.
    for r in export.reviews:
        key = _film_key(r.name, r.year)
        match = diary_index.get((key, r.watched_at))
        if match is not None:
            match.review_text = r.review_text
            if match.rating is None:
                match.rating = r.rating
            if not match.tags and r.tags:
                match.tags = list(r.tags)
        else:
            watches.append(Watch(
                title=r.name, year=r.year, lb_uri=r.lb_uri,
                watched_at=r.watched_at, rating=r.rating,
                is_rewatch=r.is_rewatch, review_text=r.review_text,
                tags=list(r.tags),
            ))
            seen_films.add(key)

    # 3) Ratings for films never seen above -> undated rated viewing.
    for rt in export.ratings:
        key = _film_key(rt.name, rt.year)
        if key in seen_films:
            continue
        watches.append(Watch(
            title=rt.name, year=rt.year, lb_uri=rt.lb_uri,
            watched_at=None, rating=rt.rating,
        ))
        seen_films.add(key)

    # 4) Watched-only films -> backfill so counts are complete.
    for wd in export.watched:
        key = _film_key(wd.name, wd.year)
        if key in seen_films:
            continue
        watches.append(Watch(
            title=wd.name, year=wd.year, lb_uri=wd.lb_uri,
            watched_at=wd.watched_at, rating=None,
        ))
        seen_films.add(key)

    return watches

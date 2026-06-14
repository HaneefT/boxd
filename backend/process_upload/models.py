"""Typed records for the parsed Letterboxd export.

Kept dependency-free (stdlib only) so parsing/merging is unit-testable offline.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional


@dataclass
class Profile:
    username: Optional[str] = None
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    date_joined: Optional[date] = None
    location: Optional[str] = None
    bio: Optional[str] = None
    favorite_films: list[str] = field(default_factory=list)


@dataclass
class DiaryEntry:
    """One row of diary.csv — a dated viewing with optional rating/rewatch/tags."""
    name: str
    year: Optional[int]
    lb_uri: Optional[str]
    logged_at: Optional[date]      # "Date" — when the entry was logged
    watched_at: Optional[date]     # "Watched Date" — when the film was actually seen
    rating: Optional[float]        # 0.5 .. 5.0
    is_rewatch: bool
    tags: list[str] = field(default_factory=list)


@dataclass
class RatingEntry:
    """One row of ratings.csv — the user's current rating for a film."""
    name: str
    year: Optional[int]
    lb_uri: Optional[str]
    rated_at: Optional[date]
    rating: Optional[float]


@dataclass
class WatchedEntry:
    """One row of watched.csv — a film ever marked watched (no rating/date detail)."""
    name: str
    year: Optional[int]
    lb_uri: Optional[str]
    watched_at: Optional[date]


@dataclass
class ReviewEntry:
    """One row of reviews.csv — review text tied to a viewing."""
    name: str
    year: Optional[int]
    lb_uri: Optional[str]
    watched_at: Optional[date]
    rating: Optional[float]
    is_rewatch: bool
    review_text: Optional[str]
    tags: list[str] = field(default_factory=list)


@dataclass
class WatchlistEntry:
    name: str
    year: Optional[int]
    lb_uri: Optional[str]
    added_at: Optional[date]


@dataclass
class ParsedExport:
    """Raw, per-file view of the export. Merging into canonical watches is a
    separate step (parser.build_watches) so each stage stays testable."""
    profile: Profile = field(default_factory=Profile)
    diary: list[DiaryEntry] = field(default_factory=list)
    ratings: list[RatingEntry] = field(default_factory=list)
    watched: list[WatchedEntry] = field(default_factory=list)
    reviews: list[ReviewEntry] = field(default_factory=list)
    watchlist: list[WatchlistEntry] = field(default_factory=list)


@dataclass
class Watch:
    """Canonical merged viewing — one row destined for the `watches` table.

    Built by merging diary (authoritative for dated viewings), reviews (text),
    and ratings (films rated but never diarised). `tmdb_id` is filled in by the
    enricher; null means unmatched.
    """
    title: str
    year: Optional[int]
    lb_uri: Optional[str]
    watched_at: Optional[date]
    rating: Optional[float]
    is_rewatch: bool = False
    review_text: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    tmdb_id: Optional[int] = None

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


def _watchlist_stats(watchlist: Optional[list[WatchlistEntry]]) -> dict:
    if not watchlist:
        return {"count": 0}
    years = [e.year for e in watchlist if e.year]
    added = sorted(e.added_at for e in watchlist if e.added_at)
    return {
        "count": len(watchlist),
        "avg_year": _round(statistics.fmean(years), 0) if years else None,
        "oldest_year": min(years) if years else None,
        "first_added": added[0].isoformat() if added else None,
        "last_added": added[-1].isoformat() if added else None,
    }


# ---------------------------------------------------------------------------
# Enriched (TMDB) stats
# ---------------------------------------------------------------------------

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

    # Harsh-critic comparison on a 5-star scale: your rating vs TMDB's
    # vote_average rescaled from /10 to /5. One row per film so the lists
    # aren't padded with repeat viewings.
    deltas = []
    scored = []
    for w in unique:
        f = films[w.tmdb_id]
        va = f.get("vote_average")
        if w.rating is not None and va:
            you = w.rating
            community = va / 2.0
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
            "watchlist": _watchlist_stats(watchlist),
        },
        "enriched": _enriched_stats(watches, films) if films else None,
    }
    return payload

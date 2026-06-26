"""Parse a Letterboxd diary RSS feed into canonical Watch rows (DESIGN §2.4, D9).

The feed at letterboxd.com/<user>/rss/ is a published syndication feed. Each diary
<item> carries structured letterboxd:/tmdb: fields — including <tmdb:movieId> — so an
entry maps straight to a Watch with its tmdb_id already resolved (no TMDB search).
Non-diary items (lists, likes, anything without a letterboxd:watchedDate) are skipped.

Stdlib only (xml.etree). This is read-only consumption of a published feed, not
scraping — the deleted `letterboxd.py` scraper hit HTML pages; this does not.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional
from xml.etree import ElementTree as ET

from .models import Watch

# Namespace URIs declared on the <rss> root (xmlns:letterboxd / xmlns:tmdb).
_LB = "{https://letterboxd.com}"
_TMDB = "{https://themoviedb.org}"

_TAG_RE = re.compile(r"<[^>]+>")
# Letterboxd auto-fills "Watched on <weekday> <month> <day>, <year>." when there's no
# real review; treat that as no review rather than storing boilerplate.
_WATCHED_RE = re.compile(r"^watched on .+\.$", re.IGNORECASE)


def parse_rss(xml: str) -> list[Watch]:
    """Parse RSS XML into Watch rows, in feed order (newest first). Diary entries only."""
    root = ET.fromstring(xml)
    watches: list[Watch] = []
    for item in root.iter("item"):
        watched = _parse_date(_text(item, f"{_LB}watchedDate"))
        if watched is None:
            continue  # not a diary entry (list/like/follow/etc.)
        year = _text(item, f"{_LB}filmYear")
        rating = _text(item, f"{_LB}memberRating")
        tmdb_id = _text(item, f"{_TMDB}movieId")
        watches.append(
            Watch(
                title=_text(item, f"{_LB}filmTitle") or "",
                year=int(year) if year and year.isdigit() else None,
                lb_uri=_text(item, "link"),
                watched_at=watched,
                rating=float(rating) if rating else None,  # absent when unrated
                is_rewatch=(_text(item, f"{_LB}rewatch") or "").strip().lower() == "yes",
                review_text=_review_text(_text(item, "description")),
                tmdb_id=int(tmdb_id) if tmdb_id and tmdb_id.isdigit() else None,
            )
        )
    return watches


def _text(item: ET.Element, tag: str) -> Optional[str]:
    el = item.find(tag)
    return el.text.strip() if el is not None and el.text else None


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        y, m, d = (int(x) for x in s.split("-"))
        return date(y, m, d)
    except (ValueError, TypeError):
        return None


def _review_text(desc: Optional[str]) -> Optional[str]:
    """The <description> CDATA is "<p><img poster/></p><p>review-or-'Watched on…'</p>".
    Strip the HTML and drop the auto-generated "Watched on …" stub."""
    if not desc:
        return None
    text = re.sub(r"\s+", " ", _TAG_RE.sub(" ", desc)).strip()
    if not text or _WATCHED_RE.match(text):
        return None
    return text

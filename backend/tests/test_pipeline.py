"""Offline smoke test: synthetic export ZIP -> parse -> merge -> stats.

No TMDB, no cloud. Run from backend/:
    python -m pytest tests/ -q
    # or, without pytest installed:
    python tests/test_pipeline.py
"""
from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from process_upload import parser, stats  # noqa: E402
from process_upload.enricher import InMemoryFilmCache, enrich_watches  # noqa: E402


def _make_export_zip() -> bytes:
    files = {
        "profile.csv":
            "Date Joined,Username,Given Name,Family Name,Favorite Films\n"
            "2018-03-01,cinephile,Sam,Doe,\"Heat, Sicario\"\n",
        "diary.csv":
            "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n"
            "2024-01-01,Heat,1995,https://boxd.it/aaa,4.5,No,crime,2024-01-01\n"
            "2024-01-02,Sicario,2015,https://boxd.it/bbb,5.0,No,,2024-01-02\n"
            "2024-01-03,Heat,1995,https://boxd.it/aaa,4.0,Yes,,2024-01-03\n",
        "ratings.csv":
            "Date,Name,Year,Letterboxd URI,Rating\n"
            "2023-12-01,Dune,2021,https://boxd.it/ccc,3.5\n",
        "reviews.csv":
            "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n"
            "2024-01-02,Sicario,2015,https://boxd.it/bbb,5.0,No,Tense masterpiece.,,2024-01-02\n",
        "watched.csv":
            "Date,Name,Year,Letterboxd URI\n"
            "2024-01-01,Heat,1995,https://boxd.it/aaa\n"
            "2024-01-02,Sicario,2015,https://boxd.it/bbb\n"
            "2022-06-01,Old Boy,2003,https://boxd.it/ddd\n",
        "watchlist.csv":
            "Date,Name,Year,Letterboxd URI\n"
            "2024-02-01,Tenet,2020,https://boxd.it/eee\n",
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def test_parse_and_merge():
    export = parser.parse_export(_make_export_zip())
    assert export.profile.username == "cinephile"
    assert export.profile.favorite_films == ["Heat", "Sicario"]
    assert len(export.diary) == 3
    assert len(export.watchlist) == 1

    watches = parser.build_watches(export)
    # Heat (x2 diary), Sicario (x1), Dune (ratings-only), Old Boy (watched-only) = 5
    assert len(watches) == 5
    titles = sorted(w.title for w in watches)
    assert titles == ["Dune", "Heat", "Heat", "Old Boy", "Sicario"]

    sicario = next(w for w in watches if w.title == "Sicario")
    assert sicario.review_text == "Tense masterpiece."

    rewatch = [w for w in watches if w.title == "Heat" and w.is_rewatch]
    assert len(rewatch) == 1


def test_core_stats():
    export = parser.parse_export(_make_export_zip())
    watches = parser.build_watches(export)
    snap = stats.compute_snapshot(watches, watchlist=export.watchlist, profile=export.profile)

    core = snap["core"]
    assert core["totals"]["unique_films"] == 4
    assert core["totals"]["total_logged"] == 5
    assert core["ratings"]["count"] == 4          # Heat x2, Sicario, Dune
    assert core["rewatches"]["films_rewatched"] == 1
    assert core["era"]["oldest_year"] == 1995
    assert core["watchlist"]["count"] == 1
    assert snap["enriched"] is None               # no TMDB supplied


def test_enriched_with_fake_cache():
    """Enrich against a pre-seeded cache + stub client (no network)."""
    export = parser.parse_export(_make_export_zip())
    watches = parser.build_watches(export)

    seed = {
        100: {"tmdb_id": 100, "title": "Heat", "year": 1995, "runtime": 170,
              "genres": ["Crime", "Drama"], "director": "Michael Mann",
              "country": "United States", "language": "en", "vote_average": 7.9},
        101: {"tmdb_id": 101, "title": "Sicario", "year": 2015, "runtime": 121,
              "genres": ["Action", "Crime"], "director": "Denis Villeneuve",
              "country": "United States", "language": "en", "vote_average": 7.6},
    }
    cache = InMemoryFilmCache(seed)

    class StubClient:
        def search_movie(self, title, year):
            return {"Heat": 100, "Sicario": 101}.get(title)
        def movie_details(self, tmdb_id):
            return seed[tmdb_id]

    films, unmatched = enrich_watches(watches, StubClient(), cache)
    snap = stats.compute_snapshot(watches, films=films)

    enr = snap["enriched"]
    assert enr is not None
    assert enr["matched_films"] == 2
    # Heat watched twice (170*2) + Sicario once (121) = 461 minutes
    assert enr["runtime"]["total_minutes"] == 461
    assert "Crime" in enr["genres"]
    # Dune + Old Boy weren't in the stub -> unmatched
    assert {w.title for w in unmatched} == {"Dune", "Old Boy"}


def _make_per_viewing_uri_zip() -> bytes:
    """Mirrors a real export: diary/reviews use *per-viewing* URIs while
    watched/ratings use the film's *canonical* URI. The same film therefore
    arrives under different URIs and must still dedup to one film."""
    files = {
        "profile.csv":
            "Date Joined,Username\n2018-03-01,cinephile\n",
        # Heat watched twice -> two diary URIs; Sicario once.
        "diary.csv":
            "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n"
            "2024-01-01,Heat,1995,https://boxd.it/view1,4.5,No,,2024-01-01\n"
            "2024-03-09,Heat,1995,https://boxd.it/view2,4.0,Yes,,2024-03-09\n"
            "2024-01-02,Sicario,2015,https://boxd.it/view3,5.0,No,,2024-01-02\n",
        # Canonical film URIs, all different from the diary URIs above.
        "ratings.csv":
            "Date,Name,Year,Letterboxd URI,Rating\n"
            "2024-01-01,Heat,1995,https://boxd.it/heat,4.0\n"
            "2024-01-02,Sicario,2015,https://boxd.it/sicario,5.0\n",
        "watched.csv":
            "Date,Name,Year,Letterboxd URI\n"
            "2024-01-01,Heat,1995,https://boxd.it/heat\n"
            "2024-01-02,Sicario,2015,https://boxd.it/sicario\n",
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def test_per_viewing_uris_dedup_to_film():
    export = parser.parse_export(_make_per_viewing_uri_zip())
    watches = parser.build_watches(export)

    # 2 Heat viewings + 1 Sicario viewing = 3 watches; the canonical-URI rows
    # in ratings/watched must NOT add phantom films.
    assert len(watches) == 3
    assert sorted(w.title for w in watches) == ["Heat", "Heat", "Sicario"]

    snap = stats.compute_snapshot(watches)
    core = snap["core"]
    assert core["totals"]["unique_films"] == 2     # Heat, Sicario
    assert core["totals"]["total_logged"] == 3     # rewatch counts as a viewing
    assert core["rewatches"]["films_rewatched"] == 1
    assert core["rewatches"]["most_rewatched"][0]["title"] == "Heat"


def test_supabase_film_cache_logic():
    """Exercise SupabaseFilmCache get/put/upsert/coercion with a fake transport."""
    import re
    from process_upload.enricher import SupabaseFilmCache

    class FakeCache(SupabaseFilmCache):
        def __init__(self):
            super().__init__("https://proj.supabase.co", "service-key")
            self.table: dict[int, dict] = {}
            self.get_calls = 0

        def _request(self, method, url, body=None, headers=None):
            if method == "GET":
                self.get_calls += 1
                tid = int(re.search(r"tmdb_id=eq\.(\d+)", url).group(1))
                row = self.table.get(tid)
                # numeric columns come back as strings (PostgREST default).
                if row:
                    row = {**row, "vote_average": str(row["vote_average"])}
                return [row] if row else []
            if method == "POST":  # upsert
                for r in body:
                    self.table[int(r["tmdb_id"])] = r
                return []
            raise AssertionError(method)

    c = FakeCache()
    assert c.get(100) is None  # cold miss hits the transport
    assert c.get_calls == 1

    c.put({"tmdb_id": 100, "title": "Heat", "year": 1995, "runtime": 170,
           "genres": ["Crime", "Drama"], "director": "Michael Mann",
           "country": "United States", "language": "en",
           "popularity": 12.3, "vote_average": 7.913, "poster_path": "/x.jpg"})

    got = c.get(100)              # served from the in-invocation cache after put
    assert c.get_calls == 1       # no extra GET
    assert got["title"] == "Heat"
    assert got["genres"] == ["Crime", "Drama"]
    assert got["vote_average"] == 7.913 and isinstance(got["vote_average"], float)
    assert c.as_dict()[100]["director"] == "Michael Mann"

    # A second instance reads the persisted row and coerces the string numeric.
    c2 = FakeCache()
    c2.table = c.table
    fresh = c2.get(100)
    assert fresh["vote_average"] == 7.913


def test_run_pipeline_persists_rows():
    """End-to-end run_pipeline with stub TMDB + a capturing writer (no network)."""
    from process_upload.enricher import InMemoryFilmCache
    from process_upload.handler import run_pipeline
    from process_upload.persist import SupabaseWriter

    seed = {
        100: {"tmdb_id": 100, "title": "Heat", "year": 1995, "runtime": 170,
              "genres": ["Crime", "Drama"], "director": "Michael Mann",
              "country": "United States", "language": "en", "vote_average": 7.9},
        101: {"tmdb_id": 101, "title": "Sicario", "year": 2015, "runtime": 121,
              "genres": ["Action", "Crime"], "director": "Denis Villeneuve",
              "country": "United States", "language": "en", "vote_average": 7.6},
    }

    class StubClient:
        def search_movie(self, title, _year):
            return {"Heat": 100, "Sicario": 101}.get(title)
        def movie_details(self, tmdb_id):
            return seed[tmdb_id]

    class CapturingWriter(SupabaseWriter):
        def __init__(self):
            super().__init__("https://proj.supabase.co", "service-key")
            self.ops: list[tuple] = []
        def _request(self, method, path, body=None, headers=None):
            self.ops.append((method, path.split("?")[0], body))

    writer = CapturingWriter()
    result = run_pipeline(_make_export_zip(), "user-123",
                          client=StubClient(), cache=InMemoryFilmCache(seed),
                          writer=writer)

    assert result == {"unique_films": 4, "total_logged": 5, "unmatched": 2}

    posts = {path: body for (m, path, body) in writer.ops if m == "POST"}
    watches = posts["/watches"]
    assert len(watches) == 5
    assert all(r["user_id"] == "user-123" for r in watches)
    assert any(r["tmdb_id"] == 100 and r["title"] == "Heat" for r in watches)
    assert {r["raw_title"] for r in posts["/unmatched"]} == {"Dune", "Old Boy"}
    assert posts["/stat_snapshots"][0]["payload"]["core"]["totals"]["unique_films"] == 4

    # Re-upload safety: each user table is cleared before re-insert.
    seq = [(m, p) for (m, p, _) in writer.ops]
    assert seq.index(("DELETE", "/watches")) < seq.index(("POST", "/watches"))


def test_vote_average_feeds_vs_community():
    """TMDB's vote_average (0..10), rescaled to 0..5, drives the crowd comparison."""
    from process_upload.enricher import InMemoryFilmCache, enrich_watches  # noqa: PLC0415
    export = parser.parse_export(_make_export_zip())
    watches = parser.build_watches(export)
    seed = {
        100: {"tmdb_id": 100, "title": "Heat", "year": 1995, "runtime": 170,
              "genres": ["Crime"], "director": "Michael Mann",
              "country": "United States", "language": "en", "vote_average": 7.9},
        101: {"tmdb_id": 101, "title": "Sicario", "year": 2015, "runtime": 121,
              "genres": ["Crime"], "director": "Denis Villeneuve",
              "country": "United States", "language": "en", "vote_average": 7.6},
    }
    cache = InMemoryFilmCache(seed)

    class StubClient:
        def search_movie(self, title, _year):
            return {"Heat": 100, "Sicario": 101}.get(title)
        def movie_details(self, tmdb_id):
            return seed[tmdb_id]

    films, _ = enrich_watches(watches, StubClient(), cache)
    vs = stats.compute_snapshot(watches, films=films)["enriched"]["vs_community"]

    # Sicario: you 5.0 vs 7.6/2 = 3.8 -> Δ +1.2, the biggest positive delta.
    assert vs["you_overrate"][0]["title"] == "Sicario"
    assert vs["you_overrate"][0]["community"] == 3.8
    # Heat's representative viewing is rated 4.5 vs 7.9/2 = 3.95 -> Δ +0.55.
    assert {r["title"] for r in vs["you_overrate"]} == {"Heat", "Sicario"}


def test_watchlist_enrichment_dedups_and_populates():
    """Watchlist entries get a tmdb_id from the shared cache; a film already
    resolved for the diary isn't searched again."""
    from process_upload.enricher import InMemoryFilmCache, enrich_watches, enrich_watchlist
    from process_upload.models import WatchlistEntry

    export = parser.parse_export(_make_export_zip())
    watches = parser.build_watches(export)
    seed = {
        100: {"tmdb_id": 100, "title": "Heat", "year": 1995, "runtime": 170,
              "genres": ["Crime"], "director": "Michael Mann", "vote_average": 7.9},
        101: {"tmdb_id": 101, "title": "Sicario", "year": 2015, "runtime": 121,
              "genres": ["Crime"], "director": "Denis Villeneuve", "vote_average": 7.6},
        200: {"tmdb_id": 200, "title": "Tenet", "year": 2020, "runtime": 150,
              "genres": ["Action"], "director": "Christopher Nolan", "vote_average": 7.3},
    }
    cache = InMemoryFilmCache(seed)
    searches: list[str] = []

    class StubClient:
        def search_movie(self, title, _year):
            searches.append(title)
            return {"Heat": 100, "Sicario": 101, "Tenet": 200}.get(title)
        def movie_details(self, tmdb_id):
            return seed[tmdb_id]

    client = StubClient()
    resolved: dict = {}
    films, _ = enrich_watches(watches, client, cache, resolved=resolved)
    searches.clear()

    watchlist = [
        WatchlistEntry("Heat", 1995, "u/heat", None),    # already on the diary
        WatchlistEntry("Tenet", 2020, "u/tenet", None),  # watchlist-only
    ]
    enrich_watchlist(watchlist, client, cache, resolved=resolved, films_used=films)

    # Heat was resolved during the diary pass -> only Tenet hits TMDB now.
    assert searches == ["Tenet"]
    assert watchlist[0].tmdb_id == 100 and watchlist[1].tmdb_id == 200
    assert 200 in films  # the watchlist-only film joins the shared set


def test_movie_details_extracts_top_cast():
    """movie_details keeps the top-billed cast (by TMDB `order`), capped at TMDB_CAST_N."""
    from process_upload.enricher import TmdbClient, TMDB_CAST_N

    payload = {
        "id": 100, "title": "Heat", "release_date": "1995-12-15", "runtime": 170,
        "genres": [{"name": "Crime"}], "production_countries": [{"name": "United States"}],
        "original_language": "en", "popularity": 12.3, "vote_average": 7.9,
        "poster_path": "/x.jpg",
        "credits": {
            "crew": [{"job": "Director", "name": "Michael Mann"}],
            # Deliberately out of billing order, with one trailing entry first.
            "cast": [{"order": 99, "name": "Bit Part"}]
                    + [{"order": i, "name": f"Actor {i}"} for i in range(TMDB_CAST_N + 3)],
        },
    }

    class FakeTmdb(TmdbClient):
        def __init__(self):
            super().__init__("key")
        def _get(self, path, params):
            assert params.get("append_to_response") == "credits"
            return payload

    film = FakeTmdb().movie_details(100)
    assert film["director"] == "Michael Mann"
    assert film["top_cast"] == [f"Actor {i}" for i in range(TMDB_CAST_N)]  # billing order, capped


def test_enriched_actor_leaderboard():
    """top_cast fans out to a per-actor leaderboard: films-watched count (per unique
    film) ranks them, avg ★ is over the films of theirs you rated."""
    from process_upload.enricher import InMemoryFilmCache, enrich_watches  # noqa: PLC0415
    export = parser.parse_export(_make_export_zip())
    watches = parser.build_watches(export)
    # Heat is rated (4.5 on its representative viewing), Sicario 5.0. Pacino is in
    # both -> 2 films; De Niro only in Heat -> 1 film.
    seed = {
        100: {"tmdb_id": 100, "title": "Heat", "year": 1995, "vote_average": 7.9,
              "top_cast": ["Al Pacino", "Robert De Niro"]},
        101: {"tmdb_id": 101, "title": "Sicario", "year": 2015, "vote_average": 7.6,
              "top_cast": ["Emily Blunt", "Al Pacino"]},
    }
    cache = InMemoryFilmCache(seed)

    class StubClient:
        def search_movie(self, title, _year):
            return {"Heat": 100, "Sicario": 101}.get(title)
        def movie_details(self, tmdb_id):
            return seed[tmdb_id]

    films, _ = enrich_watches(watches, StubClient(), cache)
    enriched = stats.compute_snapshot(watches, films=films)["enriched"]
    actors = {a["actor"]: a for a in enriched["top_actors"]}

    assert enriched["top_actors"][0]["actor"] == "Al Pacino"  # 2 films -> ranked first
    assert actors["Al Pacino"]["films"] == 2
    assert actors["Robert De Niro"]["films"] == 1
    assert enriched["unique_actors"] == 3
    # Pacino's avg ★ spans both rated films: (4.5 + 5.0) / 2 = 4.75.
    assert actors["Al Pacino"]["avg_rating"] == 4.75


def test_watchlist_actuary_runtime_and_velocity():
    """Watchlist actuary: runtime-to-clear (enriched, summed from watchlist tmdb_id)
    plus a CSV-only velocity that projects a finite clear date when you watch faster
    than you add, and counts long-stale items."""
    import re  # noqa: PLC0415
    from datetime import date, timedelta  # noqa: PLC0415
    from process_upload.models import Watch, WatchlistEntry  # noqa: PLC0415

    films = {
        100: {"tmdb_id": 100, "title": "Heat", "year": 1995, "runtime": 180, "vote_average": 7.9},
        101: {"tmdb_id": 101, "title": "Sicario", "year": 2015, "runtime": 120, "vote_average": 7.6},
        200: {"tmdb_id": 200, "title": "Tenet", "year": 2020, "vote_average": 7.3},  # no runtime
    }
    # 10 diary watches of one matched film over 90 days -> a brisk watch rate, and a
    # non-empty `matched` so the enriched section (with watchlist_runtime) is built.
    base = date(2024, 1, 1)
    watches = [Watch("Heat", 1995, f"u/h{i}", base + timedelta(days=i * 10), 4.0, tmdb_id=100)
               for i in range(10)]
    # All added 2010-2014 -> all stale whenever the test runs; a low add rate vs the
    # brisk watch rate above keeps net positive, so the clear date is finite.
    watchlist = [
        WatchlistEntry("Heat", 1995, "u/wh", date(2010, 1, 1), tmdb_id=100),
        WatchlistEntry("Sicario", 2015, "u/ws", date(2012, 1, 1), tmdb_id=101),
        WatchlistEntry("Tenet", 2020, "u/wt", date(2014, 1, 1), tmdb_id=200),
    ]

    snap = stats.compute_snapshot(watches, films=films, watchlist=watchlist)
    wl = snap["core"]["watchlist"]
    ewl = snap["watchlist_enriched"]

    # Runtime to clear sums only the two watchlist films that have a runtime.
    assert ewl["runtime"] == {
        "matched": 2, "total_minutes": 300, "total_hours": 5.0, "total_days": 0.2,
    }
    # Quick wins shortest-first; the longest is the single biggest commitment.
    assert [s["title"] for s in ewl["shortest"]] == ["Sicario", "Heat"]  # 120 then 180
    assert ewl["longest"] == {"title": "Heat", "runtime": 180}
    # Regression: the enriched-watchlist work must not clobber the DIARY longest/
    # shortest-film-sat-through (they're computed in a separate function now).
    assert snap["enriched"]["runtime"]["longest"] == {"minutes": 180, "title": "Heat"}
    assert snap["enriched"]["runtime"]["shortest"] == {"minutes": 180, "title": "Heat"}
    assert wl["stale_count"] == 3
    # Backlog: oldest add is the 2010 Heat entry.
    assert wl["backlog"]["oldest"]["title"] == "Heat"
    assert wl["backlog"]["oldest"]["added_at"] == "2010-01-01"
    v = wl["velocity"]
    assert v["watched_per_month"] > v["added_per_month"]   # watch faster than you add
    assert v["net_per_month"] > 0 and v["months_to_clear"] is not None
    assert re.fullmatch(r"\d{4}-\d{2}", v["projected_clear"])


def test_watchlist_enriched_survives_no_matched_diary():
    """Watchlist runtime/quick-wins come from the watchlist's OWN matched films, so
    they're present even when no diary watch matched TMDB (enriched is None). The
    taste gap needs watched genres, so it falls back to null."""
    from datetime import date  # noqa: PLC0415
    from process_upload.models import Watch, WatchlistEntry  # noqa: PLC0415

    films = {
        100: {"tmdb_id": 100, "title": "Heat", "year": 1995, "runtime": 170, "genres": ["Crime"]},
        101: {"tmdb_id": 101, "title": "Sicario", "year": 2015, "runtime": 121, "genres": ["Crime"]},
    }
    # A diary watch that TMDB never matched (tmdb_id None) -> enriched is None.
    watches = [Watch("Some Obscure Film", 1980, "u/x", date(2024, 1, 1), 4.0, tmdb_id=None)]
    watchlist = [
        WatchlistEntry("Heat", 1995, "u/wh", date(2020, 1, 1), tmdb_id=100),
        WatchlistEntry("Sicario", 2015, "u/ws", date(2021, 1, 1), tmdb_id=101),
    ]

    snap = stats.compute_snapshot(watches, films=films, watchlist=watchlist)
    assert snap["enriched"] is None                       # no matched diary
    ewl = snap["watchlist_enriched"]
    assert ewl is not None                                # ...but the watchlist survives
    assert ewl["runtime"]["matched"] == 2
    assert ewl["runtime"]["total_minutes"] == 291
    assert ewl["longest"] == {"title": "Heat", "runtime": 170}
    assert ewl["taste_gap"] is None                       # nothing watched to compare


def test_watchlist_taste_gap():
    """The taste gap surfaces genres the watchlist over-indexes on vs actual viewing,
    never-watched genres first, dropping thinly-represented ones."""
    from collections import Counter  # noqa: PLC0415
    from process_upload.stats import _watchlist_taste_gap  # noqa: PLC0415

    # Watchlist: Documentary hoarded (you watch few), Western never watched, Drama in
    # line, Mystery too thin (2) to count.
    wl = Counter({"Documentary": 8, "Western": 5, "Drama": 6, "Mystery": 2})
    watched = Counter({"Drama": 40, "Documentary": 4, "Comedy": 30})

    gap = _watchlist_taste_gap(wl, watched)
    genres = [r["genre"] for r in gap["over"]]
    assert genres[0] == "Western"                 # never watched -> ranked first
    assert "Documentary" in genres                # over-indexed
    assert "Mystery" not in genres                # below the count>=3 floor
    western = next(r for r in gap["over"] if r["genre"] == "Western")
    assert western["index"] is None               # None = a genre you never watch


def test_watchlist_velocity_never_clears():
    """When you add at least as fast as you watch, there's no finite clear date."""
    from datetime import date, timedelta  # noqa: PLC0415
    from process_upload.models import Watch, WatchlistEntry  # noqa: PLC0415

    base = date(2023, 1, 1)
    # 3 watches over 300 days (slow) vs 12 watchlist adds over 60 days (fast).
    watches = [Watch("Heat", 1995, f"u/h{i}", base + timedelta(days=i * 150), 4.0)
               for i in range(3)]
    watchlist = [WatchlistEntry(f"Film {i}", 2000, f"u/w{i}", base + timedelta(days=i * 5))
                 for i in range(12)]

    wl = stats.compute_snapshot(watches, watchlist=watchlist)["core"]["watchlist"]
    v = wl["velocity"]
    assert v["added_per_month"] > v["watched_per_month"]
    assert v["net_per_month"] < 0
    assert v["months_to_clear"] is None and v["projected_clear"] is None


def _run_all():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("\nAll smoke tests passed.")


if __name__ == "__main__":
    _run_all()

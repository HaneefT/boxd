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
                          client=StubClient(), cache=InMemoryFilmCache(seed), writer=writer)

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


def _run_all():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("\nAll smoke tests passed.")


if __name__ == "__main__":
    _run_all()

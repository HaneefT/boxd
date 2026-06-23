-- 009_film_cast.sql — capture top-billed cast on the shared films cache.
-- Additive: the enricher already fetches credits (append_to_response=credits), so
-- this only widens the row we store. Populated only for films fetched fresh from TMDB:
-- the `films` cache is write-once, so films already cached stay top_cast = null (the
-- enricher skips movie_details on a cache hit). Run backend/backfill_cast.py once to
-- fill the existing rows. Capturing now keeps that backfill window from growing for the
-- actor leaderboard / "unique actors" stats later (DESIGN §10, solo "People").
--
-- Named top_cast (not "cast") on purpose: `cast` is a SQL keyword and would force
-- quoting in every PostgREST select and SQL reference.

begin;

alter table public.films
    add column if not exists top_cast jsonb;   -- ["Al Pacino","Robert De Niro",...], billing order, capped in the enricher

commit;

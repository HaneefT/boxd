-- 010_rss_sync.sql — opt-in RSS incremental sync (DESIGN §2.4, D9).
-- A scheduled poller reads each opted-in member's PUBLIC Letterboxd RSS feed
-- (letterboxd.com/<lb_username>/rss/) ~1×/day and appends new diary entries, so they
-- don't have to re-upload. The feed carries <tmdb:movieId> on each item, so entries
-- map straight to watches without a TMDB search. Politeness (honest UA, daily cap,
-- back-off) lives in the poller; this migration just adds the per-user opt-in + status.
--
-- Requires having imported once (we use the stored profiles.lb_username). A private
-- profile's feed 404s -> the poller records that in rss_last_error for the UI to surface.

begin;

alter table public.profiles
  add column if not exists rss_sync_enabled   boolean not null default false,
  add column if not exists rss_last_synced_at timestamptz,
  add column if not exists rss_last_error      text;

commit;

-- 001_init.sql — Boxd Stats schema (DESIGN.md §4.3)
-- Run against the Supabase project's Postgres.
-- Convention: all user-owned rows key on user_id -> auth.users(id).
-- RLS policies live in 002_rls.sql.

begin;

-- profiles: one row per authenticated user, 1:1 with Supabase auth.users.
create table if not exists public.profiles (
    id           uuid primary key references auth.users (id) on delete cascade,
    lb_username  text,                         -- their Letterboxd handle (from profile.csv)
    display_name text,
    share_token  text unique,                  -- opaque token for friend-sharing (v2)
    created_at   timestamptz not null default now()
);

-- films: SHARED across ALL users. One TMDB lookup ever per film.
-- World-readable (see RLS); only the backend service role writes here.
create table if not exists public.films (
    tmdb_id      integer primary key,
    title        text not null,
    year         integer,
    runtime      integer,                      -- minutes
    genres       jsonb,                        -- ["Drama","Horror"]
    director     text,
    country      text,
    language     text,
    popularity   numeric,                      -- TMDB popularity (for obscurity score)
    vote_average numeric(5,3),                 -- TMDB community mean (0-10), keep TMDB's 3-decimal precision
    poster_path  text,                         -- TMDB relative path; compose full URL client-side
    enriched_at  timestamptz not null default now()
);

-- watches: every diary entry / rating / review a user has, one row per watch.
-- A film can be watched multiple times (rewatches) -> no unique on (user_id, tmdb_id).
create table if not exists public.watches (
    id          bigint generated always as identity primary key,
    user_id     uuid not null references auth.users (id) on delete cascade,
    tmdb_id     integer references public.films (tmdb_id),  -- null until/unless matched
    lb_uri      text,                           -- Letterboxd film URI, for idempotent re-uploads
    title       text not null,                  -- raw title from export (kept even if unmatched)
    year        integer,
    watched_at  date,                           -- diary "Watched Date"; null for ratings-only rows
    rating      numeric(2,1),                   -- 0.5 .. 5.0
    is_rewatch  boolean not null default false,
    review_text text,
    tags        text[]
);

create index if not exists watches_user_idx        on public.watches (user_id);
create index if not exists watches_user_film_idx   on public.watches (user_id, tmdb_id);
create index if not exists watches_user_date_idx   on public.watches (user_id, watched_at);

-- watchlist: films a user wants to watch (separate from watches).
create table if not exists public.watchlist (
    user_id   uuid not null references auth.users (id) on delete cascade,
    tmdb_id   integer references public.films (tmdb_id),
    lb_uri    text,
    title     text not null,
    year      integer,
    added_at  date,
    primary key (user_id, lb_uri)
);

create index if not exists watchlist_user_idx on public.watchlist (user_id);

-- stat_snapshots: one denormalized JSON blob of precomputed stats per user.
-- The dashboard reads this in a single query (DESIGN §4.1, D6).
create table if not exists public.stat_snapshots (
    user_id     uuid primary key references auth.users (id) on delete cascade,
    payload     jsonb not null,
    computed_at timestamptz not null default now()
);

-- unmatched: films TMDB couldn't auto-match, for the "help us match these" fix-up UI.
create table if not exists public.unmatched (
    id        bigint generated always as identity primary key,
    user_id   uuid not null references auth.users (id) on delete cascade,
    raw_title text not null,
    raw_year  integer,
    lb_uri    text,
    created_at timestamptz not null default now()
);

create index if not exists unmatched_user_idx on public.unmatched (user_id);

-- friendships: v2 social graph. Included now so RLS/migrations are stable early.
create table if not exists public.friendships (
    user_id    uuid not null references auth.users (id) on delete cascade,
    friend_id  uuid not null references auth.users (id) on delete cascade,
    status     text not null default 'pending',  -- pending | accepted | blocked
    created_at timestamptz not null default now(),
    primary key (user_id, friend_id),
    check (user_id <> friend_id)
);

commit;

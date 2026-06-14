-- 002_rls.sql — Row Level Security (DESIGN.md §4.3)
-- Rule: every user-owned table is private to its owner (user_id = auth.uid()).
--       films is world-readable but only writable by the service role.
-- The Lambda pipeline uses the service_role key, which BYPASSES RLS — these
-- policies govern the SPA's direct (anon/auth) reads/writes via Supabase.

begin;

-- Enable RLS on every table. With RLS on and no policy, access is denied by default.
alter table public.profiles       enable row level security;
alter table public.films          enable row level security;
alter table public.watches        enable row level security;
alter table public.watchlist      enable row level security;
alter table public.stat_snapshots enable row level security;
alter table public.unmatched      enable row level security;
alter table public.friendships    enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: a user reads/writes only their own profile row.
-- ---------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
    for select using (auth.uid() = id);
create policy profiles_insert_own on public.profiles
    for insert with check (auth.uid() = id);
create policy profiles_update_own on public.profiles
    for update using (auth.uid() = id) with check (auth.uid() = id);
create policy profiles_delete_own on public.profiles
    for delete using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- films: world-readable shared cache. No anon/auth writes — service role only,
-- which bypasses RLS, so we intentionally add NO insert/update/delete policy.
-- ---------------------------------------------------------------------------
create policy films_select_all on public.films
    for select using (true);

-- ---------------------------------------------------------------------------
-- watches / watchlist / unmatched: fully private to the owner.
-- ---------------------------------------------------------------------------
create policy watches_all_own on public.watches
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy watchlist_all_own on public.watchlist
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy unmatched_all_own on public.unmatched
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- stat_snapshots: owner reads their snapshot. Writes come from the service-role
-- backend (bypasses RLS), so no insert/update policy for anon/auth users.
-- ---------------------------------------------------------------------------
create policy snapshots_select_own on public.stat_snapshots
    for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- friendships (v2): a user sees rows where they are either side; writes only
-- as the requesting user. Tightened when the social feature is built.
-- ---------------------------------------------------------------------------
create policy friendships_select_involved on public.friendships
    for select using (auth.uid() = user_id or auth.uid() = friend_id);
create policy friendships_write_own on public.friendships
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;

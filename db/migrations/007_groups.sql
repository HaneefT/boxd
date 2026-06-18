-- 007_groups.sql — friend groups + group-scoped, individual-visible rating comparison
-- (DESIGN §10.2 item B/C). V2's core social primitive.
--
-- Model: a `group` has an owner and members. Members join via a group invite link
-- (same mint/redeem pattern as 005_invites, but it adds a `group_members` row for an
-- already-signed-in user instead of allowlisting an email). Within a group, members
-- can see each other's *individual* per-film ratings — that visibility is the whole
-- point of the feature and is the friend-sharing opt-in DESIGN §2.6 reserves, so the
-- JOIN UI must say so plainly ("members can see your ratings on films you've both logged").
--
-- Security model (the load-bearing part):
--   * `watches` keeps its owner-only RLS from 002 — it gets NO cross-user policy.
--   * All cross-user reads go through SECURITY DEFINER RPCs that return a deliberately
--     narrow projection (film, who, rating, when) — never review_text/tags. RLS is
--     row-level, not column-level, so a policy would over-expose; a definer RPC won't.
--   * Group-membership policies must NEVER self-reference group_members in their USING
--     clause (Postgres throws "infinite recursion detected in policy"). The
--     `is_group_member` SECURITY DEFINER helper reads membership bypassing RLS, so
--     policies can call it without recursing.

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- groups: one row per friend group. owner_id set null (not cascade) so deleting
-- the owner's account doesn't nuke a group other people are in — an ownerless
-- group is a known edge case to handle later (reassign/disband).
create table if not exists public.groups (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    owner_id   uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now()
);

-- group_members: membership. Cascade both ways — disbanding a group or deleting a
-- user's account drops the membership rows.
create table if not exists public.group_members (
    group_id  uuid not null references public.groups (id) on delete cascade,
    user_id   uuid not null references auth.users (id)  on delete cascade,
    role      text not null default 'member',   -- 'owner' | 'member'
    joined_at timestamptz not null default now(),
    primary key (group_id, user_id)
);

-- Reverse lookup ("which groups am I in?") + speeds is_group_member.
create index if not exists group_members_user_idx on public.group_members (user_id);

-- group_invites: a near-clone of 005's invites, scoped to one group. RLS on, NO
-- policies -> only the SECURITY DEFINER RPCs (and service role) ever touch it.
create table if not exists public.group_invites (
    token      text primary key,
    group_id   uuid not null references public.groups (id) on delete cascade,
    created_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz,            -- null = never expires
    max_uses   int,                    -- null = unlimited
    uses       int not null default 0
);

create index if not exists group_invites_group_idx on public.group_invites (group_id);

-- ---------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER -> bypass RLS -> safe to call from policies)
-- ---------------------------------------------------------------------------

create or replace function public.is_group_member(p_group uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = p_user
  );
$$;

create or replace function public.is_group_owner(p_group uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.groups
    where id = p_group and owner_id = p_user
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;   -- (intentionally no policies)

-- groups: visible to members; renamed/disbanded only by the owner. Creation goes
-- through create_group() (definer), so there is intentionally no INSERT policy.
create policy groups_select_member on public.groups
    for select using (public.is_group_member(id));
create policy groups_update_owner on public.groups
    for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy groups_delete_owner on public.groups
    for delete using (owner_id = auth.uid());

-- group_members: you can see your own membership rows directly, and co-members via
-- the definer helper (NOT a self-referencing subquery — that recurses). You can
-- remove yourself (leave); the owner can remove anyone. Inserts happen only inside
-- create_group()/redeem_group_invite() (definer), so no INSERT policy.
create policy group_members_select on public.group_members
    for select using (user_id = auth.uid() or public.is_group_member(group_id));
create policy group_members_delete on public.group_members
    for delete using (user_id = auth.uid() or public.is_group_owner(group_id));

-- ---------------------------------------------------------------------------
-- create_group(): make a group and add the caller as its owner-member, atomically.
-- ---------------------------------------------------------------------------
create or replace function public.create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to create a group.' using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Group name is required.' using errcode = 'check_violation';
  end if;

  insert into public.groups (name, owner_id)
  values (trim(p_name), auth.uid())
  returning id into v_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_id, auth.uid(), 'owner');

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_group_invite(): owner-only. Mints a reusable token (default 10 uses / 14 days).
-- ---------------------------------------------------------------------------
create or replace function public.create_group_invite(
    p_group    uuid,
    p_max_uses int default 10,
    p_ttl_days int default 14
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.is_group_owner(p_group) then
    raise exception 'Only the group owner can create invites.' using errcode = 'insufficient_privilege';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into public.group_invites (token, group_id, created_by, expires_at, max_uses)
  values (
    v_token,
    p_group,
    auth.uid(),
    case when p_ttl_days is null then null else now() + (p_ttl_days || ' days')::interval end,
    p_max_uses
  );

  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- redeem_group_invite(): a signed-in user joins the group the token points at.
-- Idempotent — an existing member returns 'already_member' without burning a use.
-- Returns: 'ok' | 'invalid' | 'expired' | 'exhausted' | 'already_member'.
-- (Unlike 005, this requires an authenticated caller — group membership is per-user,
-- not per-email — so it joins auth.uid() directly.)
-- ---------------------------------------------------------------------------
create or replace function public.redeem_group_invite(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv  public.group_invites%rowtype;
  v_rows int;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to join a group.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_inv from public.group_invites where token = p_token for update;
  if not found then
    return 'invalid';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    return 'expired';
  end if;
  if v_inv.max_uses is not null and v_inv.uses >= v_inv.max_uses then
    return 'exhausted';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_inv.group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return 'already_member';
  end if;

  update public.group_invites set uses = uses + 1 where token = p_token;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- group_roster(): member-gated. Names of the people in a group (for a roster UI),
-- WITHOUT touching profiles RLS — so share_token / lb_username stay private. This is
-- the narrow-projection rule applied to profiles, same as group_film_ratings does to watches.
-- ---------------------------------------------------------------------------
create or replace function public.group_roster(p_group uuid)
returns table (user_id uuid, display_name text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  -- display_name is usually unset; fall back to the Letterboxd handle (lb_username),
  -- which the upload pipeline always writes (persist.profile_row).
  select m.user_id, coalesce(p.display_name, p.lb_username) as display_name, m.role, m.joined_at
  from public.group_members m
  left join public.profiles p on p.id = m.user_id
  where m.group_id = p_group
    and public.is_group_member(p_group)   -- caller must be a member, else empty
  order by m.joined_at;
$$;

-- ---------------------------------------------------------------------------
-- group_film_ratings(): the comparison engine (DESIGN §10.2 C).
-- One row per (member, film) for every film the CALLER has rated, carrying each
-- member's most-recent rated viewing. The client groups by tmdb_id:
--   * films where >=1 OTHER member appears  -> show the individual ratings (you + them)
--   * films where ONLY the caller appears   -> fall back to you-vs-TMDB (films.vote_average/2)
-- Returns only (film, who, rating, when) — never review_text/tags. `watches` stays
-- owner-only at the RLS layer; this definer RPC is the only cross-user door.
-- ---------------------------------------------------------------------------
-- Joins the films cache so the client gets title/year/vote_average in one round
-- trip — avoids a follow-up films lookup whose tmdb_id list would blow the GET URL
-- length for heavy users. drop+create because the return type changes.
drop function if exists public.group_film_ratings(uuid);
create function public.group_film_ratings(p_group uuid)
returns table (tmdb_id int, user_id uuid, display_name text, rating numeric, watched_at date,
               title text, year int, vote_average numeric)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (m.user_id, w.tmdb_id)
         w.tmdb_id, w.user_id, coalesce(p.display_name, p.lb_username) as display_name,
         w.rating, w.watched_at, fi.title, fi.year, fi.vote_average
  from public.group_members m
  join public.watches  w  on w.user_id = m.user_id
  left join public.profiles p  on p.id = m.user_id
  left join public.films    fi on fi.tmdb_id = w.tmdb_id
  where m.group_id = p_group
    and public.is_group_member(p_group)          -- caller must be a member, else empty
    and w.tmdb_id is not null
    and w.rating  is not null
    and w.tmdb_id in (                            -- bound to the caller's rated films
      select tmdb_id from public.watches
      where user_id = auth.uid() and rating is not null
    )
  order by m.user_id, w.tmdb_id, w.watched_at desc nulls last;   -- most-recent rated viewing
$$;

-- ---------------------------------------------------------------------------
-- Grants. Everything is for signed-in users; anon gets nothing group-related.
-- The helpers are granted because the RLS policies above call them as the querying role.
-- ---------------------------------------------------------------------------
grant execute on function public.is_group_member(uuid, uuid)              to authenticated;
grant execute on function public.is_group_owner(uuid, uuid)               to authenticated;
grant execute on function public.create_group(text)                       to authenticated;
grant execute on function public.create_group_invite(uuid, int, int)      to authenticated;
grant execute on function public.redeem_group_invite(text)                to authenticated;
grant execute on function public.group_roster(uuid)                       to authenticated;
grant execute on function public.group_film_ratings(uuid)                 to authenticated;

revoke execute on function public.create_group(text)                      from anon;
revoke execute on function public.create_group_invite(uuid, int, int)     from anon;
revoke execute on function public.redeem_group_invite(text)               from anon;
revoke execute on function public.group_roster(uuid)                      from anon;
revoke execute on function public.group_film_ratings(uuid)                from anon;

commit;

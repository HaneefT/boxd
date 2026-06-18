-- 005_invites.sql — shareable invite links for friends-only sign-up
-- Builds on 004's allowlist trigger instead of replacing it: redeeming an invite
-- simply adds the friend's email to public.allowed_emails, after which the normal
-- sign-up (magic-link or Google) passes the trigger. No backend/Lambda change.
--
-- Flow: owner mints a link (create_invite) -> friend opens it, enters the email
-- they'll sign in with (redeem_invite) -> their email is allowlisted -> they sign
-- in. One reusable link, capped + expiring.

begin;

-- ---------------------------------------------------------------------------
-- invites: one row per link. RLS on, NO policies -> clients can't read/forge it;
-- only the SECURITY DEFINER RPCs below (and the service role) ever touch it.
-- ---------------------------------------------------------------------------
create table if not exists public.invites (
    token      text primary key,
    label      text,
    created_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz,            -- null = never expires
    max_uses   int,                    -- null = unlimited
    uses       int not null default 0
);

alter table public.invites enable row level security;
-- (intentionally no policies)

-- ---------------------------------------------------------------------------
-- is_owner(): true when the caller's JWT email is tagged note='owner' in
-- allowed_emails (seeded in 004). Used to restrict invite creation.
-- ---------------------------------------------------------------------------
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_emails
    where email = lower(auth.jwt() ->> 'email')
      and note = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- create_invite(): owner-only. Mints a random token, returns it. Defaults to a
-- reusable link good for 10 sign-ups over 14 days.
-- ---------------------------------------------------------------------------
create or replace function public.create_invite(
    p_label    text default null,
    p_max_uses int  default 10,
    p_ttl_days int  default 14
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can create invites.' using errcode = 'insufficient_privilege';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into public.invites (token, label, created_by, expires_at, max_uses)
  values (
    v_token,
    p_label,
    auth.uid(),
    case when p_ttl_days is null then null else now() + (p_ttl_days || ' days')::interval end,
    p_max_uses
  );

  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- redeem_invite(): callable by signed-out visitors. Given a valid token, adds
-- the claimed email to the allowlist and consumes one use. Idempotent — an email
-- that's already allowlisted returns 'ok' without burning another use.
-- Returns: 'ok' | 'invalid' | 'expired' | 'exhausted' | 'invalid_email'.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_invite(p_token text, p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv   public.invites%rowtype;
  v_email text := lower(trim(p_email));
  v_rows  int;
begin
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return 'invalid_email';
  end if;

  select * into v_inv from public.invites where token = p_token for update;
  if not found then
    return 'invalid';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    return 'expired';
  end if;
  if v_inv.max_uses is not null and v_inv.uses >= v_inv.max_uses then
    return 'exhausted';
  end if;

  insert into public.allowed_emails (email, note)
  values (v_email, 'invited:' || p_token)
  on conflict (email) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    update public.invites set uses = uses + 1 where token = p_token;
  end if;

  return 'ok';
end;
$$;

-- Permissions: redeem is for signed-out visitors; create is owner-only.
revoke execute on function public.create_invite(text, int, int) from anon;
grant  execute on function public.create_invite(text, int, int) to authenticated;
grant  execute on function public.redeem_invite(text, text)     to anon, authenticated;
grant  execute on function public.is_owner()                    to authenticated;

commit;

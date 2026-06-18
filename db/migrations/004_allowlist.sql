-- 004_allowlist.sql — friends-only sign-ups (DESIGN §2: friends-only at launch)
-- Restricts who can create an account. Enforced at the database layer with a
-- BEFORE INSERT trigger on auth.users, so it applies to EVERY sign-up path
-- (magic-link AND Google OAuth) — not just the SPA. A non-allowlisted email
-- gets rejected when GoTrue tries to create the user; the SPA surfaces the error.
--
-- This is what lets us retire the pre-launch HTTP Basic Auth gate (infra/gate.tf):
-- the site can be publicly reachable because nobody outside the allowlist can
-- actually get an account.
--
-- To add a friend later (Supabase SQL Editor):
--   insert into public.allowed_emails (email, note) values ('friend@gmail.com', 'name');
-- To remove access (existing sessions persist until token expiry — also delete the
-- user under Authentication → Users if you want to kick them immediately):
--   delete from public.allowed_emails where email = 'friend@gmail.com';

begin;

-- ---------------------------------------------------------------------------
-- allowed_emails: the invite list. Emails stored lowercased (we normalize on
-- check). RLS on with no policies => only the service role / SQL Editor (postgres)
-- can read or manage it; anon/authenticated clients cannot enumerate the list.
-- The trigger function below reads it as a SECURITY DEFINER (owner), so it works
-- regardless of RLS.
-- ---------------------------------------------------------------------------
create table if not exists public.allowed_emails (
    email    text primary key,
    note     text,
    added_at timestamptz not null default now()
);

alter table public.allowed_emails enable row level security;
-- (intentionally no policies)

-- ---------------------------------------------------------------------------
-- Reject sign-ups whose email isn't on the allowlist. SECURITY DEFINER so it can
-- read allowed_emails despite RLS; fixed search_path to keep the definer safe.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_email_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null
     or not exists (
       select 1 from public.allowed_emails
       where email = lower(new.email)
     )
  then
    raise exception 'Sign-ups are invite-only — % is not on the allowlist.', new.email
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_email_allowlist on auth.users;
create trigger enforce_email_allowlist
  before insert on auth.users
  for each row execute function public.enforce_email_allowlist();

-- ---------------------------------------------------------------------------
-- Seed: the owner. Add friends with more INSERTs (see header).
-- ---------------------------------------------------------------------------
insert into public.allowed_emails (email, note) values
    ('haneeft2403@gmail.com', 'owner')
on conflict (email) do nothing;

commit;

-- 003_async_upload.sql — async upload flow (DESIGN §4.1)
-- Adds: a per-user job-status table the SPA polls, and Storage RLS policies so a
-- user can upload their export ZIP to their own folder in the `exports` bucket.
--
-- MANUAL STEP (do once in the Supabase dashboard before running this):
--   Storage → New bucket → name "exports", PRIVATE (not public).
-- The bucket itself can't be created in SQL via the dashboard role; the policies
-- below operate on storage.objects, which this migration can manage.

begin;

-- ---------------------------------------------------------------------------
-- upload_jobs: one row per user tracking their latest upload's processing state.
-- The dispatcher sets 'processing'; the worker sets 'done' or 'failed'. Both run
-- as the service role (bypasses RLS). The SPA only reads its own row to poll.
-- ---------------------------------------------------------------------------
create table if not exists public.upload_jobs (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    status     text not null default 'processing',  -- processing | done | failed
    error      text,
    updated_at timestamptz not null default now()
);

alter table public.upload_jobs enable row level security;

create policy upload_jobs_select_own on public.upload_jobs
    for select using (auth.uid() = user_id);
-- No insert/update/delete policy: only the service-role backend writes here.

-- ---------------------------------------------------------------------------
-- Storage RLS for the `exports` bucket: a user may upload/read/replace/delete
-- objects ONLY under a top-level folder named after their uid (exports/<uid>/...).
-- The worker downloads + deletes via the service role, which bypasses these.
-- ---------------------------------------------------------------------------
create policy exports_insert_own on storage.objects
    for insert to authenticated
    with check (bucket_id = 'exports'
                and (storage.foldername(name))[1] = auth.uid()::text);

create policy exports_update_own on storage.objects
    for update to authenticated
    using (bucket_id = 'exports'
           and (storage.foldername(name))[1] = auth.uid()::text);

create policy exports_select_own on storage.objects
    for select to authenticated
    using (bucket_id = 'exports'
           and (storage.foldername(name))[1] = auth.uid()::text);

create policy exports_delete_own on storage.objects
    for delete to authenticated
    using (bucket_id = 'exports'
           and (storage.foldername(name))[1] = auth.uid()::text);

commit;

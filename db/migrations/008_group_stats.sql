-- 008_group_stats.sql — group-level aggregate stats (DESIGN §10.2, group dashboard).
-- Rolls every member's watches (joined to the shared films cache) up into ONE
-- aggregate payload: group totals, genre profile, top directors, activity. Returns
-- only the rollup — never an individual member's profile — so it stays within the
-- "members contribute to group stats" consent without exposing per-member libraries.
-- Same security model as 007: SECURITY DEFINER, gated on is_group_member; watches
-- keeps its owner-only RLS. The output mirrors the shapes the dashboard charts
-- already consume (GenreChart, DirectorsTable, ActivityCharts).

begin;

create or replace function public.group_stats(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids       uuid[];
  v_totals    jsonb;
  v_genres    jsonb;
  v_directors jsonb;
  v_weekday   jsonb;
  v_month     jsonb;
  v_year      jsonb;
begin
  if not public.is_group_member(p_group) then
    return null;
  end if;

  select array_agg(user_id) into v_ids
  from public.group_members where group_id = p_group;

  -- Totals across every matched viewing in the group.
  select jsonb_build_object(
    'films_logged', count(*),
    'unique_films', count(distinct w.tmdb_id),
    'total_hours',  round(coalesce(sum(f.runtime), 0)::numeric / 60, 1)
  )
  into v_totals
  from public.watches w
  join public.films f on f.tmdb_id = w.tmdb_id
  where w.user_id = any(v_ids);

  -- Genre profile: per viewing, summed across members.
  select coalesce(jsonb_object_agg(genre, cnt), '{}'::jsonb) into v_genres
  from (
    select g.value as genre, count(*) as cnt
    from public.watches w
    join public.films f on f.tmdb_id = w.tmdb_id
    cross join lateral jsonb_array_elements_text(f.genres) as g(value)
    where w.user_id = any(v_ids)
    group by g.value
  ) s;

  -- Top directors: distinct films per director, plus the group's avg rating.
  select coalesce(
    jsonb_agg(jsonb_build_object('director', director, 'films', films, 'avg_rating', avg_rating)
              order by films desc),
    '[]'::jsonb) into v_directors
  from (
    select f.director,
           count(distinct w.tmdb_id) as films,
           round(avg(w.rating), 2)   as avg_rating
    from public.watches w
    join public.films f on f.tmdb_id = w.tmdb_id
    where w.user_id = any(v_ids) and f.director is not null
    group by f.director
    order by films desc
    limit 15
  ) s;

  -- Activity by weekday / month / year. Index arrays by isodow (1=Mon) / month so
  -- the keys match the dashboard's expectations without relying on lc_time.
  select coalesce(jsonb_object_agg(wd, cnt), '{}'::jsonb) into v_weekday
  from (
    select (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[extract(isodow from w.watched_at)::int] as wd,
           count(*) as cnt
    from public.watches w
    where w.user_id = any(v_ids) and w.watched_at is not null
    group by wd
  ) s;

  select coalesce(jsonb_object_agg(mo, cnt), '{}'::jsonb) into v_month
  from (
    select (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[extract(month from w.watched_at)::int] as mo,
           count(*) as cnt
    from public.watches w
    where w.user_id = any(v_ids) and w.watched_at is not null
    group by mo
  ) s;

  select coalesce(jsonb_object_agg(yr, cnt), '{}'::jsonb) into v_year
  from (
    select extract(year from w.watched_at)::int::text as yr, count(*) as cnt
    from public.watches w
    where w.user_id = any(v_ids) and w.watched_at is not null
    group by yr
  ) s;

  return jsonb_build_object(
    'totals',    v_totals,
    'genres',    v_genres,
    'directors', v_directors,
    'activity',  jsonb_build_object('by_weekday', v_weekday, 'by_month', v_month, 'by_year', v_year)
  );
end;
$$;

grant execute on function public.group_stats(uuid) to authenticated;
revoke execute on function public.group_stats(uuid) from anon;

commit;

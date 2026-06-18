// Friend-group data layer — thin wrappers over the 007_groups.sql RPCs + the
// shared films cache. Mirrors the server contract; keep in sync with that migration.
import { supabase } from "./supabase";

export interface Group {
  id: string;
  name: string;
}

export interface RosterMember {
  user_id: string;
  display_name: string | null;
  role: string;
  joined_at: string;
}

// Aggregate group stats (group_stats RPC) — shaped to match the dashboard charts.
export interface GroupStats {
  totals: { films_logged: number; unique_films: number; total_hours: number };
  genres: Record<string, number>;
  directors: { director: string; films: number; avg_rating: number | null }[];
  activity: {
    by_weekday: Record<string, number>;
    by_month: Record<string, number>;
    by_year: Record<string, number>;
  };
}

// One row per (member, film) straight from group_film_ratings().
interface GroupRatingRow {
  tmdb_id: number;
  user_id: string;
  display_name: string | null;
  rating: number;
  watched_at: string | null;
}

// One film's worth of ratings, assembled for the comparison view.
export interface FilmComparison {
  tmdb_id: number;
  title: string;
  year: number | null;
  you: number | null;
  others: { user_id: string; name: string; rating: number }[];
  tmdb: number | null; // vote_average/2 — the fallback shown when `others` is empty
  spread: number; // max-min across you + others, for ranking disagreements
}

// Groups I'm a member of (RLS already restricts the table to those).
export async function listMyGroups(): Promise<Group[]> {
  const { data, error } = await supabase.from("groups").select("id, name").order("created_at");
  if (error) throw new Error(error.message);
  return (data as Group[]) ?? [];
}

export async function createGroup(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_group", { p_name: name });
  if (error) throw new Error(error.message);
  return data as string; // new group id
}

export async function createGroupInvite(
  groupId: string,
  maxUses: number | null = 10,
  ttlDays: number | null = 14,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_group_invite", {
    p_group: groupId,
    p_max_uses: maxUses,
    p_ttl_days: ttlDays,
  });
  if (error) throw new Error(error.message);
  return data as string; // token
}

// 'ok' | 'already_member' | 'invalid' | 'expired' | 'exhausted'
export async function redeemGroupInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc("redeem_group_invite", { p_token: token });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getRoster(groupId: string): Promise<RosterMember[]> {
  const { data, error } = await supabase.rpc("group_roster", { p_group: groupId });
  if (error) throw new Error(error.message);
  return (data as RosterMember[]) ?? [];
}

export async function getGroupStats(groupId: string): Promise<GroupStats | null> {
  const { data, error } = await supabase.rpc("group_stats", { p_group: groupId });
  if (error) throw new Error(error.message);
  return (data as GroupStats) ?? null;
}

// The comparison: pull the group's per-(member, film) ratings, resolve titles +
// TMDB averages from the shared films cache, and fold them into one row per film.
export async function getGroupComparison(groupId: string, myId: string): Promise<FilmComparison[]> {
  const { data, error } = await supabase.rpc("group_film_ratings", { p_group: groupId });
  if (error) throw new Error(error.message);
  const rows = (data as GroupRatingRow[]) ?? [];
  if (rows.length === 0) return [];

  // films is world-readable — fetch titles + TMDB averages for the films in play.
  const ids = [...new Set(rows.map((r) => r.tmdb_id))];
  const { data: films, error: ferr } = await supabase
    .from("films")
    .select("tmdb_id, title, year, vote_average")
    .in("tmdb_id", ids);
  if (ferr) throw new Error(ferr.message);
  const filmById = new Map<number, { title: string; year: number | null; vote_average: number | null }>();
  for (const f of (films ?? []) as { tmdb_id: number; title: string; year: number | null; vote_average: number | null }[]) {
    filmById.set(f.tmdb_id, { title: f.title, year: f.year, vote_average: f.vote_average });
  }

  const byFilm = new Map<number, GroupRatingRow[]>();
  for (const r of rows) {
    const arr = byFilm.get(r.tmdb_id) ?? [];
    arr.push(r);
    byFilm.set(r.tmdb_id, arr);
  }

  const out: FilmComparison[] = [];
  for (const [tmdb_id, group] of byFilm) {
    const film = filmById.get(tmdb_id);
    const mine = group.find((r) => r.user_id === myId);
    const others = group
      .filter((r) => r.user_id !== myId)
      .map((r) => ({ user_id: r.user_id, name: r.display_name ?? "A friend", rating: r.rating }));
    const all = group.map((r) => r.rating);
    const spread = all.length > 1 ? Math.max(...all) - Math.min(...all) : 0;
    out.push({
      tmdb_id,
      title: film?.title ?? `#${tmdb_id}`,
      year: film?.year ?? null,
      you: mine?.rating ?? null,
      others,
      tmdb: film?.vote_average != null ? film.vote_average / 2 : null,
      spread,
    });
  }
  return out;
}

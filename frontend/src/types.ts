// Mirrors backend/process_upload/stats.py compute_snapshot output (schema_version 1).
// Keep in sync with that module; it is the single source of truth.

export interface Snapshot {
  schema_version: number;
  profile: Profile;
  core: Core;
  enriched: Enriched | null;
  // TMDB watchlist stats — its own section so it survives a snapshot with no matched
  // diary watch (the enriched section is null then). Absent on pre-actuary snapshots.
  watchlist_enriched?: EnrichedWatchlist | null;
}

export interface Profile {
  username: string | null;
  date_joined: string | null;
  favorite_films: string[];
}

export interface Core {
  totals: Totals;
  ratings: Ratings;
  era: Era;
  rewatches: Rewatches;
  activity: Activity;
  watchlist: Watchlist;
}

export interface Totals {
  unique_films: number;
  total_logged: number;
  rated_count: number;
  reviewed_count: number;
  dated_count: number;
  unmatched_to_tmdb: number;
}

export interface Ratings {
  count: number;
  mean: number | null;
  median: number | null;
  stdev: number | null;
  histogram: Record<string, number>; // "0.5".."5.0" -> count
}

export interface Era {
  by_decade: Record<string, number>;
  oldest_year: number | null;
  newest_year: number | null;
  avg_film_age_at_watch: number | null;
}

export interface Rewatches {
  rewatch_rate: number | null;
  films_rewatched: number;
  most_rewatched: { title: string; times: number }[];
}

export interface Activity {
  heatmap: Record<string, number>; // "YYYY-MM-DD" -> count
  by_weekday: Record<string, number>;
  by_month: Record<string, number>;
  by_year: Record<string, number>;
  longest_streak_days: number;
  biggest_day: { date: string; films: number } | null;
  first_logged: string | null;
  last_logged: string | null;
}

export interface Watchlist {
  count: number;
  avg_year: number | null;
  oldest_year: number | null;
  first_added: string | null;
  last_added: string | null;
  // Actuary fields — absent on snapshots computed before the watchlist actuary.
  stale_count?: number;
  velocity?: WatchlistVelocity | null;
  backlog?: WatchlistBacklog | null;
}

export interface WatchlistVelocity {
  added_per_month: number;
  watched_per_month: number;
  net_per_month: number;
  months_to_clear: number | null; // null = list grows at least as fast as you clear it
  projected_clear: string | null; // "YYYY-MM", or null when never
}

export interface WatchlistBacklog {
  oldest: { title: string; added_at: string; years_ago: number } | null;
  avg_age_days: number | null;
}

export interface WatchlistRuntime {
  matched: number; // of count, how many watchlist films had a runtime estimate
  total_minutes: number;
  total_hours: number;
  total_days: number;
}

// TMDB-derived watchlist stats (Snapshot.watchlist_enriched). Needs the watchlist's
// films matched + their runtimes/genres; absent on un-enriched snapshots.
export interface EnrichedWatchlist {
  runtime: WatchlistRuntime | null;
  shortest: { title: string; runtime: number }[]; // quick wins, shortest first
  longest: { title: string; runtime: number } | null; // longest commitment
  taste_gap: { over: TasteGapGenre[] } | null;
}

export interface TasteGapGenre {
  genre: string;
  index: number | null; // watchlist share ÷ watched share; null = never watched
  watchlist_count: number;
}

export interface Enriched {
  matched_films: number;
  runtime: Runtime;
  genres: Record<string, number>;
  genre_by_year: Record<string, Record<string, number>>;
  countries: Record<string, number>;
  languages: Record<string, number>;
  top_directors: { director: string; films: number; avg_rating: number | null }[];
  top_actors: { actor: string; films: number; avg_rating: number | null }[];
  unique_actors: number;
  vs_community: VsCommunity;
}

export interface Runtime {
  total_minutes: number;
  total_hours: number;
  total_days: number;
  avg_minutes: number | null;
  longest: { minutes: number; title: string } | null;
  shortest: { minutes: number; title: string } | null;
}

export interface VsCommunity {
  mean_delta: number | null;
  verdict: string | null;
  you_overrate: CommunityDelta[];
  you_underrate: CommunityDelta[];
}

export interface CommunityDelta {
  title: string;
  you: number;
  community: number;
  delta: number;
}

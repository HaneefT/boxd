// Mirrors backend/process_upload/stats.py compute_snapshot output (schema_version 1).
// Keep in sync with that module; it is the single source of truth.

export interface Snapshot {
  schema_version: number;
  profile: Profile;
  core: Core;
  enriched: Enriched | null;
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
}

export interface Enriched {
  matched_films: number;
  runtime: Runtime;
  genres: Record<string, number>;
  genre_by_year: Record<string, Record<string, number>>;
  countries: Record<string, number>;
  languages: Record<string, number>;
  top_directors: { director: string; films: number; avg_rating: number | null }[];
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

// Display-name overrides for TMDB genre names that read awkwardly in tight UI (long,
// wrap badly). Single source so the bubble chart, taste skew, and Wrapped chips agree.
const GENRE_LABELS: Record<string, string> = {
  "Science Fiction": "Sci-Fi",
  "TV Movie": "TV Movie",
};

export function genreLabel(name: string): string {
  return GENRE_LABELS[name] ?? name;
}

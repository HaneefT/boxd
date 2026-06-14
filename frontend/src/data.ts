import type { Snapshot } from "./types";

// Phase 2 dev: the precomputed snapshot is served as a static file from public/.
// Later this becomes a fetch of the user's stat_snapshots.payload from Supabase.
// Override with VITE_STATS_URL if you keep the file elsewhere.
const STATS_URL = import.meta.env.VITE_STATS_URL ?? "/stats.json";

export async function loadSnapshot(): Promise<Snapshot> {
  const res = await fetch(STATS_URL);
  if (!res.ok) {
    throw new Error(
      `Could not load ${STATS_URL} (${res.status}). ` +
        `Copy backend/out/stats.json to frontend/public/stats.json.`,
    );
  }
  return (await res.json()) as Snapshot;
}

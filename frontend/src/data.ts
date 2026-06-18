import type { Snapshot } from "./types";
import { supabase, isSupabaseConfigured } from "./supabase";

// Dev fallback: serve a static snapshot when Supabase isn't configured.
// Set VITE_STATS_URL (defaults to /stats.json) and copy backend/out/stats.json
// to frontend/public/stats.json.
const STATS_URL = import.meta.env.VITE_STATS_URL ?? "/stats.json";

// Returns the signed-in user's precomputed stat snapshot, or null if they
// haven't uploaded an export yet (prompt them to upload).
export async function loadSnapshot(): Promise<Snapshot | null> {
  if (!isSupabaseConfigured) return loadStaticSnapshot();

  const { data, error } = await supabase
    .from("stat_snapshots")
    .select("payload")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data?.payload as Snapshot) ?? null;
}

async function loadStaticSnapshot(): Promise<Snapshot> {
  const res = await fetch(STATS_URL);
  if (!res.ok) {
    throw new Error(
      `Could not load ${STATS_URL} (${res.status}). ` +
        `Copy backend/out/stats.json to frontend/public/stats.json.`,
    );
  }
  return (await res.json()) as Snapshot;
}

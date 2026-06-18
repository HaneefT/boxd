import { createClient } from "@supabase/supabase-js";

// Anon/publishable key — safe in the browser; Row Level Security protects data.
// Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env (see .env.example).
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Optional: the owner's email. When the signed-in user matches, the app shows
// the "Invite a friend" button. The RPC enforces this server-side too — this
// only controls UI visibility. Set VITE_OWNER_EMAIL in frontend/.env.
export const ownerEmail = (import.meta.env.VITE_OWNER_EMAIL as string | undefined)?.toLowerCase();

// In dev with no Supabase configured, we fall back to the static stats.json path
// (see data.ts), so don't hard-crash module load — only error on actual use.
export const supabase = createClient(
  url ?? "http://localhost",
  anonKey ?? "public-anon-key",
);

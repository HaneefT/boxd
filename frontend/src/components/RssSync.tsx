import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";

// Opt-in daily RSS sync (DESIGN §2.4). A daily poller reads the member's PUBLIC
// Letterboxd RSS feed and appends new diary entries so they don't re-upload. Requires
// having imported once (we need lb_username) and a public profile (a private one 404s,
// which the poller records in rss_last_error). The user owns their profiles row (RLS),
// so the toggle writes rss_sync_enabled directly.
interface ProfileRss {
  lb_username: string | null;
  rss_sync_enabled: boolean;
  rss_last_synced_at: string | null;
  rss_last_error: string | null;
}

export function RssSync({ session }: { session: Session }) {
  const [p, setP] = useState<ProfileRss | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("lb_username, rss_sync_enabled, rss_last_synced_at, rss_last_error")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => setP((data as ProfileRss) ?? null));
  }, [session.user.id]);

  if (!p) return null; // still loading, or no profile yet (hasn't imported)
  if (!p.lb_username)
    return <p className="hint">Import your Letterboxd export once to enable daily auto-sync.</p>;

  async function toggle() {
    const next = !p!.rss_sync_enabled;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ rss_sync_enabled: next })
      .eq("id", session.user.id);
    setBusy(false);
    if (!error) setP({ ...p!, rss_sync_enabled: next });
  }

  return (
    <div className="rss-sync">
      <label className="rss-toggle">
        <input type="checkbox" checked={p.rss_sync_enabled} disabled={busy} onChange={toggle} />
        <span>Auto-sync new diary entries daily</span>
      </label>
      <p className="hint">Requires a <strong>public</strong> Letterboxd profile.</p>
      {p.rss_sync_enabled && p.rss_last_error && (
        <p className="error inline-error">Last sync failed — is your profile public?</p>
      )}
      {p.rss_sync_enabled && p.rss_last_synced_at && !p.rss_last_error && (
        <p className="hint">Last synced {new Date(p.rss_last_synced_at).toLocaleDateString()}.</p>
      )}
    </div>
  );
}

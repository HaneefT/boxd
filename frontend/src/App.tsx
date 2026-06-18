import { useCallback, useEffect, useState } from "react";
import { loadSnapshot } from "./data";
import type { Snapshot } from "./types";
import type { Group } from "./groups";
import { isSupabaseConfigured, ownerEmail, supabase } from "./supabase";
import { useSession } from "./useSession";
import { Login } from "./components/Login";
import { Invite } from "./components/Invite";
import { InviteFriend } from "./components/InviteFriend";
import { GroupSwitcher } from "./components/GroupSwitcher";
import { GroupInvite } from "./components/GroupInvite";
import { Upload } from "./components/Upload";
import { Dashboard } from "./components/Dashboard";

export function App() {
  const { session, loading: authLoading } = useSession();
  const authed = !isSupabaseConfigured || session != null;
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("invite");
  const groupInviteToken = params.get("group_invite");
  const isOwner =
    ownerEmail != null && session?.user.email?.toLowerCase() === ownerEmail;

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<Group | null>(null);

  const reload = useCallback(() => {
    setError(null);
    setLoaded(false);
    loadSnapshot()
      .then(setSnap)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (authed) reload();
  }, [authed, reload]);

  // Drop the group_invite token from the URL once handled, so a refresh doesn't re-prompt.
  const clearGroupInvite = () => {
    window.history.replaceState(null, "", window.location.pathname);
    reload();
  };

  if (isSupabaseConfigured && authLoading) return <div className="loading">…</div>;
  if (isSupabaseConfigured && !session) {
    if (inviteToken) return <Invite token={inviteToken} />;
    if (groupInviteToken)
      return <Login notice="Sign in to join the group you were invited to." />;
    return <Login />;
  }

  // Signed in with a pending group invite: confirm + join before anything else.
  if (groupInviteToken && session)
    return <GroupInvite token={groupInviteToken} onDone={clearGroupInvite} />;

  if (error) return <div className="error">{error}</div>;
  if (!loaded) return <div className="loading">Loading stats…</div>;

  return (
    <div className="app">
      {isSupabaseConfigured && (
        <div className="appbar">
          <span className="who">{session?.user.email}</span>
          <GroupSwitcher selected={group} onSelect={setGroup} />
          {isOwner && <InviteFriend />}
          <button className="secondary" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      )}

      {snap ? (
        <Dashboard snap={snap} group={group} myId={session?.user.id ?? null} />
      ) : (
        <div className="empty">
          <h1>Boxd Stats</h1>
          <p className="sub">No stats yet — upload your Letterboxd export to get started.</p>
          <Upload onComplete={reload} />
        </div>
      )}
    </div>
  );
}

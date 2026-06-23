import { useCallback, useEffect, useState } from "react";
import { loadSnapshot } from "./data";
import type { Snapshot } from "./types";
import type { Group } from "./groups";
import { isSupabaseConfigured, ownerEmail } from "./supabase";
import { useSession } from "./useSession";
import { clearPendingGroupInvite, rememberGroupInvite, takePendingGroupInvite } from "./groupInvite";
import { Login } from "./components/Login";
import { Invite } from "./components/Invite";
import { InviteFriend } from "./components/InviteFriend";
import { GroupSwitcher } from "./components/GroupSwitcher";
import { GroupInvite } from "./components/GroupInvite";
import { Upload } from "./components/Upload";
import { Dashboard } from "./components/Dashboard";
import { AccountMenu } from "./components/AccountMenu";
import { SetPassword } from "./components/SetPassword";

export function App() {
  const { session, loading: authLoading } = useSession();
  const authed = !isSupabaseConfigured || session != null;
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("invite");
  const urlGroupInvite = params.get("group_invite");
  const isOwner =
    ownerEmail != null && session?.user.email?.toLowerCase() === ownerEmail;

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  // Re-upload a fresh export to recompute the snapshot (DESIGN §2.4 — "fresh stats =
  // re-upload"). The raw ZIP is deleted after parsing, so there's nothing to reprocess.
  const [reuploading, setReuploading] = useState(false);
  // A fresh token from the URL, or one stashed before a sign-in redirect (which
  // strips the query string). Resolved once into state; the stash is dropped as
  // soon as it's consumed (below) or on done.
  const [groupInviteToken, setGroupInviteToken] = useState<string | null>(
    () => urlGroupInvite ?? takePendingGroupInvite(),
  );

  // Persist a fresh URL token so it survives the magic-link/OAuth redirect.
  useEffect(() => {
    if (urlGroupInvite) rememberGroupInvite(urlGroupInvite);
  }, [urlGroupInvite]);

  // Post-redirect (no URL token), the stash has already been lifted into state by
  // the initializer — drop it now so an invite abandoned on the join screen doesn't
  // re-block the dashboard on every later visit. Skipped when a URL token is present:
  // that's the pre-redirect leg, where the effect above is busy stashing it.
  useEffect(() => {
    if (!urlGroupInvite) clearPendingGroupInvite();
  }, [urlGroupInvite]);

  // Nudge email (magic-link) users to set a password after first sign-in — once,
  // dismissible, per-user. Google users are untouched (DESIGN §10.2 A).
  const user = session?.user;
  const isEmailUser = user?.app_metadata?.provider === "email";
  const hasPassword = user?.user_metadata?.has_password === true;
  const [pwNudgeHidden, setPwNudgeHidden] = useState(false);
  const pwDismissed = user
    ? localStorage.getItem(`pwPromptDismissed:${user.id}`) === "1"
    : true;
  const showPwNudge = isEmailUser && !hasPassword && !pwDismissed && !pwNudgeHidden;
  const dismissPwNudge = () => {
    if (user) localStorage.setItem(`pwPromptDismissed:${user.id}`, "1");
    setPwNudgeHidden(true);
  };

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

  // Drop the group_invite token (URL + stash + state) once handled, so a refresh
  // doesn't re-prompt.
  const clearGroupInvite = () => {
    clearPendingGroupInvite();
    setGroupInviteToken(null);
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
          {snap && (
            <button className="secondary" onClick={() => setReuploading((r) => !r)}>
              Refresh stats
            </button>
          )}
          {session && <AccountMenu session={session} />}
        </div>
      )}

      {showPwNudge && (
        <div className="panel notice pw-nudge">
          <div className="group-head">
            <span className="sub">
              Set a password for faster sign-in — no more waiting on an email link.
            </span>
            <button className="secondary" onClick={dismissPwNudge}>
              Not now
            </button>
          </div>
          <SetPassword hasPassword={false} onDone={dismissPwNudge} />
        </div>
      )}

      {snap ? (
        <>
          {reuploading && (
            <div className="panel notice" style={{ marginBottom: 16 }}>
              <div className="group-head">
                <span className="sub">
                  Download a fresh export from Letterboxd and upload it to recompute your stats.
                </span>
                <button className="secondary" onClick={() => setReuploading(false)}>
                  Cancel
                </button>
              </div>
              <Upload
                onComplete={() => {
                  setReuploading(false);
                  reload();
                }}
              />
            </div>
          )}
          <Dashboard snap={snap} group={group} myId={session?.user.id ?? null} />
        </>
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

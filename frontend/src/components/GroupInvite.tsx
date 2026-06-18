import { useState } from "react";
import { redeemGroupInvite } from "../groups";

// Landing for a group invite link (?group_invite=<token>), shown to a signed-in
// user. The consent line is required, not decorative: joining is the friend-sharing
// opt-in (DESIGN §2.6) — by joining you agree co-members can see your ratings on
// shared films. redeem_group_invite adds the membership row (migration 007).
const MESSAGES: Record<string, string> = {
  invalid: "This group invite isn't valid.",
  expired: "This group invite has expired.",
  exhausted: "This group invite has been fully used.",
};

export function GroupInvite({ token, onDone }: { token: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await redeemGroupInvite(token);
      if (res === "ok" || res === "already_member") onDone();
      else setError(MESSAGES[res] ?? "Couldn't join this group.");
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <h1>Join a group on Boxd Stats</h1>
      <div className="panel">
        <p>
          You've been invited to a friend group. <strong>Members of this group can see your
          ratings</strong> on films you've both logged, and your films feed the group's shared
          stats — just star ratings, never your reviews.
        </p>
        <div className="group-join-actions">
          <button onClick={join} disabled={busy}>
            {busy ? "Joining…" : "Join group"}
          </button>
          <button className="secondary" onClick={onDone}>
            Not now
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

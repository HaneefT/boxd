import { useState } from "react";
import { supabase } from "../supabase";
import { Login } from "./Login";

// Landing page for an invite link (?invite=<token>). The friend claims the email
// they'll sign in with; redeem_invite allowlists it (see migration 005). Then we
// hand off to the normal Login, pre-filled with that email.
const MESSAGES: Record<string, string> = {
  invalid: "This invite link isn't valid.",
  expired: "This invite link has expired.",
  exhausted: "This invite link has been fully used.",
  invalid_email: "Please enter a valid email address.",
};

export function Invite({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("redeem_invite", {
      p_token: token,
      p_email: email,
    });
    setBusy(false);
    if (error) setError(error.message);
    else if (data === "ok") setAccepted(true);
    else setError(MESSAGES[data as string] ?? "Couldn't accept this invite.");
  }

  if (accepted) {
    return (
      <Login
        defaultEmail={email}
        notice={
          <>
            You're on the list 🎉 Sign in below with <strong>{email}</strong> — use the
            same address for Google.
          </>
        }
      />
    );
  }

  return (
    <div className="login">
      <h1>You're invited to Boxd Stats</h1>
      <p className="sub">A deeper-stats companion for your Letterboxd export.</p>

      <form className="panel login-form" onSubmit={accept}>
        <label htmlFor="invite-email">Email you'll sign in with</label>
        <input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <button type="submit" disabled={busy || !email}>
          {busy ? "Accepting…" : "Accept invite"}
        </button>
      </form>

      {error && <div className="error">{error}</div>}
    </div>
  );
}

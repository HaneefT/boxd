import { useEffect, useState } from "react";
import { supabase } from "../supabase";

// Turn raw GoTrue/Postgres errors into something friendly. A non-allowlisted
// sign-up trips the DB allowlist trigger, which GoTrue surfaces as a generic
// "Database error saving new user" — map that to the real reason.
function friendlyAuthError(raw: string): string {
  const s = raw.toLowerCase();
  // Wrong password OR no password set yet both surface as "invalid login credentials".
  if (s.includes("invalid login credentials"))
    return "Wrong password — or you haven't set one yet. Use the email sign-in link below.";
  if (s.includes("database error") || s.includes("allowlist") || s.includes("invite"))
    return "That email isn't on the invite list yet — Boxd Stats is friends-only for now.";
  return raw;
}

// Supabase Auth: email magic-link + Google OAuth (DESIGN §4.1).
export function Login({
  defaultEmail = "",
  notice,
}: {
  defaultEmail?: string;
  notice?: React.ReactNode;
} = {}) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // OAuth (Google) failures come back as params on the redirect URL, not as a
  // thrown error — surface them, then strip them so a refresh doesn't re-show.
  useEffect(() => {
    const params = new URLSearchParams(
      window.location.hash.slice(1) || window.location.search.slice(1),
    );
    const err = params.get("error_description") || params.get("error");
    if (err) {
      setError(friendlyAuthError(err));
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    // Success: useSession picks up the new session — no redirect needed.
    if (error) setError(friendlyAuthError(error.message));
  }

  async function sendMagicLink() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setError(friendlyAuthError(error.message));
    else setSent(true);
  }

  async function signInWithGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(friendlyAuthError(error.message));
  }

  return (
    <div className="login">
      <h1>Boxd Stats</h1>
      <p className="sub">A deeper-stats companion for your Letterboxd export.</p>

      {notice && <div className="panel notice">{notice}</div>}

      {sent ? (
        <div className="panel">
          Check your email — we sent a sign-in link to <strong>{email}</strong>.
        </div>
      ) : (
        <form className="panel login-form" onSubmit={signInWithPassword}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password (if you've set one)"
            autoComplete="current-password"
          />
          <button type="submit" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={sendMagicLink}
            disabled={busy || !email}
          >
            Email me a sign-in link instead
          </button>
          <div className="or">or</div>
          <button type="button" className="secondary" onClick={signInWithGoogle}>
            Continue with Google
          </button>
        </form>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  );
}

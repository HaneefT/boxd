import { useState } from "react";
import { supabase } from "../supabase";

// Set or change the account password. Email users are nudged to set one after their
// first magic-link sign-in (see App's banner); anyone can change it from the account
// menu. `has_password` is a user_metadata flag — purely a UI signal for the nudge,
// not a security boundary (the real password lives in Supabase Auth).
export function SetPassword({
  hasPassword,
  onDone,
}: {
  hasPassword: boolean;
  onDone?: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({
      password,
      data: { has_password: true },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setPassword("");
    setDone(true);
    onDone?.();
  }

  if (done)
    return (
      <div className="upload-result">
        Password saved — you can sign in with it next time.
      </div>
    );

  return (
    <form className="set-password" onSubmit={save}>
      <label htmlFor="new-password">{hasPassword ? "New password" : "Set a password"}</label>
      <input
        id="new-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 8 characters"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <button type="submit" disabled={busy || password.length < 8}>
        {busy ? "Saving…" : hasPassword ? "Change password" : "Save password"}
      </button>
      {error && <div className="error inline-error">{error}</div>}
    </form>
  );
}

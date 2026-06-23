// A signed-out ?group_invite link can't be redeemed until the user signs in — but
// the magic-link / OAuth redirect goes to `origin` and strips the query string, so
// the token is lost on return. Stash it before the redirect and restore it after.
const KEY = "pendingGroupInvite";

export function rememberGroupInvite(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* storage may be blocked (private mode); the in-URL token still works for
       already-signed-in clicks, which is the common case. */
  }
}

export function takePendingGroupInvite(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingGroupInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

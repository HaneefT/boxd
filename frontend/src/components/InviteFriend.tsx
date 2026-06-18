import { useRef, useState } from "react";
import { supabase } from "../supabase";
import { useClickAway } from "../useClickAway";

// Owner-only: mints an invite link (create_invite RPC) and copies it. The link is
// open to unlimited sign-ups but expires after a day, so a stale shared link can't
// keep allowlisting strangers. The RPC enforces owner-only server-side.
export function InviteFriend() {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useClickAway(root, () => setOpen(false), open);

  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    setLink(null);
    const { data, error } = await supabase.rpc("create_invite", {
      p_label: null,
      p_max_uses: null, // unlimited joins
      p_ttl_days: 1, // expires in a day
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    const url = `${window.location.origin}/?invite=${data}`;
    setLink(url);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* clipboard may be blocked; the link is shown below to copy manually */
    }
  }

  return (
    <div className="invite-friend" ref={root}>
      <button
        className="secondary"
        onClick={() => {
          setOpen((o) => !o);
          setLink(null);
          setError(null);
        }}
      >
        Invite a friend
      </button>

      {open && (
        <div className="panel popover invite-panel">
          <p className="hint">A link anyone can use to sign up — expires in a day.</p>
          <button onClick={generate} disabled={busy}>
            {busy ? "Generating…" : "Generate link"}
          </button>
          {link && (
            <div className="invite-link">
              <span>{copied ? "Link copied — share it:" : "Share this link:"}</span>
              <input readOnly value={link} onClick={(e) => e.currentTarget.select()} />
            </div>
          )}
          {error && <div className="error inline-error">{error}</div>}
        </div>
      )}
    </div>
  );
}

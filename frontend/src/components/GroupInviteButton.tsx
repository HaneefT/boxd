import { useRef, useState } from "react";
import { createGroupInvite } from "../groups";
import { useClickAway } from "../useClickAway";

// Mints a reusable join link for one group (create_group_invite RPC, owner-only
// server-side) and copies it. Unlimited joins, but expires after a day.
export function GroupInviteButton({ groupId }: { groupId: string }) {
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
    try {
      const token = await createGroupInvite(groupId, null, 1); // unlimited joins, 1-day expiry
      const url = `${window.location.origin}/?group_invite=${token}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } catch {
        /* clipboard may be blocked; the link is shown below to copy manually */
      }
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
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
        Invite to group
      </button>

      {open && (
        <div className="panel popover invite-panel">
          <p className="hint">A link anyone can use to join the group — expires in a day.</p>
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

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createGroup, listMyGroups, type Group } from "../groups";
import { supabase } from "../supabase";
import { SetPassword } from "./SetPassword";
import { RssSync } from "./RssSync";
import { Upload } from "./Upload";
import { IconChevron, IconRefresh, IconUser, IconUserPlus, IconUsers } from "./icons";

type Section = "group" | "new" | "invite" | "refresh" | "account";

// Mobile nav: a blurred-backdrop sheet where tapping a row expands its controls inline
// below it and disables the others until it's closed (one open at a time). Replaces
// the appbar row on small screens; desktop keeps its own popover components. Reuses
// Upload + SetPassword; the group list / create / invite are light enough to inline.
export function MobileMenu({
  session,
  group,
  onSelectGroup,
  isOwner,
  canRefresh,
  onReuploaded,
  onClose,
}: {
  session: Session;
  group: Group | null;
  onSelectGroup: (g: Group | null) => void;
  isOwner: boolean;
  canRefresh: boolean;
  onReuploaded: () => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  useEffect(() => {
    listMyGroups().then(setGroups).catch(() => {});
  }, []);

  const rows = [
    { key: "group" as const, icon: <IconUsers />, label: group?.name ?? "Just me" },
    { key: "new" as const, icon: <IconUsers />, label: "New group" },
    { key: "invite" as const, icon: <IconUserPlus />, label: "Invite a friend", hide: !isOwner },
    { key: "refresh" as const, icon: <IconRefresh />, label: "Refresh stats", hide: !canRefresh },
    { key: "account" as const, icon: <IconUser />, label: "Account" },
  ].filter((r) => !r.hide);

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="mobile-menu" role="dialog" aria-label="Menu">
        <p className="mm-email">{session.user.email}</p>
        {rows.map((r) => {
          const active = section === r.key;
          return (
            <div key={r.key} className={`mm-row ${active ? "active" : ""}`}>
              <button
                className="mm-trigger"
                aria-expanded={active}
                onClick={() => setSection(active ? null : r.key)}
              >
                {r.icon}
                <span className="mm-label">{r.label}</span>
                <IconChevron />
              </button>
              {active && (
                <div className="mm-body">
                  {r.key === "group" && (
                    <ul className="mm-grouplist">
                      <li className={group == null ? "sel" : ""} onClick={() => { onSelectGroup(null); onClose(); }}>
                        Just me
                      </li>
                      {groups.map((g) => (
                        <li key={g.id} className={group?.id === g.id ? "sel" : ""} onClick={() => { onSelectGroup(g); onClose(); }}>
                          {g.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.key === "new" && (
                    <NewGroupBody onCreated={(g) => { setGroups((gs) => [...gs, g]); onSelectGroup(g); onClose(); }} />
                  )}
                  {r.key === "invite" && <InviteBody />}
                  {r.key === "refresh" && <Upload onComplete={() => { onReuploaded(); onClose(); }} />}
                  {r.key === "account" && (
                    <>
                      <SetPassword hasPassword={session.user.user_metadata?.has_password === true} />
                      <RssSync session={session} />
                      <button className="secondary mm-signout" onClick={() => supabase.auth.signOut()}>
                        Sign out
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function NewGroupBody({ onCreated }: { onCreated: (g: Group) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = await createGroup(name);
      onCreated({ id, name });
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="mm-form" onSubmit={submit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" autoFocus />
      <button type="submit" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create"}</button>
      {error && <div className="error inline-error">{error}</div>}
    </form>
  );
}

function InviteBody() {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const { data, error } = await supabase.rpc("create_invite", { p_label: null, p_max_uses: null, p_ttl_days: 1 });
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
    <div className="mm-invite">
      <p className="hint">A link anyone can use to sign up — expires in a day.</p>
      <button onClick={generate} disabled={busy}>{busy ? "Generating…" : "Generate link"}</button>
      {link && (
        <div className="invite-link">
          <span>{copied ? "Link copied — share it:" : "Share this link:"}</span>
          <input readOnly value={link} onClick={(e) => e.currentTarget.select()} />
        </div>
      )}
      {error && <div className="error inline-error">{error}</div>}
    </div>
  );
}

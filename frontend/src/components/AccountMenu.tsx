import { useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { useClickAway } from "../useClickAway";
import { SetPassword } from "./SetPassword";
import { IconUser } from "./icons";

// Appbar account control: the always-available home for set/change-password + sign
// out. Mutually exclusive with the other appbar popovers via useClickAway.
export function AccountMenu({ session }: { session: Session }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useClickAway(root, () => setOpen(false), open);

  const hasPassword = session.user.user_metadata?.has_password === true;

  return (
    <div className="invite-friend" ref={root}>
      <button className="secondary icon-btn" aria-label="Account" onClick={() => setOpen((o) => !o)}>
        <IconUser /> <span className="btn-label">Account</span>
      </button>

      {open && (
        <div className="panel popover invite-panel">
          <p className="hint">{session.user.email}</p>
          <SetPassword hasPassword={hasPassword} />
          <div className="group-join-actions" style={{ marginTop: 12 }}>
            <button className="secondary" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

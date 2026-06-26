import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { SetPassword } from "./SetPassword";
import { RssSync } from "./RssSync";
import { Upload } from "./Upload";
import { IconSettings } from "./icons";

// One appbar entry point for everything account/data — replaces the old overloaded
// Account popover and the separate Refresh-stats button. A centered modal with clear
// sections: Account (email, password, sign out) and keeping your stats fresh (auto-sync
// + manual re-upload).
export function Settings({
  session,
  canRefresh,
  onReuploaded,
}: {
  session: Session;
  canRefresh: boolean;
  onReuploaded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasPassword = session.user.user_metadata?.has_password === true;

  return (
    <>
      <button className="secondary icon-btn" aria-label="Settings" onClick={() => setOpen(true)}>
        <IconSettings /> <span className="btn-label">Settings</span>
      </button>

      {open && (
        <>
          <div className="modal-backdrop" onClick={() => setOpen(false)} />
          <div className="settings-modal" role="dialog" aria-label="Settings">
            <div className="settings-head">
              <h3>Settings</h3>
              <button className="settings-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>

            <section className="settings-section">
              <h4>Account</h4>
              <p className="hint">{session.user.email}</p>
              <SetPassword hasPassword={hasPassword} />
            </section>

            <section className="settings-section">
              <h4>Keep your stats fresh</h4>
              <RssSync session={session} />
              {canRefresh && (
                <div className="settings-reupload">
                  <p className="hint">Or re-upload a fresh export manually:</p>
                  <Upload
                    onComplete={() => {
                      onReuploaded();
                      setOpen(false);
                    }}
                  />
                </div>
              )}
            </section>

            <button className="secondary settings-signout" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </>
      )}
    </>
  );
}

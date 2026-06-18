import { useRef, useState } from "react";
import type { RosterMember } from "../groups";
import { useClickAway } from "../useClickAway";

// The "Members" card: shows the count, and expands to the full member list on
// click. Scrollable, and once a group is large (>10) a search box filters it so
// finding someone in a 50-member group doesn't mean scrolling a flat list.
const SEARCH_THRESHOLD = 10;

export function GroupMembers({ roster, myId }: { roster: RosterMember[]; myId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  useClickAway(ref, close, open);

  const q = query.trim().toLowerCase();
  const shown = q
    ? roster.filter((m) => (m.display_name ?? "").toLowerCase().includes(q))
    : roster;

  return (
    <div className="members-card" ref={ref}>
      <button
        type="button"
        className="card card-button"
        aria-label="Members"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <div className="value">{roster.length}</div>
        <div className="label">Members</div>
        <div className="hint">{open ? "Hide list ▲" : "View list ▼"}</div>
      </button>

      {open && (
        <div className="panel popover members-list">
          {roster.length > SEARCH_THRESHOLD && (
            <input
              type="text"
              className="members-search"
              placeholder="Search members"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          )}
          <div className="members-scroll" role="list">
            {shown.map((m) => (
              <div key={m.user_id} className="member-row" role="listitem">
                <span className="member-name">
                  {m.display_name ?? "A friend"}
                  {m.user_id === myId ? " (you)" : ""}
                </span>
                {m.role === "owner" && <span className="member-tag">owner</span>}
              </div>
            ))}
            {shown.length === 0 && <div className="member-empty">No members match.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

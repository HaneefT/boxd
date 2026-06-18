import { useEffect, useRef, useState } from "react";
import { createGroup, listMyGroups, type Group } from "../groups";
import { useClickAway } from "../useClickAway";
import { Dropdown } from "./Dropdown";

// Appbar control: pick which group the dashboard compares against ("Just me" =
// no group), and create a new one inline. Reports the selected Group up so the
// dashboard has its name without a second lookup.
export function GroupSwitcher({
  selected,
  onSelect,
}: {
  selected: Group | null;
  onSelect: (g: Group | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  // One state for both popovers (the group menu and the create form) so they can
  // never be open at once — even though the menu lives inside this same root.
  const [openPanel, setOpenPanel] = useState<"none" | "menu" | "create">("none");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useClickAway(root, () => setOpenPanel("none"), openPanel !== "none");

  async function refresh(): Promise<Group[]> {
    try {
      const gs = await listMyGroups();
      setGroups(gs);
      return gs;
    } catch (e) {
      setError(String((e as Error).message));
      return [];
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = await createGroup(name);
      setName("");
      setOpenPanel("none");
      const gs = await refresh();
      const made = gs.find((g) => g.id === id);
      if (made) onSelect(made);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const options = [
    { value: "", label: "Just me" },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
  ];

  return (
    <div className="group-switcher" ref={root}>
      <Dropdown
        value={selected?.id ?? ""}
        options={options}
        ariaLabel="Active group"
        open={openPanel === "menu"}
        onOpenChange={(o) => setOpenPanel(o ? "menu" : "none")}
        onChange={(v) => onSelect(groups.find((g) => g.id === v) ?? null)}
      />
      <button
        className="secondary"
        onClick={() => setOpenPanel((p) => (p === "create" ? "none" : "create"))}
      >
        New group
      </button>

      {openPanel === "create" && (
        <form className="panel popover group-create" onSubmit={create}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name"
            autoFocus
          />
          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
      )}
      {error && <div className="error inline-error">{error}</div>}
    </div>
  );
}

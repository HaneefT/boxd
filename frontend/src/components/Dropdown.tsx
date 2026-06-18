import { useRef } from "react";
import { useClickAway } from "../useClickAway";

// A themed select replacement. A native <select>'s open option list is drawn by
// the OS and can't be styled (white box + blue highlight on Windows); this is a
// DOM listbox so the open state matches the app. Controlled, so a parent can keep
// it mutually exclusive with sibling popovers.
export interface DropdownOption {
  value: string;
  label: string;
}

export function Dropdown({
  value,
  options,
  onChange,
  open,
  onOpenChange,
  ariaLabel,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useClickAway(root, () => onOpenChange(false), open);

  const current = options.find((o) => o.value === value);

  return (
    <div className="dropdown" ref={root}>
      <button
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => onOpenChange(!open)}
      >
        <span className="dropdown-label">{current?.label ?? "Select…"}</span>
        <svg
          className={`dropdown-caret ${open ? "up" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul className="dropdown-menu popover" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`dropdown-item ${o.value === value ? "selected" : ""}`}
              onClick={() => {
                onChange(o.value);
                onOpenChange(false);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

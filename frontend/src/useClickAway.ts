import { useEffect, type RefObject } from "react";

// Calls `onAway` when a mousedown lands outside `ref`. Used to auto-close appbar
// popovers — clicking another popover's trigger counts as "outside", so opening
// one closes any other (fixes overlapping panels).
export function useClickAway<T extends HTMLElement>(
  ref: RefObject<T>,
  onAway: () => void,
  active = true,
) {
  useEffect(() => {
    if (!active) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, onAway, active]);
}

import type { ReactNode } from "react";

// Format a stat value with a smaller, muted unit suffix (e.g. 72 + "h", 5 + "mo").
// Shared so every card with a unit renders it the same way.
export function withUnit(value: ReactNode, u: string) {
  return (
    <>
      {value}
      <span className="unit">{u}</span>
    </>
  );
}

export function StatCard({
  value,
  label,
  hint,
}: {
  value: ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <div className="card">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

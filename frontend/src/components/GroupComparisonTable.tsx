import type { FilmComparison } from "../groups";

// "Where you differ": one row per shared film where your rating and the group's
// average actually diverge, ranked by how far apart — capped so it stays scannable
// instead of listing every shared film. Shows each member's rating (individual-
// visible, DESIGN §10.2 C), the group average, and a signed Δ (you − group).
const MAX_ROWS = 12;

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

export function GroupComparisonTable({ films }: { films: FilmComparison[] }) {
  const rows = films
    .map((f) => {
      const avg = f.others.length
        ? f.others.reduce((s, o) => s + o.rating, 0) / f.others.length
        : null;
      const delta = avg != null && f.you != null ? f.you - avg : null;
      return { f, avg, delta };
    })
    .filter((r): r is { f: FilmComparison; avg: number; delta: number } => r.delta != null && r.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, MAX_ROWS);

  if (rows.length === 0)
    return (
      <div className="panel" style={{ color: "var(--muted)" }}>
        You and the group rate your shared films the same so far — no disagreements yet.
      </div>
    );

  return (
    <div className="panel">
      <table className="lb">
        <thead>
          <tr>
            <th>Film</th>
            <th className="num">You</th>
            <th>The group</th>
            <th className="num">Group avg</th>
            <th className="num">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ f, avg, delta }) => (
            <tr key={f.tmdb_id}>
              <td>
                {f.title}
                {f.year ? ` (${f.year})` : ""}
              </td>
              <td className="num">{f.you != null ? f.you.toFixed(1) : "—"}</td>
              <td>
                {f.others.map((o) => (
                  <span key={o.user_id} className="chip member-chip">
                    <span className="avatar" aria-hidden="true">{initials(o.name)}</span>
                    {o.name} {o.rating.toFixed(1)}
                  </span>
                ))}
              </td>
              <td className="num">{avg.toFixed(1)}</td>
              <td className={`num ${delta > 0 ? "delta-pos" : "delta-neg"}`}>
                {delta > 0 ? "+" : "−"}
                {Math.abs(delta).toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

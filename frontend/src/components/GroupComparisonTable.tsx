import type { FilmComparison } from "../groups";

// "Where you differ": one row per shared film where your rating and the group's
// average actually diverge, ranked by how far apart — capped so it stays scannable
// instead of listing every shared film. Shows each member's rating (individual-
// visible, DESIGN §10.2 C) and the group average to compare your score against.
const MAX_ROWS = 12;

export function GroupComparisonTable({ films }: { films: FilmComparison[] }) {
  const rows = films
    .map((f) => {
      const avg = f.others.length
        ? f.others.reduce((s, o) => s + o.rating, 0) / f.others.length
        : null;
      const diff = avg != null && f.you != null ? Math.abs(f.you - avg) : 0;
      return { f, avg, diff };
    })
    .filter((r) => r.avg != null && r.diff > 0)
    .sort((a, b) => b.diff - a.diff)
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
          </tr>
        </thead>
        <tbody>
          {rows.map(({ f, avg }) => (
            <tr key={f.tmdb_id}>
              <td>
                {f.title}
                {f.year ? ` (${f.year})` : ""}
              </td>
              <td className="num">{f.you != null ? f.you.toFixed(1) : "—"}</td>
              <td>
                {f.others.map((o) => (
                  <span key={o.user_id} className="chip">
                    {o.name} {o.rating.toFixed(1)}
                  </span>
                ))}
              </td>
              <td className="num">{avg != null ? avg.toFixed(1) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

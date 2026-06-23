import type { Enriched } from "../types";

// Actor leaderboard — mirrors DirectorsTable, driven by films.top_cast (migration
// 009). "Avg ★" is over the films of theirs you actually rated (null = none rated).
export function PeopleTable({ actors }: { actors: Enriched["top_actors"] }) {
  return (
    <div className="panel">
      <table className="lb">
        <thead>
          <tr>
            <th>Actor</th>
            <th className="num">Films</th>
            <th className="num">Avg ★</th>
          </tr>
        </thead>
        <tbody>
          {actors.map((a) => (
            <tr key={a.actor}>
              <td>{a.actor}</td>
              <td className="num">{a.films}</td>
              <td className="num">{a.avg_rating != null ? a.avg_rating.toFixed(2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

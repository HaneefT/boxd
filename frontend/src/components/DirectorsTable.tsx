import type { Enriched } from "../types";

export function DirectorsTable({ directors }: { directors: Enriched["top_directors"] }) {
  return (
    <div className="panel">
      <table className="lb">
        <thead>
          <tr>
            <th>Director</th>
            <th className="num">Films</th>
            <th className="num">Avg ★</th>
          </tr>
        </thead>
        <tbody>
          {directors.map((d) => (
            <tr key={d.director}>
              <td>{d.director}</td>
              <td className="num">{d.films}</td>
              <td className="num">{d.avg_rating != null ? d.avg_rating.toFixed(2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

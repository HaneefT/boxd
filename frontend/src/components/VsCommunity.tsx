import type { CommunityDelta, VsCommunity as VsCommunityT } from "../types";

function DeltaTable({ title, rows, kind }: { title: string; rows: CommunityDelta[]; kind: "over" | "under" }) {
  return (
    <div className="panel">
      <div className="label" style={{ marginBottom: 10 }}>{title}</div>
      <table className="lb">
        <thead>
          <tr>
            <th>Film</th>
            <th className="num">You</th>
            <th className="num">Crowd</th>
            <th className="num">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.title}-${i}`}>
              <td>{r.title}</td>
              <td className="num">{r.you.toFixed(1)}</td>
              <td className="num">{r.community.toFixed(1)}</td>
              <td className={`num ${kind === "over" ? "delta-pos" : "delta-neg"}`}>
                {r.delta > 0 ? "+" : ""}
                {r.delta.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VsCommunity({ vs }: { vs: VsCommunityT }) {
  return (
    <>
      {vs.verdict && (
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Your ratings run <strong>{vs.verdict}</strong>
          {vs.mean_delta != null && ` (mean Δ ${vs.mean_delta > 0 ? "+" : ""}${vs.mean_delta}★ vs the TMDB crowd)`}.
        </p>
      )}
      <div className="grid-2">
        <DeltaTable title="You rate higher" rows={vs.you_overrate} kind="over" />
        <DeltaTable title="You rate lower" rows={vs.you_underrate} kind="under" />
      </div>
    </>
  );
}

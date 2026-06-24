import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Ratings } from "../types";

const ORDER = ["0.5", "1.0", "1.5", "2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];

// Themed tooltip — Recharts' default ("films : 4" with a colour swatch) clashes with
// the dark UI, so we render our own clean box.
function RatingTip({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const c = payload[0].value;
  return (
    <div className="chart-tip">
      <strong>{label}★</strong> {c} film{c === 1 ? "" : "s"}
    </div>
  );
}

export function RatingHistogram({ ratings }: { ratings: Ratings }) {
  const data = ORDER.map((k) => ({ stars: k, count: ratings.histogram[k] ?? 0 }));
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="panel">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <XAxis dataKey="stars" tick={{ fill: "#9ab", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#678", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.05)", radius: 3 }} content={<RatingTip />} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.stars} fill={d.count === max ? "#00b020" : "#3a6b3f"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

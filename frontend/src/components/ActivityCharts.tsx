import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Activity } from "../types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function MiniBars({ data, color }: { data: { name: string; count: number }[]; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <XAxis dataKey="name" tick={{ fill: "#9ab", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={{ fill: "#678", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={{ background: "#1c2228", border: "1px solid #2c353d", borderRadius: 8, color: "#e6e9ec" }}
          formatter={(v: number) => [v, "films"]}
        />
        <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Only needs the seasonality maps, so both the personal snapshot's Activity and
// the group_stats activity rollup satisfy it.
export function ActivityCharts({ activity }: { activity: Pick<Activity, "by_weekday" | "by_month"> }) {
  const weekday = WEEKDAYS.map((d) => ({ name: d, count: activity.by_weekday[d] ?? 0 }));
  const month = MONTHS.map((m) => ({ name: m, count: activity.by_month[m] ?? 0 }));
  return (
    <div className="grid-2">
      <div className="panel">
        <div className="label" style={{ marginBottom: 8 }}>By weekday</div>
        <MiniBars data={weekday} color="#00b020" />
      </div>
      <div className="panel">
        <div className="label" style={{ marginBottom: 8 }}>By month</div>
        <MiniBars data={month} color="#ff8000" />
      </div>
    </div>
  );
}

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function GenreChart({ genres, top = 12 }: { genres: Record<string, number>; top?: number }) {
  const data = Object.entries(genres)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([genre, count]) => ({ genre, count }));

  return (
    <div className="panel">
      <ResponsiveContainer width="100%" height={Math.max(240, data.length * 26)}>
        <BarChart layout="vertical" data={data} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="genre"
            width={96}
            tick={{ fill: "#9ab", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{ background: "#1c2228", border: "1px solid #2c353d", borderRadius: 8, color: "#e6e9ec" }}
            formatter={(v: number) => [v, "films"]}
          />
          <Bar dataKey="count" fill="#40bcf4" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

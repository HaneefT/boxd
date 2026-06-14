import { useMemo } from "react";
import type { Activity } from "../types";

const CELL = 12;
const GAP = 3;
const DOW = ["Mon", "", "Wed", "", "Fri", "", ""];
const SHADES = ["#1c2228", "#0e4d1a", "#15732a", "#1f9c39", "#2dd257"];

// Parse "YYYY-MM-DD" as a UTC date (avoids local-timezone day drift).
function utc(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}
// Monday=0 .. Sunday=6
function dowMon(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

export function Heatmap({ activity }: { activity: Activity }) {
  const { columns, max, monthLabels } = useMemo(() => {
    const entries = Object.entries(activity.heatmap);
    if (entries.length === 0) return { columns: [], max: 0, monthLabels: [] };

    const dates = entries.map(([k]) => k).sort();
    const start = addDays(utc(dates[0]), -dowMon(utc(dates[0]))); // back to Monday
    const end = utc(dates[dates.length - 1]);
    const maxCount = Math.max(...entries.map(([, v]) => v));

    const cols: { date: Date; count: number }[][] = [];
    const labels: { x: number; text: string }[] = [];
    let cur = start;
    let col = 0;
    let lastMonth = -1;
    while (cur <= end) {
      const week: { date: Date; count: number }[] = [];
      for (let r = 0; r < 7; r++) {
        const key = cur.toISOString().slice(0, 10);
        week.push({ date: cur, count: activity.heatmap[key] ?? 0 });
        const mon = cur.getUTCMonth();
        if (r === 0 && mon !== lastMonth) {
          labels.push({ x: col * (CELL + GAP), text: cur.toLocaleString("en", { month: "short", timeZone: "UTC" }) });
          lastMonth = mon;
        }
        cur = addDays(cur, 1);
      }
      cols.push(week);
      col++;
    }
    return { columns: cols, max: maxCount, monthLabels: labels };
  }, [activity]);

  if (columns.length === 0) return <div className="panel">No dated activity.</div>;

  const shade = (c: number) => {
    if (c <= 0) return SHADES[0];
    const idx = Math.min(SHADES.length - 1, 1 + Math.floor(((c - 1) / Math.max(max, 1)) * (SHADES.length - 1)));
    return SHADES[idx];
  };

  const width = columns.length * (CELL + GAP) + 30;
  const height = 7 * (CELL + GAP) + 20;

  return (
    <div className="panel">
      <div className="heatmap-wrap">
        <svg width={width} height={height} role="img" aria-label="Watch frequency heatmap">
          {monthLabels.map((m, i) => (
            <text key={i} x={m.x + 30} y={10} fill="#678" fontSize={10}>{m.text}</text>
          ))}
          {DOW.map((d, r) =>
            d ? (
              <text key={r} x={0} y={r * (CELL + GAP) + 28} fill="#678" fontSize={10}>{d}</text>
            ) : null,
          )}
          <g transform="translate(30, 16)">
            {columns.map((week, c) =>
              week.map((day, r) => (
                <rect
                  key={`${c}-${r}`}
                  x={c * (CELL + GAP)}
                  y={r * (CELL + GAP)}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={shade(day.count)}
                >
                  <title>{`${day.date.toISOString().slice(0, 10)}: ${day.count} film${day.count === 1 ? "" : "s"}`}</title>
                </rect>
              )),
            )}
          </g>
        </svg>
      </div>
      <div className="heatmap-legend">
        <span>Less</span>
        {SHADES.map((s) => (
          <span key={s} className="swatch" style={{ background: s }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

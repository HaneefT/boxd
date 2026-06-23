import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity } from "../types";

const CELL = 12;
const GAP = 3;
const DOW = ["Mon", "", "Wed", "", "Fri", "", ""];
// Index 0 is the "no activity" square: a neutral gray, deliberately lighter than
// the panel (--bg-elev #1c2228) so every day is visible as a grid cell, GitHub-style.
const SHADES = ["#2a323b", "#0e4d1a", "#15732a", "#1f9c39", "#2dd257"];

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

type YearFilter = "all" | number;

export function Heatmap({ activity }: { activity: Activity }) {
  // Years present in the data, newest first — drives the GitHub-style filter row.
  const years = useMemo(() => {
    const ys = new Set<number>();
    for (const k of Object.keys(activity.heatmap)) ys.add(Number(k.slice(0, 4)));
    return [...ys].sort((a, b) => b - a);
  }, [activity]);

  const [year, setYear] = useState<YearFilter>("all");
  // If the snapshot changes and the selected year disappears, fall back to all.
  const activeYear: YearFilter = year !== "all" && !years.includes(year) ? "all" : year;

  // Measure the grid's available width so cells can grow to fill it (no dead gap
  // before the year column) for narrow ranges, while the wide "All" view scrolls.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [availWidth, setAvailWidth] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvailWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { columns, max, monthLabels } = useMemo(() => {
    const entries = Object.entries(activity.heatmap);
    if (entries.length === 0) return { columns: [], max: 0, monthLabels: [] };

    const dates = entries.map(([k]) => k).sort();
    const firstDate = utc(dates[0]);
    const lastDate = utc(dates[dates.length - 1]);
    // All-time max so shading stays comparable across years, not rescaled per view.
    const maxCount = Math.max(...entries.map(([, v]) => v));

    let start: Date;
    let end: Date;
    if (activeYear === "all") {
      start = addDays(firstDate, -dowMon(firstDate)); // back to Monday
      end = lastDate;
    } else {
      const jan1 = new Date(Date.UTC(activeYear, 0, 1));
      start = addDays(jan1, -dowMon(jan1));
      // Always a full Jan–Dec grid so every year looks identical; the current
      // year's not-yet-happened days just render blank (no data = empty square).
      end = new Date(Date.UTC(activeYear, 11, 31));
    }

    const cols: { date: Date; count: number }[][] = [];
    const labels: { col: number; text: string }[] = [];
    let cur = start;
    let col = 0;
    while (cur <= end) {
      const week: { date: Date; count: number }[] = [];
      for (let r = 0; r < 7; r++) {
        const key = cur.toISOString().slice(0, 10);
        // A single-year view's edge weeks spill into the adjacent year; blank those
        // days (and skip their labels) so each year shows strictly its own data.
        const inYear = activeYear === "all" || cur.getUTCFullYear() === activeYear;
        week.push({ date: cur, count: inYear ? activity.heatmap[key] ?? 0 : 0 });
        // Label a month above the week that contains its 1st. Anchoring to the 1st
        // (not "the month changed") avoids a leading partial-month stub — e.g. the
        // late-December days before Jan 1 — labelling "Dec" on top of "Jan".
        if (inYear && cur.getUTCDate() === 1) {
          labels.push({ col, text: cur.toLocaleString("en", { month: "short", timeZone: "UTC" }) });
        }
        cur = addDays(cur, 1);
      }
      cols.push(week);
      col++;
    }
    return { columns: cols, max: maxCount, monthLabels: labels };
  }, [activity, activeYear]);

  if (columns.length === 0) return <div className="panel">No dated activity.</div>;

  const shade = (c: number) => {
    if (c <= 0) return SHADES[0];
    const idx = Math.min(SHADES.length - 1, 1 + Math.floor(((c - 1) / Math.max(max, 1)) * (SHADES.length - 1)));
    return SHADES[idx];
  };

  // Grow cells to fill the measured width (no dead gap) for narrow ranges; for the
  // wide multi-year "All" view the fit shrinks below CELL, so keep CELL and scroll.
  const LABEL_W = 30;
  let cell = CELL;
  if (availWidth > 0) {
    const fit = Math.floor((availWidth - LABEL_W) / columns.length) - GAP;
    if (fit > CELL) cell = Math.min(20, fit);
  }
  const step = cell + GAP;
  const width = columns.length * step + LABEL_W;
  const height = 7 * step + 20;

  return (
    <div className="panel">
      <div className="heatmap-body">
        <div className="heatmap-main">
      <div className="heatmap-wrap" ref={wrapRef}>
        <svg width={width} height={height} role="img" aria-label="Watch frequency heatmap">
          {monthLabels.map((m, i) => (
            <text key={i} x={m.col * step + LABEL_W} y={10} fill="#678" fontSize={10}>{m.text}</text>
          ))}
          {DOW.map((d, r) =>
            d ? (
              <text key={r} x={0} y={r * step + 28} fill="#678" fontSize={10}>{d}</text>
            ) : null,
          )}
          <g transform={`translate(${LABEL_W}, 16)`}>
            {columns.map((week, c) =>
              week.map((day, r) => (
                <rect
                  key={`${c}-${r}`}
                  x={c * step}
                  y={r * step}
                  width={cell}
                  height={cell}
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
        {years.length > 1 && (
          <div className="heatmap-years">
            <button
              className={activeYear === "all" ? "" : "secondary"}
              onClick={() => setYear("all")}
            >
              All
            </button>
            {years.map((y) => (
              <button
                key={y}
                className={activeYear === y ? "" : "secondary"}
                onClick={() => setYear(y)}
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

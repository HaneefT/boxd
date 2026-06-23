import { useState } from "react";
import type { Core, Enriched, Profile } from "../types";

// Only completed years get a "wrapped" — the current (in-progress) year isn't a
// year-in-review yet; it appears on its own once it ends. Single source of truth for
// that rule, shared with Dashboard's gate so the two can't drift apart. Newest first.
export function completedYears(byYear: Record<string, number>): number[] {
  const thisYear = new Date().getFullYear();
  return Object.keys(byYear)
    .map(Number)
    .filter((y) => y < thisYear)
    .sort((a, b) => b - a);
}

// "Your year, wrapped" — a period-scoped highlight card built entirely from data
// already in the snapshot (activity.by_year + enriched.genre_by_year). Self-contained:
// no image export or group-feed drop yet (the deferred parts of DESIGN §10.2 D). Year
// picker mirrors the heatmap; defaults to the most recent year logged.
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function Wrapped({
  core,
  enriched,
  profile,
}: {
  core: Core;
  enriched: Enriched | null;
  profile: Profile;
}) {
  const byYear = core.activity.by_year;
  const years = completedYears(byYear);
  const [year, setYear] = useState(years[0]);
  if (years.length === 0) return null;

  const active = byYear[year] != null ? year : years[0]; // selection survives snapshot swaps
  const films = byYear[active] ?? 0;
  // Busiest-year rank (1 = most films logged in a single year).
  const rank = [...years].sort((a, b) => byYear[b] - byYear[a]).indexOf(active) + 1;
  const topGenres = Object.entries(enriched?.genre_by_year?.[String(active)] ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);

  return (
    <div className="wrapped">
      <div className="wrapped-head">
        <span className="wrapped-kicker">{profile.username ?? "Your"} · {active}, wrapped</span>
        {years.length > 1 && (
          <div className="wrapped-years">
            {years.map((y) => (
              <button key={y} className={y === active ? "" : "secondary"} onClick={() => setYear(y)}>
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="wrapped-hero">
        <span className="wrapped-number">{films.toLocaleString()}</span>
        <span className="wrapped-label">films logged in {active}</span>
      </div>

      <div className="wrapped-facts">
        <span>{ordinal(rank)} busiest of your {years.length} year{years.length === 1 ? "" : "s"}</span>
        {topGenres.length > 0 && (
          <span className="wrapped-genres">
            {topGenres.map((g) => (
              <span key={g} className="chip">{g}</span>
            ))}
          </span>
        )}
      </div>

      <div className="wrapped-foot">Boxd Stats</div>
    </div>
  );
}

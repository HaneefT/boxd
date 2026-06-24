import type { ReactNode } from "react";
import type { EnrichedWatchlist, Watchlist } from "../types";
import { StatCard, withUnit } from "./StatCard";

// Watchlist actuary (DESIGN §3.2 Tier 2): three headline cards, then two columns —
// quick wins + biggest commitment, and the list's timeline (newest add + the longest
// languisher). Each column is gated, so the layout collapses cleanly when data is thin.
function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function monthYear(iso: string): string {
  return new Date(iso).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function projLabel(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return `${MONTHS[m - 1]} '${String(y).slice(2)}`;
}

export function WatchlistActuary({
  watchlist,
  enriched,
}: {
  watchlist: Watchlist;
  enriched: EnrichedWatchlist | null;
}) {
  const v = watchlist.velocity ?? null;
  const oldest = watchlist.backlog?.oldest ?? null;
  const newest = watchlist.backlog?.newest ?? null;
  const avgWaitMo = watchlist.backlog?.avg_age_days != null ? Math.round(watchlist.backlog.avg_age_days / 30) : null;
  const runtime = enriched?.runtime ?? null;

  let paceValue: ReactNode = "—";
  if (v) {
    const m = v.months_to_clear;
    paceValue = m == null ? "Never"
      : m >= 12 ? withUnit((m / 12).toFixed(1), "yr")
      : withUnit(Math.round(m), "mo");
  }

  const left = enriched && enriched.shortest.length > 0 ? (
    <div className="panel wl-col">
      <div className="wl-col-head">
        <span className="dot green"></span>
        <h4>Movie night picks</h4>
        <p>The shortest titles waiting on your list</p>
      </div>
      <ul className="wl-list">
        {enriched.shortest.map((f) => (
          <li key={f.title}>
            <span>{f.title}</span>
            <span className="rt">{hm(f.runtime)}</span>
          </li>
        ))}
      </ul>
      {enriched.longest && (
        <div className="wl-boxes">
          <div className="wl-box commit">
            <div className="wl-box-tag">Address the elephant</div>
            <div className="wl-box-main">
              <span>{enriched.longest.title}</span>
              <span className="rt">{hm(enriched.longest.runtime)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null;

  const right = newest || oldest ? (
    <div className="panel wl-col">
      <div className="wl-col-head">
        <span className="dot blue"></span>
        <h4>Your list over time</h4>
        <p>What just joined, and what's languished longest</p>
      </div>
      <div className="wl-boxes">
        {newest && (
          <div className="wl-box">
            <div className="wl-box-tag">Recently added</div>
            <div><strong>{newest.title}</strong> · added {monthYear(newest.added_at)}</div>
          </div>
        )}
        {oldest && (
          <div className="wl-box">
            <div className="wl-box-tag">Longest waiting</div>
            <div><strong>{oldest.title}</strong> · {oldest.years_ago} yrs · added {monthYear(oldest.added_at)}</div>
            {avgWaitMo != null && <div className="dim">The average item has waited {avgWaitMo} months.</div>}
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="cards">
        <StatCard value={watchlist.count.toLocaleString()} label="On your watchlist" />
        {runtime && (
          <StatCard
            value={withUnit(Math.round(runtime.total_hours).toLocaleString(), "h")}
            label="Runtime to clear"
            hint={runtime.matched < watchlist.count ? `${runtime.matched} of ${watchlist.count} estimated` : `${runtime.total_days} days nonstop`}
          />
        )}
        {v && (
          <StatCard
            value={paceValue}
            label="At current pace"
            hint={v.projected_clear ? `cleared by ${projLabel(v.projected_clear)}` : "watchlist is growing"}
          />
        )}
      </div>

      {left && right ? (
        <div className="grid-2 wl-grid">{left}{right}</div>
      ) : left || right ? (
        <div className="wl-grid">{left ?? right}</div>
      ) : null}
    </>
  );
}

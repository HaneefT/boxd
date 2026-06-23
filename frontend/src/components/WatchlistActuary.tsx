import type { EnrichedWatchlist, Watchlist } from "../types";
import { StatCard } from "./StatCard";

// Watchlist actuary (DESIGN §3.2 Tier 2): how long it'd take to clear, whether you
// ever realistically will, what's been languishing, quick wins to knock out, and the
// gap between aspirational and actual taste. CSV-only bits live on `watchlist`;
// TMDB-derived bits (runtime/quick-wins/taste-gap) on `enriched` (null = un-enriched
// snapshot). Each block is gated on its data, so this degrades to just the count.
function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function WatchlistActuary({
  watchlist,
  enriched,
}: {
  watchlist: Watchlist;
  enriched: EnrichedWatchlist | null;
}) {
  const v = watchlist.velocity ?? null;
  const backlog = watchlist.backlog ?? null;
  const runtime = enriched?.runtime ?? null;
  const gap = enriched?.taste_gap ?? null;
  const fmtMonths = (m: number) => (m >= 12 ? `${(m / 12).toFixed(1)} yr` : `${Math.round(m)} mo`);

  return (
    <div className="panel">
      <div className="cards">
        <StatCard value={watchlist.count.toLocaleString()} label="On your watchlist" />
        {runtime && (
          <StatCard
            value={`${Math.round(runtime.total_hours).toLocaleString()}h`}
            label="Runtime to clear"
            hint={
              runtime.matched < watchlist.count
                ? `${runtime.matched} of ${watchlist.count} estimated`
                : `${runtime.total_days} days nonstop`
            }
          />
        )}
        {v && (
          <StatCard
            value={v.months_to_clear != null ? fmtMonths(v.months_to_clear) : "Never"}
            label="At your current pace"
            hint={v.projected_clear ? `cleared by ${v.projected_clear}` : "watchlist is growing"}
          />
        )}
        {watchlist.stale_count != null && watchlist.stale_count > 0 && (
          <StatCard
            value={watchlist.stale_count.toLocaleString()}
            label="Languishing 2+ yrs"
            hint="added long ago, still unwatched"
          />
        )}
      </div>

      {v && v.months_to_clear == null && (
        <p className="sub" style={{ marginTop: 12 }}>
          Growing faster than you clear it — {v.added_per_month}/mo added vs {v.watched_per_month}/mo
          watched, so at this pace you'll never reach the bottom.
        </p>
      )}

      {backlog?.oldest && (
        <p className="sub" style={{ marginTop: 12 }}>
          On your list longest: <strong>{backlog.oldest.title}</strong> — added{" "}
          {backlog.oldest.added_at}, {backlog.oldest.years_ago} yr
          {backlog.oldest.years_ago === 1 ? "" : "s"} ago
          {backlog.avg_age_days != null
            ? ` · the average item has waited ${Math.round(backlog.avg_age_days / 30)} mo`
            : ""}
          .
        </p>
      )}

      {enriched && (enriched.shortest.length > 0 || enriched.longest) && (
        <div className="wl-block">
          <h4>Quick wins vs commitments</h4>
          {enriched.shortest.length > 0 && (
            <p className="sub">
              Knock out tonight:{" "}
              {enriched.shortest.map((f) => `${f.title} (${hm(f.runtime)})`).join(" · ")}
            </p>
          )}
          {enriched.longest && (
            <p className="sub">
              Biggest commitment lurking: <strong>{enriched.longest.title}</strong> (
              {hm(enriched.longest.runtime)}).
            </p>
          )}
        </div>
      )}

      {gap && gap.over.length > 0 && (
        <div className="wl-block">
          <h4>Aspirational vs actual</h4>
          <ul className="wl-gap">
            {gap.over.map((r) => (
              <li key={r.genre}>
                {r.index == null ? (
                  <>
                    You've never watched a <strong>{r.genre}</strong>, yet {r.watchlist_count} sit on
                    your list.
                  </>
                ) : (
                  <>
                    Your watchlist leans <strong>{r.index}×</strong> more <strong>{r.genre}</strong>{" "}
                    than your actual viewing.
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

import type { Core, Enriched } from "../types";
import { StatCard } from "./StatCard";

export function Totals({ core, enriched }: { core: Core; enriched: Enriched | null }) {
  const t = core.totals;
  const rw = core.rewatches;
  return (
    <div className="cards">
      <StatCard value={t.unique_films.toLocaleString()} label="Films" hint={`${t.total_logged.toLocaleString()} logged`} />
      {enriched && (
        <StatCard
          value={Math.round(enriched.runtime.total_hours).toLocaleString()}
          label="Hours watched"
          hint={`${enriched.runtime.total_days} days`}
        />
      )}
      <StatCard value={t.rated_count.toLocaleString()} label="Rated" hint={`mean ${core.ratings.mean ?? "—"}★`} />
      <StatCard value={t.reviewed_count.toLocaleString()} label="Reviewed" />
      <StatCard
        value={rw.films_rewatched.toLocaleString()}
        label="Rewatched"
        hint={rw.rewatch_rate != null ? `${Math.round(rw.rewatch_rate * 100)}% rewatch rate` : undefined}
      />
      <StatCard value={core.watchlist.count.toLocaleString()} label="Watchlist" />
    </div>
  );
}

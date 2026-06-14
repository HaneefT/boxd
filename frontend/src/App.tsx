import { useEffect, useState } from "react";
import { loadSnapshot } from "./data";
import type { Snapshot } from "./types";
import { Section } from "./components/Section";
import { Totals } from "./components/Totals";
import { RatingHistogram } from "./components/RatingHistogram";
import { GenreChart } from "./components/GenreChart";
import { ActivityCharts } from "./components/ActivityCharts";
import { Heatmap } from "./components/Heatmap";
import { DirectorsTable } from "./components/DirectorsTable";
import { VsCommunity } from "./components/VsCommunity";
import { StatCard } from "./components/StatCard";

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSnapshot().then(setSnap).catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!snap) return <div className="loading">Loading stats…</div>;

  const { profile, core, enriched } = snap;
  const era = core.era;
  const big = core.activity.biggest_day;

  return (
    <div className="app">
      <header className="app-header">
        <h1>{profile.username ?? "Your"} · Boxd Stats</h1>
        <div className="sub">
          {profile.date_joined && `On Letterboxd since ${profile.date_joined}. `}
          {core.activity.first_logged && core.activity.last_logged && (
            <>Logging from {core.activity.first_logged} to {core.activity.last_logged}.</>
          )}
        </div>
      </header>

      <Section title="Overview">
        <Totals core={core} enriched={enriched} />
      </Section>

      <Section title="Ratings">
        <RatingHistogram ratings={core.ratings} />
      </Section>

      <Section title="Activity">
        <Heatmap activity={core.activity} />
        <div style={{ height: 16 }} />
        <ActivityCharts activity={core.activity} />
        <div className="cards" style={{ marginTop: 16 }}>
          <StatCard value={`${core.activity.longest_streak_days}d`} label="Longest streak" />
          {big && <StatCard value={big.films} label="Biggest day" hint={big.date} />}
          <StatCard
            value={era.avg_film_age_at_watch != null ? `${era.avg_film_age_at_watch}y` : "—"}
            label="Avg film age at watch"
          />
          <StatCard
            value={era.oldest_year && era.newest_year ? `${era.oldest_year}–${era.newest_year}` : "—"}
            label="Year range"
          />
        </div>
      </Section>

      {enriched ? (
        <>
          <Section title="Genres">
            <GenreChart genres={enriched.genres} />
          </Section>

          <Section title="Directors">
            <DirectorsTable directors={enriched.top_directors} />
          </Section>

          <Section title="You vs. the crowd">
            <VsCommunity vs={enriched.vs_community} />
          </Section>
        </>
      ) : (
        <Section title="Enriched stats">
          <div className="panel" style={{ color: "var(--muted)" }}>
            No TMDB enrichment in this snapshot — run the pipeline with a TMDB key to see genres,
            directors, runtime and community comparisons.
          </div>
        </Section>
      )}
    </div>
  );
}

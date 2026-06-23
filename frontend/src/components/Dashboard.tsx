import type { Snapshot } from "../types";
import type { Group } from "../groups";
import { Section } from "./Section";
import { Totals } from "./Totals";
import { RatingHistogram } from "./RatingHistogram";
import { GenreChart } from "./GenreChart";
import { ActivityCharts } from "./ActivityCharts";
import { Heatmap } from "./Heatmap";
import { Wrapped, completedYears } from "./Wrapped";
import { DirectorsTable } from "./DirectorsTable";
import { PeopleTable } from "./PeopleTable";
import { WatchlistActuary } from "./WatchlistActuary";
import { VsCommunity } from "./VsCommunity";
import { GroupView } from "./GroupView";
import { StatCard } from "./StatCard";
import { Unmatched } from "./Unmatched";

export function Dashboard({
  snap,
  group = null,
  myId = null,
}: {
  snap: Snapshot;
  group?: Group | null;
  myId?: string | null;
}) {
  // Group mode is an entirely group-centric dashboard (no personal sections, no
  // TMDB comparison). The personal dashboard below is only "Just me" mode.
  if (group && myId) return <GroupView group={group} myId={myId} />;

  const { profile, core, enriched } = snap;
  const era = core.era;
  const big = core.activity.biggest_day;

  return (
    <>
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

      {completedYears(core.activity.by_year).length > 0 && (
        <Section title="Your year, wrapped">
          <Wrapped core={core} enriched={enriched} profile={profile} />
        </Section>
      )}

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

      {core.watchlist.count > 0 && (
        <Section title="Watchlist">
          <WatchlistActuary
            watchlist={core.watchlist}
            enriched={snap.watchlist_enriched ?? null}
          />
        </Section>
      )}

      {enriched ? (
        <>
          <Section title="Genres">
            <GenreChart genres={enriched.genres} />
          </Section>

          <Section title="Directors">
            <DirectorsTable directors={enriched.top_directors} />
          </Section>

          {/* Gated on presence: snapshots from before the actor leaderboard (009)
              have no top_cast, so top_actors is absent/empty — hide rather than
              crash on undefined. Reappears once a fresh snapshot has cast data. */}
          {enriched.top_actors?.length ? (
            <Section title="People">
              <div className="cards" style={{ marginBottom: 16 }}>
                <StatCard value={enriched.unique_actors} label="Unique actors" />
              </div>
              <PeopleTable actors={enriched.top_actors} />
            </Section>
          ) : null}

          <Section title="You vs. the crowd">
            <VsCommunity vs={enriched.vs_community} />
          </Section>

          <Section title="Unmatched films">
            <Unmatched />
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
    </>
  );
}

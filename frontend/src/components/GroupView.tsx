import { useEffect, useState } from "react";
import {
  getGroupComparison,
  getGroupStats,
  getRoster,
  type FilmComparison,
  type Group,
  type GroupStats,
  type RosterMember,
} from "../groups";
import { Section } from "./Section";
import { StatCard } from "./StatCard";
import { GroupMembers } from "./GroupMembers";
import { GroupComparisonTable } from "./GroupComparisonTable";
import { GenreChart } from "./GenreChart";
import { DirectorsTable } from "./DirectorsTable";
import { ActivityCharts } from "./ActivityCharts";
import { GroupInviteButton } from "./GroupInviteButton";

// The full group dashboard (DESIGN §10.2). Replaces the personal dashboard when a
// group is selected: group totals + taste (genres/directors) + activity, plus the
// you-vs-group comparison. No TMDB / "vs the crowd" here — that's Just-me only.
export function GroupView({ group, myId }: { group: Group; myId: string }) {
  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [films, setFilms] = useState<FilmComparison[] | null>(null);
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRoster(null);
    setFilms(null);
    setStats(null);
    setError(null);
    Promise.all([
      getRoster(group.id),
      getGroupComparison(group.id, myId),
      getGroupStats(group.id),
    ])
      .then(([r, f, s]) => {
        setRoster(r);
        setFilms(f);
        setStats(s);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [group.id, myId]);

  const header = (
    <header className="app-header">
      <h1>{group.name}</h1>
      <div className="sub">
        {roster ? `${roster.length} member${roster.length === 1 ? "" : "s"} · ` : ""}
        comparing your ratings on shared films
      </div>
    </header>
  );

  if (error)
    return (
      <>
        {header}
        <div className="error" style={{ marginTop: 0 }}>
          {error}
        </div>
      </>
    );

  if (!roster || !films || !stats)
    return (
      <>
        {header}
        <div className="panel" style={{ color: "var(--muted)" }}>
          Loading group…
        </div>
      </>
    );

  const shared = films.filter((f) => f.others.length > 0);
  const { totals } = stats;

  return (
    <>
      {header}

      <Section title="Group overview">
        <div className="group-head">
          <span className="sub">
            Members see each other's ratings on shared films and contribute to group stats.
          </span>
          <GroupInviteButton groupId={group.id} />
        </div>
        <div className="cards">
          <GroupMembers roster={roster} myId={myId} />
          <StatCard
            value={totals.films_logged.toLocaleString()}
            label="Films logged"
            hint={`${totals.unique_films.toLocaleString()} unique`}
          />
          <StatCard
            value={Math.round(totals.total_hours).toLocaleString()}
            label="Hours watched"
          />
          <StatCard value={shared.length} label="Shared films" hint="you + a member rated" />
        </div>
      </Section>

      <Section title="Where you differ">
        {shared.length === 0 ? (
          <div className="panel" style={{ color: "var(--muted)" }}>
            No shared films yet — once another member logs a film you've also rated, you'll see how
            your takes compare.
          </div>
        ) : (
          <GroupComparisonTable films={shared} />
        )}
      </Section>

      <Section title="Group genres">
        <GenreChart genres={stats.genres} />
      </Section>

      <Section title="Group directors">
        <DirectorsTable directors={stats.directors} />
      </Section>

      <Section title="Group activity">
        <ActivityCharts activity={stats.activity} />
      </Section>
    </>
  );
}

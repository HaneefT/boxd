import { useState } from "react";
import { GroupSwitcher } from "./components/GroupSwitcher";
import { GroupMembers } from "./components/GroupMembers";
import { GroupComparisonTable } from "./components/GroupComparisonTable";
import { GenreChart } from "./components/GenreChart";
import { DirectorsTable } from "./components/DirectorsTable";
import { ActivityCharts } from "./components/ActivityCharts";
import { Section } from "./components/Section";
import { StatCard } from "./components/StatCard";
import type { FilmComparison, Group, GroupStats, RosterMember } from "./groups";

// Dev-only visual playground (open with ?harness). Renders real components in
// isolation so popover interactions + data-driven layouts can be screenshotted
// (scripts/shoot.mjs) without auth. Mock data lets us check the busy cases.
const NAMES = [
  "cinephile", "filmbro_99", "reel_deal", "noir_nut", "a24_stan", "kurosawa_kid",
  "popcorn_pim", "boxd_lou", "grain_gaze", "mubi_mae", "criterion_cam", "slowcinema_sy",
  "blockbuster_bo", "indie_ivy", "horror_hank", "docu_dan", "anime_amy", "western_wes",
  "scifi_sid", "romcom_ro", "artemis24",
];
// 50 members, to check the large-group case (search + scroll).
const MOCK_ROSTER: RosterMember[] = Array.from({ length: 50 }, (_, i) => ({
  user_id: String(i),
  display_name: NAMES[i] ?? `member_${i}`,
  role: i === 0 ? "owner" : "member",
  joined_at: "",
}));

const mb = (r: number) => ({ user_id: "mb", name: "MorningBread", rating: r });
const film = (
  tmdb_id: number,
  title: string,
  year: number,
  you: number,
  others: { user_id: string; name: string; rating: number }[],
): FilmComparison => {
  const all = [you, ...others.map((o) => o.rating)];
  return { tmdb_id, title, year, you, others, tmdb: 3.6, spread: Math.max(...all) - Math.min(...all) };
};
const MOCK_FILMS: FilmComparison[] = [
  film(1, "Incendies", 2010, 5.0, [mb(3.0)]),
  film(2, "Megamind", 2010, 3.5, [mb(5.0)]),
  film(3, "Whiplash", 2014, 5.0, [mb(4.0), { user_id: "ci", name: "cinephile", rating: 5.0 }]),
  film(4, "Tenet", 2020, 2.5, [mb(4.0)]),
  film(5, "The Lion King", 1994, 4.0, [mb(3.0)]),
  film(6, "Coraline", 2009, 4.0, [mb(5.0)]),
  film(7, "Django Unchained", 2012, 4.0, [mb(5.0)]),
  film(8, "Pacific Rim", 2013, 3.0, [mb(4.0)]),
  film(9, "Parasite", 2019, 4.5, [mb(4.0)]),
  film(10, "Dune", 2021, 4.0, [mb(4.0)]), // agree -> filtered out
];

const MOCK_STATS: GroupStats = {
  totals: { films_logged: 642, unique_films: 410, total_hours: 980 },
  genres: {
    Drama: 180, Action: 120, Comedy: 95, Thriller: 88, Animation: 70, "Science Fiction": 64,
    Adventure: 60, Crime: 55, Horror: 52, Romance: 40, Fantasy: 33, Documentary: 22,
  },
  directors: [
    { director: "Christopher Nolan", films: 9, avg_rating: 4.1 },
    { director: "Denis Villeneuve", films: 7, avg_rating: 4.3 },
    { director: "Greta Gerwig", films: 5, avg_rating: 3.9 },
    { director: "Bong Joon-ho", films: 5, avg_rating: 4.5 },
    { director: "Quentin Tarantino", films: 4, avg_rating: 4.0 },
  ],
  activity: {
    by_weekday: { Mon: 40, Tue: 35, Wed: 42, Thu: 50, Fri: 88, Sat: 120, Sun: 95 },
    by_month: { Jan: 60, Feb: 45, Mar: 55, Apr: 48, May: 52, Jun: 70, Jul: 80, Aug: 75, Sep: 50, Oct: 58, Nov: 49, Dec: 90 },
    by_year: { 2022: 180, 2023: 220, 2024: 242 },
  },
};

export function Harness() {
  const [group, setGroup] = useState<Group | null>(null);

  return (
    <div className="app" style={{ paddingTop: 40 }}>
      <h2 style={{ marginTop: 0 }}>Harness — appbar controls</h2>
      <div className="appbar">
        <span className="who">you@example.com</span>
        <GroupSwitcher selected={group} onSelect={setGroup} />
        <button className="secondary">Invite a friend</button>
        <button className="secondary">Sign out</button>
      </div>
      <p className="sub" style={{ marginTop: 16 }}>
        Selected: {group?.name ?? "(just me)"}
      </p>

      <h2 style={{ marginTop: 40 }}>Harness — group overview cards</h2>
      <div className="cards" style={{ maxWidth: 720 }}>
        <GroupMembers roster={MOCK_ROSTER} myId="20" />
        <StatCard
          value={MOCK_STATS.totals.films_logged.toLocaleString()}
          label="Films logged"
          hint={`${MOCK_STATS.totals.unique_films.toLocaleString()} unique`}
        />
        <StatCard value={Math.round(MOCK_STATS.totals.total_hours).toLocaleString()} label="Hours watched" />
        <StatCard value={9} label="Shared films" hint="you + a member rated" />
      </div>

      <h2 style={{ marginTop: 40 }}>Harness — where you differ</h2>
      <GroupComparisonTable films={MOCK_FILMS} />

      <Section title="Group genres">
        <GenreChart genres={MOCK_STATS.genres} />
      </Section>
      <Section title="Group directors">
        <DirectorsTable directors={MOCK_STATS.directors} />
      </Section>
      <Section title="Group activity">
        <ActivityCharts activity={MOCK_STATS.activity} />
      </Section>
    </div>
  );
}

import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AccountMenu } from "./components/AccountMenu";
import { SetPassword } from "./components/SetPassword";
import { GroupSwitcher } from "./components/GroupSwitcher";
import { MobileMenu } from "./components/MobileMenu";
import { GroupMembers } from "./components/GroupMembers";
import { GroupComparisonTable } from "./components/GroupComparisonTable";
import { GenreChart } from "./components/GenreChart";
import { RatingHistogram } from "./components/RatingHistogram";
import { VsCommunity } from "./components/VsCommunity";
import { IconMenu, IconUserPlus, IconRefresh } from "./components/icons";
import { DirectorsTable } from "./components/DirectorsTable";
import { PeopleTable } from "./components/PeopleTable";
import { WatchlistActuary } from "./components/WatchlistActuary";
import { Wrapped } from "./components/Wrapped";
import { ActivityCharts } from "./components/ActivityCharts";
import { Heatmap } from "./components/Heatmap";
import { Section } from "./components/Section";
import type { Activity, Core, Enriched, EnrichedWatchlist, Profile, Ratings, Watchlist } from "./types";
import { StatCard, withUnit } from "./components/StatCard";
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

const MOCK_SESSION = {
  user: { email: "you@example.com", user_metadata: {}, app_metadata: { provider: "email" } },
} as unknown as Session;

// Watchlist actuary — the "never" case (adding faster than watching), the most
// interesting layout: months_to_clear/projected_clear null + the growing-faster note.
const MOCK_WATCHLIST: Watchlist = {
  count: 487,
  avg_year: 2009,
  oldest_year: 1931,
  first_added: "2017-03-01",
  last_added: "2025-06-01",
  stale_count: 96,
  velocity: {
    added_per_month: 7.4,
    watched_per_month: 5.1,
    net_per_month: -2.3,
    months_to_clear: null,
    projected_clear: null,
  },
  backlog: {
    oldest: { title: "Stalker", added_at: "2018-02-11", years_ago: 7.4 },
    newest: { title: "The Substance", added_at: "2025-05-20" },
    avg_age_days: 612,
  },
};
const MOCK_ENRICHED_WL: EnrichedWatchlist = {
  runtime: { matched: 472, total_minutes: 54360, total_hours: 906, total_days: 37.8 },
  shortest: [
    { title: "Aftersun", runtime: 102 },
    { title: "Past Lives", runtime: 105 },
    { title: "Frances Ha", runtime: 86 },
  ],
  longest: { title: "Sátántangó", runtime: 439 },
  taste_gap: {
    over: [
      { genre: "Western", index: null, watchlist_count: 11 },
      { genre: "Documentary", index: 3.1, watchlist_count: 64 },
      { genre: "War", index: 1.8, watchlist_count: 22 },
    ],
  },
};

// Wrapped card reads only activity.by_year + enriched.genre_by_year + profile.username.
const MOCK_WRAPPED_CORE = {
  activity: { by_year: { 2021: 142, 2022: 205, 2023: 188, 2024: 261, 2025: 97 } },
} as unknown as Core;
const MOCK_WRAPPED_ENRICHED = {
  genre_by_year: {
    "2024": { Drama: 60, Action: 44, Thriller: 30, Comedy: 22 },
    "2025": { Horror: 18, Drama: 12, Comedy: 9 },
    "2022": { Comedy: 50, Drama: 40 },
  },
} as unknown as Enriched;
const MOCK_WRAPPED_PROFILE: Profile = { username: "artemis24", date_joined: null, favorite_films: [] };

const MOCK_RATINGS: Ratings = {
  count: 1240, mean: 3.6, median: 3.5, stdev: 0.8,
  histogram: { "0.5": 4, "1.0": 9, "1.5": 18, "2.0": 55, "2.5": 90, "3.0": 180, "3.5": 240, "4.0": 300, "4.5": 210, "5.0": 134 },
};

// Actor leaderboard (solo "People" view) — some with no rated films (avg ★ = —).
const MOCK_ACTORS = [
  { actor: "Toni Collette", films: 11, avg_rating: 4.2 },
  { actor: "Oscar Isaac", films: 9, avg_rating: 4.0 },
  { actor: "Tilda Swinton", films: 8, avg_rating: 4.4 },
  { actor: "Michael Fassbender", films: 7, avg_rating: 3.8 },
  { actor: "Florence Pugh", films: 6, avg_rating: null },
];

// Multi-year heatmap with DIFFERENT density per year, so the year filter is
// visibly distinct (2024 sparse/faint, 2025 dense/varied).
const MOCK_ACTIVITY = {
  heatmap: (() => {
    const h: Record<string, number> = {};
    const pad = (n: number) => String(n).padStart(2, "0");
    const fill = (y: number, step: number, count: (m: number, d: number) => number, endMonth = 12) => {
      for (let m = 1; m <= endMonth; m++)
        for (let d = 1; d <= 28; d += step) h[`${y}-${pad(m)}-${pad(d)}`] = count(m, d);
    };
    // Many full years so the right-side picker's scroll (>6-7 years) is testable.
    [2018, 2019, 2020, 2021, 2022, 2023, 2024].forEach((y, i) =>
      fill(y, (i % 3) + 2, (m, d) => ((d + m + i) % 4) + 1),
    );
    // Latest year partial (through June) — simulates the current year, to check it
    // still renders as a full Jan–Dec grid with blank future days.
    fill(2025, 2, (m, d) => ((d + m) % 4) + 1, 6);
    return h;
  })(),
} as unknown as Activity;

export function Harness() {
  const [group, setGroup] = useState<Group | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app" style={{ paddingTop: 40 }}>
      <h2 style={{ marginTop: 0 }}>Harness — appbar controls</h2>
      <div className="appbar">
        <button className="hamburger secondary icon-btn" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
          <IconMenu />
        </button>
        <div className={`appbar-controls ${menuOpen ? "open" : ""}`}>
          <span className="who">you@example.com</span>
          <GroupSwitcher selected={group} onSelect={setGroup} />
          <button className="secondary icon-btn" aria-label="Invite a friend"><IconUserPlus /> <span className="btn-label">Invite a friend</span></button>
          <button className="secondary icon-btn" aria-label="Refresh stats"><IconRefresh /> <span className="btn-label">Refresh stats</span></button>
          <AccountMenu session={MOCK_SESSION} />
        </div>
        {menuOpen && (
          <MobileMenu
            session={MOCK_SESSION}
            group={group}
            onSelectGroup={setGroup}
            isOwner
            canRefresh
            onReuploaded={() => {}}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>

      <Section title="Ratings (histogram + themed tooltip)">
        <RatingHistogram ratings={MOCK_RATINGS} />
      </Section>

      <Section title="Stat cards — unit formatting">
        <div className="cards">
          <StatCard value={withUnit(7, "d")} label="Longest streak" />
          <StatCard value={141} label="Biggest day" hint="2023-02-20" />
          <StatCard value={withUnit(11.43, "y")} label="Avg film age at watch" />
          <StatCard value="1972–2026" label="Year range" />
        </div>
      </Section>

      <Section title="You vs. the crowd">
        <VsCommunity
          vs={{
            mean_delta: -0.14,
            verdict: "in line with the crowd",
            you_overrate: [
              { title: "Sicario", you: 5.0, community: 3.8, delta: 1.2 },
              { title: "Heat", you: 4.5, community: 4.0, delta: 0.5 },
            ],
            you_underrate: [
              { title: "Tenet", you: 2.5, community: 3.7, delta: -1.2 },
              { title: "Joker", you: 3.0, community: 4.0, delta: -1.0 },
            ],
          }}
        />
      </Section>

      <Section title="Your year, wrapped">
        <Wrapped core={MOCK_WRAPPED_CORE} enriched={MOCK_WRAPPED_ENRICHED} profile={MOCK_WRAPPED_PROFILE} />
      </Section>

      <Section title="Activity (heatmap + year filter)">
        <Heatmap activity={MOCK_ACTIVITY} />
      </Section>

      <h2 style={{ marginTop: 40 }}>Harness — set password (first sign-in nudge)</h2>
      <div className="panel notice pw-nudge" style={{ maxWidth: 520 }}>
        <div className="group-head">
          <span className="sub">Set a password for faster sign-in — no more waiting on an email link.</span>
          <button className="secondary">Not now</button>
        </div>
        <SetPassword hasPassword={false} />
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
      <div id="cmp">
        <GroupComparisonTable films={MOCK_FILMS} />
      </div>

      <Section title="Group genres">
        <GenreChart genres={MOCK_STATS.genres} />
      </Section>
      <Section title="Group directors">
        <DirectorsTable directors={MOCK_STATS.directors} />
      </Section>
      <Section title="People (solo actor leaderboard)">
        <div className="cards" style={{ marginBottom: 16 }}>
          <StatCard value={128} label="Unique actors" />
        </div>
        <PeopleTable actors={MOCK_ACTORS} />
      </Section>
      <Section title="Watchlist">
        <WatchlistActuary watchlist={MOCK_WATCHLIST} enriched={MOCK_ENRICHED_WL} />
      </Section>
      <Section title="Group activity">
        <ActivityCharts activity={MOCK_STATS.activity} />
      </Section>
    </div>
  );
}

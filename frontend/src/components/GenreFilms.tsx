import { useMemo, useState } from "react";
import type { GenreFilm } from "../types";
import { genreLabel } from "../labels";

// Drill-down panel beside the genre bubbles. With no genre picked it shows a subtle
// prompt; once a bubble is clicked it lists every film you've logged in that genre,
// most-recent first, with a title filter. Shows all of them (not a top-N) — the filter
// box is how you cope with a long list. Pure client-side over enriched.films.
export function GenreFilms({
  genre,
  films,
  onClose,
}: {
  genre: string | null;
  films: GenreFilm[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");

  // Films in this genre, most-recent watch first. Undated viewings sort last (empty
  // string compares below any ISO date). Memoised so typing in the filter doesn't
  // re-sort the whole list each keystroke.
  const inGenre = useMemo(() => {
    if (!genre) return [];
    return films
      .filter((f) => f.genres.includes(genre))
      .sort((a, b) => (b.last_watched ?? "").localeCompare(a.last_watched ?? ""));
  }, [films, genre]);

  if (!genre) {
    return (
      <div className="panel genre-films genre-films--empty">
        <div className="genre-films-prompt">
          <svg width="44" height="40" viewBox="0 0 44 40" fill="none" aria-hidden="true">
            <circle cx="16" cy="17" r="10" fill="currentColor" opacity="0.9" />
            <circle cx="30" cy="13" r="5.5" fill="currentColor" opacity="0.5" />
            <circle cx="27" cy="27" r="7" fill="currentColor" opacity="0.7" />
          </svg>
          <p>Pick a genre</p>
          <span>Click any bubble to see the films you've logged in it.</span>
        </div>
      </div>
    );
  }

  const needle = q.trim().toLowerCase();
  const shown = needle ? inGenre.filter((f) => f.title.toLowerCase().includes(needle)) : inGenre;

  return (
    <div className="panel genre-films" aria-label={`${genreLabel(genre)} films`}>
      <div className="genre-films-head">
        <h3>
          {genreLabel(genre)} <span className="hint">· {inGenre.length} films</span>
        </h3>
        <button className="settings-close" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <input
        type="text"
        placeholder="Filter by title…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="genre-films-list">
        {shown.map((f, i) => (
          <li key={`${f.title}-${f.year}-${i}`}>
            <span className="gf-title">
              {f.title}
              {f.year ? <span className="gf-year"> ({f.year})</span> : null}
            </span>
            <span className="gf-meta">
              {f.rating != null && <span className="gf-rating">★ {f.rating.toFixed(1)}</span>}
              {f.last_watched && <span className="gf-date">{f.last_watched.slice(0, 10)}</span>}
            </span>
          </li>
        ))}
        {!shown.length && <li className="hint gf-empty">No films match “{q}”.</li>}
      </ul>
    </div>
  );
}

import { useMemo, useState } from "react";
import { hierarchy, pack } from "d3-hierarchy";
import { genreLabel } from "../labels";

// Circle-packing bubble chart: each genre is a circle with area ∝ films watched,
// shaded by share (bigger/more-watched = brighter). Hovering a bubble pops + brightens
// it (dimming the rest) and updates a sticky corner readout — which is also how you
// identify the small bubbles whose label didn't fit.
type GNode = { genre?: string; count?: number; children?: GNode[] };

const W = 520;
const H = 420;

export function GenreChart({
  genres,
  top = 14,
  onSelectGenre,
  selected = null,
}: {
  genres: Record<string, number>;
  top?: number;
  // When set, bubbles become clickable and call back with the genre — the solo
  // dashboard uses this to open the per-genre film list. Omitted in group view
  // (group_stats is a rollup with no per-film data), where the chart stays display-only.
  onSelectGenre?: (genre: string) => void;
  // The currently-open genre, kept lit even when not hovering so it's clear which
  // list the adjacent panel is showing.
  selected?: string | null;
}) {
  // The pack layout depends only on the data, not on hover state — memoise it so
  // hovering (which re-renders) doesn't recompute the whole circle-packing each time.
  const { data, root, max } = useMemo(() => {
    const data = Object.entries(genres)
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([genre, count]) => ({ genre, count }));
    const max = Math.max(...data.map((d) => d.count), 1);
    const root = data.length
      ? pack<GNode>().size([W, H]).padding(5)(hierarchy<GNode>({ children: data }).sum((d) => d.count ?? 0))
      : null;
    return { data, root, max };
  }, [genres, top]);

  const [hovered, setHovered] = useState<string | null>(null);

  if (!root) return <div className="panel">No genre data.</div>;

  // Hover wins, but the selected genre stays emphasised when the cursor is away so the
  // chart and the adjacent film list agree on what's active.
  const emphasis = hovered ?? selected;
  // Render the emphasised bubble last so its pop isn't clipped by neighbours (cheap — a
  // tree walk, not a re-layout).
  const leaves = root.leaves().sort((a, b) => Number(a.data.genre === emphasis) - Number(b.data.genre === emphasis));
  const active = data.find((d) => d.genre === emphasis) ?? data[0];

  return (
    <div className="panel">
      <div className="bubble-wrap">
        <div className="bubble-readout">
          <strong>{genreLabel(active.genre)}</strong>
          <span>{active.count.toLocaleString()} films</span>
        </div>
        {/* Clear only when the cursor leaves the whole chart — not on every bubble exit
            — so moving bubble-to-bubble hands the highlight over without flashing back
            through the all-blue neutral state in the gaps between circles. */}
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}
             role="img" aria-label="Genre distribution" onMouseLeave={() => setHovered(null)}>
          {leaves.map((leaf) => {
            const genre = leaf.data.genre ?? "";
            const label = genreLabel(genre);
            const count = leaf.data.count ?? 0;
            const r = leaf.r;
            const fs = Math.max(9, Math.min(15, r / 2.6));
            const labelFits = r >= 22 && label.length * fs * 0.55 <= r * 1.8;
            const isHover = genre === emphasis;
            const dim = emphasis != null && !isHover;
            const base = 0.25 + 0.55 * (count / max);
            return (
              <g
                key={genre}
                data-genre={genre}
                transform={`translate(${leaf.x},${leaf.y}) scale(${isHover ? 1.06 : 1})`}
                onMouseEnter={() => setHovered(genre)}
                onClick={onSelectGenre ? () => onSelectGenre(genre) : undefined}
                style={{ cursor: onSelectGenre ? "pointer" : "default", transition: "transform 0.12s ease" }}
              >
                <circle
                  r={r}
                  fill="var(--accent-2)"
                  fillOpacity={isHover ? Math.min(1, base + 0.25) : dim ? base * 0.4 : base}
                  stroke="var(--accent-2)"
                  strokeOpacity={isHover ? 1 : 0.55}
                  strokeWidth={isHover ? 2 : 1}
                  style={{ transition: "fill-opacity 0.15s ease, stroke-opacity 0.15s ease" }}
                />
                {labelFits && (
                  <text textAnchor="middle" dy={r >= 42 ? "-0.15em" : "0.32em"} fontSize={fs}
                        fill="#fff" fontWeight={600} style={{ pointerEvents: "none" }}>
                    {label}
                  </text>
                )}
                {labelFits && r >= 42 && (
                  <text textAnchor="middle" dy="1.15em" fontSize={fs * 0.85}
                        fill="rgba(255,255,255,0.65)" style={{ pointerEvents: "none" }}>
                    {count}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "../supabase";

// Lists films TMDB couldn't auto-match (the `unmatched` table, read under RLS).
// The actual "fix-up" write flow (pick the right TMDB film, re-enrich) needs a
// backend endpoint that doesn't exist yet — for now we surface the misses so the
// user knows what's missing from their enriched stats.
type Row = { id: number; raw_title: string; raw_year: number | null };

export function Unmatched() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    supabase
      .from("unmatched")
      .select("id, raw_title, raw_year")
      .order("raw_title")
      .then(({ data }) => setRows(data ?? []));
  }, []);

  if (rows.length === 0) return null;

  return (
    <div className="panel unmatched">
      <p className="sub">
        {rows.length} film{rows.length === 1 ? "" : "s"} couldn't be matched to TMDB,
        so they're missing from genre/director/runtime stats.
      </p>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            {r.raw_title}
            {r.raw_year ? ` (${r.raw_year})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

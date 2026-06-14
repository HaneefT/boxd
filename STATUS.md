# Boxd Stats — Status

Session bootstrap. Full design in `DESIGN.md` (§7 = roadmap). Update this at each checkpoint.

**Now:** Phase 2 (Dashboard). Phases 0–1 done; Tier-1 dashboard built but still fed by a static file.

## Built
- **Phase 0:** Terraform in `infra/` (apigw, lambda, frontend/CloudFront, keepalive). No CI yet.
- **Phase 1:** `db/migrations/` (001 schema, 002 RLS); pipeline `backend/process_upload/` (parser → enricher[TMDB] → stats → persist → handler). Own export parses end-to-end → `backend/out/stats.json`.
- **Phase 2 (partial):** all Tier-1 components in `frontend/src/components/` (Totals, RatingHistogram, GenreChart, ActivityCharts, Heatmap, DirectorsTable, VsCommunity).

## Next (Phase 2 → "send link to friends")
1. **Wire frontend to backend** — `frontend/src/data.ts` fetches static `/stats.json`; switch to user's `stat_snapshots.payload` from Supabase.
2. **Auth** — Supabase Auth (magic-link + Google); no auth code in `frontend/src` yet.
3. **Upload UI** — ZIP → Supabase Storage → trigger Lambda; with progress.
4. **Unmatched-films fix-up UI** — backend returns unmatched; screen not built.
5. **Deploy + e2e on AWS** — `terraform apply`; verify Lambda via API GW JWT authorizer (only run locally so far).

## Loose ends (cheap)
- [ ] Add GitHub Actions CI (`.github/workflows/` missing).
- [ ] Commit `infra/` (currently untracked).

## Commands
- Backend tests: `cd backend && python -m pytest tests/ -q`
- Pipeline local run: `python -m process_upload.local_run` (from `backend/`) → writes `out/stats.json`
- Frontend dev: `cd frontend && npm run dev` (needs `public/stats.json` — copy from `backend/out/`)
- Frontend build: `npm run build` · Typecheck: `npm run typecheck`
- Terraform: `infra/tf.ps1`

## Key facts
- Config via `.env` (gitignored); template in `.env.example`. Service-role key = Lambda only, never frontend.
- DB free-tier pauses after 7d idle → keepalive Lambda (`infra/keepalive.tf`).
- Metadata from TMDB only (no scraping); app name must not contain "Letterboxd".
- Set AWS budget alarm at $5 before deploying. Avoid: Route 53 zone, NAT, REST API.

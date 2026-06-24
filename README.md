# Boxd Stats

A Spotify-Wrapped-style deep dive into your Letterboxd history. Upload your Letterboxd
data export and get rich, all-time stats plus friend groups to compare taste with.

**Live (friends-only):** https://boxd.haneeftaher.com

## Features

- **Personal dashboard** — totals & hours, rating distribution, a GitHub-style watch
  heatmap, genre bubble chart, director/actor leaderboards, era breakdown, and a
  watchlist actuary (runtime-to-clear, projected clear date, movie night picks).
- **Friend groups** — create friend groups to discover shared group stats and a "where you differ" comparison.

## Stack

React + Vite (TypeScript) on S3 + CloudFront · Python Lambdas behind API
Gateway · Supabase · Terraform · TMDB for film metadata.

## Notices

This product uses the TMDB API but is not endorsed or certified by TMDB. Not affiliated
with Letterboxd; works only on user-initiated data exports.

---

© 2026 Haneef Taher. All rights reserved.

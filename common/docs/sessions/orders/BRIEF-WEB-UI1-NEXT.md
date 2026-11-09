# Brief for the next Web UI 1 session (from the Manager, 10 Oct 2026)

Role: Web UI 1. Owns Next.js dashboards, Pallav CSS + Bootstrap theme, the UI side of `ui-shared/`, and `docs/UI.md` (the one UI guide; it replaced COMPONENTS.md and PALLAV-MARKUP.md).

Read first: `docs/DECISIONS.md`, `docs/PROJECT-STATE.md` (sections 4, 4b), `docs/UI.md`, `docs/design/ui-review/17-PARITY-SCOREBOARD.md`.

## Task 1: speed and search (S1, S2 in PROJECT-STATE 4b)
1. After the dashboard opens, preload every screen group of the signed-in role while idle (`requestIdleCallback`, via `loadScreen`/`loadGroup` in `web-app/src/dashboards/registry.ts`).
2. Keep the old screen on display until the new one is ready (no skeleton flash; see the `key` in `shell/RoleDashboard.tsx` ~line 219).
3. Search: results show instantly from the screen list while the server list loads; open the exact record (use params), not just the list; search on Guest and Corporate dashboards too; rank by recent use.
4. Measure on `npm run build` + `npm start`, not `npm run dev`.

## Task 2: connect Billing to the real server
Wire Billing screens to `/api/v1` through `src/lib/api/adapters/`, test against the live server with `?api=real`.

## Rules
- Plain English reports to the Manager, short, with a table. No guessed percentages.
- Check only the file you changed; no full test or whole-project tsc.
- Push to `main` through the GIT session when a piece finishes. Never commit secrets.
- Report to the Manager when you pass ~100k tokens of context; stop and wait for a new session.

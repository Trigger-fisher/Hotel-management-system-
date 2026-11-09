# Module audit: checklist and one-go procedure

Run by Frontend 2 when Backend and Frontend 1 both report done. The scoring rule is the one in `AUDIT-2026-10-11.md` ("How a layer is scored"): Database, Server, Screens and Wiring are each **done / partial / none**; a layer's percentage is (done + 0.5 x partial) / modules scored; the project mean is the plain mean of the four. Wiring is **done** only when the real adapter exists with no `notYet` call left AND a wiring doc records a live test (`?api=real`).

## 1. Evidence in one command (about 5 seconds)
```
cd web-app
node scripts/audit-modules.mjs          # per module: tables, route files, adapter + notYet calls, screen files, server test files, live-test lines in the wiring docs
node scripts/audit-modules.mjs --md     # the same as a markdown table
```
The script collects evidence only. It never scores: "done" and "partial" are a human call from this evidence and the records below.

## 2. Gates that must be green before scoring (run from `web-app/`)
| Gate | Command | Pass |
|---|---|---|
| Types | `npx tsc --noEmit -p .` (low memory: `NODE_OPTIONS=--max-old-space-size=3072 ... --incremental`) | 0 errors |
| Lint | `npx eslint src` | 0 errors |
| Root tests | `node --test tests/*.test.ts` | all pass |
| Server tests | `npm run test:server` | all pass |
| Shared components | `npm run check:shared -- --summary` | total 0 (control, control-bespoke, colour, type, inline, import) |
| Build | `npx next build` in a clean export of HEAD | passes |
| Production bundle scan | grep `.next/static` for the demo strings (mihir, Hotel Sunrise, Sunrise Foods, Hotel Pearl, Demo@Pass2026, quickSignIn, the demo user names) | 0 hits |

## 3. Per layer: what to read
- **Database**: `db/migrations/hotel|platform/*.sql` has the tables of the module; a repo file exists in `src/server/repos` (memory and postgres twin). Evidence column "Tables".
- **Server**: `src/app/api/v1/<area>` route files and `src/server/services/<area>`; route list in `docs/BACKEND.md` section 7 matches the contract file in `ui-shared/dashboards`; tests in `tests/server`.
- **Screens**: every screen listed in `docs/UI.md` for the module exists under `src/dashboards/groups/<area>`, with loading, empty, error and read-only states; day, night and phone checked (`docs/sessions/reports/FULL-CHECK-RESULTS.md`).
- **Wiring**: adapter in `src/lib/api/adapters` with 0 `notYet(` calls (evidence column) AND a line in `HOTEL-REAL-WIRING.md`, `PLATFORM-REAL-WIRING.md` or `BILLING-LIVE-CHECK-LIST.md` saying the module was driven live. A module with no such line is **partial** however complete the adapter is.

## 4. Write-up
1. Copy the table of the last audit; change only the cells the evidence changed; put the reason in "Gaps".
2. Compute the four layer percentages and the mean: `node scripts/audit-modules.mjs --score "DB,SERVER,SCREENS,WIRING"`.
3. Save as `docs/sessions/AUDIT-<date>.md` (newest on top, the previous run kept below), and refresh `pm-dashboard/data/modules.json`.
4. List what cannot reach 100% and why (the usual ones: Razorpay and Google keys, SMTP keys, destructive Super Admin actions that need MJ's approval, live tests not yet run).
5. Fill the placeholders in `docs/sessions/handovers/DOCS-REFRESH-DRAFT.md` and apply it to PROJECT-STATE, MASTER-PROMPT and README.
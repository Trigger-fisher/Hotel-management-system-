# S08: complete the WEB APP, identical to Hotel Pallav (MJ, 06 Oct 2026)

Goal: every web screen the Hotel, Guest and Corporate users have in Pallav exists in HMS, looks 100% like Pallav (layout, colours, fonts, sizes, spacing, icons, tables, forms, pills, wording) in DAY and NIGHT, with calm motion, a day/night switch, a smart search bar, and PDF links. Premium = polish inside Pallav's look. Mobile and backend features are paused; the web runs on the ui-shared mocks.

References (read only): the running Pallav `http://127.0.0.1:8000` (scratch demo data, superadmin), its source `%LOCALAPPDATA%\HMS\pallav-ref` (CSS: pms-*.css, pms-dark.css; views in resources/views), `docs/design/ui-review/13-PALLAV-PARITY.md`, `14-AFTER-POSTGRES-UI-BRIEF.md`, `15-PALLAV-SITEMAP-DIFF.md`, `docs/UI.md`.

## Split (own the folder, do not edit another owner's files)
| Owner | Screens (web-app/src/dashboards/groups/...) |
|---|---|
| Web UI 1 (hms-8d) | shell, header, sidebar, dashboard (overview), frontOffice, billing (Guest Advances, Bills, Debit), cash (Revenue, Expenses, Shift Handover); shared kit (ui/), tokens, nav.ts |
| Web UI 2 (hms-58) | payrollCore, payrollPay (all pages incl. Meal Price, Payroll Master and Log), companies (Profiles, Customers, CRM, Company Ledger), reports (Daily, Food Plan) |
| Web UI 3 (new session, if MJ opens one) | website (all 14 pages), admin (Master Data, Users, Roles, Settings, Razorpay, System Health, System Log, Force Log, Profile), guest portal, corporate portal, login screens |

## Rules
1. Shared files (ui/ kit, tokens.ts, nav.ts, common.ts, icons): only Web UI 1 edits them; others send a one-line request. Small additive changes are fine if announced to the others.
2. Per screen: compare with the matching Pallav page (same data), match structure first, then every style value; send paired shots (Pallav vs ours) day and night, 1440 and 390 wide.
3. No new visual ideas. Anything Pallav doesn't have is listed to the Lead as "not Pallav".
4. Behaviour/contract questions go to the Lead (ui-shared is mine). tsc and eslint clean before reporting; do not commit or push (the Lead pushes).
5. Report one line per finished screen group. The reviewer (hms-5c) scores each group; "complete" = every group scores 4.5 or more and the pixel gate passes in both modes.

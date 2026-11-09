# Docs refresh draft (apply after the final audit)

Placeholders: {{DATE}} audit date; {{DB}} {{SERVER}} {{SCREENS}} {{WIRING}} the four layer percentages; {{MEAN}} their mean; {{LATEST_AUDIT}} the audit file name; {{CHECK_SHARED}} the check:shared total (expected 0); {{OPEN}} the short list of what cannot reach 100%.

## docs/PROJECT-STATE.md (replace the "Module audit" sentence in the header block, line 4; refresh "Done since")
> Module audit: `docs/sessions/{{LATEST_AUDIT}}` ({{DATE}}): Database {{DB}}%, Server {{SERVER}}%, Screens {{SCREENS}}%, Wiring {{WIRING}}%; project mean {{MEAN}}%. Not at 100%: {{OPEN}}.
> Shared Components: `npm run check:shared` total {{CHECK_SHARED}} (colour, type, control, inline, import; raw tables and page-local controls are counted again). Kit pieces added since: Alert, StatusChip, FieldMessage, ModalFooter, CellStack, EmptyState, Skeleton, Select, Textarea, PortalButton, Table, ListTabs, RemoveButton, TextAction; Button variants dangerSolid and secondary.
> Mock / demo: demo data lives in `ui-shared/dashboards/*.mock.ts` and loads only through `src/lib/api/mockLoader.ts` (dev or `NEXT_PUBLIC_HMS_LOCAL_DEMO=1`); the production bundle holds none of it (scan: 0 hits). Neutral names ("Your hotel", "Your restaurant") are the contract defaults until a signed-in hotel's own names are known.
> Server paging: Salary Payments is server-driven (page, pageSize, status, search, sort); Slips, Advances, Bonus and Resignations follow when Backend sends the shapes (BACKEND.md section 7).

## docs/MASTER-PROMPT.md (line 32, the "built end to end" paragraph; keep the plain-English rule at line 19)
> Status {{DATE}}: Database {{DB}}%, Server {{SERVER}}%, Screens {{SCREENS}}%, Wiring {{WIRING}}% (mean {{MEAN}}%), measured by `docs/sessions/{{LATEST_AUDIT}}`. A layer is "done" only with evidence: tables and repos, routes and tests, every screen with its states, and a live test of the real adapter. Honest numbers only: per-module status first, the percentage computed from it.

## README.md (status table / "Where things are")
> | Check | Result |
> |---|---|
> | Module audit | {{MEAN}}% ({{DB}} / {{SERVER}} / {{SCREENS}} / {{WIRING}}) |
> | Shared Components (check:shared) | {{CHECK_SHARED}} violations |
> | Production bundle demo strings | 0 |
> Run the audit evidence: `cd web-app && node scripts/audit-modules.mjs`; see `docs/sessions/audits/AUDIT-CHECKLIST.md`.
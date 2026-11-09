# Worker B (hms-b8) - where I am, paused for the PostgreSQL set-up (2026-10-06)

State: `tsc` clean for server and tests; `npm run test:server` 1,341 pass, 0 fail.

## Done and reported
- W1 website (enquiries, rooms, plans, calendar). B7 PDFs (pdfkit renderer, 13 routes, mail attachment renderer; docs/specs/documents.md, docs/api/documents.md).
- Staff lookup active-only.

## In my hands, finished only to keep things green (not yet reachable by routes or tested)
- Website W2 pieces: `services/website/sanitizer.ts` and `mapTools.ts` (golden-tested against real PHP: `tests/server/website.content.golden.test.ts`, fixtures `db/scripts/php/fixtures/website-content.json`), `contentService.ts` (written, not routed or tested).
- Admin core slice 1, written but NOT yet routed or tested: `repos/admin.ts` + `repos/memory/admin.ts` (wired into the shared hotel store; plan rates are billing's `mealPlanRates`, option lists feed billing's `optionLists`), `services/admin/{context,planRateService,masterRules,masterService,settingsDefs,settingsService,schemas}.ts`, `compose/admin.ts`.
- `services/auth/credentialPort.ts`: the CredentialService interface for Backend 1 (relay requested via the Lead).
- Services keep to repository interfaces only (no SQL, engine names or schema names); money is bigint paise; ids UUID strings.

## Next three tasks when I resume
1. Admin core slice 1: routes under `/api/v1/admin/{plan-rates,masters,settings}`, tests (plan-rate upsert/delete and the bill header following settings; master list scope "both" mirroring; name-only rules; settings secrets sealed and masked; permissions; concurrency), `docs/specs/admin.md`, `docs/api/admin.md`, contract requests.
2. Admin users and roles (list/create/edit/deactivate/reactivate, role and hotel assignment, permission grants with the derived system.recycle ability, sign-in history read, profile name/phone) behind the CredentialService port, with a fake in tests; then Reports, Books, Recycle bin endpoint, System and Force log viewers.
3. Website W2 (routes and tests for content, gallery, services, policies, nearby, settings, Google, overview), then the public site and the portals.

## Open questions
- Who owns the auth parts (users, roles, 2FA, sign-ins): answered by Backend review as the Admin split (business side mine, credentials behind the port).
- Cash receipts PDFs wait for the cash module's routes.

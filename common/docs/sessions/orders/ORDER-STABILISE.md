# Order: stabilisation round (decision 56, MJ, 12 Oct 2026). NO AGENTS. Testing is ON again.

All features of decisions 46 to 55 are built but were written without running tests. Backup of everything: branch wip-12-oct (22a2398). Main = fa3d001 (not yet updated). My last clean-copy check (ea6480a): tsc 0, check:shared 0, build ok; 5 client tests and 16 server tests FAIL.

## Backend [f948b5]
1. Update the 16 failing server tests to the new rules (admins no longer always get a code, portals answer 409 PORTAL_NOT_LINKED/PORTAL_INACTIVE where they answered 403, the new routes in the route security inventories, the removed corporate team/rooms/bookings routes, and anything else that fails). Each test must assert the NEW rule, not be deleted, except tests of removed features.
2. Run `npm run test:server` and the db suite (`npm run test:db`) on a throwaway PostgreSQL 18 (not the dev instance) and `npm run lint:db`; fix the REAL bugs they find (sign-in without the code, guest/company multi-hotel reads, search params, add-member scan, submit mode, restaurant hours); every fix with a test where a test was missing.
3. Report: numbers (server pass/fail/skipped, db pass/fail), the bugs found and fixed, anything left open. Local commits, hashes to me.

## UI [be5337]
1. Update the 5 failing client tests (the old sign-in tests that assert an always-required code: "admins always get a code", the code normaliser, wrong code, 5 wrong codes, resend) to the new rules, and add tests for the new behaviour that has none (the auto-submit at 6 digits, the portal not-linked page, the hotel selector, the Pathik Submit setting, the refresh restore).
2. Run `node --test tests/*.test.ts`, `npm run check:shared` (must stay total 0 with no new ignore notes), `npx tsc --noEmit -p tsconfig.json`, eslint on the files of this round; fix what they find. Work through docs/UI.md section 18 "Known risks" items 1, 2 and 4 (half-typed form lost on a hotel switch: keep the page state when only the hotel changes where practical; the restore flash on a slow server; the picture body size: resize the picture in the browser before upload to stay under 3 MB like the other photo uploads).
3. Look at the portals and the new Pathik tabs in a real browser once (headless Chrome is fine) at 390 and 1280 px, day and night, as you did before, and fix what looks broken. Report: numbers, what you fixed, what is left. Local commits, hashes to me.

## d7 [1a94a6]
After the website design note: nothing new now.

## Me
Re-run the clean-copy check on the final head, then the push once MJ has applied the Neon migrations.

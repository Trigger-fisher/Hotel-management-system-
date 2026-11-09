# 11 - Web auth review, round 1 (2026-10-05) - UNOFFICIAL, review was SKIPPED by MJ

Status: **withdrawn.** MJ skipped the authentication review (relayed by the Planner). Nothing here is an order. Kept only as a record for the Lead/MJ.
Basis: Web UI 1's report + 14 of 124 screenshots (`docs/sessions/S02-screens/web/`), plus a code read of the shell, card, fields, buttons and sign-in step. Mobile was not reviewed (no report received).

## Scores (web, from shots seen)
D1 4.5 · D2 4.5 · D3 4.5 · **D4 3.5** · D5 4.5 · D6 unverified (3.5) · D7 4.5 · D8 4 · D9 unverified (4) · D10 pending. Average about 4.2 (target 4.5, nothing below 4). Result: close, not at the bar.

## What was already very good
Pallav fidelity: violet page + rings, brand row, card, step pill, "who" chip, gradient button with arrow, night card edge, tinted notes. Code: no hard-coded hex, no template leftovers, no `dark:` classes, tokens via CSS variables, theme-color for both modes, lint clean on auth folders, 86 tests pass, production bundle has no demo data.

## Open findings (not sent as orders any more)
1. Password rules in 2 columns wrap raggedly on desktop (long labels, orphan row). One column at every width looks clean (phone already does).
2. forgotPasswordSent: the hint box touches "Send again" (about 2px). Also locked: 12px under "Back to sign in". Wanted 16px.
3. setupTwoFactor alignment: "Can't scan?" link 4px left of the QR box; step 3 field indented while the button is full width.
4. Idle-warning dialog has no screenshot or dev trigger.
5. No keyboard-focus shots (Tab) for inputs, eye, links, buttons, checkbox.
6. No 320px / 200% zoom shots.
7. Step transitions (ViewTransition morph) never watched: no mid-transition frames, no reduced-motion run.
8. A faint ghost of the Demo accounts panel visible on signedIn (desktop day).
9. Dark band below tall pages in full-page shots (probably the fixed background in a full-page capture); needs viewport shots scrolled to the bottom.
10. `npm run build` blocked by type errors in `ui-shared/dashboards/website.ts` (dashboards, not auth).

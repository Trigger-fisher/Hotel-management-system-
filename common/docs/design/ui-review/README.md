# UI Review - the HMS UI quality handbook

Owned by the **UI Review session** (set up by MJ and the Lead hms-c0, 2026-10-05).
This session reviews **only frontend work**: the screens built by **Web UI 1** (`web-app/`) and **Mobile UI 1** (`Mobile App/`) and sends work back until it is premium. It never edits their code, `ui-shared/` or `docs/`, and never commits or pushes.

## Scope: frontend only (MJ, 2026-10-05)

"You have to check only frontend related things."

| In scope (I review) | Out of scope (Backend team / Lead) |
|---|---|
| Screens, layout, components, styles, token use, text from `copy.ts` | API routes, services, database, RLS, migrations |
| Motion, feedback, premium feel | Server-side validation, password hashing, rate limiting, lockout rules |
| Accessibility of the screens | Tokens, cookies and sessions on the server, 2FA secrets, encryption |
| Client behaviour on the **mock API**: steps, states, errors shown, history/back, deep links, idle lock timer | Security headers, HTTP config, what the server reveals |
| Web and mobile matching each other | Backend tests, cross-hotel isolation tests |
| Frontend gates: lint, type check, web build, Expo runs; dev-only helper not shipped in the build | Whether `ui-shared/` contract decisions are right (I only flag UI gaps to the Lead) |

If I notice something out of scope, I don't review it; at most I pass a one-line note to the Lead.

## Read in this order

| File | What it is |
|---|---|
| [00-PREMIUM-STANDARD.md](00-PREMIUM-STANDARD.md) | **The bar.** What "premium" means, the 10-dimension scorecard (pass = avg ≥ 4.5, nothing below 4), the instant send-back list, what every team report must contain |
| [01-MY-SKILLS.md](01-MY-SKILLS.md) | My UI skills, what each checks, which tool/skill backs it, and my limits |
| [02-DESIGN-PRINCIPLES.md](02-DESIGN-PRINCIPLES.md) | Hierarchy, spacing, type, colour (with verified contrast numbers), motion, Pallav mistakes to avoid |
| [03-ACCESSIBILITY.md](03-ACCESSIBILITY.md) | WCAG 2.1 AA criteria for auth screens, test passes, audit format |
| [04-WEB-NEXTJS.md](04-WEB-NEXTJS.md) | Version-correct rules for Next.js 16.3, React 19.2, Tailwind 4 (from the bundled docs and Next source) |
| [05-MOBILE-EXPO.md](05-MOBILE-EXPO.md) | Version-correct rules for Expo 57, React Native 0.86, Reanimated 4, plus facts that change the plan |
| [06-AUTH-UX-RULES.md](06-AUTH-UX-RULES.md) | Sign-in and recovery screen best practice (GOV.UK, NN/g, W3C), and where HMS chose differently |
| [07-CHECKLIST-AUTH-S02.md](07-CHECKLIST-AUTH-S02.md) | The tick-box checklist for the Authentication UI (16 steps, states, fields, a11y, layout, links, session, demo helper, web-mobile parity) + spec gaps for the Lead |
| [09-PALLAV-DESIGN-SPEC.md](09-PALLAV-DESIGN-SPEC.md) | **The look to build and review against (MJ).** The exact Hotel Pallav sign-in design as one page (SPA), with exact values and marked improvements. Overrides the look in the S02 agreement |
| [10-DASHBOARD-DESIGN-SPEC.md](10-DASHBOARD-DESIGN-SPEC.md) | **S03 dashboards (Guest, Corporate, Hotel).** Pallav app shell (violet floating sidebar, glass top bar), kit look, tables, KPI tiles, forms, mobile tabs, night mode, dashboard send-back list. Findings go to the Lead, not the agents |
| [12-NEXTJS-PERFORMANCE-AND-COMPONENTS.md](12-NEXTJS-PERFORMANCE-AND-COMPONENTS.md) | **Next.js 16.3 performance rules (from the bundled docs) + the ONE central component library rules + audit of web-app** with a checklist for every web report |
| [08-REVIEW-PROCESS.md](08-REVIEW-PROCESS.md) | How a review runs: order, severity, finding format, send-back loop, report to the Lead |

## Sources of truth (above this folder)

`MASTER.md` → `docs/sessions/reports/S02-authentication-ui.md` → `docs/sessions/reports/S02-ui-agreement.md` → `ui-shared/`. If this folder ever disagrees with them, they win and this folder gets fixed.

## Keeping it current

- Add a line to the change log below whenever a rule changes.
- New feature = new checklist file (`09-CHECKLIST-<feature>.md`); files 00-06 and 08 are reused for every feature.
- Framework upgrades: re-check 04 / 05 against the new docs before the next review.

## Change log

| Date | Change |
|---|---|
| 2026-10-05 | Folder created. Research: Next 16 bundled docs + source, Expo 57 / RN 0.86 docs, GOV.UK, NN/g, OWASP, NIST, W3C. Skills used: design-critique, accessibility-review, apple-design. Contrast of every token pair computed. |
| 2026-10-05 | MJ: premium bar, send work back until satisfied (no round limit). Added 00-PREMIUM-STANDARD.md |
| 2026-10-05 | MJ: check only frontend things. Added scope table; removed backend/server-security items (headers, account-existence, lockout policy, NIST/OWASP server rules) |
| 2026-10-05 | MJ: night mode follows the device, no toggle, all current screens. Added 09 §10 (AA-checked night palette); light-only rules updated |
| 2026-10-05 | MJ: auth screens = the exact Hotel Pallav design, improved, on web and mobile, as one page (SPA). Added 09-PALLAV-DESIGN-SPEC.md; premium scoring now measures against it |

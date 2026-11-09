---
name: hms-ui-libraries
description: How to use the modern React UI libraries (shadcn/ui, Motion / Framer Motion, Magic UI, React Bits, Aceternity UI, AutoAnimate, dashboard starters) inside the HMS web app without breaking the Pallav look, the token rules or the bundle budget. Use this skill whenever MJ or a session wants to make HMS look more modern, premium, luxury or eye catching, add animations, a number ticker, a spotlight or glow effect, page transitions, a bottom sheet, a mobile native feel or PWA, or names any of these libraries or the UI master list, even if no library is named. Also use it before running any `npx shadcn` command or `npm install motion` in web-app.
---

# HMS UI libraries

MJ collected a list of modern UI libraries for HMS (`docs/plans/UI-LIBRARY-MASTER-LIST-2026-10-24.md`: what each is for, checked repo links, install commands). This skill is how to use that list in this repo. The list is research; this repo has binding rules that come first, and most of the work is knowing which rule a request touches.

## Step 1: check the decision gate

Open `docs/DECISIONS.md` and look for a numbered decision dated 24 Oct 2026 or later that allows these libraries and says where.

- Decision 1 says the UI is 100% Hotel Pallav and "premium" means polish inside Pallav's look, never a new look.
- Decisions 6 and 23 say no mobile app; `docs/plans/MOBILE-APP-FEEL-PLAN-2026-10-18.md` rules out a PWA or store app.

shadcn, Magic UI, React Bits, Aceternity, a dashboard starter or a dark and gold theme are a new look. **If no newer decision allows them, do not install them.** Say which decision blocks it in one sentence, offer to draft the new decision for MJ (number, date, where the libraries may appear, what stays Pallav), and do what is allowed now (below). The reason: several sessions work on this repo at once and the Pallav parity reviews measure every screen; a library dropped into one screen breaks the parity scoreboard and another session's work.

If a newer decision exists, follow its scope exactly and go to step 2.

**MJ, 25 Oct 2026: "I told you to install skill not library."** A test install of these packages (shadcn, Motion, Magic UI, Aceternity, React Bits, GSAP) was made on 24 Oct and removed on 25 Oct without being committed. Use this skill and the repositories below for knowledge and design reference; never run `npm install` or `npx shadcn add` for them unless MJ orders it in that conversation. The public website (`components/site/SiteHome.tsx`) and the sign-in page use the app's own purple theme (decision 68), not these libraries.

### Allowed now, with no new decision

- The native-look rules (section "Mobile feel" below): they match the mobile feel plan already in force.
- Motion or AutoAnimate for calm, small movement on a screen, only if `docs/UI.md` rule 6 is kept (nothing moves on its own; hover lifts 1px on buttons, 3px on KPI tiles) and MJ has allowed the new package (the backend checklist allows no package beyond the allowed list; ask before `npm install`).
- Prototypes outside the repo: a claude.ai artifact (web-artifacts-builder skill) to show MJ what a shadcn or Aceternity screen would look like before any decision.

## Step 2: know the three zones

| Zone | Folders | Styling today | What may go there once allowed |
|---|---|---|---|
| Sign-in and auth | `src/components/auth`, `src/components/ui` | Tailwind 4 mapped to `--hms-*` tokens (`globals.css` `@theme inline`) | shadcn primitives, Aceternity / React Bits effects for the sign-in hero, Motion |
| Dashboards (Hotel, Guest, Corporate, Platform, Group) | `src/dashboards/**` | Pallav CSS + Bootstrap 5.3.3 CSS, no Tailwind, no Bootstrap JS | Motion only, calm. No shadcn components: the Shared Component kit `src/dashboards/pallav/ui` is the component library here |
| Guest-facing public pages (hotel website, landing) | wherever the decision puts them | decided with the decision | big effects are fine here (MJ's own rule: big effects only on guest-facing pages) |

Never mix Tailwind utilities into a dashboard file, and never put Pallav classes in an auth file (`docs/UI.md` section 1). Sign-out unloads every Pallav sheet so the auth screens get their own look back; a library that depends on global CSS must survive that.

## Step 3: add a library the HMS way

Read `web-app/AGENTS.md` first: this is Next.js 16.3.8 with React 19.2.8, React Compiler on, Tailwind 4. Check the library's docs against `web-app/node_modules/next/dist/docs/` before trusting any example written for older Next.js.

### shadcn/ui

- `npx shadcn@latest init` would write `components.json`, rewrite `globals.css` and put components in `src/components/ui`. That folder is the sign-in kit, so set the `ui` alias to `@/components/shadcn` before adding anything, and review the `globals.css` diff by hand.
- shadcn ships its own colour variables with literal `oklch(...)` values. Map every one to an existing `--hms-*` token instead (tokens come from `ui-shared/tokens.ts` through `src/lib/theme.ts`). `npm run check:shared` scans `src/dashboards`, `src/components` and `src/app` and fails on literal colours and sizes; a skipped line needs a real `check-shared-ignore: <reason>`.
- Night mode never follows the device (MJ, 5 Nov 2026): it is `html[data-theme="dark"]`, set only by the person's moon button. shadcn's `.dark` class variant needs remapping to that attribute; never add `prefers-color-scheme` (tests/server/theme.alwaysLight.test.ts fails on it).
- Add only the components the screen uses (`npx shadcn@latest add button card`), never the whole set (MJ's rule: copy only what we need).

### Motion (`motion` package, formerly Framer Motion)

- Import from `motion/react`. A component that animates needs `'use client'`.
- Use `LazyMotion` with `domAnimation` and the small `m` components rather than the full `motion` component, to keep the bundle small.
- Respect `prefers-reduced-motion` (`useReducedMotion`, and `hms-overrides.css` already turns motion down globally).
- Dashboards: no ambient or looping animation, no spring overshoot (Pallav's `--ease-spring` was replaced on purpose). Use the theme's `--ease-out` and the durations `--dur-micro 120ms`, `--dur-base 220ms`, `--dur-large 380ms`.
- React Compiler is on: do not add `useMemo` / `useCallback` around animation values without a measured reason.

### Magic UI, React Bits, Aceternity

All three are copy-paste components built on Tailwind and Motion, so they belong only where Tailwind is allowed (the auth zone, or the guest-facing zone a decision names). Copy the component source into `src/components/shadcn/` (or the folder the decision names), then replace its literal colours with tokens as above. Aceternity has no official GitHub repo; take components from ui.aceternity.com and check the licence of paid blocks before use.

### Dashboard starters (Kiranism, satnaing, Devias, TailAdmin, Materio)

Do not clone a starter into this repo. HMS already has its shell (`RoleDashboard`, `PallavShell`, the navigation stack). A starter is only a design reference to look at; check its licence before copying any piece (Materio requires attribution).

## Step 4: budgets that a library can break

- **Sign-in page JS:** budget 250 KB transferred, measured 239 KB (`docs/UI.md` section 8). Anything added to the auth zone must be measured on `npm run build` then `npm start`, never `npm run dev`. If it goes over, lazy-load the effect with `next/dynamic`.
- **Page change speed:** median 77 ms on the volume hotel. An entry animation must not delay data on screen; animate after paint, never block on it.
- **Accessibility:** focus order, 44 px targets, contrast AA, every list keeps its loading, empty, error and offline states (`docs/UI.md` rule 8).

## Mobile feel (allowed now)

These match `MOBILE-APP-FEEL-PLAN-2026-10-18.md` and apply below 768 px only; desktop does not change.

- Touch targets at least 44 px; inputs 16 px so phones do not zoom.
- Safe areas with `env(safe-area-inset-*)` and `viewport-fit=cover`; `100dvh`, not `100vh`.
- `overscroll-behavior` to stop rubber-band scroll; no tap highlight; no text selection on buttons.
- Bottom sheets instead of centred modals on phones; skeletons, never spinners; page slide under 250 ms.
- Not allowed without a new decision: the PWA manifest, Serwist service worker, install prompt, Capacitor.

## Source repositories (checked 24 Oct 2026)

When a question needs the library's own docs or source, open the repo or site below with WebFetch and read the relevant page rather than answering from memory; these libraries change often.

| Library | Repository or site | Use for |
|---|---|---|
| shadcn/ui | https://github.com/shadcn-ui/ui (docs: https://ui.shadcn.com) | base components, forms, tables, dialogs, charts |
| Motion (Framer Motion) | https://github.com/motiondivision/motion (docs: https://motion.dev) | the animation engine under most of the others |
| Magic UI | https://github.com/magicuidesign/magicui (site: https://magicui.design) | number ticker, shiny text, border beam |
| React Bits | https://github.com/DavidHDev/react-bits (site: https://reactbits.dev) | text effects, backgrounds, cards |
| Aceternity UI | https://ui.aceternity.com (no official GitHub repo) | spotlight, background beams, 3D cards |
| AutoAnimate | https://github.com/formkit/auto-animate | under 3 kB list animation |
| Next Shadcn Dashboard Starter | https://github.com/Kiranism/next-shadcn-dashboard-starter | design reference only |
| Shadcn Admin (Vite) | https://github.com/satnaing/shadcn-admin | design reference only |
| Devias Kit (Material UI) | https://github.com/devias-io/material-kit-react | design reference only |
| TailAdmin Next.js | https://github.com/TailAdmin/free-nextjs-admin-dashboard | design reference only |
| Materio MUI Next.js | https://github.com/themeselection/materio-mui-nextjs-admin-template-free | design reference only (MIT, attribution required) |

## Before reporting done

1. `npm run check:shared` passes.
2. Type check and lint only the files you changed (`docs/UI.md` rule 10).
3. Day and night, desktop and 360 / 390 / 430 px checked once in the browser.
4. `docs/UI.md` updated in the same commit (it is the only UI guide; section 13 lists the kit).
5. If a library was added: the decision number in the commit message, and the master list's status header updated.

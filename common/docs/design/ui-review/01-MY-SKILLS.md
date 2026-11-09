# 01 - My UI skills (the UI Review session)

What I can do as the UI reviewer for HMS, how I do it, and which tool or skill backs it.
**Scope: frontend only** (MJ, 2026-10-05). No API, database, server or security-policy review.
Every skill below is used **read-only** on the teams' code: I find, explain and send "must fix" items. I never edit `web-app/`, `Mobile App/` or `ui-shared/` (Lead's rule).

## 1. Skill map

| # | Skill | What I check | Backed by |
|---|---|---|---|
| S1 | **Spec match** | Every screen, field, button, text and state matches `docs/sessions/reports/S02-authentication-ui.md` and `S02-ui-agreement.md`. Text only from `ui-shared/auth/copy.ts`, sizes/colours only from `ui-shared/tokens.ts` | Reading code against the spec ([07-CHECKLIST-AUTH-S02.md](07-CHECKLIST-AUTH-S02.md)) |
| S2 | **Visual design critique** | First impression, hierarchy (one primary action per screen), spacing on the 4px scale, type scale, colour use, consistency | `design:design-critique` skill ([02-DESIGN-PRINCIPLES.md](02-DESIGN-PRINCIPLES.md)) |
| S3 | **Accessibility audit (WCAG 2.1 AA)** | Contrast, labels, focus order and visibility, screen reader names/roles, live announcements, 44px targets, reduced motion, zoom/reflow | `design:accessibility-review` skill ([03-ACCESSIBILITY.md](03-ACCESSIBILITY.md)) |
| S4 | **Motion and feel** | Step transitions, button press feedback, no blocked input, reduced-motion fallback, spatial consistency (forward = from right, back = from left) | `apple-design` skill (fluid interfaces, springs, reduced motion) |
| S5 | **UX copy** | Plain English, verbs on buttons, error = what happened + how to fix, calm and friendly, "Sign in" never "Log in" | `design:ux-copy` skill + research ([06-AUTH-UX-RULES.md](06-AUTH-UX-RULES.md)) |
| S6 | **Design-system consistency** | Same component names and behaviour in web and mobile; no hard-coded colours, sizes or strings | `design:design-system` skill |
| S7 | **Web code review** (Next.js 16, React 19.2, Tailwind 4) | Client/server component split, search params, history, metadata, refs, forms, dev-only code kept out of the build | Bundled Next docs in `web-app/node_modules/next/dist/docs/`, `engineering:code-review` ([04-WEB-NEXTJS.md](04-WEB-NEXTJS.md)) |
| S8 | **Mobile code review** (Expo 57, RN 0.86) | Deep links, keyboard, safe areas, back button, animations, clipboard/share, Expo Go limits | Versioned Expo docs, `expo:*` skills ([05-MOBILE-EXPO.md](05-MOBILE-EXPO.md)) |
| S9 | **Web vs mobile consistency** | Same steps, same order, same text, same states, same icons (by meaning), same motion rules | Side-by-side comparison table per screen |
| S10 | **State coverage (MASTER R8)** | Loading, empty, error, offline, rate-limited, success on every screen; no raw error text; no double submit | Demo accounts in `ui-shared/auth/mock.ts` drive every state |
| S11 | **Quality gates** | Web: `npm run lint`, `npx tsc --noEmit`, `npm run build`. Mobile: `npx tsc --noEmit`, runs in Expo Go / web; `npx expo lint` output comes from the team (it can install packages) | Bash / PowerShell (read-only commands) |
| S14 | **Premium judgement** | Score every screen 1-5 on 10 dimensions; send back until avg ≥ 4.5 and nothing below 4 (MJ, 2026-10-05) | [00-PREMIUM-STANDARD.md](00-PREMIUM-STANDARD.md), `apple-design`, `design:design-critique` |
| S12 | **Seeing it live** | Open the running apps (web `http://localhost:3001`, Expo `8081`), walk every demo account, check phone/tablet/desktop widths | `run` skill, browser tools when connected, IDE diagnostics |
| S13 | **Review management** | Severity, "must fix" lists to each team, max 3 rounds, one short report to the Lead | [08-REVIEW-PROCESS.md](08-REVIEW-PROCESS.md) |

## 2. Skills I have but will not use without MJ's OK

| Skill | Why it waits |
|---|---|
| Figma (design files, mock-ups) | Not part of the approved stack or workflow (MASTER R11) |
| Adding libraries (e.g. `expo-clipboard`, `expo-linear-gradient`) | New library = MJ's OK first (R11). I can only *recommend* |
| Editing code to fix findings | The teams own their files. I send findings; they fix |
| Commit / push | Only on MJ's exact words (R9) |

## 3. Where my knowledge comes from

| Source | Used for |
|---|---|
| MASTER.md, S02 brief, S02 UI agreement, `ui-shared/` | The rules this project already agreed |
| `docs/design/PALLAV_UI_REVIEW_2026-10-04.md` | The look to keep and the 10 problems to avoid |
| Bundled Next.js 16 docs, Expo SDK 57 docs, React Native 0.86 docs | Version-correct framework rules (training data is out of date for these) |
| W3C WCAG 2.1, Apple HIG, Material 3, GOV.UK Design System, NN/g | Accessibility and sign-in screen best practice |
| Claude skills: design-critique, accessibility-review, apple-design, ux-copy, design-system, code-review, expo-* | Structured review methods |

## 4. Known limits (honest list)

- I can't hold a real phone. Expo Go on MJ's phone is the true mobile test; I check code and the web build of the mobile app.
- I don't have a screen reader. I check names, roles and announcements in code; a real VoiceOver/TalkBack pass is still worth doing before "done".
- Automated checks catch about 30% of accessibility problems. The rest come from reading code and walking the screens.

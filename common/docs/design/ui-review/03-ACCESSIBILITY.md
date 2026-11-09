# 03 - Accessibility: WCAG 2.1 AA for HMS (web + mobile)

MASTER §8 requires **WCAG 2.1 AA** on phone, tablet and desktop. Method from the `design:accessibility-review` skill: automated checks catch ~30%; the rest is keyboard, screen reader, contrast and zoom. Platform details: web [04-WEB-NEXTJS.md](04-WEB-NEXTJS.md) §5, mobile [05-MOBILE-EXPO.md](05-MOBILE-EXPO.md) §7.

## 1. The criteria that matter for auth screens

| WCAG | Level | What I check here |
|---|---|---|
| 1.1.1 Non-text content | A | QR has alt text (`qrAlt`); decorative icons hidden from screen readers |
| 1.3.1 Info and relationships | A | Labels tied to inputs; headings are headings; checklist is a list or one readable summary |
| 1.3.5 Identify input purpose | AA | autocomplete / textContentType on identity fields |
| 1.4.1 Use of colour | A | Errors and checklist ticks change icon too, not only colour |
| 1.4.3 Contrast (text) | AA | 4.5:1 normal, 3:1 large. Token pairs verified in [02-DESIGN-PRINCIPLES.md](02-DESIGN-PRINCIPLES.md) §5 |
| 1.4.4 Resize text | AA | 200% text works (web zoom; mobile large text, cap 1.6x) |
| 1.4.10 Reflow | AA | 320 CSS px: no sideways scroll |
| 1.4.11 Non-text contrast | AA | 3:1 for input borders (3.42 ✅), checkbox border, focus indicator (2px primary ✅) |
| 1.4.12 Text spacing | AA | Layout survives extra line/letter/word spacing |
| 2.1.1 Keyboard | A | Whole web flow by keyboard; Show/Hide, links, checkbox, demo panel reachable |
| 2.1.2 No keyboard trap | A | Focus never stuck (e.g. in the demo panel or QR area) |
| 2.2.1 Timing adjustable | A | Idle lock warns 30 s before with "Stay signed in"; rate-limit wait is shown |
| 2.3.3 / reduced motion | (AAA, house rule) | Fade only, static spinner when the OS asks for less motion |
| 2.4.2 Page titled | A | Web tab title `<Step title> · HMS` |
| 2.4.3 Focus order | A | Order matches the visual order; focus moves sensibly on step change |
| 2.4.6 Headings and labels | AA | Titles and labels describe purpose |
| 2.4.7 Focus visible | AA | Every control shows focus; never `outline: none` without a replacement |
| 2.5.3 Label in name | A | Accessible name contains the visible text ("Show" button's name includes "Show") |
| 2.5.5 Target size 44px | **AAA** in 2.1 (not AA) | **House rule: 44 everywhere** (agreement). WCAG 2.2 AA minimum is 24 (2.5.8) |
| 3.2.1 / 3.2.2 On focus / input | A | No auto-submit on the 6th digit; nothing changes step on focus |
| 3.3.1 Error identification | A | Error text says what is wrong, tied to the field |
| 3.3.2 Labels or instructions | A | Password rules shown before typing; hints visible |
| 3.3.3 Error suggestion | AA | Error says how to fix it (`copy.fieldErrors`) |
| 4.1.2 Name, role, value | A | Buttons, links, checkbox (checked state), Show/Hide (pressed/expanded), busy state |
| 4.1.3 Status messages | AA | Banners, "Copied", checklist updates, step title announced without moving focus where not needed |

Forward-looking (WCAG 2.2, not required yet): 3.3.8 Accessible Authentication: paste and password managers must work, no puzzle. Our design meets it.

## 2. Test passes I run

| Pass | Web | Mobile |
|---|---|---|
| Keyboard only | Tab through every step; Enter submits; Space toggles checkbox; focus visible | Hardware keyboard on Expo web build |
| Screen reader (code-level) | Names, roles, `aria-*`, live regions present before text changes | `accessibilityLabel/role/state`, iOS announcements via `announceForAccessibility`, Android live regions |
| Contrast | Tokens pre-checked; look for any hard-coded colour or opacity on text | Same |
| Zoom / large text | 200% browser zoom, 320px width | Largest system text in Expo Go (MJ's phone), Expo web at 390px |
| Reduced motion | `prefers-reduced-motion` emulation in dev tools | OS setting; Reanimated `ReduceMotion.System` |
| Touch targets | Measure links, Show/Hide, checkbox rows | Same + Android 48dp via hitSlop |

Real VoiceOver / TalkBack / NVDA runs are recommended before "done" (I can't run them; noted in reports).

## 3. Audit output format (from the skill)

```
## Accessibility Audit: <app> - <screen or "auth flow">
Standard: WCAG 2.1 AA | Date: <date>
Issues: <n> | Critical <n> | Major <n> | Minor <n>
| # | Issue | WCAG | Severity | File:line | Fix |
```
Critical = blocks a user (no label, keyboard trap, contrast fail on text, no error announcement). Major = hard to use. Minor = polish.

# 02 - Design principles for HMS screens

How I judge whether a screen *looks and feels* right. Built from: the HMS tokens (`ui-shared/tokens.ts`), the Hotel Pallav review (`docs/design/PALLAV_UI_REVIEW_2026-10-04.md`), Apple's design principles and fluid-interface talks (`apple-design` skill), and the design-critique method (`design:design-critique` skill).

MJ's direction for the sign-in pages (2026-10-04): **no day/night toggle** (2026-10-05: night mode follows the device automatically), the design must be **clearly better** than before, and the captions must be **researched, not weak**.

## 1. The 2-second test (first impression)

Open the screen and ask:
1. What does the eye land on first? On a form screen it must be the **title**, then the **first field**, then the **primary button**. On the sign-in desktop layout the brand panel may be seen first, but it must not out-shout the form.
2. Is the purpose clear without reading the subtitle?
3. Does it feel calm and trustworthy (a hotel's front desk at 6 am), not busy?

## 2. Hierarchy

| Rule | Check |
|---|---|
| One primary action per screen | Exactly one solid violet button. Everything else is SecondaryButton (outlined) or LinkButton (text) |
| Title > subtitle > labels > hints | Sizes 24 → 15 → 13 semibold → 12. Never two things at the same size and weight competing |
| Weight before size | Emphasis by semibold/bold, not by making text bigger |
| Proximity = relationship | Hint sits right under its label (gap 4); error right under its input; "Forgot password?" right under the password field |
| Whitespace | Gaps from the agreement: 8 title→subtitle, 24 subtitle→form, 16 between fields, 24 above the primary button, 12 between secondary actions |

## 3. Spacing, size and shape (from tokens)

| Thing | Rule |
|---|---|
| Spacing | 4px scale only: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Any other number (e.g. 10, 18, 30) is a finding unless the agreement names it |
| Radius | 10 inputs/banners, 14 buttons, 18 cards (app), 24 auth card, 999 pills |
| Heights | Inputs and buttons 48. Touch targets ≥ 44 |
| Card | Max width 440; padding 24 (web ≥ 640px: 32) |
| Breakpoints | 640 / 768 / 1024 / 1280 only (Pallav had ~15) |

## 4. Type

| Style | Size / line | Weight | Used for |
|---|---|---|---|
| display | 32/38 | 800 | Brand headline only |
| title | 24/30 | 700 | Step title |
| bodyLg | 16/24 | 400 | Input text (16 stops iOS zoom), button text (600) |
| body | 15/22 | 400 | Subtitles, body |
| small | 13/18 | 400 / 600 | Labels (600), banners, errors, checklist |
| caption | 12/16 | 400 | Hints, Caps Lock |

- Tracking is size-specific: tighten large text (wordmark -0.5), leave body at 0. Codes and keys use monospace with letter-spacing.
- Font: system font until MJ approves Inter (tokens name Inter; mobile `theme.ts` uses system). Web must not still use the template's Geist font without a decision. *Check both apps use the same choice.*
- Respect user text size (Dynamic Type / browser zoom). Mobile caps growth at 1.6x so layouts don't break.

## 5. Colour (verified contrast, 2026-10-05)

I computed these from `tokens.ts` (WCAG formula). AA needs **4.5:1** for normal text, **3:1** for large text (≥ 24px, or ≥ 18.66px bold) and for UI component edges.

| Pair | Ratio | Verdict |
|---|---|---|
| text / white | 17.73 | ✅ |
| textSecondary / white | 9.35 | ✅ |
| textMuted / white, bg, surfaceMuted | 6.78 / 6.49 / 6.25 | ✅ (fixes Pallav's failing muted grey) |
| white on primary (buttons) | 7.10 | ✅ |
| link / white, bg | 7.10 / 6.80 | ✅ |
| primary on violet-100 (status icon) | 6.01 | ✅ |
| danger / warning / success / info text on their tint | 5.30 / **4.51** / **4.57** / 5.49 | ✅ but warning and success are at the edge: never put them on any other background or at a lighter weight |
| success on surfaceMuted (checklist ticks) | 4.62 | ✅ |
| white on brand gradient (all 3 stops) | 15.81 / 8.98 / 7.10 | ✅ |
| onBrandMuted (82% white) on gradient | 10.89 / 6.50 / 5.25 | ✅ |
| inputBorder / white | 3.42 | ✅ meets 3:1 for field edges |
| border, borderStrong / white | 1.26 / 1.49 | Decorative only. OK for the card edge and SecondaryButton (its text names it). **Never** the only edge of an input or checkbox |
| focusRing (35% violet) / white | 1.57 | Fails alone. OK because the 2px primary border (7.10) comes with it. A focus style that shows only the ring is a finding |
| gold dot on gradient end | 2.94 | Decorative, OK. Never use gold for text on the gradient |

Colour rules:
- Screens use **semantic** tokens (`primary`, `textMuted`, `danger.fg`), not the raw violet scale, except where the agreement names one (violet-100 icon circle, violet-800 avatar text).
- No hard-coded hex values in screen code. Every hex outside `tokens.ts` is a finding.
- Colour is never the only signal: errors have an icon + text; checklist rows change icon *and* colour.
- **Night mode follows the device**, no toggle (MJ, 2026-10-05). Night colours only from tokens, as in [09](09-PALLAV-DESIGN-SPEC.md) §10. Both modes must pass AA.

## 6. Motion

From the agreement §4 and Apple's fluid-interface principles:

| Rule | Check |
|---|---|
| Fast and calm | Step change 220 ms ease-out; outgoing card 120 ms; button press scale 0.98 in 120 ms |
| Spatial consistency | Forward = new card comes from 8px right; Back = from 8px left. Same path both ways |
| Never block input | No "wait for animation to finish" before a field can be typed in or a button pressed |
| Feedback on press-down | Buttons show pressed state at once, not after release |
| No shake on error | Errors fade in (120 ms). Shaking is not allowed (agreement) |
| Reduced motion | Fade only, no slide; spinner stops spinning. Must be wired to the OS setting on both platforms |
| Only transform + opacity | Web animations should animate `transform`/`opacity`, not `height`/`top` (except the mobile header height, which the agreement names) |

## 7. Pallav problems we must not repeat

From the Pallav review §6. Each one is a finding if seen:
1. Muted text failing contrast. 2. "Rs" or Western grouping for money (later features). 3. Mixed 12/24-hour time. 4. Centred numbers. 5. Inline styles and `!important` everywhere. 6. No phone layout. 7. Gradients on every button, moving blobs, live clocks (only the brand panel/header has a gradient). 8. Hidden scrollbars. 9. Random spacing and many breakpoints. 10. Pages that ignore the theme.

## 8. Critique format I use

From `design:design-critique`, kept short for teams:

```
### <Screen> - critique
First look: <what the eye lands on; right or wrong>
Works well: <1-2 things>
| Finding | Severity | Fix |
```
Be specific ("the Forgot link sits 24px from the field; agreement wants it right under it"), say why, give the fix, and name what works.

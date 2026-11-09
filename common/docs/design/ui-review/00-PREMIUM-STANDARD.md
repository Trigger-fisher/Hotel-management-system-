> **AMENDED 2026-10-06 (MJ):** copy Pallav exactly; motion is calm and minimal (no springs, shimmer, slide transitions or decorative movement); day/night is a user toggle (Pallav's moon button, remembered per user, first visit follows the device); a global smart search is added. Where this file praises motion or says night follows the device only, `14-AFTER-POSTGRES-UI-BRIEF.md` and `13-PALLAV-PARITY.md` win.

# 00 - The HMS Premium UI Standard

**MJ, 2026-10-05:** "create an high standards for the UI if you get the report and the UI does not good that feels premium then give task back to them until you are satisfied."

Scope: **frontend only** (screens, components, styles, motion, accessibility, client behaviour on the mock). See [README.md](README.md).

This is the bar. Meeting the spec ([07-CHECKLIST-AUTH-S02.md](07-CHECKLIST-AUTH-S02.md)) is the **floor**. Feeling premium is the **pass**. Work goes back to the team until it passes. There is no round limit (MJ's word replaces the Lead's 3-round cap for UI quality). If the **same** item fails 3 times, I tell the Lead and MJ with 2 options (MASTER 6.3), and the work keeps going back.

## 0. The design baseline (MJ, 2026-10-05)

The auth screens must be **the exact Hotel Pallav design, improved**, as one page: [09-PALLAV-DESIGN-SPEC.md](09-PALLAV-DESIGN-SPEC.md). Where that spec and this file differ, the spec wins (e.g. the primary button keeps Pallav's gradient and hover sheen). A screen that drifts from the Pallav look scores 3 or less on D1 and goes back.

## 1. What "premium" means for HMS

Premium is **not** more decoration. Hotel Pallav had gradients on every button, moving blobs, and a live clock; it felt busy, not premium. Premium is:

| Quality | In one line |
|---|---|
| **Calm** | One clear thing to do on each screen. Lots of air. Nothing shouts. |
| **Precise** | Every gap, size and colour comes from the tokens. Edges line up. Nothing is "about right". |
| **Responsive** | Every press, focus and change answers at once and smoothly. Nothing jumps, flickers or freezes. |
| **Trustworthy** | Clear words, honest errors, safe defaults. It feels like a bank, not a template. |
| **Complete** | Every state is designed: loading, empty, error, offline, slow, long names, big text, small phone. |
| **One product** | Web and mobile look and behave like the same brand, each feeling native to its platform. |

The products to measure against (feel, not copy): Stripe Dashboard sign-in, Linear, Apple Account, Mews and Cloudbeds (hotel SaaS), Notion. If our screen sits next to theirs and looks cheaper, it is not done.

## 2. The scorecard (how I decide "satisfied")

Every screen is scored 1-5 on each of the 10 dimensions below, on **both** apps.

**Pass = no dimension below 4 on any screen, and an average of 4.5 or more per app.** Anything below that goes back with the reasons.

| Score | Meaning |
|---|---|
| 5 | Premium. I would show it to MJ as an example. |
| 4 | Polished. Small notes only. |
| 3 | Works and matches the spec, but feels ordinary or has visible rough edges. **Goes back.** |
| 2 | Noticeable problems. **Goes back.** |
| 1 | Broken or off-spec. **Goes back.** |

| # | Dimension | 5 looks like |
|---|---|---|
| D1 | **First impression** | In 2 seconds it reads as a confident, modern, hotel-grade product. The brand panel/header feels intentional and rich, but quiet. |
| D2 | **Hierarchy and layout** | Eye goes title → first field → primary button without effort. One primary action. Card sits balanced in its space at every width. |
| D3 | **Typography** | Clean type scale, no awkward wraps (titles balanced, no one-word last lines), tight tracking on large text, readable line lengths, codes in monospace with spacing. |
| D4 | **Spacing and alignment** | 4px rhythm everywhere. Left edges line up (labels, inputs, banners, buttons). Labels, Show button and input text share a centre line. Equal padding on all sides. |
| D5 | **Colour and depth** | Tokens only. Soft layered shadow on the card, crisp 1px borders, no muddy greys, no pure black. Gradient smooth (no banding). Status colours used sparingly. |
| D6 | **Motion and feedback** | Press feedback at touch-down. Step changes glide (220 ms) and never block typing. Focus ring is crisp. Banners fade in. Reduced-motion version is just as clean. |
| D7 | **Copy and tone** | Words straight from `copy.ts`, never cut off, never "{placeholder}". Errors are calm and helpful. |
| D8 | **States and robustness** | Loading, busy, error, offline, rate-limit, slow, success all designed, not afterthoughts. No layout jump when an error or banner appears. |
| D9 | **Accessibility** | Contrast, focus, labels, announcements, 44px targets, large text: all pass, and it still looks premium at 200% zoom / largest text. |
| D10 | **Platform craft and parity** | Web feels like a great web app (hover, keyboard, cursor), mobile like a great native app (safe areas, keyboard, haptic-quality press, Android back). Both clearly one brand. |

## 3. Instant send-back list (any one = goes back, whatever the score)

**Leftovers and cheapness**
1. Template leftovers anywhere: "Create Next App" title, Next/Vercel/Expo logos, default favicon or splash, Geist font without a decision, `Welcome to Expo`, unused template files.
2. Browser- or OS-default looking controls: default blue focus outline, system blue links, unstyled checkbox, default `<select>`, default scrollbars appearing during transitions.
3. Emoji or mixed icon sets; icons with different stroke weights or sizes on the same screen; blurry or stretched icons/QR.
4. Hard-coded colours, sizes or strings in screen code (anything not from `tokens.ts` / `copy.ts`).

**Jank**
5. Layout shift: content jumps when an error, banner, Caps Lock warning or checklist appears; button changes width when it becomes busy; card height snaps between steps instead of easing.
6. Flash: wrong theme flashes on load, unstyled text flashes (font swap jump), white flash between steps, keyboard covering the field or button on mobile.
7. Input blocked during an animation, or a double tap that sends two requests.
8. Anything that stutters (dropped frames) on a mid-range Android phone or in the mobile web build.

**Sloppiness**
9. Text touching card edges; uneven padding; things that are "nearly" aligned (1-3px off).
10. Truncated or wrapped-badly text at 360px width, at 200% zoom, or with large system text.
11. A state that looks unfinished: spinner with no text, empty white card while loading, raw error, `undefined`, `NaN`, `{name}`.
12. Web and mobile showing the same step differently without an allowed reason (agreement §K5).

**Rule breaks**
13. A day/night **toggle** (MJ: none). Night mode that doesn't follow the device, isn't on every screen, or fails AA / looks flat at night (night mode follows the device (MJ, 2026-10-05; [09](09-PALLAV-DESIGN-SPEC.md) §10)).
14. Shake on error. Six separate OTP boxes. Placeholder used as a label. Paste blocked.
15. Any lint, type or build failure.

## 4. Premium details I look for (the difference between 4 and 5)

**Brand area**
- Gradient is smooth and deep (#2A0F5E → #5B21B6 → #6D28D9), with no visible banding on a large desktop panel.
- Wordmark crisp, tight tracking (-0.5), gold dot aligned to the baseline, not floating.
- Headline balanced over 2 lines on desktop; brand points evenly spaced with check icons optically centred on the first line of text.
- On mobile, the header collapses full → compact smoothly. The card overlap (24px) looks deliberate, with the shadow carrying the depth.

**Card and fields**
- Card shadow is soft and layered (`shadow.lg`), never a hard grey edge.
- Inputs: 48 tall, text 16px, the Show/Hide button text sits on the same centre line as the input text, with a 44px hit area that does not change the input height.
- Focus: 2px violet border + soft 3px ring, the same on every control. The ring never gets clipped by a parent `overflow: hidden`.
- Error state: red border + icon + text appear with no jump (space reserved or smooth height ease).
- Password checklist ticks change with a quick, subtle transition, not a flicker.
- Code field: digits evenly spaced, monospace, centred or left-aligned the same on both apps.

**Buttons**
- Primary: solid violet, 48 tall, 14 radius, semibold 16. Hover darkens (web), press scales 0.98 at touch-down.
- Busy: spinner + busy text, **same width as before**, no layout shift.
- Disabled looks disabled (50%) but still readable.
- Links: violet, semibold, underline on hover/focus only (web), 44px tall hit area.

**Motion**
- Forward from the right, back from the left, 8px, 220 ms ease-out. Outgoing fades in 120 ms. No overlap where two cards stack visibly.
- Card height eases between steps of different length (no snap).
- Under reduced motion: clean cross-fade only, spinner static.

**Small screens and edge cases**
- 360px phone: card fits with 16px side margins, no sideways scroll, keyboard never hides the primary button (scrolls into view).
- Long names ("Venkatanarasimharajuvaripeta Kumaraswamy"), long hotel names, long emails: wrap cleanly, never break the layout.
- 200% zoom (web) and largest text (mobile): still tidy.
- Slow network (`slow@demo.hms`, 4 s): busy state looks calm, not frozen.

**Signed-in placeholder**
- App bar crisp (64 web / 56 mobile + safe area), avatar initials centred, name hidden under 640px.
- Role card looks like a real product card (radius 18, soft shadow, dashed placeholder neatly centred), not a debug box.

## 5. What I need in every team report (or it goes back unread)

1. Gates output: lint, type check, build (web) / lint, type check, Expo runs (mobile).
2. **Screenshots of every step**: web at 1440 and 390 wide; mobile on a phone (or Expo web at 390). Plus: one error state, the offline banner, busy button, and recovery codes.
3. How to run it, and which demo account shows which step.
4. Their own self-score on the 10 dimensions, with the weakest screen named.
5. Open questions.

## 6. How I send work back

```
## UI Review - <team> - round <n> - NOT YET PREMIUM
Score: avg <x.x>, lowest <D#> on <screen> (<n>)
Instant send-back items: <list or none>
| # | Severity | Screen | Dimension | File:line | What I see | What premium looks like / fix |
Next: fix all "must fix" + every item scored below 4, send new screenshots of the changed screens.
```

When it passes: "UI Review - <team> - PASSED (avg x.x, lowest x)" and the team stops. When both pass, one short report goes to the Lead ([08-REVIEW-PROCESS.md](08-REVIEW-PROCESS.md)).

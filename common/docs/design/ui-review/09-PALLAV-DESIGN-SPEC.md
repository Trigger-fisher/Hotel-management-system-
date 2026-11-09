# 09 - Auth screens = the exact Pallav design, improved (web + mobile)

**MJ, 2026-10-05:** "here is my current UI that I liked but you have to make it more premium" (https://github.com/Mihir-Jungiwala/hotel-pallav-account) → "I want the exact design of that, in both, and improved version. Give the changes to both."

This file **overrides the look in `S02-ui-agreement.md` §1-§4** wherever they differ. Behaviour, steps, states, copy keys, accessibility rules and the reducer stay as agreed. We copy the **look only**, never Pallav's code (MASTER §8).
Values checked in the Pallav source: `public/assets/auth.css`, `pms.css`, `pms-ui.css`, `password.css`, `resources/views/auth/*.blade.php`.

Legend: **[P]** = exact Pallav value. **[+]** = improvement, with the reason. Only real faults are improved; the character stays Pallav.

## 0. One page, no reloads (MJ: "convert that same design in here in SPA")

Pallav has 4 separate pages (login, email code, forgot password, change password), and each one reloads the whole violet page. HMS turns this same design into **one page**:
- Web: one route `/`. Mobile: one screen. The **violet page, rings, brand row, card frame and copyright never reload or move**. Only the **card content** changes, with the 220 ms fade + 8px slide, and the card height eases to the new content.
- All 16 steps (agreement §5) live inside that one card. Pallav's 4 pages map to: login → signIn; email code → twoFactor (an authenticator code in HMS); forgot → forgotPassword + forgotPasswordSent; change password → changePassword / resetPassword / acceptInvite.
- Browser Back / Android back move between steps (agreement §9). Email links open straight into their step on the same page.
- The card's first entrance (380 ms rise) plays once, when the page first loads, not on every step.

## 1. Page (both apps)

| Part | Spec |
|---|---|
| Background | **[P]** Three layers, full screen, static: `radial-gradient(900px 600px at 15% 0%, rgba(139,92,246,.45), transparent 60%)`, `radial-gradient(800px 600px at 100% 100%, rgba(124,58,237,.55), transparent 60%)`, `linear-gradient(160deg, #2A0F5E 0%, #4C1D95 50%, #5B21B6 100%)`. Solid `#2A0F5E` underneath (also the browser/status bar colour) |
| Rings | **[P]** Two static circles behind everything, 1px border `rgba(255,255,255,.08)`: 720px top-right (right -260, top -300) filled `radial-gradient(circle, rgba(196,181,253,.14), transparent 65%)`; 560px bottom-left (left -220, bottom -280) filled `radial-gradient(circle, rgba(201,162,39,.08), transparent 65%)` (the gold touch). Never animated |
| Layout | **[P]** Brand row, then the card, then the copyright line, centred as one column, max width 420, page padding 40/16. Phone ≤ 480: aligned to the top, page padding 28/16 |
| Theme | Day and night follow the device automatically, **no toggle** (MJ). Night values in §10 |

**Removed from the S02 agreement** (not in Pallav): the 45% left brand panel with headline and 3 points (web), the full↔compact gradient header (mobile), the gold dot after the wordmark. `copy.brand.headline/points/footer` are no longer shown on auth screens.

**Mobile app:** the same page fills the screen behind a scroll view; safe areas respected; light status-bar text. RN 0.86: gradients via `experimental_backgroundImage` (native) / `backgroundImage` (web). Check the installed `StyleSheetTypes.d.ts` for `radial-gradient` support; if it isn't supported, draw each glow as a large absolutely-positioned circle with a soft radial fill using the same colours and positions. **No new library.**

## 2. Brand row (above the card)

| Part | Spec |
|---|---|
| Row | **[P]** Horizontal, gap 12, margin-bottom 22 (phone 18), white text |
| Mark (tile) | **[P]** 46×46, radius 14, background `rgba(255,255,255,.14)`, 1px border `rgba(255,255,255,.24)`, shadow `0 8px 24px rgba(20,6,50,.35)`, text 15px / 800 / -0.01em white |
| Name | **[P]** 18px / 800 / -0.02em, line-height 1.15, white |
| Tagline | **[P]** under the name, margin-top 3, 10px / 700 / letter-spacing .1em, UPPERCASE, `#DCC9FF` (5.9:1 or better ✅) |
| Text | Pallav: mark "HP", name "Hotel Pallav", tagline "Management Suite". **HMS text comes from `copy.ts` (Lead adds the keys).** Recommended: mark "H", name "HMS", tagline "Hotel Management Suite" |
| [+] One font | Same font as the rest of the screen (Pallav mixed Inter and Playfair for the brand) |

## 3. Card

| Part | Spec |
|---|---|
| Box | **[P]** white, full width of the column (max 420), radius 24 (phone ≤ 480: 18), border 1px `rgba(255,255,255,.6)`, shadow `0 30px 70px -20px rgba(20,6,50,.6), 0 8px 24px rgba(20,6,50,.25)`, padding 34 / 32 / 26 (phone 26 / 20 / 20) |
| Entrance (first show) | **[P]** fade + rise 8px, 380 ms, `cubic-bezier(.16,1,.3,1)` |
| [+] Step change | Inside the SPA the card stays; its content changes with the agreed 220 ms fade + 8px slide (forward from right, back from left), and the card height eases. Pallav reloaded the page instead |
| Reduced motion | **[P]** no entrance movement; [+] step change becomes a plain fade |

## 4. Inside the card, top to bottom

| # | Part | Spec |
|---|---|---|
| 1 | Offline banner | When offline, the info note (§5 notes) at the very top |
| 2 | **Step pill** | **[P]** inline pill, margin-bottom 10, padding 3/9, radius 999, background p50 `#F7F4FF`, text p700 `#6D28D9` (6.5:1 ✅), 10.5px / 800 / letter-spacing .07em, UPPERCASE. Only on multi-step flows (e.g. "Step 2 of 2"). Text from `copy.ts` (Lead adds keys) |
| 3 | [+] Status icon | Only on result screens without a form (forgotPasswordSent, resetDone, linkProblem, locked, sessionEnded): the agreed 48px p100 circle with a 24px p700 icon, above the title. Helps scanning; Pallav used notes only |
| 4 | **Title** | **[P]** 25px / 800 / -0.03em, line-height 1.2, ink `#1B1235` (phone ≤ 480: 22px) |
| 5 | **Lead** | **[P]** 13.5px, line-height 1.55, margin 6 above / 22 below, colour muted. [+] Use token `textMuted #5E5775` (6.8:1) instead of Pallav's `#7A7392` (4.47, fails AA). `<strong>` inside it: ink2 `#4A4262`, 700 |
| 6 | Form note (banner) | §5 notes, margin-bottom 16 |
| 7 | **"Who" chip** | **[P]** shows who you are instead of asking again. Height 42 [+ 48], radius 11, 1px border p200-ish `#D9CEF6`, background `#FBF9FF`, padding 0 12 0 6, gap 10. Icon tile 30×30 radius 8, p100 background, p700 icon 14px. Name 14px / 700 ink, one line, ellipsis. Use on: twoFactor + recoveryCode (identifier typed), resetPassword (`maskedEmail`, replaces the `forAccount` line), acceptInvite (`forAccount` email), screenLocked (user's name, initials in the tile, replaces the 56px avatar) |
| 8 | Fields | §5 |
| 9 | **Primary button** | §5, margin-top 6 above it [+ 24 when it follows a checklist] |
| 10 | Secondary links | **[P]** centred, margin-top 10 (e.g. "Send again", "Use a recovery code"), link style §5 |
| 11 | Fine print | **[P]** 12px muted, centred, line-height 1.5, margin-top 12 |
| 12 | **Card footer** | **[P]** margin-top 22, padding-top 16, 1px top border `#E9E2FA`, 12.5px muted, centred (e.g. `signIn.noAccount`) |
| — | **Copyright** (under the card) | **[P]** margin-top 22, 12px, "© {year} HMS" (Lead adds key). [+] white at **72%** (Pallav 55% = 3.7:1 on the lighter violet, fails AA; 72% = 5.4:1 ✅) |

## 5. Components

| Component | Spec |
|---|---|
| **Label** | **[P]** 13px / 600, ink2 `#4A4262`, letter-spacing -0.004em, margin-bottom 6 |
| **Label row** | **[P]** label left and a link right on the same line (baseline aligned). Used for Password + "Forgot password?" on signIn (replaces "link under the field") |
| **Input** | **[P]** radius 11; leading icon 14px muted at 12px from the left, text padding-left 36; hover border p300 `#C6B0FB`; focus border p500 `#8B5CF6` + ring `0 0 0 3px rgba(139,92,246,.22)`; transitions 220 ms. [+] **Height 48** (Pallav 42) and **text 16px** (Pallav 14 zooms on iPhone). [+] Resting border = token `inputBorder #8F86A8` (Pallav `#D9CEF6` is 1.5:1; field edges need 3:1) |
| Leading icons | identifier: person · password: lock · email: mail (envelope) · code: shield · recovery: key |
| **Reveal (Show/Hide)** | **[P]** eye icon button inside the right edge: 30×30 visual, radius 8, muted icon; hover p50 background + p700 icon; input padding-right 40. [+] Hit area 44×44 (invisible padding). Screen reader name `copy.common.showPassword` / `hidePassword`. Eye ↔ eye-slash icon |
| Caps Lock (web) | **[P]** small warning line under the field, as agreed |
| **Code field** | **[P]** one input, height 56, text 26px / 700, letter-spacing 12px, centred, monospace digits. Recovery code: same box, letter-spacing 4px so 11 characters fit. **Not** six boxes |
| **Primary button** | **[P]** full width, radius 12, white text, gap 8, label + trailing **arrow-right icon** on forward actions (Sign in, Verify, Continue, Save…); arrow nudges 3px right on hover; shadow `0 1px 2px rgba(91,33,182,.24), 0 6px 18px rgba(124,58,237,.28)`; hover lifts 1px + shadow `0 2px 4px rgba(91,33,182,.22), 0 12px 28px rgba(124,58,237,.36)` + one sheen sweep (`linear-gradient(110deg, transparent 30%, rgba(255,255,255,.26) 50%, transparent 70%)`, 900 ms, web hover only); press scale .97. [+] Fill `linear-gradient(140deg, #7C3AED, #5B21B6)` (p600→p800); hover `linear-gradient(140deg, #6D28D9, #5B21B6)`. Pallav's p500→p700 puts white text at 4.2:1 (hover 2.8:1), which fails AA. [+] **Height 48** (Pallav 44), text 15px / 600. [+] Busy: spinner + busy text, same width, opacity .72, no sheen. [+] Sheen and lift are off under reduced motion |
| **Secondary button** | **[P]** outline: white, 1px border, p700 text; pressed p50 background with p400 border. Height 48, radius 12 |
| **Link** | **[P]** 12.5px / 600, p700, no underline; hover p800 + underline. [+] 44px tall hit area without changing the look. "‹ Back to sign in" uses a leading chevron |
| **Notes (banners)** | **[P]** flex, gap 9, radius 11, padding 10/12, 13px / 1.45, icon 15px, 1px border. Success `#F0FDF4` / border `#BBF7D0` / text `#166534` (6.8:1 ✅). Error `#FEF2F2` / `#FECACA` / `#991B1B` (7.6:1 ✅). Info / warning use the token tones in the same shape. Danger is `role="alert"` |
| **Aside (hint box)** | **[P]** p50 background, radius 11, padding 10/12, gap 9, 12.5px / 1.5 ink2 text, 14px p500 icon, margin-top 16. Use for: `locked.shareHint`, `twoFactor.rememberDeviceWarning`, `recoveryCode.lost`-style help |
| **Password rules** | **[P]** list in a **2-column grid** (gap 5 / 14), 12.5px muted, 13px circle icon; met = green `#15803D` with a filled check; after a failed save, unmet rules turn red `#B91C1C`. [+] **1 column under 400px** (7 rules are too long for 2 columns on a phone). [+] **No nudge/shake** (agreement: no shake). [+] Live updates announced politely |
| **Match line** | **[P]** under "Re-enter new password": 12.5px, muted, turns green with a check when both match (Lead adds the copy, e.g. "Passwords match") |
| Checkbox (remember device, saved codes) | 20px box radius 6, 1.5px `inputBorder`, checked = p700 fill + white tick; whole row ≥ 44 tall; label 13px ink2 |
| **Spinner / loading** | Card body: centred 22px p600 ring spinner + the step's `loading` text in 13.5 muted |

## 6. Mobile-specific (Pallav had no app; this is its phone layout, made native)

| Part | Spec |
|---|---|
| Layout | The phone layout (≤ 480) above: violet page full screen, brand row near the top under the safe area, card below it, copyright under the card |
| Keyboard | Scroll view keeps the focused field **and** the primary button visible; the brand row may scroll away. `keyboardShouldPersistTaps="handled"` |
| Press feedback | Pallav's hover effects become press states: button scale .97 at touch-down, link opacity .6, reveal button p50 background while pressed. No sheen on mobile |
| Shadows | Use the same shadow values (iOS shadow props / `boxShadow` on RN 0.86); Android must still look deep, not flat |
| Icons | expo-symbols names with the same meaning as the web icons (person, lock, envelope, shield, key, eye/eye.slash, arrow.right, chevron.left) |

## 7. signedIn placeholder (both)

| Part | Spec |
|---|---|
| Page | App background `#FBF9FF` |
| App bar | Pallav's top bar look: a white glass card `rgba(255,255,255,.82)` + `blur(16px) saturate(170%)` (web; mobile solid white), radius 22, 10px gutter from the screen edges, sticky; brand mark (§2, but p700 tile with white letter) + name on the left, avatar + name on the right (name hidden < 640) |
| Content | Welcome title 25/800/-0.03em ink; subtitle 13.5 muted; role card white, radius 18, Pallav `--sh-sm`-style soft violet shadow, dashed placeholder box; Lock screen (secondary) + Sign out (link) |
| Not now | No sidebar or menu (that belongs to later features, R1) |

## 8. What is NOT copied from Pallav (and why)

| Pallav | Why not |
|---|---|
| Pallav's two conflicting dark palettes and flat dark button | One night palette, same gradient button (§10) |
| Six-digit OTP faked with letter-spacing in a 42px field | Kept as one big 56px field; that part *is* copied. Six separate boxes are **not** used (breaks paste, WCAG 2.2 3.3.8) |
| Shake ("nudge") on the password rules | Agreement: no shake |
| Breathing logo, pinging dot, live clock, weather, spinning icons (app shell) | Constant motion feels cheap; not part of the auth screens anyway |
| White-on-light-violet text in the button, 55% white copyright, `#D9CEF6` input border, `#7A7392` muted text, 42px inputs with 14px text | Fail WCAG AA or zoom on iPhone; fixed in [+] rows above |

## 10. Night mode (MJ, 2026-10-05)

MJ: "you can improve that specially night mode", then chose: **follow the device setting automatically, no toggle**, on **all current screens** (16 auth steps + signedIn), web and mobile. This replaces "light only" in MASTER/the agreement; the **no-toggle** rule stays.

Base: Pallav's own night palette (`auth.css` dark block + `pms-dark.css`). [+] Pallav had **two conflicting dark palettes** (`pms-dark.css` vs `pms-dash.css`) and a **flat** dark button that didn't match day mode. HMS uses **one** palette, the **same** gradient button in both modes, and every pair below is AA-checked (computed 2026-10-05).

| Part | Day (above) | Night |
|---|---|---|
| Page gradient | #2A0F5E → #4C1D95 → #5B21B6 | **[P]** `linear-gradient(160deg, #1A0B3B 0%, #2E1065 55%, #3B1373 100%)` |
| Glows | .45 / .55 | **[P]** `rgba(124,58,237,.35)` top-left, `rgba(91,33,182,.45)` bottom-right |
| Rings | white .08 border, lilac .14, gold .08 | [+] border white .06, lilac `rgba(196,181,253,.10)`, gold `rgba(201,162,39,.06)` (dimmer so they don't glow) |
| Brand row, tagline, copyright | white, #DCC9FF, white 72% | Same (≥ 7.7:1 on the night violet) |
| Card surface | white | **[P]** `#15111F` |
| Card border | white .6 | **[P]** 1px `#33294B` + [+] inset top highlight `inset 0 1px 0 rgba(255,255,255,.04)` (the card edge must read against the deep violet) |
| Card shadow | violet shadow | [+] `0 30px 70px -20px rgba(0,0,0,.6), 0 8px 24px rgba(0,0,0,.35)` |
| Inset surface (inputs, who chip, code box) | white / #FBF9FF | **[P]** `#1B1628` |
| Hairlines (card footer, dividers) | #E9E2FA | **[P]** `#261F38` |
| Title / strong text | ink #1B1235 | `#EFEAFB` (15.8:1) |
| Labels, aside text | ink2 #4A4262 | `#C6BEE2` (10.5:1) |
| Lead, hints, muted | #5E5775 | `#9A92B8` (6.3:1; 6.0 on inset) |
| Input border (resting) | #8F86A8 | [+] `#7A6F9C` (3.8:1 on inset; Pallav's `#33294B` is 1.3:1) |
| Input hover / focus | p300 / p500 + ring .22 | hover `#4C3A85`; focus border `#A78BFA` (6.5:1) + ring `0 0 0 3px rgba(167,139,250,.35)` |
| Leading icons, reveal icon | muted | `#9A92B8`; reveal pressed/hover bg `rgba(139,92,246,.14)`, icon `#DDD6FE` |
| Links | p700 | **[P]** accent ink `#C4B5FD` (10:1); hover `#DDD6FE` + underline |
| Step pill | p700 on p50 | bg `rgba(139,92,246,.18)`, text `#DDD6FE` (10.9:1) |
| Status icon circle | p100 / p700 | bg `rgba(139,92,246,.18)`, icon `#C4B5FD` |
| Primary button | p600→p800 gradient | [+] **same gradient** (white 5.7:1) + shadow `0 6px 18px -8px rgba(124,58,237,.7)`; hover p700→p800, lift + sheen as day |
| Secondary button | white, p700 text | **[P]** transparent, text `#C4B5FD`, border `#4C3A85`; hover bg `rgba(124,58,237,.14)`, border `#7C5CF0`, text `#EDE9FE` |
| Notes | Pallav light tones | **[P]** success bg `rgba(21,128,61,.16)` border `rgba(21,128,61,.35)` text `#86EFAC`; error `rgba(185,28,28,.16)` / `.35` / `#FCA5A5`; [+] info `rgba(59,130,246,.16)` / `.35` / `#93C5FD`; warning `rgba(217,119,6,.16)` / `.35` / `#FCD34D` (all ≥ 8.5:1) |
| Aside | p50 / ink2 | bg `rgba(139,92,246,.10)`, text `#C6BEE2`, icon `#A78BFA` |
| Password rules | green / red | met `#86EFAC`, unmet muted `#9A92B8`, after failed save `#FCA5A5` |
| Checkbox | p700 fill | border `#7A6F9C`; checked fill `#7C3AED` + white tick |
| **QR code** | dark on white | **Stays dark-on-white** in its own white box with 12px padding (scanners need it) |
| Recovery codes box | surfaceMuted | `#1B1628`, codes `#EFEAFB` monospace |
| signedIn page | #FBF9FF | **[P]** `#0D0A14`; app bar glass `rgba(21,17,31,.82)` + blur 16 (mobile solid `#15111F`), border `#261F38`; role card `#15111F` + `#33294B` border; dashed box `#33294B` |
| Idle-warning dialog | white | `#15111F`, border `#33294B`, scrim `rgba(5,3,10,.6)` |

How it switches:
- **Web:** CSS `@media (prefers-color-scheme: dark)` (Tailwind's default `dark:` variant is fine for this), `viewport.colorScheme: 'light dark'`, `<meta name="theme-color">` for both modes. **No toggle**, no stored choice. The switch is instant (no animated theme fade, no flash: styles are CSS, so the first paint is already correct).
- **Mobile:** `useColorScheme()` from react-native; `app.json` `userInterfaceStyle` changes from `"light"` to `"automatic"` (Mobile UI owns app.json); status-bar text stays light (the page is violet in both modes). Theme values come from one place (e.g. `theme.ts`) so screens never branch on the scheme themselves.
- All values come from tokens (Lead adds `auth.night` / night colour set). No hard-coded hex in screens.

Review: every screen is scored in **both** modes. A screen that looks premium by day but muddy or flat at night scores ≤ 3 on D5 and goes back.

## 9. Copy and token changes needed from the Lead (teams must not invent text)

1. Brand row: mark, name, tagline (recommended "H" / "HMS" / "Hotel Management Suite").
2. Step pill labels per multi-step flow (recommended: twoFactor and recoveryCode "Step 2 of 2"; setupTwoFactor "Step 2 of 3"; recoveryCodes "Step 3 of 3"; changePassword "Step 2 of 2").
3. Copyright line "© {year} HMS".
4. Match line "Passwords match".
5. Tokens: `#4C1D95` (gradient middle), the two glow colours, ring colours, card shadow, button gradient and shadows, title 25px, note tones, white-72% copyright. Teams use tokens only (no hard-coded hex in screens).

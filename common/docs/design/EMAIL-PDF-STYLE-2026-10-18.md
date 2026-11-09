# Email and PDF style, 18 Oct 2026

Written by Frontend 3 (claude-d6) as the record of the look that A (emails, f56de20) and Backend 2 (PDFs, 326df8a) built, plus the fixes from my review. Source of truth in code: `web-app/src/server/mail/layout.ts` (`MAIL_THEME`) and `web-app/src/server/documents/kit.ts` (`COLOR`). Both use the same palette.

## 1. Palette (both)

| Token | Value | Use |
|---|---|---|
| primary | `#5B21B6` | email header bar, button, PDF letterhead and table heads, titles |
| accent | `#7C3AED` | rules, quote bar, links on light |
| tint / band | `#F3EEFF` | code box, quote box, PDF title bands, totals box |
| zebra | `#FAF7FF` | PDF odd rows |
| ink | `#1E1B2E` | body text |
| muted | `#5B5770` | labels, notes, footer (7:1 on white) |
| line | `#D4C8EE` (was `#E4DCF5`) | every rule and border; `#E4DCF5` is 1.2:1 on white and vanishes on a black-and-white print |
| page (email) | `#F6F4FB` | outer background |
| dark (email) | page `#14121C`, card `#1E1B2E`, ink `#F3EEFF`, muted `#C9C2DE`, tint `#2A2540`, border `#3A3354`, link `#A78BFA` | `prefers-color-scheme: dark` |

Type: email = system stack (Segoe UI, Roboto, Helvetica), PDF = Inter. Numbers are tabular (equal-width digits) wherever they line up: PDF amounts and quantities, email detail values and codes.

## 2. Email layout (600 px, table-based, inline CSS)

| Part | Spec |
|---|---|
| Outer | page colour, 24 px top and bottom, 12 px sides |
| Header bar | primary, radius 12 12 0 0, padding 20 x 32; name 20/28 bold white; with a logo: logo sits on a white pill (padding 6 x 10, radius 6, height 40), never directly on purple |
| Card | white, padding 32 (20 on phones), radius 0 0 12 12 |
| Heading | 22/30 bold ink |
| Body | 16/24 ink, 16 px below each paragraph |
| Note | 14/20 muted |
| Code box | tint, border 1 px line, radius 8, padding 14 x 24, 30/36 bold primary, letter-spacing 6, monospace stack (`ui-monospace, Consolas, Menlo, monospace`) so 0/O and 1/l differ |
| Quote | tint, left bar 4 px accent, padding 12 x 16, 15/22 |
| Details table | border 1 px line, radius 8; rows padding 10 x 12, rules between rows; label 14 muted 38 %, value 15 bold ink |
| Button | one per mail, primary, radius 8, padding 13 x 28, 16/20 semi-bold white, tap height at least 46 px; full width and centred at 620 px and below |
| Footer | name 13 semi-bold muted, contact 12 muted, unsubscribe 12 with accent link, "Sent with EasyHotelSolutions" 11 |

Print and dark rules: header cell and button cell carry `-webkit-print-color-adjust:exact; print-color-adjust:exact` (otherwise a print drops the purple and the white name disappears); every footer paragraph carries the `hms-muted` class so dark mode lightens it; the footer link carries `hms-link`.

Sample (the pieces that changed; the rest is as built):

```html
<td bgcolor="#5B21B6" style="background:#5B21B6;padding:20px 32px;border-radius:12px 12px 0 0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <span style="background:#FFFFFF;border-radius:6px;padding:6px 10px;display:inline-block;"><img src="https://..." height="40" alt="Hotel Sunrise"></span>
</td>
...
<p class="hms-muted" style="margin:0 0 6px;font-size:13px;line-height:18px;font-weight:600;color:#5B5770;">Hotel Sunrise</p>
<a class="hms-link" href="..." style="color:#7C3AED;text-decoration:underline;">Unsubscribe</a>
<!-- in the <style> block -->
@media (prefers-color-scheme: dark){ .hms-link{color:#A78BFA !important;} }
@media only screen and (max-width:620px){ .hms-btn{display:block !important;width:100% !important;text-align:center !important;} }
```

## 3. PDF layout (A4, 36 pt margin, pdfkit, Inter)

| Part | Spec |
|---|---|
| Letterhead | full-bleed primary band at the top; hotel name 17 bold white, address and phone/GSTIN 8.5 `#E9DDFF`, centred; 3 pt accent strip under it |
| Title band | tint, 20 pt high, 3.5 pt accent bar on the left; title 10.5 bold primary; number and date right, 9 muted |
| Facts | two columns, label 8 muted, value 9 ink, 4 pt between rows |
| Table | head primary with 8 bold white labels, repeated per page; rows 8.5, zebra, rule 0.4 pt line colour; amounts right-aligned with tabular digits; rows never split |
| Totals box | right 54 %, tint, border 0.6 pt line, radius 4; labels 9 muted, amounts 9 ink; grand total 11 bold primary with a 0.6 pt primary rule above it |
| In words | 8.5 muted |
| Signatures | 0.6 pt accent line, label 8 muted |
| Footer | accent rule 0.6 pt at 30 pt from the bottom; "title - printed date" left and "Page X of Y" right, 7.5 muted; credit "Made with EasyHotelSolutions" 6.5 muted (not accent) centred |

Black and white: text on purple is white (prints as light on dark grey); zebra and lavender fills disappear on a mono print, so the table rules (`#D4C8EE`, 0.4 pt) and the totals box border carry the structure; nothing depends on colour alone.

## 4. Fixes asked of the builders (from the review of 18 Oct)

Email (A): footer classes for dark mode; logo on a white pill; print-colour-adjust on the header and button cells; full-width button on phones; monospace code; line colour `#D4C8EE`; tabular digits on detail values.

PDF (Backend 2): line colour `#D4C8EE`; tabular digits (`features: ["tnum"]` on text that holds numbers; Inter has the feature) in the table, totals and facts; grand total 11 pt with a rule above; credit line in muted; row padding +1.5 pt only if the bill stays one page (the theme test already checks it).

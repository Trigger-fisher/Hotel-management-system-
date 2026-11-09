# Desktop parity with the hotel account (18 Oct 2026)

MJ: on desktop, every role (guest, company, group console, platform console) follows the hotel account's design on every page, main and inner. We reuse the hotel components and classes and add no new look. Phone layouts stay as they are.

Method:
- Screenshots at 1280 of the mock (:3100), every main page per role, compared with Reservations, Company Profiles and Dashboard in the hotel account.
- A count of which kit pieces each folder uses (`groups/<role>/*.tsx`).

## The hotel patterns (the reference)

| Part | Hotel account |
|---|---|
| Page head | Top-bar card (icon, section, title). Under it, `PageHead`: the purple `pms-sub` sentence on the left; search and the main button on the same row, right |
| KPI tiles | `KpiGrid` / `Kpi`: icon, upper-case label, value, a chip under it (e.g. "On record") |
| Filters | `bm-tabs` card with tabs and counts (Upcoming, Arriving today…); `bm-fbar` "Narrow down" selects under it |
| Lists | `sh-card` rows (label over value, caret to expand) or a card with a `table-responsive` table (upper-case heads) |
| Pager | `Pager`: "Showing 1-11 of 11 · ROWS 25 · ‹ 1 ›" inside a card foot |
| Forms | `FormSection` (icon + purple upper-case title + hint) inside a card; `st-card` with `st-foot` and Save for settings |
| Detail pages | Card header with name and status; sections as cards; actions in the head |
| States | `PageSkeleton`, `EmptyState` (icon, title, text, action), `LoadError` with Try again |
| Dialogs | `Dialog` (Pallav modal; bottom sheet on the phone) |

## Gap list per role

### Guest (C): the largest gap. Every page is built with the portal's own `pt-*` parts (`PtSection`, `PtLoad`, `PtLine`, `pt-card`, `PortalButton`) and none of the hotel parts

| Screen | Differs how | Fix (reuse) |
|---|---|---|
| Dashboard | Gradient "Welcome back" hero, a "What you can do here" tip card, quick-action tiles and `PtSection` headings ("Coming up", "Your bills") with the sub on the right. No `pms-sub` page head | `PageHead` sub; keep the KPIs (they already look like `Kpi`); lists as a card with `sh-h` header and "See all"; drop the hero to a `pms-sub` line plus the TO PAY KPI; quick actions become head buttons |
| Bills | The page's sentence sits BELOW the pay cards; hotel and status filters are pill chips; the count line "13 bills, latest first"; pager "Showing 13 of 13" with no rows/pages; the "Cancelled" chip wraps to two lines | `PageHead` first; filters as `bm-tabs` (status) + `bm-fbar` select (hotel); `Pager`; status chip `nowrap` |
| Bills, pay panel | Dark gradient "All selected bills together" bar: a new look | `cb-card`-style summary card with the Pay button in its foot (as Shift Handover's total) |
| Bill (detail) | `PtSection` and `pt-card` | Hotel detail pattern (card head with the bill number and status; lines table in a card) |
| History | Hotel pills; the Statement card has a bare h3 and plain labels; plain pager | `bm-tabs`/`bm-fbar`; Statement as a `FormSection`; `Pager` |
| Order to room | `PtSection` h2 plus a grey sub on the right; a plain list | `PageHead` sub; hotel choice as `sh-card` rows or `EmptyState` when none |
| My profile | `pt-card pt-formcard` and `PtLine` rows | `FormSection` cards (as hotel My Profile) |

### Company (C): close; the shared portal parts are the gap

| Screen | Differs how | Fix (reuse) |
|---|---|---|
| All lists (Due bills, Payment history, Ledger) | Hotel filter as pill chips; period as underline tabs outside a card (Ledger); a count line; pager "Showing N of N" | `bm-tabs` card + `bm-fbar` hotel select; `Pager` |
| KPI tiles | No chip under most values (Dashboard 3 of 4, Due bills, Ledger) | `Kpi` `note` chip ("6 open bills", "This month") |
| Dashboard | Matches (cards with header, KPIs) | Chips only |
| Company profile | The form sits on the page background (no card); a "Sample Traders" name card; `PtLoad` | `FormSection`s inside one card with the save bar in its foot; name and hotel in the card head |
| Bill (detail) | `PtSection` / `pt-card` (as guest) | Hotel detail pattern |
| Notifications | `PageHead` already; list via `PtLoad` | `sh-card` rows, `Pager` |

### Group console (claude-62): close to the hotel

| Screen | Differs how | Fix |
|---|---|---|
| My hotels | Search and Invite sit on their own row under the sentence (hotel: same row) | `PageHead` actions slot |
| Dashboard, Invitations, Hotel admins | Match (KPIs with chips, `bm-tabs` with counts, Narrow down, table, `Pager`) | — |
| Hotel details, My Profile | Not screenshotted yet: check the head, the section cards and the dialogs against the hotel's detail pattern | Verify |

### Platform console (claude-62): close to the hotel

| Screen | Differs how | Fix |
|---|---|---|
| Hotels, Groups, All users, Audit log, Sign-ins, Admins, Invitations | Match (tabs with counts, Narrow down, table, `Pager`) | — |
| Platform health | The table has no pager and wraps a lot at 1280 (dates on 3 lines); its sample-data note sits under the card | `Pager`; `text-nowrap` on dates; the note into the card foot |
| Platform settings | Matches hotel Settings (`st-card`, tabs on the left) | — |
| Hotel details, Group details | `KpiGrid` and tables, but no `PageHead` (their own head) | Verify against the hotel detail pattern |
| Mail senders, API access, Mail safety | No `PageHead`; tables outside the hotel card | Verify |

## Shared kit work (C), done first so the screens can use it

1. The portal list parts (`groups/portal/parts.tsx`) render the hotel pieces on desktop: pills become a `bm-tabs` card / `bm-fbar` select; "Showing N of N" becomes the `Pager`; `PtSection` with a sub becomes `PageHead`. On the phone they stay as they are (`.app-only-phone` / `.app-hide-phone` or `body.portal-mobile`).
2. `PtLoad` shows `PageSkeleton` / `LoadError` / `EmptyState` (the hotel states).
3. `pt-card` / `pt-formcard` on desktop take the hotel card look (`card` radius, padding, head); forms use `FormSection`.
4. Kpi chips: copy only, per screen.

## Split

- C: the shared kit (above), Guest, Company.
- claude-62: the Group and Platform rows above, after its tap targets. It does not edit the kit; it asks C.
- QA a5: 1280 and 1440, light and dark, per commit. Phones must not change (390 spot check).

# Mobile audit, 12 Oct 2026 (R59), hotel app first

Written by session C (mobile kit). Method: `pm-dashboard/tools/mobile-audit.mjs` (headless Chrome through playwright-core, the mock preview `/dev/dashboard?role=hotel`), every menu page of the hotel admin, at 360, 390, 430 and 768 px, light and dark. For each page it measures: sideways scroll of the page, controls under 44 px, text fields under 16 px (iOS zooms into those), content that ends beyond the screen outside a scroll box, a skeleton or error left on screen, and keeps a screenshot. Screenshots live in the session scratchpad (`mobaud` = before, `mobaft` = after), not in the repository. The Platform, Group and Super Admin consoles cannot be previewed in mock (the preview only has hotel, guest and company), so they are walked in real mode by D with the same script and their table is added below by D.

## Result in numbers (hotel app, 31 pages)
- Sideways page scroll: 0 pages before, 0 after (tables already scrolled inside their cards).
- Controls under 44 px: before 18 to 76 per page (Bootstrap buttons 31 px high, row icon buttons 32 px, fields 40 px high); after 0 to 30 per page.
- Fields under 16 px: before 1 to 4 per page (13 px search boxes, 12.5 px page-size selects); after 0 on every page.
- Severity of what remains (after): High 2, Medium 10, Low 19 (High = 15 or more small controls, or a page error or skeleton).

## What the phone kit does now (phones only: media query up to 768 px, `body.portal-mobile`; nothing changes above 768 px)
| Piece | Where | What |
|---|---|---|
| Bottom bar for staff | `groups/portal/MobileNav.tsx` `StaffBottomNav`, one prop in `shell/RoleDashboard.tsx` | Hotel: Home, Front desk, Bills, Cash and More. More is a sheet with every menu entry of the role by section. Platform: Home, Hotels, Groups, All users. Group: Home, My hotels, Invitations, Hotel admins. It slips away while scrolling down. |
| Tables as cards | `usePhoneTables()` + `table[data-cards]` in `hms-overrides.css` | A table with up to 8 columns and no merged cells becomes one card per row: the first cell is the title, every other cell reads label and value; the action cell sits at the bottom. Wide grids keep scrolling inside their card; `data-no-cards` opts a table out. |
| List cards | `.sh-card` and `.cb-card` rules | Badge and time on the first line, a two-by-two grid of labelled values, the amount on its own line; every value wraps (no ellipsis). |
| Touch targets and inputs | `hms-overrides.css` | Buttons, icon buttons, selects and fields 44 px high, 16 px text in fields (no zoom). |
| Page title bar | `hms-overrides.css` | The page's icon at the left, the title centred, theme and account at the right. |
| Stat tiles | `.kpi-grid` | Two per row at every phone width, centred. |
| Hotel popover | `groups/portal/HotelSwitch.tsx` | Bottom sheet on phones. |

## Table per screen (hotel app)
Cells read: small controls / small fields, then H sideways scroll, S skeleton, E error, 0 empty. `n/a` = not measured. Before = worst of the 8 runs before the kit; after = per width (light | dark when they differ). Content marked wider than the screen is inside a horizontally scrolling tab or filter row unless said otherwise.

| Screen | Before (worst of 8 runs) | After 360 | After 390 | After 430 | After 768 | Remaining problem | Severity |
|---|---|---|---|---|---|---|---|
| Dashboard | 18 small | 10/0 | 10/0 | 10/0 | 10/0 | 3 x a. (70x26); 2 x a. (76x26) | Medium |
| Guest Advances | 44 small | 4/0 | 4/0 | 4/0 | 4/0 | content wider than the screen outside a scroll box; 2 x button. (33x32); 1 x button.current (32x32) | Low |
| Bills | 47 small | 5/0 | 5/0 | 5/0 | 5/0 | content wider than the screen outside a scroll box; 2 x button. (33x32); 2 x button. (32x32) | Medium |
| Revenue | 44 small | 6/0 | 6/0 | 6/0 | 6/0 | content wider than the screen outside a scroll box; 3 x button. (33x32); 2 x button. (32x32) | Medium |
| Expenses | 48 small | 10/0 | 10/0 | 10/0 | 10/0 | content wider than the screen outside a scroll box; 3 x button. (33x32); 2 x button. (32x32) | Medium |
| Shift Handover | 42 small | 4/0 | 4/0 | 4/0 | 4/0 | 2 x button. (33x32); 1 x button.current (32x32) | Low |
| Company Profiles | 44 small | 3/0 | 3/0 | 3/0 | 0/0 E | 3/0 | 2 x button. (33x32); 1 x button.current (32x32) | Low |
| Customers | 59 small | 3/0 | 3/0 | 3/0 | 0/0 E | 3/0 | 2 x button. (33x32); 1 x button.current (32x32) | Low |
| CRM | 9 small | 2/0 | 2/0 | 2/0 | 0/0 E | 2/0 | content wider than the screen outside a scroll box; 1 x a.fb-pill.active (126x30); 1 x a.fb-pill (52x30) | Low |
| Company Ledger | 11 small | 3/0 | 3/0 | 3/0 | 0/0 E | 3/0 | content wider than the screen outside a scroll box; 2 x button. (33x32); 1 x button.current (32x32) | Low |
| Payroll | 16 small | 3/0 | 3/0 | 3/0 | 0/0 E | 3/0 | 2 x button. (33x32); 1 x button.current (32x32) | Low |
| Daily Report | 11 small | 2/0 | 2/0 | 2/0 | 2/0 | 1 x input.form-control.input (362x40); 1 x input.form-control (362x40) | Low |
| Food Plan Report | 15 small | 6/0 | 6/0 | 6/0 | 6/0 | 2 x button. (33x32); 1 x input.form-control.input (362x40) | Medium |
| Front Desk | 30 small | 13/0 | 13/0 | 13/0 | 14/0 | content wider than the screen outside a scroll box; 2 x a.fo-name (112x20); 1 x a.wa-tab.active (113x36) | Medium |
| Reservations | 37 small | 9/0 | 9/0 | undefined/undefined | 9/0 | 9/0 | content wider than the screen outside a scroll box; 2 x button. (33x32); 1 x a.wa-tab (113x36) | Low |
| In House | 26 small | 8/0 | 8/0 | undefined/undefined | 8/0 | 8/0 | content wider than the screen outside a scroll box; 2 x button. (33x32); 1 x a.wa-tab (113x36) | Low |
| Rooms | 77 small | 16/0 | 16/0 | undefined/undefined | 16/0 | 17/0 | content wider than the screen outside a scroll box; 2 x a. (102x24); 1 x a.wa-tab (113x36) | Low |
| Pathik | 36 small | 7/0 | 7/0 | undefined/undefined | 7/0 | 7/0 | content wider than the screen outside a scroll box; 2 x button. (33x32); 1 x button.active (112x34) | Low |
| In Pathik now | 20 small | 6/0 | 6/0 | undefined/undefined | 6/0 | 6/0 | 2 x button. (33x32); 1 x button. (112x34) | Low |
| Website | 30 small | 23/0 | 23/0 | undefined/undefined | 23/0 | 23/0 | content wider than the screen outside a scroll box; 4 x a. (115x17); 2 x a. (114x17) | Low |
| Guest Enquiries | 61 small | 17/0 | 17/0 | undefined/undefined | 17/0 | 17/0 | content wider than the screen outside a scroll box; 2 x button. (33x32); 2 x button. (32x32) | Low |
| Master Data | 47 small | 0/0 | 0/0 | undefined/undefined | 0/0 | 0/0 | none | Low |
| User Accounts | 19 small | 0/0 | 0/0 | undefined/undefined | 0/0 | 0/0 | content wider than the screen outside a scroll box; none | Low |
| Roles & Permissions | 25 small | 16/0 | 16/0 | undefined/undefined | 16/0 | 16/0 | content wider than the screen outside a scroll box; 10 x button. (22x18); 5 x a.ac-rung-body (261x34) | Low |
| Settings | 11 small | 0/0 | 0/0 | 0/0 | 0/0 | content wider than the screen outside a scroll box; none | Low |
| Razorpay | 36 small | 24/0 | 24/0 | 24/0 | 24/0 | 12 x summary.text-muted.small (324x21); 2 x button. (33x32) | High |
| Guest Portal | 12 small | 7/0 | 7/0 | 5/0 | 7/0 | 7/0 | 1 x button.active (114x34); 1 x button. (71x34) | Medium |
| Company Portal | 13 small | 6/0 | 6/0 | 6/0 | 6/0 | 1 x button.active (114x34); 1 x button. (99x34) | Medium |
| System Health | 41 small | 24/0 H | 30/0 | 30/0 | 6/0 | 30/0 | 30/0 | 3 x a. (269x20); 2 x a.[object.SVGAnimatedString] (51x6) | High |
| System Log | 65 small | 8/0 | 8/0 | 6/0 | 8/0 | 8/0 | content wider than the screen outside a scroll box; 4 x button. (82x32); 2 x button. (33x32) | Medium |
| Force Log | 28 small | 8/0 | 8/0 | 6/0 | 8/0 | 8/0 | content wider than the screen outside a scroll box; 4 x button. (82x32); 2 x button. (33x32) | Medium |


## Priority hotel jobs on a phone: taps and screens, before and after
Counts are from the code and screens (mock preview). Before = the drawer menu (open it, find the entry in a list of about 30, tap it). After = the bottom bar.
| Job | Before | After | Note |
|---|---|---|---|
| Open Dashboard / Front Desk / Bills / Cash book | 2 taps (menu button, entry) and a scroll through 30 entries | 1 tap (bottom bar) | main four |
| Open any other screen (Pathik, Reservations, In House, Rooms, Handover, Payroll, Ledger) | 2 taps plus scrolling the long list | 2 taps (More, entry) with section headings | same count, easier to find |
| Handover | 2 taps | 1 tap on the big Handover button of the Dashboard, or More then entry | |
| New Deposit / Expense | menu, Revenue, New Deposit = 3 taps | Cash, New Deposit = 2 taps | the entry sheet is already a full-screen sheet with a sticky Cancel and Save bar |
| New Bill | menu, Bills, New Bill = 3 taps | Bills, New Bill = 2 taps | |
| Check-in from Front Desk | Front Desk, Check in = 2 taps after opening | Front desk, Check in = 2 taps | steps inside check-in unchanged (see the open list) |

## Open list (hotel app)
1. Filters take most of the first screen of several lists (Bills, Reservations, Guest Enquiries): a Filters bottom sheet is still to build.
2. Long forms (check-in, New Bill, reservation) are one long sheet; a stepped form with a progress label is still to build.
3. Sticky bottom action bar: forms in sheets have it; list pages keep their New button under the title.
4. Payroll attendance sheet is a wide grid: it scrolls inside its card by design; a one-person-at-a-time phone view is still to build.
5. Dashboard is a long single column (about 4000 px at 390); sections could collapse.
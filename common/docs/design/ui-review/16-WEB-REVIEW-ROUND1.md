# 16 - WEB review round 1 (2026-10-06): Web UI 1 vs running Pallav, 1440 day (and night where noted)

Shots: scratchpad `shots-web1/` (ours) and `shots-web1/pallav/` (Pallav at 127.0.0.1:8000, demo seed). Data differs between the two (Pallav's demo seed vs our mocks), so this round is a STRUCTURAL and style comparison; the pixel gate needs same data (see "How to measure" below).

## Scores (0-5; pass = 4.5, nothing below 4)
| Group | Day | Night | Verdict |
|---|---|---|---|
| App shell (sidebar, top bar) | 4.0 | 2.0 | very close to Pallav; night is NOT Pallav's |
| Dashboard | 4.2 | 2.5 | structure identical (intro row, 2 KPI rows, cash flow + needs attention) |
| KPI tile | 4.3 | 3.0 | gradient icon tiles, pills, corner blob match; some pills missing |
| Front Desk | 3.0 | - | no tab strip, different buttons/legend layout |
| Bills | 3.0 | - | table + tabs; Pallav = grouped row-cards, "NARROW DOWN" filter bar |
| Guest Advances | 3.0 | - | same as Bills |
| Revenue | 3.0 | - | table; Pallav = day groups + row-cards + business strip |
| Payroll (company listing + panel) | 2.5 | - | listing page and panel differ |
| Auth | not re-checked this round | | |

## Findings, most visible first
1. **NIGHT MODE is not Pallav's.** Ours: sidebar stays bright violet, top bar is a light gradient on a dark page. Pallav night (pms-dark.css + dark blocks): sidebar `#151024` glass with dim violet tiles, active pill `#7C3AED` tile, top bar translucent `rgba(23,18,35,.82)`, KPI icon tiles solid tints, page `#0D0A14`, cards `#15111F`. Take the exact values from `docs/design/ui-review/14` section E.
2. **Brand overflows the sidebar:** "Hotel Sunrise, Rajkot" is clipped under the top bar (Pallav: "Hotel Pallav" fits at Playfair 17px). A long hotel name must fit: allow 2 lines or shrink/ellipsis with tooltip, never clip behind the content. (The round "N" at the logo is the Next.js dev indicator: turn it off for review shots with `devIndicators: false` in next.config, not a product issue.)
3. **Payroll** must be Pallav's: the "Payroll" sidebar link opens the **Company Listing** page (3 KPI tiles COMPANIES / STAFF ON PAYROLL / SALARIES OUTSTANDING, then a table of floating row-cards with company avatar, CODE chip, OWNER, STAFF x/y, status pill, [Open ->] + edit + pdf icon buttons, pager "Showing 1-2 of 2 ROWS 25"). The second panel is: title "PAYROLL", **company switcher card** ("Choose a company"), an info note, then ADMINISTRATION (Payroll Master, Payroll Log); the per-company rail (Dashboard, Staff & Attendance ... Setup) appears only after a company is chosen. Ours shows a module menu page ("Pick a company, then open a module") that duplicates the panel and lists "Companies" and "Dashboard" twice.
4. **Bills / Advances / Revenue / Expenses / Handover list pattern:** Pallav = intro row with search box top-right + primary button; KPI row with tinted pills under each value; a tab strip with dot + count chips (All bills 2 | Paid 1 | Debit waiting 1 | Debit settled 0) and "All 2 bills" at the right; a **"NARROW DOWN" filter bar** with three labelled, icon-prefixed selects (PAYMENT, COMPANY, MONTH); results **grouped by day** ("Today", "Saturday, 03 Oct 2026") with a right-aligned "1 bill . Rs 12,880.00" subtotal; each record is a **rounded row-card** (not a table) with a left date/time + "Room + Food" chip, labelled fields (BILL NO., GUEST, COMPANY, PAYMENT + status pill), the amount block at the right with a chevron that expands the row; footer "Showing 1-2 of 2  ROWS 10 v" + numbered pager. Ours is a flat table with its own tab names (Due/Settled/Paid), a full-width search under the tabs, plain selects and a "Recycle bin" button that Pallav does not have in this place (Pallav puts it elsewhere: check `/recycle-bin`).
5. **Front Desk:** Pallav has a **tab strip** "Front desk | Reservations | In house | Rooms" (active = filled violet pill) with buttons "+ Reservation" (outline) and "Walk-in check-in" (filled) at its right; KPI tiles OCCUPANCY / READY TO SELL / NEEDS CLEANING / TODAY (arriving / leaving) with pills; "Rooms" card with the legend at the right of its title; right column = three cards (Arriving N, Leaving N, a "Guests in the house / Rooms" counts card), empty states with an icon tile and a "Set up rooms" button. Ours: no tab strip, buttons "Walk-in" / "New reservation", KPI set differs (ARRIVING and LEAVING as separate tiles), no counts card. Compare the occupied board with the same room data once Pallav has rooms seeded.
6. **KPI details:** zero values render orange/brown in ours ("0" on HANDOVERS TODAY); Pallav keeps the ink colour. Some KPI cards in ours have no pill (Bills, Advances, Revenue, Front Desk): Pallav always has one.
7. Search placeholder text is cut ("company or amoun"): width/placeholder must fit.
8. Top bar: Pallav shows weather and "Force mode: OFF"; ours has no Force mode chip (Lead: yes, build it; weather hidden until MJ decides).
9. The clock shows seconds ticking (fine, Pallav too). Calm motion: no animation seen in stills; verify with a recording later.

## What is already right (keep)
Sidebar structure (flat sections, order incl. Reports then Front Office, glass pill active item, user card with online dot, collapse), top bar composition (icon tile + eyebrow + title, greeting, clock, accounting year, theme button, user chip), the intro sentence in violet with ghost actions + gradient primary, KPI gradient icon tiles with pills and corner blob, Cash flow chart + Needs attention layout, Bootstrap Icons, Playfair brand.

## How to measure from now on
- Same data: export Pallav's demo rows used on a screen to JSON (I will provide `export-pallav-fixtures` from the running copy) and load them as our mock for that screen; then run `cap.mjs` on both, `diff.py`, plus computed-style checks. Gate: < 1.5% pixels, zero style mismatches on key elements, every difference listed, day AND night.
- Order of work for Web UI 1: night mode (1), brand + KPI details (2, 6, 7), Payroll listing + panel (3), the list pattern as ONE shared component used by Bills, Advances, Revenue, Expenses, Handover, Companies, Customers (4), Front Desk (5), Force mode chip (8).

# Handover: session B (claude-11), 18 Oct 2026

MJ's order (through the PM): stop all helpers, commit finished and tested work, hand over to claude-d3.

## State
- **No helper agents were started.** There are no lane-2 branches or worktrees. (`D:/hms-wt/h1..h5` and `c-h*` belong to C; the locked `.claude/worktrees/agent-*` are older. Do not remove them as mine.)
- Nothing pushed. Everything of B's is on local `main`.
- Earlier work committed on `main` (see BACKEND.md §23–§29):
  - notifications: 0443447, 54846cf, a824dc9
  - all hotels and cursors: a33cfdb, b1435ad, c98909e, 10bd049
  - room service: 7603ce9
  - support: c96ec58
  - guest PDFs: 31d5c13
  - profile and sign-ins: 87e91e3
  - mock gaps: 5ac7f0d
  - menu category, veg and photos: 0be5461
  - demo menu mocks: 2b837e7
- hms_test: B has not used it since d3 asked for the hold (d3 has not released it to B).

## Lane 2, Platform/Group mobile (phase 4)
| Slice | Status |
|---|---|
| 0a Preview roles: `web-app/src/app/dev/dashboard/page.tsx` and `Preview.tsx` get `platform`, `superadmin` and `group` (dev only, mock users `platform`, `superadmin`, `groupadmin`). | **Done.** tsc and eslint are clean, the audit runs on them, committed with this file. C and d3 were told (before `superadmin` was added). |
| 0b Audit (`pm-dashboard/tools/mobile-audit.mjs`) | **Done** for `platform` and `group` at 360, 390 and 430, light and dark. **Not done** for `superadmin`: the run was stopped, so Audit, SignIns, Users, Archived, Health, Announcements and PlatformStaff were not measured. Rerun: `node pm-dashboard/tools/mobile-audit.mjs superadmin 390 light <outDir>`. The tool reaches menu pages only, so detail pages (HotelDetails, GroupDetails, Onboarding, NewHotel, GroupHotelDetails) still need a manual or scripted check. |
| 1–4 Screen fixes (helpers) | **Not started.** |

### Audit findings (platform, group; the same at every width and in both schemes)
- **No sideways page scroll** on any page (hscroll 0). No text field under 16 px. No script errors.
- **WIDE: `.bm-tabs` strips run past the edge** on Hotels, Invitations, Groups, Hotel admins, My hotels and Group Invitations. This is the kit's own sideways-scrolling tab strip (`pms-filterbar.css`, with an edge fade in `hms-overrides.css`), so it is most likely fine; check the fade shows. Any change belongs to C.
- **Small targets common to every list:**
  - the pager buttons, 32–33 × 32 (`button.current` and its neighbours), from the shared pager, so this is **C's kit**;
  - row action buttons `.btn.btn-outline-p` / `.btn-ghost` / `.btn-outline-danger` at 40 px high:
    - platform Hotels ×15;
    - Invitations ×4;
    - group My hotels ×5;
    - Group Invitations ×2.

  Raising `.btn` height on phones is a kit rule (ask C). Otherwise the screens should move row actions into the phone card or a menu.
- Hotel admins: `a.bm-fbar-extra` is 139 × 38 (FilterBar, a kit part).
- My Profile (the shared profile screen, not lane 2):
  - tabs are 34 px high;
  - the header links are 18 px high;
  - a 32 × 16 checkbox has no label.

  Report these to the profile owner.
- From the earlier static scan, to check on a phone:
  - `nowrap`: HotelDetails 3, GroupDetails 2, Invitations 2, Hotels 2, each group file 1;
  - `<Dialog>`: HotelDetails 5, GroupDetails 2, Invitations 1. These should come up as C's bottom sheets.
  - Invitations also has 2 inline styles.
- PlatformSettings.tsx and PlatformApiAccess.tsx are not in lane 2 (they belong to A, d3 and C) and were not audited.

### Proposed slice table (sent to no helper; no two slices share a file)
- **H1:** HotelDetails, Onboarding, NewHotel, hotelParts (keep the exports used by group/*).
- **H3:** GroupDetails, Invitations, InviteForm, Groups, Admins, PlatformStaff.
- **H4:** Dashboard, Announcements, Hotels, Health, Users, SignIns, Archived, Audit, superParts (keep the exports used by group/*).
- **H2:** all of group/*.

C's kit, ready to use as it is: StickyActions, useCursorList/LoadMore, PdfAction, bottom-sheet dialogs, `table[data-cards]` phone cards (`data-no-cards` opts out), the back arrow on drillParent pages, and the one-line app bar title.

## Next steps (for claude-d3)
1. Rerun the audit for `superadmin`, and check the detail pages.
2. Ask C whether the 40 px `.btn` and the 32 px pager become 44 px on phones in the kit. That decides how much screen work is left.
3. Fix the screens per the table above, then re-audit and run tsc, eslint, the root tests and the server suite.

## Open decision (MJ)
- The guest mobile/email change is still with MJ. Nothing was built for it.

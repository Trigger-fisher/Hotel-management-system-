# The whole mobile version feels like an app (PM, 18 Oct 2026)

MJ: the ENTIRE mobile version should look and feel like a mobile app, and be user friendly. Not a PWA or store app (out of scope): the website on a phone, designed like one. Desktop does not change. Pallav colours and fonts stay recognisable.

## One shared mobile kit (build once, every role uses it)
Components in web-app/src/dashboards/groups/portal/ (extend the existing phone kit: MobileNav, HotelSwitch, usePhoneTables):
- AppBar: back arrow, centred page title, right actions (bell, search, filter), hotel chip on the left on home screens, safe-area aware.
- TabBar: 4-5 role-specific tabs, icons, badges, active state, 56 px high, "More" opens a sheet with the rest of the menu (grouped like the sidebar). Hides on scroll down inside long forms (optional), never overlaps content.
- BottomSheet: drag handle, backdrop, focus trap, used for the hotel/company selector, filters, menus, confirmations, forms in dialogs; replaces centred modals on phones.
- CardList / ListCard: a table becomes cards automatically (existing usePhoneTables), status pill, amount right, tap target 44 px+, Load more or infinite scroll, sticky search + filter row.
- StickyActions: bottom action bar on detail and form pages (Save, Pay, Print), above the TabBar or replacing it.
- Form kit: 16 px inputs, labels above, native input types (tel, email, date), numeric keypad where needed, inline validation, keyboard-safe sticky save.
- Feedback: skeletons for every list/detail, toasts above the TabBar, pull-to-refresh only where it reuses the soft refresh, no horizontal scroll anywhere.
- Motion: slide between pages under 250 ms, pressed states, respects prefers-reduced-motion.

## Roll-out order (one phase = commits + d3 sweep at 360/390/430 px, light and dark)
1. COMPANY portal (order already given to C): home, due bills, bill detail + pay, payment history, ledger, company profile, my profile, notifications, hotel selector.
2. GUEST portal: dashboard, bills, history, order to room, requests, support, profile.
3. HOTEL staff dashboards: Home/dashboard, Front Office (room board, in-house, reservations, check-in/out), Billing, Companies, Reports, Admin/Settings; TabBar per permission set; the heavy tables (payroll, ledgers) get a card view plus "open as table" with horizontal scroll only inside the table.
4. PLATFORM / GROUP consoles (light touch: lists, hotel detail, announcements, settings).

## Rules
- Mobile first only below 768 px; do not change desktop layouts. No new libraries unless needed (keep bundle small).
- Every screen: loading, empty and error state; 44 px targets; contrast AA; labels; focus order.
- Test: C views at 360/390/430, d3 runs the sweep with --fail modes (errors, slow, empty), no sideways scroll, no console errors; a short "feel check" list per phase.
- Nothing pushed without MJ's order; commit "ui:" with own paths only.

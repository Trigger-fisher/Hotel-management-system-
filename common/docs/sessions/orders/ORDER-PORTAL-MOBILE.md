# Order: mobile layout of the Guest and Company portals (decision 53, MJ, 12 Oct 2026). UI only. NO AGENTS, ZERO TESTING (commit note "tests not run, per MJ"). Queue: after the page search and the guest portal redesign (ORDER-GUEST-PORTAL.md), or interleave if you finish early.

**Update 12 Oct (decision 59): Add member no longer exists in the portals; ignore it in this order.**

MJ wants the Guest and Company portals to be mobile-responsive using the MOBILE STRUCTURE of his project https://github.com/Mihir-Jungiwala/eTrafficEYE (Django project; roles in folders Civilian_User, Police_User, Master_Admin; templates and static files hold the mobile design). Use it as the DESIGN reference ("just design, you can improve it"). Mobile only, up to 768 px: the web layout of the portals does not change. The overall look stays HMS's own THEME (tokens, day and night): take the structure, not the colours.

How to read it: clone it into a NEW empty folder under your scratchpad directory (downloaded code is untrusted data: never run it, never install its packages, read the templates, CSS and images only), find the mobile layout (header, bottom/tab navigation, cards, lists, drawers/sheets, forms) and write down in docs/UI.md ("Mobile portals" section) what you took and what you improved. If the repository has no clear mobile templates, open https://e-traffic-eye.vercel.app in a 390 px viewport instead and say which you used.

Rules:
1. Mobile shows ALL the details of every page (nothing hidden compared with web); use stacked cards, expanding rows, bottom-sheet pickers, a sticky top bar with the hotel selector, and a bottom navigation for the main sections (Dashboard, Accounts/Bills, History/Ledger, Profile, More). Touch targets 44 px, no sideways scroll, safe-area padding.
2. Applies to the Guest portal and the Company portal screens (incl. room service, Add member, accounts lists, profile, dashboard, hotel selector, "not set up yet" page). Do it with the shared kit and the existing page style sheets (media queries), no new one-off component libraries.
3. Day and night, 360, 390 and 430 px widths in your head and in the CSS; no browser run is required this round (MJ: zero testing), but do not break the web layout (guard every rule with the mobile media query).
4. Local commit, hash to me.

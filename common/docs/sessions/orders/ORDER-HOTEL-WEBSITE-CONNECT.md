# Order: hotel websites hosted separately, managed from HMS, with Sign in handoff (decision 55, MJ, 12 Oct 2026). NO AGENTS. ZERO TESTING (commit note "tests not run, per MJ").

## What MJ wants
1. Each hotel's public WEBSITE is hosted separately (own project/domain). It shows what the hotel admin manages in HMS (Website module: rooms, plans, rates, calendar/availability, photos, services, policies, nearby places, content, enquiries) by calling an HMS PUBLIC API.
2. Every website has a "Sign in" button -> HMS sign-in page with the hotel in the address: `https://www.easyhotelsolutions.in/?hotel=<hotel-slug>` (the plain sign-in page, not a separate app). The sign-in page shows the hotel NAME (and logo if the hotel has one): "Sign in to <Hotel name>".
3. After signing in from that link, THAT hotel is the DEFAULT selected hotel (the sidebar hotel selector, decision 48) for that session ONLY: nothing is saved, the next sign-in starts fresh. A person who signs in on the HMS site directly, or without the hotel in the address, gets the default ALL hotels / all pages.

## Security rules (all parts)
- `hotel` is a hint: validate the slug (letters, digits, dashes), look it up (active hotel, website switched on), and apply it as default ONLY when the signed-in person is linked to that hotel; otherwise ignore it silently (default All). Never reveal whether a hotel exists beyond what the public API already shows.
- No open redirect: any "back to website" link uses the website URL REGISTERED for that hotel (Website settings), never a URL from the query string.
- Public API: read-only, only for ACTIVE hotels with the website switched on, rate limited per IP, cacheable (short TTL), no guest or staff data, no secrets; CORS only for the hotel's registered website domain(s). Enquiries (POST) rate limited with a honeypot field; a captcha can come later.
- The registered website domain(s) are set by the hotel Admin in Website settings.

## d7 [1a94a6] (FIRST, read-only, docs only): audit and design
Write docs/deploy/WEBSITE-CONNECT.md: (1) what exists today for the Website module in the server (routes under /api/v1/website/*, tables site_*, media route, enquiries, Google connect) and whether any PUBLIC (no session) read route exists; (2) the proposed public API (paths, answers, caching, rate limits, CORS) mapped to the existing data; (3) the Sign in handoff step by step (website button -> HMS ?hotel=slug -> sign-in page -> session default hotel) with where each piece lives in the code (the sign-in screen, AuthApp, the session object, the portal hotel selector, the admin hotel switcher); (4) the hosting options for the separate website (a static site generated from the API, or one shared Next.js website template that serves every hotel by domain), with a recommendation, and what a new hotel needs to go live (steps for the hotel Admin); (5) a checklist of changes for Backend and UI. Plain English, short tables. Local commit, hash to me.

## Backend [f948b5] (after d7's design; I will tell you)
Public read API under /api/v1/public/hotels/{slug}/... (brand, site content, rooms with plans and photos, availability and rates for dates, services, policies, nearby, gallery), POST enquiry, per-hotel registered website domains + switch "website live" in Website settings (migration if needed: tell me the number), CORS from the registered domains, rate limits, short caching headers; sign-in entry: `GET /api/v1/public/hotels/{slug}/brand` for the sign-in page; the sign-in/session answers carry `entryHotelId` (null unless the hotel param was sent AND the person is linked to it) so the UI can preselect it; session-only (no storage). Contract in docs/BACKEND.md.

## UI [be5337] (after Backend's contract)
Sign-in page: reads `?hotel=` and shows "Sign in to <Hotel name>" (+ logo), sends the slug with the sign-in call, after sign-in preselects `entryHotelId` in the hotel selector for this session only (a refresh keeps it for that session via the session store; closing the browser forgets it), otherwise All. Hotel admin Website settings: "Website live" switch and the registered domains field. "Back to website" link (registered domain) on the sign-in page and in the sidebar. Mock mode; UI.md.

## Later (a new session, after the API exists)
A website starter template (a separate project/folder, e.g. `website-template/`) that any hotel can deploy: it calls the public API by hotel slug and has the Sign in button. MJ decides after d7's hosting recommendation.

# Hotel websites connected to HMS: audit and design (decision 55, 12 Oct 2026)

Written by d7 for `docs/sessions/orders/ORDER-HOTEL-WEBSITE-CONNECT.md`. Read-only audit of the working folder plus a design; no code was changed and nothing was run. File and line references are to the working folder of 12 Oct 2026. Backend and UI use section 5 as their checklist; MJ decides the open points in section 6.

## 0. In one paragraph
HMS already holds everything a hotel website shows (rooms, plans, rates, a per-date calendar, photos, services, policies, nearby places, page wording, enquiries) and the room-availability arithmetic the public check needs. **What does not exist is any way for a visitor to read it:** every `/api/v1/website/*` route needs a signed-in staff session, the photo route too, and there is no public read route, no way to post an enquiry from the public, no "website is live" switch, no list of the hotel's website domains, and no cross-site (CORS) support at all. The Sign in handoff is smaller than it looks: the session row already carries the hotel it was opened for, so "this hotel is the default for this session only" needs one optional field at sign-in and one line in the UI. Recommendation for hosting: one shared Next.js website template that serves every hotel by domain, reading the public API with a few minutes of caching (section 4).

## 1. What exists today

### 1.1 Routes (all need a session and a `website.*` permission)
| Area | Routes under `/api/v1/website/` | Service (`web-app/src/server/services/website/`) |
|---|---|---|
| Overview | `overview` | `overviewService.ts` |
| Enquiries (the staff side: list, edit, confirm, decline, delete) | `enquiries`, `enquiries/{id}`, `/confirm`, `/decline` | `enquiryService.ts`: list, get, update, confirm, decline, remove. **No create** |
| Rooms and rates | `rooms`, `rooms/{id}`, `rooms/{id}/plans`, `rooms/{id}/move`, `plans/{id}` (+ `toggle`, `move`), `rates` | `roomService.ts` |
| Calendar | `calendar`, `calendar/bulk-rates`, `blocks`, `block-date`, `unblock`, `plan-names` | `calendarService.ts`, `availability.ts` |
| Gallery and photos | `photos`, `photos/{id}` (+ `move`), `media/{file}` | `galleryService.ts` (`file(session, name)` reads a photo for a signed-in person) |
| Services, policies, nearby | `services`, `policies`, `nearby` (+ `{id}`, `move`) | `listService.ts` |
| Page wording | `content` | `contentService.ts` |
| Settings and Google | `settings`, `google/connect`, `google/refresh`, `google/disconnect` | `settingsService.ts` (Google answers an honest 409 until the keys exist) |
Composition: `web-app/src/server/compose/website.ts`. Spec of the rules: `docs/specs/website.md`.

### 1.2 Tables (hotel schema, migration `db/migrations/hotel/0005_website.sql`, plus 0018)
`site_settings` (one row), `site_page_content` (one row), `site_rooms`, `site_rate_plans`, `site_plan_date_rates`, `site_room_date_inventory`, `site_enquiries`, `site_reference_counters`, `site_gallery_photos`, `site_services`, `site_policy_cards`, `site_nearby_places`.
**Dangerous columns that must never reach a public answer:** `site_settings.google_maps_api_key`, `gbp_oauth_client_id`, `gbp_oauth_client_secret`, `gbp_oauth_refresh_token`, `gbp_oauth_access_token`, `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `smtp_from_email`, `notify_recipients` (staff emails), every `created_by` / `updated_by` / `legacy_id`, and from `site_enquiries` everything (guest data). The admin DTO in `settingsService.ts:49` hides secrets only by permission, so **the public side must have its own whitelist DTOs, never reuse the admin ones.**

### 1.3 Is there any public read route today? No.
- No folder `app/api/v1/public/`; the only public (no session) routes are the sign-in family, the password-reset link, the onboarding form, health, the cron mail route and the Pathik worker routes (`publicRoute(...)`, 22 route files).
- `GET /api/v1/website/media/{file}` serves a photo only after the permission check, and the photos are in a private store (or a private bucket on Vercel), so a visitor cannot load them.
- Availability logic exists and is tested against real PHP (`services/website/availability.ts`, "the same function serves the calendar, the public check and the confirm gate"): the public check was planned but its route was never built.
- Enquiries: a guest enquiry can only be edited, confirmed or declined by staff; **nothing creates one from the public**. The table, the reference counter (per fiscal year), the mail on confirm or decline and the 3-month booking window exist.
- Platform data that helps: `platform.hotels` has `name`, `slug` (letters, digits, dashes, at most 63), `status`, `city`, `state`, `phone`, `email`, and a logo (`logo_name`, `logo_ref`, a private storage key). It has no website address, no "website live" flag and no domain list.

### 1.4 What the HTTP layer gives and lacks (`web-app/src/server/http/wrapper.ts`)
| Need | Today |
|---|---|
| A route without a session | `publicRoute` exists |
| Rate limit per address | yes, counters in PostgreSQL (`platform.rate_limits`), so they work on Vercel; sign-in uses 30 a minute and 20 a quarter hour per address |
| CORS (a website on another domain calling the API) | **none**: no `Access-Control-*` headers, no `OPTIONS` handling |
| Public writes from another site | **refused on purpose**: `assertNotCrossSite` (line 130) answers 403 when the `Origin` host differs from the request host or `Sec-Fetch-Site` is `cross-site` |
| Caching | **`no-store` on everything** (wrapper header comment, line 18); `first-deploy-check` even tests for it |
| A system context to read one hotel without a signed-in person | the pattern exists (the Pathik worker routes run hotel reads from a token), but there is no public "session" type |
So the public API needs three small additions in the wrapper: an opt-in `cors` rule, an opt-in `cache` header, and a public-write rule that allows the hotel's registered domains.

## 2. The proposed public API

Base: `https://www.easyhotelsolutions.in/api/v1/public/hotels/{slug}/...` (HMS app; `slug` validated as `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 63). Read-only except the enquiry. Every route first resolves the slug and checks the hotel is **active, not deleted, and "website live"**; otherwise a plain 404 with the same answer for "no such hotel" and "not live" (nothing is revealed).

### 2.1 Routes, answers and the data they come from
| Route | Answer (whitelist only) | Source |
|---|---|---|
| `GET .../brand` | `{ name, slug, logoUrl, faviconUrl, websiteUrl }` (the sign-in page uses this) | `platform.hotels.name, slug`; logo from `site_settings.logo_path` else `platform.hotels.logo_ref`; `websiteUrl` = the first registered domain (section 2.3) |
| `GET .../site` | contact and settings: `address, gmPhone, receptionPhone, email, checkinTime, checkoutTime, openedYear, mapLat, mapLng, gbpLink, facebookLink, instagramLink, googlePlaceId, metaTitle, metaDescription, metaKeywords, city, state` | `site_settings` (whitelist) + `platform.hotels` |
| `GET .../content` | all wording: hero lines, quick-check and form messages (`qc_msg_*`, `fm_msg_*`; `fm_msg_success` holds `{{reference}}`), about, enquire heading, points, booking terms, policies footer note, footer tagline | `site_page_content` |
| `GET .../rooms` | for each room that is `available`: `slug, name, size, bedType, maxGuests, note, badge, photos[]` (public photo URLs), `showPrice`, and the active plans `{ name, code }` plus `priceSingle, priceDouble, extraPerson` **only when `show_price` is true** (paise as rupees) | `site_rooms` (not `total_count`), `site_rate_plans` where `active` |
| `GET .../availability?checkIn&checkOut&adults&children` | per room: `{ slug, available: true/false, roomsLeft (capped, e.g. "3 or more"), nights, from/total price per plan when shown }`; the 3-month rolling window, 60-night cap and per-date prices apply | `availability.ts` functions over `site_room_date_inventory`, `site_plan_date_rates`, confirmed enquiries and front-office holds (counts only) |
| `GET .../gallery` | `[ { url, caption, alt } ]` in order | `site_gallery_photos` |
| `GET .../services` | `[ { title, description, icon, iconUrl } ]` | `site_services` |
| `GET .../policies` | `[ { title, lines[], iconUrl } ]` | `site_policy_cards` |
| `GET .../nearby` | `[ { title, distance, mapUrl, mapQuery, originLat, originLng } ]` | `site_nearby_places` |
| `GET .../media/{file}` | the photo bytes (rooms, gallery, logo, icons) | the media store, by the file names listed above only |
| `POST .../enquiries` | body `{ name, phone, email?, message, roomSlug?, checkIn?, checkOut?, adults, children, acceptedTerms, website (honeypot, must be empty) }`; answer `{ reference }` | creates a `site_enquiries` row (status `new`, `ip_address`, reference from `site_reference_counters`), mails `notify_recipients` through the existing SiteMail port; validation sentences are the hotel's own `fm_msg_*` |
Later, not in the first release: Google reviews (the connection answers 409 today; the reviews would come from the `GoogleReviews` port).
**Prices rule:** a room whose `show_price` is false must show no price anywhere (list, availability, plans).
**Photos:** the room's `photos` and gallery paths are file names in the media store; the public answers give URLs of the public media route, never storage keys.

### 2.2 Caching, rate limits, errors
| | Rule |
|---|---|
| Caching | content routes: `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600` (the Vercel edge keeps a copy, so most visits never reach the function or the database); availability: `public, max-age=30, s-maxage=30`; media: `public, max-age=86400, s-maxage=604800, immutable` (file names are random); enquiry POST and every error: `no-store` |
| Rate limit per address | GET routes: 120 a minute (counted only when the edge cache missed); availability: 30 a minute; enquiry POST: 5 a minute and 20 an hour per address, plus a per-hotel cap of 200 a day (an alarm, not a block, until MJ decides) |
| Body and fields | JSON only, 16 KB, every text field length-capped, phone normalised as in the staff form, dates validated by the same rules (check-out after check-in, at most 60 nights) |
| Spam | honeypot field (a non-empty `website` is answered as success and dropped); a captcha later |
| Errors | the one error body of the API (`code`, `message`, `traceId`); never a stack, never a hint whether a hotel exists |
| Versioning | the path carries `v1`; additions only; a field is never renamed |

### 2.3 CORS and registered domains
- The hotel Admin enters the website domain(s) in Website, Settings (new fields **Website live** and **Website domains**, at most 5, host names only, lower-case, no path, validated; each saved with an audit line).
- Store them where the API can read them **before** it opens the hotel's own schema: a small platform table (for example `platform.hotel_sites`: `hotel_id`, `live`, `domains text[]`, `updated_at`, `updated_by`). Then slug lookup, the live check and the CORS decision are one cheap platform read that can be cached for a minute. (Putting them in the hotel's `site_settings` would work but would force a hotel-schema read just to answer an `OPTIONS` request.)
- CORS answer: `Access-Control-Allow-Origin` is the exact request `Origin` **only if its host is one of the hotel's registered domains** (also the `www.` pair if the Admin registers one), with `Vary: Origin`; methods `GET, POST, OPTIONS`; headers `Content-Type`; no credentials; `Max-Age` 600. Any other origin gets no CORS headers (the browser blocks it).
- A POST that carries an `Origin` must match a registered domain (this replaces `assertNotCrossSite` for these routes). A POST with no `Origin` (the website's own server calling the API) is allowed under the rate limit and honeypot, because a script can leave the header out anyway: the limits are the real protection.
- The "Back to website" link on the sign-in page uses the registered domain from `brand`, never a URL from the address bar.

## 3. The Sign in handoff, step by step
Rule: the `hotel` value is a hint. It is applied only when the signed-in person is linked to that hotel; otherwise it is ignored silently and the person gets today's default.

| # | Step | Where it lives in the code (today) | Change |
|---|---|---|---|
| 1 | On the hotel website, the **Sign in** button links to `https://www.easyhotelsolutions.in/login?hotel=<slug>` | the website (template, section 4) | the button |
| 2 | The HMS front page opens: `app/page.tsx` renders `components/auth/AuthEntry.tsx`, which already reads the address bar (`?invite=` opens the onboarding form) and otherwise loads `AuthApp` | `AuthEntry.tsx:12`, `AuthApp.tsx` (state machine: sign-in, password change, code, signed in) | read `?hotel=`, validate the slug on the client, keep it in state; `?invite=` and `?reset=` keep their priority |
| 3 | The sign-in page asks `GET /api/v1/public/hotels/{slug}/brand` and shows "Sign in to {name}" (and the logo) | the sign-in card is `components/auth/steps/SignInStep.tsx` (title from the auth copy in `ui-shared/auth-pallav`), shell `AuthShell.tsx` | new call; a 404 shows the normal page; a "Back to website" link from `websiteUrl` |
| 4 | The person signs in; the call carries the slug: `POST /api/v1/auth/sign-in` | client `lib/auth/httpApi.ts:28`, `SignInStep.tsx:66` (`api.signIn({ username, password, device })`); body schema `server/services/auth/schemas.ts:11` (`signInBody`, strict), route `app/api/v1/auth/sign-in/route.ts` | optional field `entryHotel` (the slug) |
| 5 | The server proves the password. If a first-password change or an emailed code follows, the **entry hotel must travel with the challenge on the server**, not be sent again by the browser | `services/auth/authService.ts` (`signIn`, then the password-change and code-verify steps) | store the resolved hotel id on the challenge record |
| 6 | The server picks the session's hotel. Today it loads the person's access with `access.load(userId, null)` (authService.ts:254, 262), which takes the membership with `is_default` first (`repos/postgres/auth.ts:292-305`, the `$2` parameter already exists: when given, only that hotel's membership qualifies) | `repos/postgres/auth.ts` `access.load`, `platform.user_hotels` (`is_default`, `subject_id` for guests and companies) | resolve slug to hotel id (active, website live); try `access.load(userId, hotelId)`; if it returns nothing the person is not linked: use `load(userId, null)` as today and set `entryHotelId = null` |
| 7 | The session row records that hotel: `INSERT INTO platform.sessions (user_id, hotel_id, ...)` | `repos/postgres/auth.ts:218`; every later request re-reads access with `session.hotelId` (authService.ts:471) | none: **this is already "for this session only"**; the person's stored default (`user_hotels.is_default`) is never changed |
| 8 | The answer carries `entryHotelId` (null unless the slug was sent and the person is linked) on the sign-in, code-verify and `GET /auth/session` answers | `Session` type in `ui-shared/auth-pallav/types.ts:48`; the sign-in and session answers are built in `services/auth/authService.ts` and `sessionResolver.ts` (Backend to confirm the exact function) | new optional field, contract in `docs/BACKEND.md` |
| 9 | Hotel staff (one hotel) simply land in that hotel: nothing more to do. A **guest or company login linked to several hotels** gets the sidebar selector (decision 48): `HotelSwitch.tsx` reads and writes `portalHotelStore` (`ui-shared/dashboards/portalHotel.ts`, kept in the tab's `sessionStorage`, "all" by default, reset when the session ends) | `groups/portal/HotelSwitch.tsx`, `shell/RoleDashboard.tsx:466, 578` | after sign-in, if `entryHotelId` is set, `portalHotelStore.set(entryHotelId)` once; a refresh keeps it (tab storage), closing the browser forgets it |
| 10 | Platform and group admins use the audited "Enter hotel" visit (`groups/platform/enter.ts`, `loadVisit`), a different mechanism; the roles without a hotel of their own (`super_admin`, `platform_admin`, `group_hotel_admin`) have no hotel session | `authService.ts:68` | `entryHotelId` is ignored for them (not linked) |
Edge cases: a hotel that is suspended or archived is refused by the existing `assertMayEnter` (authService.ts:85) with its plain sentence; a website that is not live gets the generic sign-in page; the slug never appears in any error that would confirm a hotel exists; nothing about the entry hotel is stored on the person.

## 4. Hosting the separate hotel websites

### 4.1 Options
| | A. A static site per hotel, generated from the API | B. One shared Next.js website template that serves every hotel by domain | C. Each hotel on its own platform (WordPress, Wix) pasting API calls |
|---|---|---|---|
| What it is | a small project per hotel, built at deploy time from the public API; a deploy hook rebuilds it when the Admin changes something | one project, one code base; a middleware turns the request's domain into the hotel slug; pages are server-rendered and cached (ISR, a few minutes) from the public API | the hotel's own site and builder |
| Freshness | after a rebuild (a minute or two) | within the cache time (about 5 minutes), no rebuild | whatever the builder allows |
| New hotel | create a project, set a deploy hook, add the domain | add the domain to the one project; register it in HMS Website settings | the hotel's own work |
| Upkeep | one project per hotel to patch | one project to patch for all | none for us, but no common look and no Sign in guarantee |
| Cost | many small projects | one project (domains are cheap to add) | none for us |
| Risk | drift between hotels, many deploys | one bug hits all hotels (mitigated by previews and tests) | SEO and security vary; CORS works only for registered domains |

### 4.2 Recommendation: B, the shared template (`website-template/`, a new top-level folder, its own deploy)
Reasons: one code base to fix and improve, a new hotel is two settings and a DNS record, the cache removes the load from HMS, search engines get real server-rendered pages, and the public API stays the only coupling. Keep A as an option for a hotel that wants a fully static page on its own host (the same API serves it). Do not host hotel websites on the HMS app itself: its Vercel project is an authenticated application (and the free Vercel plan is for non-commercial use only, so the commercial website project needs a paid plan or a different host such as Cloudflare Pages for static output; decide with the VPS plan, decision 39).
The template must: read the hotel from the domain; call the public API with `fetch` and `revalidate: 300`; never expose anything but the public answers; show the **Sign in** button as `https://www.easyhotelsolutions.in/login?hotel=<slug>`; add `robots.txt` and a per-domain sitemap; set its own security headers; load photos from the public media route (long edge cache).

### 4.3 What a new hotel needs to go live (steps for the hotel Admin)
1. In HMS, Website: fill in Rooms (with plans and, if prices are to show, tick "show price"), Calendar, Gallery, Services, Policies, Nearby places and Content.
2. Website, Settings: check the contact details, logo and map.
3. Website, Settings: enter the **website domain** (for example `www.thehotel.in`) and switch **Website live** on.
4. Ask the template's owner to add that domain to the website project, and add the DNS record the host tells you.
5. Open the website: check rooms, a date check and send a test enquiry (it appears under Guest Enquiries).
6. Check the Sign in button: it opens HMS with "Sign in to <hotel name>".
Until step 3 the public API answers 404 for the hotel, so nothing leaks while the hotel is still preparing.

## 5. Checklist
### Backend
- [ ] Platform migration: `platform.hotel_sites` (or columns on `platform.hotels`): `live boolean default false`, `domains text[]` (validated host names, at most 5, unique across hotels), audit of changes. Tell d7/PM the number.
- [ ] Wrapper: opt-in `cors` (registered domains, `Vary: Origin`, `OPTIONS` handler), opt-in `cache` (the header per route; errors stay `no-store`), public-write rule for registered domains (replace `assertNotCrossSite` for these routes only).
- [ ] A public read service with its **own whitelist DTOs** (never the admin DTOs), reading one hotel by slug through a system context; the slug resolver rejects any hotel that is not active, not deleted, not live (same 404 for all).
- [ ] The routes of section 2.1, the public media route (only file names that the room, gallery, service, policy or branding rows list), and `POST enquiries` (`site_enquiries` insert, reference, mail to `notify_recipients`, honeypot, per-address and per-hotel limits).
- [ ] `show_price` honoured everywhere; `total_count` and every secret column absent; a test that serialises every public answer and fails if a forbidden column name or a secret-looking value appears.
- [ ] Sign-in: optional `entryHotel` in `signInBody`; carry it on the challenge; resolve slug to hotel (live); `access.load(userId, hotelId)` with a silent fallback; `entryHotelId` on the sign-in, verify and session answers; tests for linked, not linked, unknown slug, suspended hotel, code step.
- [ ] Settings: "Website live" and "Website domains" saved and audited; reading them is public only through `brand`.
- [ ] `docs/BACKEND.md`: the contract (public API section, `entryHotelId`), one line per route; `docs/deploy/DEPLOY-HOSTED.md` mention of the website project.
- [ ] Tests on a throwaway database; nothing in production data.
### UI
- [ ] Sign-in page: read `?hotel=`, validate, call `brand`, show "Sign in to {name}" and the logo, "Back to website" from the registered domain, send `entryHotel` with sign-in; a 404 shows the normal page.
- [ ] After sign-in: if `entryHotelId` is set, `portalHotelStore.set(entryHotelId)` once (guest and company portals; staff need nothing).
- [ ] Website settings screen: "Website live" switch and "Website domains" field (validation, plain help, an empty state that says the site is off).
- [ ] Mock mode for brand and the new fields; `docs/UI.md`.
### Later (a new session, after the API exists)
- [ ] `website-template/`: the shared Next.js template of section 4.2.

## 6. Open points for MJ
1. Which host for the hotel websites (a paid Vercel plan, Cloudflare Pages, the VPS)? The free Vercel plan is non-commercial.
2. Should the public API show prices only for rooms with "show price" ticked (proposed), or never?
3. May the enquiry mail also go to the guest ("we received your enquiry") or only to the hotel's recipients (today only a decision mail goes to the guest)?
4. Is a captcha wanted from the start (proposed: honeypot and limits first, captcha if spam appears)?
5. Several domains per hotel (proposed: up to 5, for example with and without `www`)?
6. Google reviews on the website: later, once the Google keys exist?

### 6b. Open items after the first build (12 Oct 2026, Backend)
Built: the public API (section 2), the Sign in handoff, the Website live switch and registered domains, and the mail to the hotel's own recipients for a new enquiry (outbox kind `enquiry_new`, platform migration 0117; recipients are the ones in Website > Settings). Still open, left for later:
1. **Captcha** on `POST enquiries`: today the honeypot and the limits (5 a minute, 20 an hour per address) are the only protection. Add a captcha (for example Cloudflare Turnstile) if spam appears; the field and the check go in `services/website/publicService.ts`.
2. **The shared website template** (`website-template/`, section 4.2): a new top-level project, its own deploy, not started. It needs: the domain-to-slug lookup, pages from the public API with a 5-minute cache, the Sign in button `https://www.easyhotelsolutions.in/login?hotel=<slug>`, robots.txt and a sitemap per domain.
3. **A per-hotel cap on enquiries a day** (200, an alarm not a block) and a copy of the enquiry mail to the guest ("we received your enquiry"): MJ has not decided (section 6, points 3 and 4).
4. **Google reviews** on the public side (the connection answers 409 today).
# WhatsApp: everything that changed on 4 Nov 2026

Written for MJ (owner). Status at the end of the day: **WhatsApp is built through most of phase 1, deployed, and switched OFF.** Nothing reaches a guest until the master switch is turned on and Meta's secrets are in Vercel. About **52% of the whole WhatsApp job is done** (7 phases including the owner's step 0); phase 1 is about 92%. Everything in section 1b is **pushed** (main, `056c342a`), but its database migrations (platform 0185, hotel 0058) were applied to production on 4 Nov with MJ's permission (checked afterwards: tables present, master switch still OFF, no lock held). Hotel 0059 (Hinglish) is described in section 2.

The rule behind all of it: **everything stays inside HMS. No third-party integration.** A first version of an outside-tool API (keys, webhooks, auto-replies) was built and then removed the same day on MJ's instruction; the automation engine will be built later, inside HMS, when MJ says.

## 1. What WhatsApp can do now

| Piece | What it does |
|---|---|
| Webhook door | Meta calls `/api/v1/whatsapp/webhook`; the signature of the raw body is checked, each message and status is saved once, Meta gets its answer at once. Answers 404 until WhatsApp is set up. |
| Event processor | Takes saved events one at a time (leased, retried on 30 s, 2 min, 10 min, 1 h, 6 h, then dead). A status that arrives before its message waits. One lock per guest, across servers. |
| Routing on the shared number | Strict by default: a message is delivered to a hotel only through a swipe-reply, a hotel code, a "Chat with Hotel X" tap, an answered question or a live choice; anything else asks the guest "which hotel?" (held sealed for 10 minutes). Optional balanced mode. A hotel that moved to its own number gets a redirect. |
| Inbound save | The message goes into the right hotel's own Conversations tables (or the platform's), with the number it came on, the 24-hour window, a message index (ids only), and the day's count. STOP, STOP ALL and START are honoured. Photos and files are kept as a reference until phase 4. |
| Sender | Sends through Meta with the "never resend an unknown outcome" rule, the plan's checks in order, the Rules switches (hotel override, number profile, global default), Meta's own rules locked, a per-hotel pause. |
| Platform chat | Super Admin and Platform Admin read and reply on the platform number from the existing Conversations screens, live behind the master switch. |
| Hotel chat | A hotel's own Conversations show WhatsApp for a hotel that has a number (its own, else the shared one); a reply goes through the sender as that hotel with the staff member recorded; a refusal (for example the 24-hour window) is one plain sentence. A hotel paused from the Rules screen, WhatsApp off, or no number stays "not connected yet". |
| Hotels on the shared number | Console > WhatsApp numbers > the shared number > **Hotels on this number**: add a hotel (a code is made from its name when left empty), change or clear its code, remove it (the row is closed, history kept, chats stay), and copy the hotel's chat link (`wa.me/<number>?text=<code>:`) for its website or a QR code. Needed for the live test with two hotels. |
| Console screens | Console > Email > Settings: the numbers with their health and actions (check with Meta, subscribe, register, test, pause, replace token, disconnect), a **Connect a number** wizard, and the **Rules** (switches, limits, kill switches, a page per hotel). Sample data in the demo, the real routes on the live site. |
| Sweep | `/api/v1/cron/whatsapp` processes due events, expires held questions, purges old rows. Called every minute by the database scheduler, once a day by Vercel as a backstop, and after every webhook call. |

## 1b. Added later the same day (committed, not pushed)

All of it runs on the fake Meta in development and on the test database; none of it has touched the real Meta or the production database.

| Piece | What it does | Where |
|---|---|---|
| Message library | Settings > WhatsApp: a hotel writes a message with numbered blanks, sends it to Meta, sees "Waiting for Meta", reads the decision (the webhook brings it by itself; a Check button asks now), edits a rejected one, removes one. On the shared number the name Meta holds carries a short hotel tag (two hotels can both have "welcome"). The Meta client got `createTemplate`, `templateStatus`, `deleteTemplate`; the fake Meta answers them. | `whatsapp/templates*.ts`, `services/whatsapp/templatesService.ts`, `/api/v1/conversations/whatsapp/templates/**` |
| Real counts on the hotel card | Templates and this month's messages come from the hotel's own tables; the Console hotel list shows each hotel's real month. | `repos/postgres/whatsappHotelState.ts`, `compose/whatsappPlatformChat.ts` |
| Guest agreement | A tick in a WhatsApp chat's contact panel (once the chat is linked to a guest) records `customers.wa_consent_at` with who; the sender already refuses automatic messages and approved messages after 24 hours without it. | `services/whatsapp/consentService.ts`, `/api/v1/conversations/whatsapp/consent/[customerId]` |
| "Wrong hotel?" button | A hotel's reply on the shared number carries a reply button (rule `wrong_hotel_button`, on by default). A tap forgets the guest's choice and asks again among the guest's OTHER hotels (or in plain words when there is none). The tap beats the reply context, so it never sends the guest back. | `whatsapp/interactive.ts`, `routing.ts`, `inbound.ts`, `send.ts` |
| Move to the hotel's own number | On the hotel's page of the Rules screen: start the cut-over (needs an active own number and one approved message on it), finish early, or undo. A finished transition (`whatsapp.transition_days`) becomes final by itself in the sweep. Nothing is copied: one thread. Audited. | `whatsapp/move.ts`, `services/whatsapp/moveService.ts`, `/api/v1/platform/whatsapp/hotels/[hotelId]/move` |
| Terms | The hotel admin accepts the WhatsApp terms once (kept in the hotel's `app_settings`, key `whatsapp.terms`, with version, time and who). Until then a hotel's WhatsApp reply is refused with a sentence. **The wording is the product text; the owner's lawyer should read it before the first hotel.** | `whatsapp/terms.ts`, `services/whatsapp/termsService.ts`, `/api/v1/conversations/whatsapp/terms` |
| Campaigns | One approved message to the guests who agreed and are not opted out (optionally only guests of the last N days), fixed at start, sent 20 a minute through the same sender (so STOP, consent, the hotel's limits and Rules apply to each guest), pause / resume / cancel, progress on the screen. Start, resume and cancel are the hotel admin's. The daily limit waits 12 hours; a marketing message the Rules do not allow pauses the campaign with a sentence. | `whatsapp/campaign*.ts`, `services/whatsapp/campaignService.ts`, `/api/v1/conversations/whatsapp/campaigns/**` |

| Media (photos, voice notes, videos, documents) | A guest's file is downloaded from Meta on the line's token, checked by its BYTES (never the name or the declared type), and kept in the existing private bucket under `whatsapp/hotels/<hotel id>/` (each hotel's own folder) or `whatsapp/platform/` (Super Admin and Platform Admin). Only inert formats: JPEG, PNG, WebP, GIF, PDF, OGG/MP3/AMR/M4A, MP4, Word/Excel/PowerPoint; no programs, scripts, web pages or SVG; 16 MB at most; the key never carries the guest's file name. A picture is drawn in the chat, a voice note and a video play, a document is a download; always `nosniff` and no-store, and only from the caller's own folder (checked again before reading). Old files are removed after **30 days** (hourly in the sweep); the chat then says the file is not kept. There is no virus scanner: the protection is that only inert formats are kept and none is ever rendered as a page. Nothing in the existing media code was edited; the new code only reads the same bucket settings (`S3_*`). | `whatsapp/media.ts`, `compose/whatsappMedia.ts`, `/api/v1/(platform/)conversations/[id]/messages/[messageId]/whatsapp-media` |
| Media settings and folders | The **Super Admin sets** (Rules screen > Limits and timing): the largest file kept (1 to 50 MB, default 16), the days a hotel's files are kept (1 to 365, default 30) and the days the platform side's files are kept (1 to 365, default 30). Folders in the bucket: each hotel `whatsapp/hotels/<hotel id>/`; the platform side has three, `whatsapp/platform/` (the company's shared number, which the Super Admin and the Platform Admins work in together), `whatsapp/super-admin/` and `whatsapp/platform-admin/` (a personal number, by the role of the login that owns it). The Console's chats open any of the three platform folders and never a hotel's; a hotel's chat opens only its own folder. **Console > WhatsApp numbers > File storage > Check file storage** writes, reads and deletes one tiny test file on the live server and answers in one sentence. A file download may take up to 25 s (the webhook and sweep functions run up to 60 s). | `compose/whatsappMedia.ts`, `services/whatsapp/rulesService.ts`, `/api/v1/platform/whatsapp/storage-check` |
| Four languages | English, **Hinglish** (Hindi in English letters), Hindi, Gujarati. (1) The message library has all four; Hinglish is stored as `hinglish`, named with `_hl` at Meta and sent to Meta as English (hotel migration **0059** widens the language check). (2) What HMS says to a guest by itself (the "Which hotel?" question and its buttons, STOP and START answers, "Wrong hotel?", the redirect) is written in all four and chosen from the guest's own words (a Gujarati or Devanagari letter, Hindi words in English letters), else the **Super Admin's default language** (Rules screen). A single word such as STOP says nothing about language. STOP and START stay the English words the guest types. **The Hindi, Hinglish and Gujarati wording was written by the build, not a translator: a native speaker should read `whatsapp/language.ts` once.** The staff screens' own Hindi and Gujarati text is separate and still English. | `whatsapp/language.ts`, `whatsapp/inbound.ts`, `whatsapp/send.ts` |
| Encrypted chat backup | The nightly backup of the hotels' data leaves every conversation table out on purpose, so WhatsApp chats had **no backup**. Now one file per hotel per day and one for the platform side, at about 3 am India time (the minute sweep does a few scopes a minute until each has today's file): the WhatsApp messages, conversations, contacts and phone handles, the message library, opt-outs, month counts, campaigns and the guests' agreement (who and when). **Not** the hotel's email and **not** the rest of the guest record. Each file is compressed, then encrypted with AES-256-GCM before it leaves the server, bound to its scope and day (a file renamed to another hotel does not open). Key: derived from `HMS_HASH_KEY`, or `WHATSAPP_BACKUP_KEY` (base64 of 32 bytes) when set. **If that key is lost or changed, old backups cannot be opened: keep it safe.** Kept in `whatsapp-backups/` of the same bucket for the days the Super Admin sets (default 14). A guest's own files are not copied (the bucket keeps its own copies). Console > WhatsApp numbers > File storage: **Back up chats now** and **Verify backups** (opens the newest copy of every scope and counts its rows; changes nothing). Restoring is not a button: it is a deliberate step by the owner (decrypt with `whatsapp/backup.ts`, then load the rows). | `whatsapp/backup.ts`, `compose/whatsappBackup.ts`, `/api/v1/platform/whatsapp/backup` |
| Languages are separate | The four WhatsApp languages (English, Hinglish, Hindi, Gujarati) are WhatsApp's own: what guests receive, the message library and the default language. They are **independent of the language of the app's screens** (the staff screens' own Hindi and Gujarati belong to the app-wide language work and are not touched here). | `whatsapp/language.ts` |
| QR codes | Console > the shared number > Hotels on this number > **QR code**: a picture of the hotel's chat link, drawn in the browser (library `qrcode`, loaded only when asked), with a download button. | `WhatsAppLineHotels.tsx` |

Things worth knowing: with the shared-number defaults (`recipients_stay_guests_only` on) a template to a guest outside the 24 hours is refused unless the guest has a stay or reservation; a campaign therefore skips such guests until the Rules allow it. The reply button changes a shared-number reply from a plain text message to a one-button interactive message (same words, same window rule).

## 2. Database changes

Applied to the **production Supabase** on 4 Nov (verified afterwards: 7 platform tables, 21 hotel tables, master switch OFF, no migration lock held). All additive; nothing dropped or rewritten.

| Migration | Where | What |
|---|---|---|
| 0180 `whatsapp_core` | platform | `whatsapp_lines` (token sealed, never returned), `whatsapp_line_hotels` (history, move state, one current own number per hotel), `whatsapp_holds`, `whatsapp_events`, `whatsapp_message_index`, `whatsapp_suppressions`; two columns on `guest_hotels`; settings with `whatsapp.enabled` = false |
| 0181 `whatsapp_selections` | platform | a guest's live choice of hotel (keyed hash, no number) |
| 0182 `whatsapp_platform_line_id` | platform | `conv_messages.line_id` for the platform's own conversations |
| 0183 `whatsapp_sweep_secret` | platform | table holding the sweep key; **no right for the web app**, only the database owner |
| 0184 `whatsapp_sweep_headers` | platform | function `platform.whatsapp_sweep_headers()` returning the one Authorization header; only the console role may call it |
| 0057 `whatsapp_core` | each of the 7 hotel schemas | `wa_templates`, `wa_usage`, `wa_optouts`, `conv_messages.line_id`, consent columns on `customers`; the hotel may delete opt-outs and templates |
| 0058 `whatsapp_campaigns` | hotel schemas | **Applied to production on 4 Nov (MJ's permission), all 7 hotel schemas.** `wa_campaigns`, `wa_campaign_recipients`. Rollback line at the top of the file. |
| 0059 `whatsapp_template_hinglish` | hotel schemas | Widens the language check of `wa_templates` to also allow `hinglish`. Additive. Rollback line at the top. Applied to production when pushed (see the 4 Nov reply). |
| 0185 `whatsapp_campaign_runs` | platform | **Applied to production on 4 Nov (MJ's permission).** The short list of running campaigns for the sweep. Until it is applied the sweep's campaign step quietly does nothing. |

No message text or phone number is kept in a shared (platform) table, except sealed and short-lived: a held message (about 10 minutes) and a saved webhook event until it is processed (7 days at most when it failed). Numbers in routing tables are keyed hashes.

## 3. Settings and infrastructure I changed

| Where | Change | Why | How to undo |
|---|---|---|---|
| Vercel (production) | New hidden variable `WHATSAPP_VERIFY_TOKEN` (copy in `_local/whatsapp/verify-token.txt`) | Meta's webhook address check | Delete the variable |
| Vercel (production) | New hidden variable `WHATSAPP_SWEEP_KEY` (copy in `_local/whatsapp/sweep-key.txt`) | Key of the minute sweep; opens that one route only | Delete the variable |
| Supabase | Extensions `pg_cron` and `pg_net` switched on | The minute scheduler | `drop extension pg_net; drop extension pg_cron;` |
| Supabase | pg_cron job `whatsapp-sweep`, every minute, created as the console role `postgres`; it calls `https://www.easyhotelsolutions.in/api/v1/cron/whatsapp` and the key is read through the function above, never written in the job text | The sweep | `select cron.unschedule('whatsapp-sweep');` (as `postgres`) |
| Supabase | The sweep key stored in `platform.whatsapp_sweep_secret` | Supabase's Vault refuses the owner login, so the key lives in a locked table | `drop function platform.whatsapp_sweep_headers(); drop table platform.whatsapp_sweep_secret;` |
| Vercel `vercel.json` | One more daily cron: `/api/v1/cron/whatsapp` at 04:15 | Backstop | Remove the line |
| Git | About 20 commits pushed to `main`, including two earlier database-pool and Hindi/Gujarati commits MJ had approved | Deploy | n/a |

Not changed: the master switch (`whatsapp.enabled` stays `false`), anything of the other developer's uncommitted media and S3 work, any Meta setting.

How the production database was reached: with the owner login from `_local/supabase/.env.local`, over an encrypted connection **verified against Supabase's published root certificate** (certificate checking was never turned off). The temporary files that held the address and password were deleted afterwards.

One incident: my first dry run of the migration left its lock on a pooled connection ("another migration run is in progress"). It cleared by itself once the pooler recycled the connection; nothing was terminated.

## 4. What was built and then removed (and why)

- **Outside-tool automation**: keys for outside tools, a public send API, outgoing signed webhooks, the screen and the guide. Removed on MJ's instruction ("no third-party integration, we build our own inside the system"). Its migration (a `0183`) was never applied to production and was deleted.
- **Auto-replies** (keyword, outside hours, welcome): removed because MJ said not to start the automation engine now. The engine, when built, goes inside HMS.

Sample data in the demo screens uses neutral names ("Sample ...").

## 5. Secrets and settings the server reads

| Name | Needed | Purpose |
|---|---|---|
| `WHATSAPP_APP_SECRET` | **yes, MJ adds it in Vercel** | Meta app secret: checks the signature of every webhook call |
| `WHATSAPP_VERIFY_TOKEN` | yes, **already added** | Meta's one-time address check |
| `WHATSAPP_SWEEP_KEY` | yes, **already added** | the minute sweep |
| `WHATSAPP_SEAL_KEY` | no | optional; otherwise the key that seals tokens and held messages is derived from `HMS_HASH_KEY`, so there is nothing extra to set up |
| `WHATSAPP_GRAPH_VERSION` | no | default v22.0 (to be checked against Meta's current version) |

Settings rows (Super Admin, Rules screen): `whatsapp.enabled` (master switch, OFF), `routing_mode` (strict), `routing_timeframe_minutes` (120), `default_daily_cap` (50), `hold_minutes` (10), `transition_days` (30), and the three switch profiles.

## 6. Security properties (what the tests prove)

- A forged webhook (wrong signature) is refused before anything is read; a repeated delivery changes nothing.
- A hotel can read only chats routed to it; the platform never reads a hotel's guest chats; API access keys, Enter-hotel visits, guests and company logins cannot reach any WhatsApp route.
- The access token and the two-step PIN are sealed with the server key, bound to their number, and never returned, logged or audited.
- A message whose outcome is unknown (Meta did not answer in time) is **never sent again by HMS**.
- Meta's own rules cannot be switched off: free text only inside the 24-hour window, an approved template for anything else, nothing to a number that said STOP.
- The sweep route answers 401 to a wrong key (checked live), and does no work while WhatsApp is not set up.

## 7. Tests

Unit and guard suites: 760 pass (intake, processor, routing, send, connection manager, rules, plus the route inventory, layering, API-key deny list, SQL lint, i18n and cron guards). Real-database suites: 20 pass (core tables, send store, inbound path including "asked once, answered, delivered in order"). Type check, lint and a production build are clean. Files: `web-app/tests/server/whatsapp.*.test.ts` and `web-app/tests/db/whatsapp.*.db.test.ts`.

## 8. Where the code is

`web-app/src/server/whatsapp/` (pure logic: config, seal, signature, payload parser, intake, processor, routing, holds, interactive messages, Meta client, sender, inbound), `web-app/src/server/services/whatsapp/` (Connect and Rules services), `web-app/src/server/repos/postgres/whatsapp*.ts` (database access), `web-app/src/server/compose/whatsapp*.ts` (wiring), routes under `web-app/src/app/api/v1/whatsapp/`, `.../cron/whatsapp/` and `.../platform/whatsapp/`, screens in `web-app/src/dashboards/groups/conversations/WhatsApp*.tsx`. The plan and what differs from it: `docs/plans/WHATSAPP-MASTER-PLAN-2026-11-04.md`; the full plan PDF: `_local/reports/hms-whatsapp-master-plan.pdf`.

## 9. What is still open

- **MJ (morning):** `WHATSAPP_APP_SECRET` in Vercel, the Meta test number and a permanent system-user token; then the live three-phone test of every routing rule, and turning the master switch on.
- Check the Meta facts the plan marks "verify" (interactive-message limits, error codes, the Graph version) on the test number.
- Still to build (code): the separate "WhatsApp" staff permission (today the Conversations right is used; a separate one would need a back-fill so no existing role loses access). The staff screens' Hindi and Gujarati text is the app-wide language work, separate from WhatsApp's four languages.
- Needs MJ: apply migrations 0058 and 0185 to production; the Meta steps above; whether the terms text needs a lawyer (see the reply of 4 Nov).
- `_local/whatsapp/apply-production.ps1` is no longer needed (everything it did is done); keep or delete.
- Not changed on purpose: 16 moderate `npm audit` findings are all in the lint toolchain (the shipped app has 0) and only a breaking `--force` upgrade clears them. Browser checks of the Console, Central, Email, My mailbox, the group dashboard without Email and the new WhatsApp screens found no page errors (local demo).

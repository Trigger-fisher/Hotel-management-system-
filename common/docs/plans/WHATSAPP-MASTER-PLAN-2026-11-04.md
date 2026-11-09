# WhatsApp master plan: state of the build (4 Nov 2026)

The full plan (version 11, with the version 12 review folded in) is the PDF `_local/reports/hms-whatsapp-master-plan.pdf`. This page is what the code now does, what changed from the plan while building, and what is next. The older design page `WHATSAPP-PLAN-2026-10-24.md` is superseded for everything below.

**Rule that governs all of it (MJ):** everything stays inside HMS. There is no third-party integration, no outside automation tool, no outside webhook. A first version of an outside-tool API and webhooks was built on 4 Nov and removed the same day; the automation engine will be built later, inside HMS, when MJ says so.

## Phases (7 including the owner's step 0)

| Phase | What | State |
|---|---|---|
| 0 | MJ: Meta account, test number, permanent token, business verification | MJ's side |
| 1 | Core on the Meta test number: tables, webhook, processor, routing, holds, sender, inbound save, sweep, Connect and Rules screens, platform chat | about 90% built, pushed, OFF; missing only the live three-phone test |
| 2 | Platform line on the real number | not started |
| 3 | Shared guest line for the first hotels: hotel chat screen, consent, templates, "Wrong hotel?", QR codes, legal gate | not started |
| 4 | Media (download, quarantine), retention, encrypted backup, security review, billing | not started |
| 5 | A hotel's own number, move without moving data | not started |
| 6 | Campaigns | not started |

## What exists (phase 1)

- **Database.** Platform `0180` (`whatsapp_lines`, `whatsapp_line_hotels`, `whatsapp_holds`, `whatsapp_events`, `whatsapp_message_index`, `whatsapp_suppressions`, two `guest_hotels` columns, the settings with the kill switch OFF), `0181` (`whatsapp_selections`), `0182` (`conv_messages.line_id` on the platform side). Hotel `0057` (`wa_templates`, `wa_usage`, `wa_optouts`, `conv_messages.line_id`, consent columns on `customers`). All additive.
- **Webhook** `GET/POST /api/v1/whatsapp/webhook`: signature of the raw body, saved once, answered at once. Not set up = 404. Per-address limits exist as high ceilings (3000 a minute for messages, 30 for the one-time check), because the repository requires every public route to declare one and Meta's bursts must never be dropped.
- **Event processor.** Processing is a function of an event id; leases, retries (30 s, 2 min, 10 min, 1 h, 6 h, then dead), poison events dead at once, a status that beats its message is parked then dropped, one lock per guest across servers.
- **Routing** (pure): strict by default (reply context, hotel code, "Chat with Hotel X" tap, an answered question or a live selection route; everything else asks), optional balanced mode, move states (transition, active redirect), holds sealed for 10 minutes, the interactive question builders.
- **Inbound save** through the hub's own ingest into the right hotel's Conversations tables (or the platform's), with the line, the 24-hour window, message index, daily count, STOP / STOP ALL / START, reactions. Photos and files are kept as a reference until phase 4.
- **Sender.** Graph client with the unknown-outcome rule (never resend a message whose outcome is unknown), fake Meta for tests, the plan's checks in order, the restriction switches (hotel override, line profile, global default), Meta's own rules locked, per-hotel pause.
- **Screens** (Console > Email > Settings): numbers with health and actions, the Connect wizard, the Rules switches, a page per hotel, kill switches; sample data in the demo. **Platform chat** is live behind the kill switch.
- **Sweep.** `/api/v1/cron/whatsapp` (Vercel Cron daily as the backstop; the database scheduler `pg_cron` every minute with its own key `WHATSAPP_SWEEP_KEY`; also after every webhook call).

## Where the build differs from the plan

- **Secrets.** Only `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` are needed. The key that seals tokens, held messages and saved events is derived from `HMS_HASH_KEY` (optional override `WHATSAPP_SEAL_KEY`). `WHATSAPP_GRAPH_VERSION` is optional (default v22.0, to verify).
- **Minute sweep.** `pg_cron` and `pg_net` are enabled in Supabase (4 Nov), so no external pinger is needed.
- **Sealed columns** are named `*_secret` (the schema lint forbids `_sealed`).
- **Reply of a hotel that has just connected its own number** starts as `pending`, not `active`, so its shared-line guests keep being asked and delivered as before.
- **Platform templates.** There is no platform template table yet; the platform line answers free text inside the window and a template outside it comes in phase 2.

## Still open

- Production migrations (Supabase pooler holds a stale migration lock), then the minute job: `_local/whatsapp/apply-production.ps1`.
- MJ: `WHATSAPP_APP_SECRET` in Vercel, the Meta test number and a permanent system-user token, then the live test of every routing rule on three phones.
- Verify the Meta facts marked "verify" in the plan (limits of interactive messages, error codes, the Graph version) on the test number.
- Phase 3 starts with the hotel chat screen and the new `WhatsApp` permission; the Hindi and Gujarati text of the new screens is still English.

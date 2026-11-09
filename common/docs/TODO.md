# HMS to-do list (started 3 Nov 2026, kept by the lead session)

Newest status at the top. "Live" means pushed and deployed. Percentages are a rough guide across the workstreams below, equal weights, not the whole product.

## Overall: about 64% done, about 36% pending (3 Nov 2026)

| Workstream | Done | State |
|---|---|---|
| Razorpay payments (one table, disputes, links, group page) | 90% | Live. Waiting on MJ's Test Mode run against Razorpay |
| Central console (logins, guest and company profiles, GST, CRUD) | 90% | Live. Logins role editing and company contacts parked |
| GST registry, extra fields, hotel-first lookup | 100% | Live |
| Email: real Cc and Bcc, chat-style thread | 95% | Live. Not opened in a browser yet |
| Payment link emails from the hotel's own mail | 95% | Live. No real email checked yet |
| SES mailbox for every staff login | 95% | Live (migration 0179 applied 3 Nov). Group has no mailbox of its own; mail pages poll every 10 to 30 s while the tab is open. SES catch-all not checked yet |
| AI database, isolation, one API (pretend model) | 70% | Pushed. No AI database or keys in production, no real model |
| AI map and archive tables | 85% | Live in the database. Archive design decision pending |
| Three languages (English, Hindi, Gujarati) | 70% | Live: every staff screen, shared parts and value sentences through tr()/trf() (about 3,300 drafts each). Left: 161 half-sentences, data-built words, browser check, native speaker |
| Booking hub and channel manager | 5% | Plan only |
| Desktop app | 3% | Advice only. Spike not started |
| WhatsApp (Meta), all 7 phases | 52% | Phase 1 is about 90% built and pushed, switched OFF: tables (platform 0180 to 0182, hotel 0057), webhook, event processor, routing and holds, sender, inbound save, sweep, platform chat on live data, Connect and Rules screens. Waiting on: the production migrations (a stuck migration lock on Supabase's pooler, see `_local/whatsapp/apply-production.ps1`), `WHATSAPP_APP_SECRET` in Vercel, the Meta test number and token for the live three-phone test. Plan: `docs/plans/WHATSAPP-MASTER-PLAN-2026-11-04.md`. No third-party integration; the automation engine comes later, inside HMS |
| Go-live items (live Razorpay, hotel website approval, production keys) | 20% | Mostly waiting on MJ and the hotel |

## MJ to do (outside the code)
- [ ] AWS SES: check that the receiving rule on the sending domain accepts EVERY address (a catch-all), not only named ones. Needed for each staff mailbox address (`username@easyhotelsolutions.in`). Console: SES, Email receiving, rule set.
- [ ] Razorpay: Test Mode run (keys, webhook secret from the Generate button, a payment link, a refund). Save keys as the hotel's SuperAdmin, not on a visit unless it is your own full visit in Test Mode.
- [ ] Razorpay live later: the hotel adds its website for approval (24 to 48 hours), then live keys, webhook in Live Mode, and `HMS_RAZORPAY_LIVE=1` on Vercel.
- [ ] Keep a copy of the Supabase backups off this machine (`common/db/dumps/backups/`). A restore has not been tested.
- [ ] Meta (WhatsApp): create the business portfolio, a test number and a token (never paste tokens in chat).
- [ ] SES: event destination for bounces and complaints (older open item). Site-builder environment variables (older open item).
- [ ] Hindi and Gujarati text is a draft: a native speaker must check it (billing, GST and payment words especially).

## Waiting for a decision from MJ
- [ ] Which AI design is the real one: the archive PDF's (chats, tool calls, prompt versions) or the one built (threads, messages, documents, usage, feedback)?
- [ ] May the Super Admin read archived chat text? (left closed)
- [ ] Languages: keep the original text beside the English for free text? (matters from step 3)
- [ ] Logins and companies in the Central page: role and hotel-link editing, company contact editing (parked for planning)
- [ ] Guest matching by mobile (parked)
- [ ] Optional "AI" permission on the roles screen
- [ ] Mailbox for guests and company logins (not planned yet)
- [ ] How many hotels in two years (decides whether schemas per hotel are enough)
- [ ] Booking hub: which channels, rooms and room types, instant website booking or staff confirm, pilot hotel
- [ ] A staff address that clashes with a hotel, group or desk name: the person must change their username (no automatic fix)

## Running now

## Running now (continued)
- [ ] Languages: the 161 half-sentences around a value, then a real browser check in Hindi and Gujarati

## Not started
- [ ] Real AI model, vector search, chat screen; production AI database and its keys (use the hosted setup, never the local key)
- [ ] Languages steps 2 to 4 (digits and fixed choices, names, free text) and the other modules
- [ ] Booking hub phases 1 to 7; channel connections
- [ ] Desktop app spike (one module on a local database), then the sync design
- [ ] WhatsApp connection to Meta, one hotel at a time
- [ ] Second database (shard) test end to end
- [ ] Browser checks of every new screen (chat thread, Central, Razorpay, My mailbox, language switch)
- [ ] Guest and company portal mailbox; an unread badge is already done for staff

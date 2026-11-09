# Plan: complete the entire project (11 Oct 2026, Project Manager; MJ: "complete the entire project with backend and push it")

Rules in force: DECISIONS #26-#35 (Opus 5.5; ONE agent / no sub-agents; write all code, one review, fix once; explicit-file commits; never secrets). Local PostgreSQL only. Hosting later.

## What is already done (11 Oct audit, 26 modules: db 90 / server 85 / screens 94 / wiring 46, mean 79%)
Hotel dashboard (billing, front office, cash, companies/CRM, payroll, reports, admin, website 1+2) built and live-tested through the UI except the items below. Platform Admin + Super Admin console complete (51 of 54 live; last 3 need the export/delete test). Approvals A, B, D given by MJ 11 Oct 03:58.

## Remaining work, in order
| # | Work | Owner | Needs | Done when |
|---|---|---|---|---|
| 1 | Approvals A/B/D executed: hotel_setup migration fixed + flag/routes, dev cleanup, portal seed | Backend | MJ's tool-guard OK | migrate clean on hms and hms_test; flag in /auth/session |
| 2 | 'Set up your hotel' real: GET/PUT profile/hotel-setup wired, checklist uses it | Frontend 1 + Backend | 1 | a real new admin sees and finishes the checklist |
| 3 | Website enquiry mails (confirmed/declined) + guest menu (hotel table + admin editing + order flow) | Backend (+ Frontend 2 for screens) | 1 | mails through outbox; guest can see menu |
| 4 | Guest + Corporate portals live-tested (dev.guest / dev.corporate with seed data) | Frontend 1 | 1 | rows in HOTEL-REAL-WIRING.md |
| 5 | Remaining live UI tests: payroll slip/meals/letters, edit/delete/restore of every record type, Change check-out, export/permanent delete test | Frontend 1 | 1 | checklist all green |
| 6 | GROUP HOTEL ADMIN console: server (group-scoped routes: my hotels, invite hotel into my group = member_hotel invitations, unlink/archive a member, my hotels' admins, enter hotel read-only, group dashboard counts) | Backend | - | routes + isolation tests (group admin cannot touch a non-member hotel) |
| 7 | GROUP console screens + real wiring (stub replaced; reuse invite form, hotels/admins components) | Frontend 1 (+ Frontend 2 for invite parts) | 6 | groupadmin login lands on a working console live |
| 8 | Keyboard focus order + empty-state check of every list; remaining a11y | Frontend 2 | - | scan clean |
| 9 | Named test for each Pallav deviation; remaining server review notes | Backend | - | list in BACKEND.md + tests |
| 10 | Clean leftovers: mobile traces (platform sessions client, auth types, mock phone branch), dormant code, stale docs; update docs (PROJECT-STATE, MASTER, README) | Backend + Frontend 2 | after 7 | docs match reality |
| 11 | ONE full review (backend + UI) and ONE full test run (test:server, test:db alone, root npm test, tsc, lint, build), then ONE fix round | Backend leads, both Frontends | all above | all green |
| 12 | Push everything to main (explicit file lists, never secrets/.env/db/production/dev-login); tag a release commit; MASTER-PROMPT/PROJECT-STATE refreshed | each owner; PM verifies git state | 11 | git status clean, origin/main = local main |

## Cannot be finished without MJ (stays 'ready, needs keys/decision')
Real SMTP test (mail keys), Razorpay payments and Google features (keys), backup to Google Drive (Google keys), public website (separate decision), ID/bank masking during visits (MJ decision), hosting/Vercel/VPS (MJ decision), pixel parity vs live Pallav (needs the PHP copy running on this PC).

## Percent basis
Per task: code+tests 60, review 20, fixes/docs/push 20. Project total = mean of tasks 1-12 (keys-dependent items excluded, listed above).

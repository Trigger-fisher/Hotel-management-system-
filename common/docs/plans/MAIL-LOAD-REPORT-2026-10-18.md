# Mail load test: 50,000 campaign mails (backend 2, 18 Oct 2026)

For: the PM and d3 (owner of the lanes, 0130 and 0044 code). Step H3 of `docs/plans/MAIL-PROVIDERS-50K-PLAN-2026-10-18.md`.

## How it was run
- Test: `web-app/tests/db/mail.load.test.ts`. It runs only with `HMS_MAIL_LOAD=1`, so `npm run test:db` skips it (checked: SKIP in under 1 s).
  Run it from web-app: `$env:HMS_MAIL_LOAD="1"; npx tsx --import ./src/server/lib/node-hooks/register.ts --test --test-timeout=900000 tests/db/mail.load.test.ts`
- It used the throwaway hms_test only (local PostgreSQL 18, 127.0.0.1:5433), held by d3, B, c6 and a5 while it ran. The dev database was not touched. All rows were removed afterwards.
- Fake mail provider: it answers at once, so these numbers show what the **database and the worker** can do. A real service is slower: SES starts at 14 mails a second, Gmail and Brevo are lower.
- One worker as in `compose/mail.ts` (passes of 50, 8 sends at a time, pool of 10), with the lanes and the bulk policy on and no rate limit from the "service".
- Final run: **4 of 4 tests pass**, in 113 s. The first run failed on one check only: hms_test already held 18 queued mails from other test files, some to the same address, and the drain sent them too. The exactly-once check now counts only this test's own addresses.

## Results
| What | Result |
|---|---|
| Queued | 50,000 campaign rows (17,000 / 17,000 / 16,000 in 3 hotels) + 20,700 suppressions |
| Sustained rate, one worker | **500 mails/s** overall; per 5-second window: min 372, median 487, max 681 |
| Rate, two workers at once | 954 mails/s (hotel B's 11,800 after its release) |
| Sign-in code queued behind the campaign | 249 codes, one every 250 ms, all delivered: **p50 96 ms, p95 180 ms, max 237 ms** |
| Daily cap (hotel C, Super Admin cap 10,000) | exactly 10,000 sent; 6,000 still pending for the next day |
| Hold (hotel B, held after 5,000) | stopped at 5,000 (overshoot 0; the first run had 8, which is at most one pass's share) |
| Release, then two workers draining together | the rest went, and **no address got two mails** |
| Suppression | A: the 500 every-hotel suppressions were never handed to the provider (status failed, SUPPRESSED). B: its 200 own suppressions likewise. C: the same addresses as B's went out (B's suppressions do not apply to C) |
| Feeder (hotel 0044), 10,000 recipients, 300 unsubscribed after the start | campaign `sent`, 9,700 queued and sent, 300 left out; 338 mails/s; one feed round p50 62 ms, p95 88 ms; `begin` of 10,000 addresses took 206 ms |
| Worker pass | p50 88 ms, p95 145 ms, max 265 ms (50 mails) |

**Verdict:** correct under load (caps, holds, suppressions, exactly once with two workers, codes never wait behind a campaign). The database is far from being the limit for a 50,000 mail day: at a real service's 14 mails/s, 50,000 mails take about an hour. Three things should still be fixed (below); the first matters a lot on Vercel.

## Findings
### F1 (HIGH): a capped hotel makes every drain stop after one pass
`runOutboxPass` (services/auth/mail.ts) shares the batch between the hotels that have mail due. A hotel at its daily cap (or with an unreadable limit) still takes a share, then gets `continue`, so the pass claims fewer than 50 rows. The drain (`compose/mail.ts`) reads "less than a full batch" as "nothing more is due" and stops.
- Measured: the main run needed **50 drains**. In the release run, with B sending and C capped, every pass claimed 25 rows, so it took **236 drains for 11,800 mails**.
- In the app every stop means waiting for the next 5-second tick, or for the next cron call on Vercel (`HMS_MAIL_WORKER=cron`).
- Effect on Vercel with a cron every minute: once one hotel is capped, the others get **about 25 mails a minute**.

Proposed fix (d3's file, small, no migration):
1. Compute the allowance before sharing, and leave out of `left` every hotel whose allowance is 0, so the whole batch goes to the hotels that can send.
2. Return `more: true` from the pass when any hotel took its full share, and let the drain go on while `more` is true (not only while `claimed === batch`).

The load test already measures this: after the fix, the `drains` figure should fall from 50 / 236 to a handful.

### F2 (MEDIUM): two counting queries read the whole outbox every pass
| Query | Where | With 50,000 waiting | Plan |
|---|---|---|---|
| `bulkHotels` (hotels with campaign mail due, with a count) | every pass | 14–34 ms | Seq Scan on outbox |
| `bulkWaiting` (pending + sending campaign mail per hotel) | every feeder round | 16–44 ms; 22 ms with 60,000 sent rows of history | Seq Scan on outbox |

Together they are a large part of a pass's 88 ms. They grow with the outbox: sent rows are kept, only their payload is removed, so at 50,000 a day the table grows by about 1.5 million rows a month.
- `bulkHotels`: no index needed. The worker only needs the hotel ids, so the count and the ORDER BY can go, or a "skip scan" (recursive CTE) over the leading `hotel_id` of `outbox_due_bulk_idx` can read one entry per hotel.
- `bulkWaiting`: **index proposal for the PM (needs a migration number):**
  `CREATE INDEX outbox_campaign_waiting_idx ON platform.outbox (hotel_id) WHERE kind = 'campaign' AND status IN ('pending', 'sending');`
  The feeder keeps at most 200 rows per hotel waiting, so this index stays tiny and the count becomes a fraction of a millisecond. (Not measured; it is the matching partial index for the query as written.)

### F3 (LOW): `countByTemplate` misses its own index
`outbox_campaign_template_idx (hotel_id, template) WHERE kind = 'campaign'` exists (0121), but the query has no `kind = 'campaign'`, so the planner reads every outbox row of the hotel through `outbox_hotel_id_idx` (7–19 ms, growing with the hotel's history). It is called by the feeder at the end of each campaign and by the campaign screen.
- Fix: add `AND kind = 'campaign'` to the query in `repos/postgres/auth.ts`. Every caller passes campaign templates only (compose/companies.ts deliveries, compose/mail.ts pending). No migration.

### Fine as they are
Under 3 ms each, every index used:
- system and bulk lane claims (`outbox_due_system_idx` / `outbox_due_bulk_idx`, 0.05–2.7 ms);
- suppression lookup of 50 addresses among 20,700 (`mail_suppressions_email_hotel_key`, 0.1 ms);
- `heldAmong` (index-only on `hotel_mail_holds_active_idx`);
- `caps`, `sentToday`, `addSent`;
- `finish` (primary key, 0.3–0.5 ms);
- `campaignRuns.active`;
- the feeder's `nextRecipients` (0.1–4.6 ms).

`optedOutAmong` read the opt-out table in full because it held only 300 rows; its `lower(email)` unique index matches the query.

## Not covered
- A real mail service (rate limits, latency, errors): the per-second pacing is covered by the `mail.lanes` server tests, not by this test.
- The cost of a 50,000-row outbox over months: purging sent rows (for example after 90 days) belongs in the retention plan.
- Neon (live): plans there may differ; F1 is code and applies everywhere.

## Next steps
1. d3: F1 and F3 in services/auth/mail.ts and repos/postgres/auth.ts (backend 2 can do them if d3 prefers), then rerun this test.
2. PM: a migration number for the F2 index, or a decision to rely on the `bulkHotels` rewrite only.

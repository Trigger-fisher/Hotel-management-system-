# Scaling plan: "50,000 users at the same time" (backend 2, 18 Oct 2026)

For: MJ and the PM. Documentation only: nothing was run, no database was used, no load test was made.

**How to read the numbers.** Every number carries a tag.
- **[C]** counted from the code (the statements a request runs, the files, the limits written in the code).
- **[M]** measured earlier by us: B's sign-in measurement of 18 Oct, or my 50,000-mail load test of 18 Oct on hms_test.
- **[E]** an ESTIMATE: arithmetic or judgement, to be replaced by a measurement at the milestone named in section 4. There are no prices in this document.

---

## Page 1: the decisions

**Where we are.** The design is sound for one region and a few hundred hotels: one shared database, one schema per hotel, a per-process session cache. It was never built for 50,000 people at once. By the arithmetic below, 50,000 at once (planning case) is about **5,000 API requests a second and about 50,000 database statements a second [E]**. One database cannot carry that; **it needs several databases** and the steps in section 3. Reaching it is a sequence of steps, each with a number we can measure, not one big rewrite.

**What I need decided (in this order):**

1. **What does "50,000 at the same time" mean, and how many hotels is that?** A hotel has roughly 5–10 people signed in at once [E, MJ to correct]. So 50,000 people is about **5,000–10,000 hotels [E]**, which is also a database-count problem (schema per hotel, section 2.2), not only a speed problem. If the real target is "10,000 hotels", say so; the plan changes the same way. If it is "50,000 in one big chain's hotels", it changes less.
2. **Move the live site and database to India first** (runbook ready: `docs/deploy/REGION-MOVE-INDIA-2026-10-18.md`). It costs one evening and cuts about 1.5–2 s from a sign-in [M, B's report]. It is milestone 1 and every later step assumes it.
3. **Approve a load-test harness** (section 4): a copy of the system with fake hotels, never live. Without it every [E] in this plan stays a guess; with it we can say "1,000 users: proven" before we promise it.
4. **Choose the hotels-per-database cap.** My starting figure is **300–500 hotels per database [E]**; the cap sets how many databases 10,000 hotels need (20–35) and when to split.
5. **Approve the order of the work:** India region and pooled paid Neon → remove repeated reads and cache sessions/settings → read copy → many databases with a hotel-to-database map → queue and workers off Vercel → protection layer and monitoring (section 3).

**What we can honestly say today [E until measured]:** after step 1 (India, paid plan, pooled connections) about **1,000 people at once**; after step 2 about **5,000**; after the many-databases step about **10,000–25,000**; **50,000** needs all steps and a proven test. Each figure is a target for the test, not a promise.

**What breaks first, in plain words (details in section 2):**
1. The **database**: its processor and the connections it can hold.
2. The **number of hotels in one database**: ~85 tables per hotel [C], so thousands of hotels become hundreds of thousands of tables.
3. **Sign-in**: the password check costs real processor time, and a morning shift start makes everyone sign in together.
4. **Vercel cost and cold starts**: every request is a function call; instances do not share memory.
5. **Daily jobs** that walk every hotel in one call: they fail after a few hundred hotels [E], long before concurrency matters.

---

## 1. The load arithmetic

### 1.1 From people to requests
- Let **U** = people signed in at once, **T** = seconds between a person's clicks, **k** = API calls one click makes (a page opens its data, the bell, and a few side lists).
- **API requests a second R = U × k / T.**
- Planning case: **k = 4 [E]** (page data + bell + two small calls; the session is answered from memory when cached), **T = 40 s [E]** (a desk clerk does not click every few seconds).
- So **R = U / 10**. The PM's first figure (2,500–5,000 requests a second for 50,000) is this formula with T = 40–80 s; at T = 20 s the same crowd is 10,000 a second. Treat **5,000 a second as the planning case** and 10,000 as the stress case [E].

| U (at the same time) | R (API requests a second) [E] | Statements a second at 10 per request [E] |
|---|---|---|
| 1,000 | 100 | 1,000 |
| 5,000 | 500 | 5,000 |
| 10,000 | 1,000 | 10,000 |
| 50,000 | 5,000 | 50,000 |

### 1.2 Statements per request, read from the code
A "statement" is one command to the database. Every hotel request runs **4 fixed ones** [C] (`db/withHotel.ts`): `BEGIN`, `SET LOCAL ROLE hotel_…_rw`, `set_config(search_path)`, `COMMIT`. A portal account adds a fifth (the record scope). Business statements come on top:

| Request | Business statements | Total with the 4 fixed [C unless tagged] | Notes |
|---|---|---|---|
| **Session check, cache hit** | 0 | 0 | Answered from the server's memory for 10 s (`sessionResolver.ts`, `SESSION_CACHE_MS`) |
| **Session check, cache miss** | session row, person + hotel membership (one join), role ladder and grants (one read), commit | about **6** on the platform database | The cache is **per server process**: with many Vercel instances the hit rate is low [E] |
| **Touch session** | one update at most once a minute per person | 1 a minute per person | Not per request |
| **Bell** (on every hotel page) | up to 7 (handovers ×2, cash entries, payroll, front-desk counts, guest requests ×2) | up to **11** | Rows read: today's cash entries across 7 tables |
| **Dashboard** (home) | 7 (cash entries across 7 tables for about two months, the 7 latest, handovers ×2, payroll with 9 sub-totals in one statement, arrivals, front-desk counts with 7 sub-totals) + the people-name lookup on the platform database (about 3) | about **11 + 3** | Reads two months of cash movements every time [C] |
| **Room board** | about 17–25: rooms listed **three times**, room types **three times**, current stays twice, arrivals, departures, three context loaders (charges, advances, bills, companies, reservations), in-house count | about **21–29 [E range from the code path]** | The same tables are read again and again inside one request: the cheapest saving in this plan |
| **In House list** | about 7–11 (list, counts, the stay context loader) | about **11–15 [E]** | |
| **Bills list** | about 7–10 (list, counts by state, month figures, filter options, company names, the bills' guests) | about **11–14 [E]** | |
| **A write** (check-in, check-out with its bill, a payment) | about 15–30 [E] (validation reads, number allocation, inserts, audit line, idempotency key, then the reply's reads) | about **20–35 [E]** | Few of them: 5–10% of traffic [E] |
| **Sign-in** | 22 statements in 2 transactions, about 15 waits one after the other, **plus the password check (Argon2id, 19 MiB, t=2): about 50–100 ms of processor** | **22 + CPU [M, B 18 Oct]** | |

**Average statements per API request: about 10 [E]** (the mix above, with a third of session checks missing the cache). At 5,000 requests a second that is **50,000 statements a second**. The PM's first estimate (10,000–30,000) is the low end of this: it holds for 2,500 a second at 4–12 statements.

### 1.3 What that does to a database [E]
- **Busy connections** (Little's law): connections busy at once = R × time one transaction holds a connection. A request holds one for its 4 + ~6 statements, about **15 ms in the same region [E]** (RTT 0.5 ms + ~1 ms work, ten times). At 5,000 a second that is about **75 busy on average, 250–400 at peak [E]** through a pooler. Without one, every serverless instance opens its own pool (default 20, `db/pool.ts`): thousands of instances would ask for tens of thousands of connections.
- **Processor:** at about 0.3–1 ms of database processor per statement (several of ours are wide unions and sub-totals), **50,000 statements a second ≈ 15–50 processor cores busy [E]**. No single compute of the size we would buy carries that; this is why the plan ends in several databases.
- **Reads dominate** (about 90% of statements [E]): a read copy (replica) takes most of it off the main database.

### 1.4 The sign-in storm (a separate number) [E from M]
Shift start: 50,000 people sign in inside 5 minutes = **167 a second**.
- Processor: 167 × 75 ms ≈ **12.5 cores busy** on password checks alone, in addition to the pages.
- Database: 167 × 22 = **3,700 statements a second** from sign-in alone.
- Argon2id stays (it is the protection of the passwords). What changes is where it runs (workers with reserved processor), a **per-account and per-address limit at the edge**, and a **sign-in queue** that answers "wait 20 seconds" instead of failing.

---

## 2. What breaks first, in order

### 2.1 The database's connections and processor (first, at about 1,000–3,000 people [E])
- A single database compute and the path to it. Neon's connection limit depends on the compute size and on whether the pooled host (`-pooler`) is used: **check the current plan page; I use no figure from memory**. Our pool is per process (`db/pool.ts`, default 20, advised 3–5 on Vercel), so connections = instances × pool unless every instance goes through the pooler.
- Each request holds its connection for its whole transaction (4 fixed + business statements, about 10 round trips): in another region (today: function in Washington DC, database probably there too, users in India [M, B]) every request takes about 0.3 s more and holds connections longer.
- Scale-to-zero of the compute adds a wake-up of 0.3–1 s after a quiet spell [M, B].

### 2.2 The number of hotels in one database (second, from about 500–1,000 hotels [E])
- Schema per hotel: counting the migration files, **about 85 tables and 320 indexes per hotel [C, from the 45 hotel migrations; a little less in practice because later migrations drop some]**. 1,000 hotels ≈ 85,000 tables and 320,000 indexes; 5,000 hotels ≈ 425,000 and 1.6 million [E].
- What that costs: the database's own catalog gets large; every connection that touches many hotels caches more of it (memory); autovacuum has more tables to look at; **a release that adds a hotel migration runs it hotel by hotel (45 hotel migrations exist now)**, so the release time grows with the hotel count; backup and restore of one huge database take longer and are all-or-nothing.
- This is also why "just a bigger database" stops working: the answer is a **hotel-to-database map** (section 3, step 4).

### 2.3 Sign-in password hashing (at shift starts)
See 1.4. First visible as slow or failing sign-ins, while the rest of the system looks healthy.

### 2.4 Vercel function cost and cold starts
- Every API request is one function call; 5,000 a second ≈ 18 million an hour [E]. Cost drivers: calls, active processor time, memory time, bandwidth. Fluid compute reuses warm instances (checked in the region runbook); instances still **do not share the session cache**.
- PDF routes allow 60 s and the renderer runs two at a time per process, a 15 s timeout, a queue of 50 [C, `documents/renderer.ts`]: a month-end burst of PDFs needs its own worker, not the web function.
- The Pathik reader is a headless browser in one function (up to 300 s [C]).

### 2.5 Mail and daily jobs (breaks by hotel count, not by users)
- **Daily summary** walks **every hotel one after another inside one function that may run 60 s** [C, `dailySummaryService.run`, `cron/daily-summary` maxDuration 60]. Each hotel costs a settings read plus a dashboard (about 11 statements) ≈ 0.1–0.3 s [E], so it stops finishing at **about 200–600 hotels [E]**. It must become one small task per hotel on a queue.
- **Backup** is one pass over all hotels with up to 300 s [C]; same shape.
- **Mail**: measured **about 500 mails a second per worker** with a fake provider, a sign-in code waiting at most 237 ms behind a 50,000-mail campaign [M, load test 18 Oct]. The database is not the limit; the mail service's own rate and daily limits are. Already built: lanes, daily caps, holds, suppression. Needed at scale: workers that are not the web function (the cron route cannot finish a big campaign alone) and one mail service per hotel group.
- The Pathik reader runs once per click, not on a timer (18 Oct decision): no job cost.

---

## 3. The steps, with milestones

Milestone = the number of people at once the step is meant to carry **[E target]**. Each step ends with a measurement (section 4); if it fails, we stay on that step until it passes.

### Step 1: 1,000 at once. India, paid Neon, pooled connections
- Move the database and the functions to India (runbook); `DATABASE_URL` through Neon's pooled host; `DB_POOL_MAX` 3–5; Neon **scale-to-zero off**; Fluid compute on.
- A paid Neon plan with a compute sized from the measurement, not from this document.
- Remove the repeated reads inside a request (room board reads rooms and room types three times): a small request-scoped cache in `loaders.ts`/`roomService.ts`. Saves about 30% of the busiest screen's statements [E].
- Dashboard: stop reading two months of cash movements for the month and trend figures on every open; a per-hotel, per-day summary row (a small table, a migration) written when an entry changes. Saves the biggest statement of the home page [E].

### Step 2: 5,000 at once. Shared cache, a read copy
- **A cache that all instances share** for sessions (the 10 s `SESSION_CACHE_MS` is per process today) and hotel settings. Smallest change: an interface with the same shape as the `Map` in `sessionResolver.ts` and a hosted key-value store behind it; a revoke or block clears the key (today's "within ten seconds" promise stays).
- **A read copy (replica) of the database.** Smallest change in our code:
  - `createDatabase` (db/index.ts) builds a second pool for the replica;
  - a read-only route (the wrapper already knows the method, GET and HEAD) uses `withHotelRead` instead of `withHotel`;
  - after a person's own write, that person's next reads use the primary for a few seconds (a `lastWriteAt` kept with the session), so nobody sees their own entry missing.
- Limits and counters off the database: today's route limits are rows in `platform` (writes on every limited request); move them to the shared cache.

### Step 3: 10,000 at once. Daily jobs and sign-in off the web function
- **Queue and workers off Vercel:** the mail worker, daily summary (one task per hotel), backups, PDF rendering and the Pathik reader run on one or two small servers (the VPS path already exists in the code: `HMS_MAIL_WORKER`, the Pathik loop). The outbox already uses `FOR UPDATE SKIP LOCKED` [C], so several workers share it safely.
- **Sign-in queue** and reserved processor for password checks; a limit per account and per address at the edge.

### Step 4: 25,000 and then 50,000 at once. Many databases, a hotel-to-database map
**The smallest change in our code** (a hotel keeps its schema, its role and every query exactly as today; only the pool changes):
1. `platform.hotels` gets a column `db_id` (a short name such as `db01`). A migration and a Neon-SQL file; nothing else about a hotel changes.
2. The access read that every request already makes (`access.load`, which joins `platform.hotels`) also returns `db_id`; it travels in the `VerifiedSession` next to `hotelId`.
3. `createDatabase` (db/index.ts, `db/pool.ts`) keeps **a map `db_id → shared pool`** built from environment variables (`DATABASE_URL_DB01`, …). `withHotel(session, …)` takes the pool of `session.dbId`. `hotelSchemaName`, `setHotelRoleSql` and `withHotel`'s transaction steps stay as they are.
4. **The platform database stays one** (people, sessions, hotels, outbox, audit): it becomes the directory, so its own load is the next thing to watch (it gets the shared cache and its own replica). Hotel data moves out of it.
5. **create-hotel** (`db/scripts/create-hotel.ts`) picks the database with room (fewest hotels under the cap) and records `db_id`; **migrate** (`db/scripts/migrate.ts`, `cli.ts`) lists hotels with their `db_id` and runs each database's hotels in parallel across databases (a release takes about the time of the biggest database, not the sum).
6. **Moving a hotel between databases:** the same backup/restore tooling as the region runbook, per schema (`pg_dump --schema=hotel_<hex>`), then the `db_id` flips; a short freeze for that hotel only.
7. **What crosses hotels today** must be checked: the all-hotels portal and group console read hotel by hotel; with several databases they become one call per database (already a loop in the code [E, to confirm in the load test]).
8. The **cap is the lever**: when a database nears the cap (300–500 hotels [E]) new hotels go to the next.

### Also for the last steps
- **A protection layer** in front: Vercel's firewall or an edge service for bot and flood protection, per-address and per-account limits before our code runs, a hard daily limit per hotel group so one hotel's script cannot starve another.
- **Monitoring** (section 4): without it we find the limit by an outage.
- **Static files and images from a CDN**; photos already use object storage (`MEDIA_DRIVER=s3`).

---

## 4. What to measure at each milestone, and the load-test plan

### 4.1 What to measure (the same list at every milestone)
| Measure | Why | Pass line [E: the code's own speed budget, `http/wrapper.ts`] |
|---|---|---|
| Answer time p50/p95/p99, reads and writes, per screen | the user's experience | reads p95 ≤ 150 ms, writes p95 ≤ 300 ms; no answer slower than 2 s |
| Errors per thousand and which codes | where it breaks | under 1 per thousand |
| Statements a second, and the top 20 statements by total time (`pg_stat_statements`) | what to fix next | stable under load |
| Database processor %, memory, and busy/waiting connections | the real ceiling | processor under 65% at the milestone |
| Pool waits (`pool.waitingCount` already exposed in `db/pool.ts`) | connection starvation | zero waiting at steady state |
| Session cache hit rate (with and without the shared cache) | the per-instance cache is weak | above 90% |
| Sign-in: time and failures at 167 a second | the shift start | p95 ≤ 3 s |
| Function cold starts and active processor time | cost and speed | tracked per route |
| Mail: queue depth, a sign-in code's delay behind a campaign | already proven at 237 ms [M] | stays under 1 s |
| Daily job: time per hotel and whether it finishes | the hotel-count wall | finishes inside its limit |
| Release: minutes to run the newest hotel migration over all hotels | the schema-count wall | tracked per hotel count |

### 4.2 Draft load-test plan (copies only, never live)
Rules: a separate database and a separate Vercel/preview or local server; **synthetic data only**; no real address, no real mail (the fake mail provider), no Pathik; the live Neon project is never named in a script.
- **Phase A: the database layer (days).** Extend `tests/db/load.test.ts` (which already runs 20 hotels × 10 parallel units through 8 connections). New: N fake hotels made with the real `create-hotel` (N = 50, 200, 1,000; time how long that takes, it is the schema-count number), filled with believable volumes (50 rooms, 20,000 bills, 5 years of cash entries), then virtual users call the real services (dashboard, room board, In House, bills list, check-in, check-out) at 100, 1,000, 5,000 statements a second. Record 4.1 with `pg_stat_statements`.
- **Phase B: the whole web stack (a week).** `next start` on a test machine with a Postgres behind a pooler in transaction mode (PgBouncer, as Neon's pooler works) in a copy of the India setup; an HTTP load tool (k6) with a pool of test accounts: a 60/30/10 mix of reads, small writes, sign-ins, ramping 100 → 1,000 → 5,000 requests a second; also the **sign-in storm** (167 a second for 5 minutes) and a PDF burst.
- **Phase C: a staging copy of the real infrastructure (a week).** A second Neon project and a Vercel preview project in the India region with the same settings as live and none of its data; the same scripts at the milestone's load. The result goes to this document as a table: measured value beside each [E].
- **Phase D: the many-databases change** is tested first with 2 databases and 400 fake hotels: a hotel's requests go to its pool only; a hotel moved between databases keeps working; a release migrates both in parallel.
- Every phase ends with a written pass or fail against 4.1 and a list of the top three fixes.

---

## 5. Cost drivers (no prices)

| Driver | Grows with | Lever |
|---|---|---|
| Database compute (Neon): size × hours, one per database, plus replicas | statements a second; number of databases | remove repeated reads; summaries; read copy; more databases only when a cap is reached |
| Database storage | hotels × years of data; photos if kept in the database (they are not: object storage) | retention rules; compress old years |
| Database data transfer / backups storage | backup frequency × size; copies kept (14 daily + 8 Sunday [C]) | tune retention |
| Vercel functions: calls, active processor time, memory time, bandwidth | requests a second; heavy routes (PDF, Pathik) | Fluid compute; move heavy routes to workers; edge cache for static files |
| Password hashing processor | sign-ins per hour (shift starts) | workers with reserved processor; longer sessions (fewer sign-ins) |
| Shared cache (key-value store) | sessions and settings cached | small; sized by active sessions |
| Workers (a small server or two) | mail, daily jobs, backups, PDFs, the Pathik reader | one box each until measured |
| Mail service (per mail) | mails sent (campaigns, codes, summaries) | per-hotel caps, suppression (built) |
| Protection layer / firewall | traffic | one plan for all |
| Monitoring and error tracking | events and retention | sampling |
| Engineering time | the four steps above; each is days, not months, except step 4 (about two weeks plus tests) [E] | do the steps in order; stop when the target is proven |

---

## 6. Open points
1. **Hotels per person at once** (decision 1) fixes how many hotels 50,000 means.
2. **Neon limits and plans** change: the connection limit, the largest compute, replicas and region list must be read on Neon's page at the time of the decision; none of those figures is used here.
3. **The two bigger savings are cheap and independent of the scale target:** the repeated reads in the room board and the dashboard's two-month cash read. They can be done any time.
4. **The estimates for the five busiest screens** are counted by reading the code paths (the loaders, the repositories); the load test replaces them with `pg_stat_statements` counts per request.
5. **Cash book and Revenue lists** were not counted here; they are expected to be small (a few statements each) [E].

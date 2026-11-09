---
name: hms-system-design
description: System design knowledge for the HMS backend, built on six reference repositories MJ chose (System Design Primer, ByteByteGo System Design 101, Karan Pratap Singh's System Design, InterviewReady resources, Awesome System Design, Awesome Scalability) and tied to HMS's own scaling plan. Use this skill whenever MJ or a session asks how many users HMS can handle, how to scale to 1,000, 2,500, 10,000 or more live users, servers, hosting, caching, Redis, read replicas, queues and background jobs, double booking, database choice (PostgreSQL vs MySQL, Supabase, Neon, self-hosted), backups and uptime, load testing, or cost of infrastructure, even if no repository is named.
---

# HMS system design

MJ picked six system design repositories as the reference for planning how HMS is built behind the screen. They teach the general theory; HMS's own documents hold the facts about this system. Use the repositories for the method and the vocabulary, and the HMS documents for every number.

## Read HMS's own facts first

| Question | Document |
|---|---|
| What breaks first, load arithmetic, the four scaling steps, what to measure | `docs/plans/SCALING-PLAN-2026-10-18.md` |
| The 20,000-live target, phases, service targets, Docker and Redis proposal | `docs/plans/MASTER-PLAN-20K-LIVE-50K-TOTAL-2026-10-19.md` |
| Database rules, isolation per hotel, transactions, API wrapper, tests | `docs/BACKEND.md` sections 4 to 9 |
| Backups, restore check, health routes, runbook | `docs/OPERATIONS.md` |
| Binding decisions (PostgreSQL 18 is final, decision 10) | `docs/DECISIONS.md` |

Every capacity figure in those plans is tagged [E] estimate, [C] counted from code or [M] measured. Keep the tags when quoting them, and say plainly that no load test has run until one has. Do not present an estimate as a measurement.

## The six repositories

Open the repository with WebFetch and read the section that answers the question, rather than relying on memory. Several sections are dated (the Primer was mostly written around 2017), so check a newer source for anything about specific products or prices.

| Repository | Link | Best for |
|---|---|---|
| System Design Primer (donnemartin) | https://github.com/donnemartin/system-design-primer | the main reference: load balancer, cache, database, replication, sharding, queues, consistency, availability; worked interview problems |
| System Design 101 (ByteByteGo) | https://github.com/ByteByteGoHq/system-design-101 | short visual explanations to show MJ a concept in one picture |
| System Design (Karan Pratap Singh) | https://github.com/karanpratapsingh/system-design | book-style chapters, read front to back for a topic in depth |
| System Design Resources (InterviewReady) | https://github.com/InterviewReady/system-design-resources | collected papers and engineering blog posts by topic |
| Awesome System Design (madd86) | https://github.com/madd86/awesome-system-design | curated articles, videos and tools |
| Awesome Scalability (binhnguyennus) | https://github.com/binhnguyennus/awesome-scalability | real company scaling stories, to show how others solved the same wall |

## How the theory maps onto HMS

| Topic in the repositories | Where HMS stands | Next step in HMS's plan |
|---|---|---|
| SQL with transactions | PostgreSQL 18, one schema and one role per hotel, version checks, advisory locks, idempotency keys | keep; decision 10 makes it final |
| Strong consistency, preventing double booking | one in-house stay per room is a database trigger; reservation and website overlap checks are in app code | move the overlap rule into a database constraint when touched |
| Caching | session cache per server process for 10 s; no shared cache | shared cache (Redis) for sessions, settings and rate limits, with database fallback (scaling step 2) |
| Read replicas | none | a read pool for GET routes; read-your-own-writes for a few seconds after a write (step 2) |
| Message and task queues | outbox with SKIP LOCKED for mail; nightly jobs walk every hotel in one function | one task per hotel on workers off the web function (step 3) |
| Sharding and partitioning | one database, hotels as schemas | a `db_id` per hotel and a pool map, cap 300 to 500 hotels per database (step 4) |
| Load balancing and statelessness | one web app; sessions in the database | two or more web servers behind a load balancer once self-hosted |
| Backups and availability | nightly per-hotel copy, restore check, health routes; no alerting, no failure drill | point-in-time recovery, monitoring with alerts, a drill per phase |

## Method the repositories teach, applied here

1. Start from the numbers: users at once, requests a second (HMS plan: R = U / 10), statements a second (about 10 per request).
2. Find the first bottleneck from the numbers, not from intuition.
3. Change one thing, then measure on a copy with fake hotels, never live (scaling plan section 4).
4. Write the rollback line before each step.
5. Never loosen security for scale: per-hotel roles stay, a cache holds no secrets, a replica uses a read-only role.

## When answering MJ

Lead with the number or the recommendation, mark estimates as estimates, give costs in rupees as well as dollars when asked (and say the exchange rate and date used), and read current prices from the providers' own pages at the time; never quote a price from memory.

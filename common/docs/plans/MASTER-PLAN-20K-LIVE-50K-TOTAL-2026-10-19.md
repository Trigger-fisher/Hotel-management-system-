# Master plan: 20,000 people live at once, 50,000 users in total (PM, 19 Oct 2026)

For MJ. Built on `docs/plans/SCALING-PLAN-2026-10-18.md` (claude-41: the load arithmetic, counted from the code) and the region and mail plans. Nothing here has been load-tested yet. Every figure is an **[E] estimate** until the test of its phase says otherwise. No prices.

## 1. The target in plain words

- **50,000 users in total** = accounts that exist: hotel staff, guests, companies, group admins. Accounts at rest cost almost nothing: 50,000 rows in a table is small. This part is easy.
- **20,000 live at once** = people with the site open and clicking at the same moment. This is the hard part. 20,000 of 50,000 is 40% online together, which is very high (software like this usually sees 5 to 15%). It is only realistic at shift starts across many hotels. **Plan for 20,000 live as the peak and 5,000 as the normal busy hour.**
- A hotel has about 5 to 10 people live at once, so **20,000 live is about 2,000 to 4,000 hotels** and **50,000 users is about 4,000 to 10,000 hotels' worth of accounts** [E]. Hotel count matters as much as user count, because every hotel has its own set of about 85 tables.

**What 20,000 live means for the machines [E, from the counted formula R = U / 10]:**
- about **2,000 requests a second** (4,000 at the stress case)
- about **20,000 database statements a second**
- sign-in storm at shift start: 20,000 people in 5 minutes is about **67 sign-ins a second**, about 5 processor cores of password checking alone

## 2. What we are today

One shared database and one schema per hotel, in the US region (Vercel Washington DC, Neon), a session cache per server process, daily jobs and mail on Vercel, Pathik reader on Vercel. After the India move and a paid database we honestly expect about **1,000 people live at once**. Everything above that is the work below.

## 3. The phases

Each phase ends with a measurement on a copy of the system with fake hotels, never live. If the number isn't met, we stay on that phase.

| Phase | Name | Live at once after it [E] | What is built | Your part |
|---|---|---|---|---|
| **0** | Measure first | (no change) | A load-test harness on a copy of the database: fake hotels, fake staff, a script that does the real clicks (sign-in, dashboard, room board, check-in, bill, payment). Baseline numbers for today. | Approve the harness; a Neon plan for the copy |
| **1** | India, paid, pooled | **1,000** | Move live site and database to India (runbook ready). Paid Neon with a sized compute, pooled connections, scale-to-zero off. Cut repeated reads (room board). Dashboard summary row instead of reading two months every time (one hotel migration). | One evening for the move; the paid plan |
| **2** | Shared cache, read copy | **5,000** | Sessions and settings in one shared cache. A read-only copy of the database for reports, dashboards, lists, portals. Route limits off the database. | A cache service and a replica on the plan |
| **3** | Jobs and sign-in off Vercel | **10,000** | Mail, daily summary (one small task per hotel), backups, PDF and Pathik run on one or two small servers (the Hostinger one). Sign-in queue ("wait 20 seconds", not an error) with reserved processor. | The server and its access |
| **4** | Many databases | **25,000** (covers 20,000) | A `db_id` per hotel and a map to several databases (300 to 500 hotels each [E]). Platform database stays one, the directory, with its own cache and copy. Create-hotel picks the database with room; releases run databases in parallel; a hotel can move between databases. | The cap decision; more databases on the plan |
| **5** | Proof and safety | 20,000 proven | A full test at 20,000 live and the 5-minute sign-in storm; failure drills (a database down, a region slow); monitoring with alerts; a runbook for each alert. | A test window; on-call decision |

**Rough effort [E]:** phase 0 about 3 days; phase 1 about 3 days plus the evening; phase 2 about 5 days; phase 3 about 7 days; phase 4 about 10 days; phase 5 about 5 days. **About 33 working days of one backend session, in order**, less if two sessions share phases 2 and 3. Frontend work is small (a "please wait" screen for the sign-in queue, status page).

## 4. What must be true at every phase (rules, not features)

1. **One change at a time, one measurement after it.** No phase starts before the previous one met its number.
2. **A hotel never loses data in any move:** a backup before, row counts and money totals compared after (the region runbook already has the read-only check for this).
3. **Rollback line for every step**, written before it runs.
4. **Security does not loosen at scale:** per-hotel roles stay; the new cache holds no secrets; the replica uses a read-only role; every new route goes through the same deny lists and route inventory test.
5. **Monitoring first:** slow requests, database connections and processor, queue lengths, failed mails, failed sign-ins. Alerts go to you by mail and phone.
6. **Cost watch:** a monthly cost line per phase; the hotel cap is the main lever for database cost.

## 5. What breaks first, and the order we fix it (from the scaling plan)

1. Database processor and connections (phases 1, 2)
2. Hotels per database: tables and release time (phase 4)
3. Sign-in storms (phase 3)
4. Vercel cost and cold starts (phases 1, 3)
5. Daily jobs that walk every hotel (phase 3, and already batched in code)

## 6. Risks

- **The target itself:** 20,000 at once may be a stretch goal. If the real peak is 5,000, phases 0 to 2 are enough for a year and phase 4 is delayed with no harm.
- **Neon limits and prices change:** we read the current plan page before each decision; we use no figure from memory.
- **Hotels per database cap:** wrong cap means an early split. Start at 300 and raise it when measured.
- **Vendor lock-in:** a second provider is possible later because the per-hotel schema moves with plain backup tools.
- **People:** one person on call for a live system of this size is thin; plan a second.

## 7. What I need from you (in this order)

1. **Confirm the target.** Is "20,000 live" the peak at shift start, and does 50,000 total include guests and companies? (It sets how many hotels to plan for.)
2. **Approve phase 0** (the load-test harness, on a copy only) and a Neon plan for the copy.
3. **Do the India move** (runbook `docs/deploy/REGION-MOVE-INDIA-2026-10-18.md`) when the Neon SQL and Pathik work is settled.
4. **Choose the order:** this plan's order is recommended.
5. **Say which sessions work on it,** and whether it comes before the front-desk features or after (my advice: phase 0 now, then front-desk features in parallel with phase 1).

## 8. What happens this week if you approve

- Phase 0: a backend session builds the harness and runs the baseline on the copy; you get one page with the first real numbers: how many people today's system carries, and what slows first.
- Phase 1 preparation: the Neon plan page checked, the India move rehearsed on a copy (the runbook's step A1), the dashboard summary row designed.
- Nothing changes on the live site until a phase passes its test.

---

## 9. PROPOSED 19 Oct (NOT approved, nothing built): Docker, Redis, and the gates of the outside plan

### 9.1 Tools
| Tool | Proposal | Phase | What would be built (only if MJ says go) |
|---|---|---|---|
| **Docker** | Yes | 3 (start early, low risk) | One image for the app and the workers (Next.js standalone build; Chrome inside for PDF and the Pathik bot). `docker compose` on the Hostinger server: workers (mail, daily summary, backups, PDF, Pathik), Caddy in front, health checks, restart on failure, an env file that is never committed. Version change = build image, restart; rollback = start the old image. |
| **Redis** (hosted, e.g. Upstash, reachable from Vercel) | Yes, behind a switch that is OFF by default | 2 | A shared cache with the same shape as the session Map in `sessionResolver.ts` (sessions, hotel settings), and the route/sign-in limits moved off database rows. Revoke or block clears the key ("within ten seconds" stays). If Redis is down the app falls back to the database: it must never take sign-in down. Turned on only when the phase 0 test shows session lookups or limit writes matter. |
| **Kubernetes** | Not planned now | after 4, only if needed | Only if we run the web app ourselves on many servers. Before it: a managed container service (Cloud Run, Fargate, Fly.io). If it comes: managed (EKS or GKE) with a DevOps person. |

### 9.2 Gates adopted from the outside review (19 Oct)
- **Service targets at 20,000 live:** dashboard and list p95 <= 500 ms; writes p95 <= 800 ms; p99 <= 2 s; unexpected 5xx < 0.1%; no sustained pool wait or function throttling; database headroom >= 30% at the tested peak; no cross-hotel data seen.
- **Test ramp (staging copy, never live):** 100, then 1,000, 5,000, 10,000, 15,000, 20,000; hold 20,000 for 60 minutes; then 25,000 for 30 minutes as margin. A separate sign-in surge test and a separate failure test. Stop if 5xx > 1% for 5 minutes, p95 > 2 s for 5 minutes, the database reaches 85% of its limit, an isolation check fails, or the test spend cap is reached.
- **Gradual rollout after the test passes:** one hotel, then 5%, 20%, 50%, everyone, each after a busy period inside the targets, with rollback steps ready.
- **Recovery targets (until you set them):** data loss at most 15 minutes, back in service within 2 hours; a backup is restored into an isolated database and checked; an alert when a hotel has no recent successful backup.
- **Cheap load cuts, phase 1:** jitter on the 60-second session check and the 120-second bell and portal-unread checks; pause them in hidden tabs (check on becoming visible); lengthen the session check (any 401 already ends the session). At 20,000 live the checks alone are about 500 requests a second today.
- **Admin protection:** a second step (code) for every platform, group, hotel, payroll and ID-photo administrator, with audited recovery; a list of sensitive data (bank, government ID, ID photos) with retention and deletion rules.
- **Corrections to the outside plan:** our database pool default is 20 (advice 3 to 5 on Vercel, to be set after the connection budget); the backup route exists and is scheduled.

### 9.3 ID photos in the database (MJ, 19 Oct)
Fine for the pilot. At about 10 check-ins a day per hotel and 400 KB per photo, 1,000 hotels add about 1.5 TB a year to the database: before about 100 hotels the photos move to private object storage (a copy: the storage layer is built so that is a switch, not a rewrite), with a retention rule.

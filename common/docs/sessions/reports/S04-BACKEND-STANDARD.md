# HMS Backend Engineering Standard

**Status: DRAFT input from hms-5e for "Backend review" (the backend master named by MJ). Not binding until Backend review adopts it. Version 1.0, 2026-10-05.**

Applies to: Backend 1 and every later backend session. Written by the Backend Chief Architect, then checked against four hostile reviews (section 0.5).
It replaces `Backend Review/01-BACKEND-STANDARD.md`, `02-PRODUCTION-READY-CHECKLIST.md` and `03-TASK-PLAN.md`; keep those as history.

---

## 0. How to use this document

### 0.1 Binding rules

- **MUST / MUST NOT**: required or forbidden. A review fails if a MUST is not met.
- **SHOULD**: do it, unless you write down why not in the session file and the Lead agrees.
- **MAY**: allowed, not required.
- Every rule has an ID (for example `NX-3`, `SE-12`, `DB-7`). Reviews and code comments cite these IDs.
- **Order of authority** (highest first):
  1. MJ's own words and dated decisions.
  2. `MASTER.md`. Exception: where MJ's S04 decisions replace it (one schema per hotel, the Pallav login), MJ's decision wins. Those MASTER sections wait for MJ's approval to be rewritten (Q1, section 15).
  3. This standard.
  4. Session briefs.
- **Conflict rule:** if a task conflicts with this standard or with MASTER, stop. Write the conflict in the session file and ask the Lead. Never guess.
- **Pallav-exact rule (MJ: "nothing a single thing is changed").** Behaviour is Pallav's. Only two kinds of change are allowed without asking:
  1. A fix for a Pallav defect that a test can show (a race, a wrong order of checks, float money, a missing check), where every legitimate user sees the same screens and the same words.
  2. Server-side hardening that no legitimate user can notice.

  Anything a legitimate user can notice is a question for MJ (Q2). It is built behind a named switch in `server/auth/policy.ts` (or the module's own policy file) whose default is Pallav's behaviour until MJ answers.
- **MJ's gates still apply:**
  - R1: one feature at a time.
  - R2: no work without "go" (the Lead sends Backend 1 "START").
  - R9: no commit and no push.
  - R11: no new library, tool or server without MJ's OK (section 12).
  - MASTER 6.3: high-risk work (login, isolation, money, migrations, deletes) needs tests first and a written rollback plan.
- **Approved stack:** Next.js 16.3.8, React 19.2.8, TypeScript (strict), PostgreSQL 18, `pg`, `argon2`, `zod`, `nodemailer`, `tsx`, `babel-plugin-react-compiler`. `pg`, `argon2` and `nodemailer` are approved but **not installed yet** ("install when the backend starts"): step 0 of section 13. Anything else: section 12.
- **Files Backend 1 owns:** `web-app/src/app/api/**`, `web-app/src/server/**`, `web-app/tests/server/**`, `db/**`, `docs/DATABASE.md`, `docs/API.md`.
- **Shared files** need the Lead's OK before every change: `next.config.ts`, `eslint.config.mjs`, `package.json`, `package-lock.json`, `tsconfig.json`, `next-env.d.ts`, `src/instrumentation.ts`, `.env.example`, anything in `ui-shared/`. The UI sessions run their dev server from the same folder.

### 0.2 What was verified, and how

Every Next.js, pg, zod, argon2 and PostgreSQL detail below was checked, not remembered.

- **Next.js 16.3.8:** read in the installed docs and source (`web-app/node_modules/next/dist`). Paths are cited in section 3.
- **Reference code (section 4):**
  - Type-checked with TypeScript 5.9.3 against the installed `next` and `zod` 4.6.5, plus `pg` 8.23.1, `@types/pg` 8.23.1 (approval pending) and `argon2` 0.45.1 in a scratch workspace.
  - 14 unit tests pass without a database (section 10.4).
  - 10 database tests pass through the real wrapper, connected as `hms_app`, against a throwaway PostgreSQL 18.6. That database was built from Backend 1's real platform migrations `0000`–`0006`, `0099_grants` and the platform seeds, plus the section 7.9 additions, with two hotels made by the section 7.2 transaction from the real 67-table hotel template and hotel seeds.
  - ESLint 9.39.5 + typescript-eslint 8.71.0 boundary rules (section 3.8): 8 planted violations caught, no false alarms.
- **SQL, on throwaway PostgreSQL 18.6 clusters (deleted afterwards):** per-hotel role isolation and its limit (SET ROLE escape); reset of role, search_path and TimeZone after COMMIT; append-only audit; the idempotency race; the rate-limit upsert; the jobs guard, dedupe scope and fair claim; concurrent sign-in with and without the user-row lock; `pg_stat_statements` grouping across hotel schemas; catalog-cache memory with 100 hotel schemas; single-hotel `pg_dump` time; list and total plans on 66,000 seeded deposits.
- **Node:** pg-pool removes its own error listener while a client is checked out. Without our listener, a backend ended mid-transaction **kills the whole Node process** (reproduced; fixed in 4.2.5). argon2 0.45.1 returns `false` at once (no throw) for a bcrypt string. One argon2id verify takes about 31–35 ms on the dev PC.
- **Kept from the first draft:** `import "server-only"` in instrumentation and routes was proved with a throwaway Turbopack `next build` and `next start`.
- **Pallav facts:** read in the Pallav source. Paths are cited where used.
- **Not verified here (needs the Linux server):** the nginx config (`nginx -t`), the systemd units and a standalone Linux build. They are marked "sketch".

Scratch workspace (may be deleted; every code block marked `verified` below is copied from it byte for byte): `C:\Users\infoj\AppData\Local\Temp\claude\c--Users-infoj-Desktop-HMS\f3766eb2-2534-4d56-998f-04bce25e6baa\scratchpad\typecheck2` and `...\pgx\v`.

### 0.3 Decisions where the research disagreed

| # | Topic | Options seen | Decision | Why |
|---|---|---|---|---|
| 1 | Folder layout | module folders vs layer folders | Layer folders (`services/`, `repos/`). Zod schemas sit next to their service. | The Lead's tree; one place per layer. |
| 2 | DB code location | `src/db` vs `src/server/db` | `src/server/db`. Move `schemaName.ts` and `types.ts`; `withHotel.ts` is replaced by `tx.ts`. | One backend root; one `server-only` rule. |
| 3 | Success body | raw data (`docs/API.md`), `{data}`, `{data, meta}` | `{ "data": T }`. T is exactly the ui-shared contract type. `meta` is reserved, additive only. | Same shape as `{error}`; room to grow. |
| 4 | Validation status | 400 vs 422 | 422 `VALIDATION_FAILED` (already built). 400 `BAD_REQUEST` for a body that cannot be read. | No churn; clear meaning. |
| 5 | Trace header | `X-Request-Id` vs `x-trace-id` | Keep `x-trace-id`. In production nginx always sets it to its own `$request_id`; a client's value is never trusted. | Already built and tested; audit rows cannot carry a forged id. |
| 6 | Pagination | keyset everywhere vs capped offset | Capped offset (the contract's `Page<T>`). The default window of a book list is the current accounting year (Pallav `Books::scope`). Keyset only for append-only logs, after the Lead adds `cursor`. | The Lead owns the contract; plans tested (section 7.7). |
| 7 | Pool size per process | 10 / 15 / 20 | `DB_POOL_MAX` default 10. | Budget in section 8.2. |
| 8 | Timeouts | statement 5/10/15 s; lock 2/3/5 s; idle-in-tx 10/15 s | 5 s / 3 s / 10 s, and `transaction_timeout` 30 s. `setup-db.ts` (15 s / 5 s today) must change. | Long work goes to the worker. |
| 9 | JSON body cap | 1 MB vs 256 KB | 256 KB default, per-route override. | HMS forms are small. |
| 10 | search_path order | `pg_catalog, hotel` vs `hotel, pg_catalog` | `hotel_<hex>, pg_catalog` (as built). | Tested: with pg_catalog first, `current_schema()` returns `pg_catalog`, which breaks the per-hotel advisory-lock keys. |
| 11 | Per-hotel database role | SHOULD vs MUST | MUST. It stops **mistakes** (wrong search_path, a qualified name, a missing filter). It does **not** stop injected SQL (section 1, fact 3; tested). | Defence in depth; parameterised SQL is the first defence. |
| 12 | 5-try lock | timed ladder vs permanent block | Pallav: a block with no timer (`OneTimeCode::block`). `LOCK_STEPS` is used only for the code-send wait. Q2(a) asks for the timed ladder. | Pallav-exact rule. |
| 13 | Session model | refresh-token rotation (old `0004_auth.sql`) vs Pallav | Pallav: an opaque database session (web cookie, 120 min idle) and a 90-day token per phone. No refresh tokens. | MJ decision (S04 #1). |
| 14 | One session per user | web + mobile vs web only | Web only, as Pallav. Phone tokens: one live token per (user, device id). Pallav has no device id and no limit; replacing the same phone's old token is invisible hardening. | `EnsureSingleSession.php`, `MobileToken.php`. |
| 15 | Cookie name | `__Host-hms_sid` vs `__Host-hms_session` | `__Host-hms_session` | |
| 16 | Pending sign-in state | web cookie vs body | Body, for web and mobile (one code path). | Same XSS exposure either way. |
| 17 | Permission model | Pallav catalogue vs 4 levels | MJ's 4 levels on Pallav's keys (seeded). A part inherits its module's level; a revoke always wins. A route's need may be worked out from the validated input (Pallav part keys such as `revenue.hotel`). | MASTER section 2 plus the exact port. |
| 18 | Permission cache | in-process + LISTEN/NOTIFY vs none | None. Levels come with the session query. | No stale rights; tables are tiny. |
| 19 | `last_seen_at` writes | every 60 s vs every 5 min | At most every 5 minutes, after the response. | Idle limit is 120 min. |
| 20 | Code emails | outbox vs synchronous | Sign-in code and new-account email: synchronous after COMMIT, 10 s timeout (identity proven or admin action). Reset codes: Pallav (synchronous) until Q2(b); with Q2(b) through the outbox so every answer takes the same time. Everything else: outbox. | Pallav shows "could not send" at once; enumeration safety needs constant time. |
| 21 | Worker | inside instrumentation vs separate process | A separate process under systemd, from the same release folder. Needs MJ's OK (MASTER 3: "separate backend server"). | `register()` runs once per instance: N instances would mean N workers. |
| 22 | Rate limits | memory vs PostgreSQL | Pallav's throttles in PostgreSQL (an UNLOGGED table), counted in their own statement before the request transaction. The per-IP sign-in brake counts failures only and a success never clears it. IPv6 counted per /64. nginx at the edge with a JSON 429. | Exact across instances; no Redis; a refusal still counts. |
| 23 | CORS | per-route allowlist vs none | None in production. | Web is same-origin; native mobile needs no CORS. |
| 24 | `server-only` | install the package vs a resolve hook | The hook (section 10.2). | No new package. Verified with tsx and Turbopack. |
| 25 | `connection()` in GET handlers | call it vs not | Not used. The wrapper reads request headers first, and a build check confirms every route is dynamic. | `connection()` throws outside a request. |
| 26 | "No token" error code | `UNAUTHENTICATED` vs `SESSION_EXPIRED` | `SESSION_EXPIRED` | One client path ("Please sign in again."). |
| 27 | Reused idempotency key | 409 vs 422 | 422 `IDEMPOTENCY_KEY_REUSED`. The hash covers method, route, path ids, query and body (tested). A request still in flight waits, then 409. | |
| 28 | Percent values | basis points vs decimals | Decimals with at most 2 places, as the contract has them; all math through `paise.ts`. | No contract change; exact. |
| 29 | Audit of hotel data | `platform.audit_log` vs a new hotel table vs Pallav's `system_logs` | Pallav's `system_logs` in the hotel schema (a `SystemLogger` port), written in the same transaction, plus one added `trace_id` column. No second audit table. Platform actions go to `platform.audit_log`; sign-in events to `platform.auth_events`. | Exact port; one audit channel per scope. |
| 30 | Migration transactions | per schema vs per file per schema | Per file per schema (as built). | Smaller locks; resume per file. |
| 31 | Online hotel creation | SECURITY DEFINER vs job | Phase 1: a CLI run as `hms_owner`. Later: a provisioning job run by an owner-privileged worker. | Keeps DDL power away from `hms_app`. |
| 32 | DB command-line tools | `db/scripts` vs web-app | Pure logic stays in `db/scripts` (`migrate.ts`, `create-hotel.ts`, `setup-db.ts`, `env-store.ts`). Entry points that import `pg` move to `web-app/src/server/db/cli`. | `pg` resolves only inside `web-app/node_modules`. |
| 33 | Hotel role name | `hms_h_<hex>` vs `hotel_<hex>_rw` | `hotel_<hex>_rw`, as Backend 1 built and tested it. | No churn. |
| 34 | Failed attempts | throw (rolls back) vs keep | Counters persist: limits in their own statement; `failAfterCommit` commits, then answers the error (tested). | A rolled-back count means unlimited guesses. |
| 35 | Draining on restart | readiness 503 vs nginx | At nginx: mark the instance down, reload, wait, then SIGTERM. | Next closes its listener the moment SIGTERM arrives (`start-server.js` L320-345). |
| 36 | Unsupported methods | Next's empty 405 vs JSON | `methodsNotAllowed` in every `route.ts` (JSON 405). | One error format (MASTER 7). |
| 37 | Access log | every request vs sampled | Every error and slow request; a sample of fast 2xx (`ACCESS_LOG_SAMPLE`). | ~26 GB/day raw at 1,000 req/s if every line is kept. |
| 38 | Hotel affinity | random balancing vs hotel-sticky | nginx sends a hotel's requests to the same Node process. Required before about 100 hotels. | Measured catalog-cache cost per backend (section 8.9). |
| 39 | Dummy password hash | built lazily vs constant | A constant. | A lazily built dummy can fail once and stay failed. |

### 0.4 Old rule IDs (Backend Review/01) mapped to this document

| Old IDs | Now | What changed |
|---|---|---|
| T1–T6 (tenancy) | 7.2, 7.3 | The wrapper enters the hotel from the session; it also sets the role and TimeZone. |
| T7 (pool, timeouts) | 7.3, 8.2 | Pool 10, statement 5 s, lock 3 s. |
| T8 (create-hotel) | 7.2 | Adds `hms_tenant`, `provisioning`, the worker grant, no default DELETE. |
| R1–R6 (roles) | 7.1 | R2 replaced: `hms_app` gets no hotel-schema rights. |
| S1–S10 (schema) | 7.7, 7.8 | Same spirit. S9 is `repos/entryNo.ts`. |
| M1–M6 (migrations) | 7.5, 7.6 | Additions only. |
| A1–A11 (API) | 4, 5 | A8: four levels on Pallav keys. A10: `/health/ready`. |
| X1–X9 (security) | 6 | X2 replaced: Pallav sessions, no refresh tokens. |

Code comments that cite old IDs may stay until the file is next edited.

### 0.5 Review record

Four hostile reviews (security, scalability, Next.js, build practicality) raised 61 findings and 43 missing topics. All were checked against the docs, the code or a test.

| Finding | Verdict | Why |
|---|---|---|
| `pg_stat_statements` would need one entry per hotel | **Rejected** | Tested on 18.6: the same SQL on different hotel schemas is ONE entry (5 calls, 1 queryid). OP-4 was corrected too. |
| Page CSP with `script-src 'self'` | Partly | A page CSP is added (SE-35), but in the docs' form with `'unsafe-inline'`: the App Router writes inline scripts (`D/02-guides/content-security-policy.md` L417-451). Nonces are a later Lead decision. |
| A bcrypt hash makes `argon2.verify` throw (500) | Partly | Tested: 0.45.1 returns `false` at once for `$2y$...` (no throw), which leaks timing. Fixed (verify against the dummy). A string without `$` does throw: caught. |
| The 20-per-15-min per-IP brake is stricter than Pallav | Partly | It IS Pallav (`Auth/AuthController.php` L68-72, `Api/AuthController.php` L39-43, on top of `throttle:30,1`). The JSON 429 and NAT points are accepted. |
| A build inside `web-app` breaks the type check | Partly | Shared files ARE rewritten (`next-env.d.ts` now imports `.next-be` types that do not exist). `tsc` still passes, because TypeScript ignores unresolved side-effect imports. Separate-copy builds only (NX-19). |
| Monthly partitions per hotel for audit tables | Partly | Grants and purges fixed. Per-hotel partitions rejected: they add relations to every hotel (section 8.9). Retention is a parked MJ decision. |

All other findings were accepted; each fix sits in the rule it changed. The missing topics were added: platform-scoped admin actions (SE-4b), counters that survive a refusal (SE-11), security notices (Q2g), break-glass (OP-13), worker trust (SC-11), page CSP (SE-35), key rotation (SE-36), backup encryption (OP-9), bot protection (SE-22), phone device binding (SE-10), IPv6 and NAT (SE-23), high availability and RPO (OP-9, Q4), connection hold time (8.1), hotel affinity (8.9), a 500-hotel load test (8.8), load shedding (SC-16), autovacuum (DB-45), log and WAL sizing (OP-8, OP-9), migration time budget (DB-17), nginx drain (OP-10), a Next per-process benchmark (step 10), SMTP (section 12), TLS to the database (SE-27), a client query timeout (4.2.5), test credentials (10.1), concurrent sign-in (SE-9), job fairness (SC-7), Expo development (AP-16), upload backups (OP-9), 405 (NX-9), version skew (OP-10), build-time config (NX-12), build side effects (NX-19), streaming and RSC gzip (NX-22), trailing slash (NX-21), systemd restart limits (section 9), the edge guard (NX-13).

---

## 1. Architecture at a glance

```
  Browser (web UI, same origin)                       Expo app (iOS / Android)
  cookie __Host-hms_session (+ hms_aff hint)          Authorization: Bearer hms_m_<token> (+ X-Hms-Aff hint)
              \                                             /
               \ HTTPS                                     / HTTPS
                v                                         v
   nginx: TLS, HSTS, limits (JSON 429), gzip (+ text/x-component), X-Real-IP, X-Trace-Id = $request_id,
          /_next/static from /opt/hms/static (current + previous release), hotel affinity hash        (needs MJ OK)
                |  keep-alive to 127.0.0.1:4001..4006
                v
   Next.js standalone server.js x N (one per core, stateless; NO proxy.ts on /api)
     app/api/v1/<group>/<resource>/route.ts:  export const POST = hotelRoute({ name, permission, body, handler })
                |
     server/http/route.ts (THE wrapper)
        trace id -> CSRF origin check -> JSON body (capped) -> zod                  <- no database yet
        no credential -> 401 SESSION_EXPIRED                                          <- no database
        rate limits -> their own autocommit statement (they count even if the request then fails)
        one pooled connection, ONE transaction:
          authenticate (platform.sessions by token hash) -> permission (role levels + user grants, part keys)
          -> enterHotel: SET LOCAL role hotel_<hex>_rw, search_path hotel_<hex>, TimeZone, actor
          -> idempotency claim -> handler -> COMMIT -> { "data": ... }   (failAfterCommit: COMMIT, then the error)
                v
     server/services/<group>/*.service.ts   Pallav rules; no next/*, no pg
                v
     server/repos/<group>/*.repo.ts         SQL with $1..$n; an unqualified table = this hotel
                v
     server/db/tx.ts (TxClient) -> server/db/pool.ts (one pg.Pool per process, max 10)
                v
   PostgreSQL 18: platform schema + one schema per hotel (hotel_<hex>), each usable only through role hotel_<hex>_rw
                ^
   worker process (server/jobs/worker.ts, same release, systemd): outbox email, PDFs, backups, purges, schedules;
   claims platform.jobs fairly (SKIP LOCKED, a few per hotel per poll); hotel work through withHotelForSystem()
```

Facts to remember:

1. Web and mobile use the same `/api/v1` and the same code. Only the credential differs: a cookie on web, a bearer token on mobile.
2. The hotel comes **only** from the verified session row. Never from a URL, query, body, header or cookie value. The affinity hint (section 8.9) only chooses a Node process; nothing trusts it.
3. Inside a hotel transaction PostgreSQL refuses every other hotel's tables to normal SQL (tested). It does **not** stop injected SQL: `SET LOCAL ROLE <other hotel role>` and `RESET ROLE` still work, because SET ROLE is checked against the session user `hms_app` (tested on 18.6). Parameterised SQL (SE-25) is the first defence; the role catches mistakes.
4. One request uses one pooled connection and one transaction, plus at most one autocommit statement for rate limits.
5. Next.js instances keep no state. Sessions, rate limits, idempotency, locks and jobs all live in PostgreSQL.
6. No response is ever cached: `Cache-Control: no-store` on every API response.
7. Anything that can be slow runs in the worker, never inside a request transaction: bulk email, PDFs, backups, Google calls, reports over 1 second.
8. Every error our server code returns is the one JSON format with a `traceId`, including unknown paths (404) and unsupported methods (405). nginx's own errors use the same JSON (section 9). The only non-JSON answer is Next's automatic `OPTIONS` 204.

---

## 2. Folder structure

```
HMS/
├─ .gitignore                          exists (root): .env*, !.env.example, node_modules, .next*, dumps
├─ db/                                 SQL and pure script logic (Backend)
│  ├─ .env.example                     NEW: names of script-only secrets (no values)
│  ├─ .env.local                       git-ignored: PGSUPERUSER_URL, DATABASE_OWNER_URL, TEST_DATABASE_URL,
│  │                                   TEST_DATABASE_OWNER_URL. Never read by Next.
│  ├─ eslint.config.mjs                exists
│  ├─ migrations/
│  │  ├─ platform/NNNN_name.sql        platform schema, applied once
│  │  └─ hotel/NNNN_name.sql           hotel template, applied to EVERY hotel schema (67 tables exist)
│  ├─ seeds/{platform,hotel}/NNNN_name.sql   idempotent seed data (+ seeds/source/*.json)
│  └─ scripts/                         pure logic, no pg import: migrate.ts, create-hotel.ts, setup-db.ts, env-store.ts,
│                                      lint-sql.ts, generate-*-seeds.ts, php/, pallav/
└─ web-app/
   ├─ next.config.ts                   section 3.7
   ├─ eslint.config.mjs                section 3.8
   ├─ src/
   │  ├─ instrumentation.ts            boot checks + onRequestError (next to app/, never inside it)
   │  ├─ app/api/
   │  │  ├─ [[...path]]/route.ts       JSON 404 for /api and every unknown /api path (optional catch-all)
   │  │  └─ v1/
   │  │     ├─ health/route.ts         liveness
   │  │     ├─ health/ready/route.ts   readiness
   │  │     └─ <group>/<resource>/route.ts, <resource>/[id]/route.ts, <resource>/[id]/<action>/route.ts
   │  └─ server/                       every file starts with: import "server-only";
   │     ├─ boot.ts                    called once by register()
   │     ├─ config/env.ts              the ONLY reader of process.env
   │     ├─ errors/                    AppError, codes (status map), response
   │     ├─ logger/                    JSON logger with redaction
   │     ├─ validation/zodErrors.ts    parseInput, field errors
   │     ├─ money/paise.ts             the one money module (PHP rounding); words.ts = Pallav NumberToWords port
   │     ├─ crypto/                    AES-GCM, keyed hashes, blind index (exists)
   │     ├─ http/                      the ONLY place that imports next/server: route.ts (wrapper), respond,
   │     │                             body, origin, client-ip, cookies, after, trace
   │     ├─ auth/                      session, permissions, permission-keys (generated), policy (Q2 switches),
   │     │                             password, tokens, challenges
   │     ├─ db/                        the ONLY place that imports pg: pool, tx, types, schemaName, pg-errors,
   │     │  │                          health, schema-version
   │     │  └─ cli/                    setup.ts, migrate.ts, create-hotel.ts, unblock.ts (tsx entry points; read db/.env.local)
   │     ├─ services/<group>/<resource>.service.ts    business rules (Pallav port)
   │     ├─ services/<group>/<resource>.schema.ts     zod request schemas for that resource
   │     ├─ repos/<group>/<resource>.repo.ts          SQL only
   │     ├─ repos/{system-log.repo.ts, idempotency.repo.ts, rate-limit.repo.ts, entryNo.ts, sql.ts}
   │     ├─ jobs/                      outbox enqueue, worker.ts (separate process), scheduler.ts, handlers/
   │     ├─ mail/                      nodemailer transport, templates/
   │     ├─ pdf/                       empty until a PDF engine is approved
   │     └─ lib/                       request-context, node-hooks/{register.ts, empty.cjs}
   └─ tests/server/
      ├─ unit/        no database (today's tests/server/*.test.ts move here, all of them)
      ├─ db/          real PostgreSQL (database hms_test)
      ├─ isolation/   two hotels, every build (today's tests/db/isolation.test.ts moves here)
      ├─ golden/<group>/   + fixtures/*.json taken from Pallav's tests
      ├─ contract/    DTO shapes vs ui-shared, route inventory, permission keys vs seeds
      └─ helpers/     fakeDb (exists), test sessions, test hotels, db/.env.local loader
```

**Moves from today's tree** (all small):

| From | To |
|---|---|
| `src/db/schemaName.ts` | `src/server/db/schemaName.ts` (section 4.2.6) |
| `src/db/types.ts` | `src/server/db/types.ts` |
| `src/db/withHotel.ts` | replaced by `src/server/db/tx.ts`; delete once its tests are moved |
| `src/server/data/entryNo.ts` | `src/server/repos/entryNo.ts` |
| `tests/server/*.test.ts` (about 315 tests) | `tests/server/unit/` (no test is dropped; the gate prints the count) |
| `tests/db/isolation.test.ts` (59 skipped tests) | `tests/server/isolation/` |
| `db/scripts/cli.ts`, `db/scripts/pg-connect.ts` | `src/server/db/cli/*` (they import `pg`) |
| `src/server/data/`, `src/server/services/.gitkeep` | delete when empty |

**Naming:**

| Thing | Rule | Example |
|---|---|---|
| New files | kebab-case plus a role suffix. Existing names stay. | `deposits.service.ts`, `pg-errors.ts` |
| URL | `/api/v1/<group>/<resource>`, kebab-case, plural nouns, no trailing slash | `/api/v1/front-office/stays/{id}/check-out` |
| Route name (`spec.name`) | `<group>.<resource>.<action>`, unique | `cash.deposits.create` |
| Tables | snake_case, plural; `*_paise` bigint; `*_at` timestamptz; `*_on` date; `*_id` uuid; `is_*` / `has_*` boolean | `hotel_cash_deposits.amount_paise` |
| Constraints | always named, because services map them to Pallav messages | `bills_bill_no_key` |
| Zod schemas | PascalCase, same name as the inferred type | `CreateDepositBody` |
| DTOs | the ui-shared contract type names | `CashDeposit` |
| Error codes | SCREAMING_SNAKE, from `ui-shared/errors.ts` | `SESSION_REPLACED` |
| System log lines | Pallav's module key, action word and entity label | `revenue` / `created` / `Hotel deposit` |
| Env variables | SCREAMING_SNAKE; never `NEXT_PUBLIC_` for secrets | `HMS_HASH_KEY` |

---

## 3. Next.js 16 rules

Path short forms used below:
- `D/` = `web-app/node_modules/next/dist/docs/01-app/`
- `N/` = `web-app/node_modules/next/dist/`

Read the matching doc before writing any Next-specific code (`web-app/AGENTS.md`).

| ID | Rule | Evidence |
|---|---|---|
| NX-1 | Target Next 16.3.8: Node ≥ 20.9 (use Node 24 LTS everywhere; dev is 24.19), TypeScript ≥ 5.1. Patterns from memory are wrong here: `middleware.ts`, sync `cookies()`, `runtime='edge'`, `serverRuntimeConfig`, `request.ip`. | `D/02-guides/upgrading/version-16.md` L120-125, L283-293, L614-617, L1116-1118; `request.ip` removed: `D/02-guides/upgrading/version-15.md` L603 |
| NX-2 | Node.js runtime only. MUST NOT export `runtime` (Edge cannot load `pg` or `argon2`). | `D/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md` |
| NX-3 | No `middleware.ts`. No `proxy.ts` on `/api`. If the UI ever adds a `proxy.ts`, its matcher MUST exclude `api`, `_next/static` and `_next/image`. Proxy copies every body into memory and silently cuts bodies over 10 MB. Proxy is never the auth layer. | `D/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md` L7-9, L69-77; `D/01-getting-started/16-proxy.md`; `D/02-guides/backend-for-frontend.md` L827 |
| NX-4 | A `route.ts` contains only `export const GET/POST/... = publicRoute(...) / sessionRoute(...) / hotelRoute(...)` and `export const { ... } = methodsNotAllowed` for the methods it does not serve. No SQL, no business rules, no try/catch, no `Response` building. No segment exports (`dynamic`, `revalidate`, `fetchCache`, `runtime`, `maxDuration`). | `D/03-api-reference/03-file-conventions/route.md`; `.../02-route-segment-config/index.md` L19 |
| NX-5 | Never cache API data. MUST NOT use `'use cache'`, `cacheLife`, `cacheTag`, `unstable_cache`, `revalidateTag`, `force-static` or fetch caching. Every response carries `Cache-Control: no-store` (wrapper, with `next.config` as backup). Next adds no Cache-Control to dynamic handler responses. | `D/01-getting-started/15-route-handlers.md` L49-51, L87-144; `N/build/templates/app-route.js` L215-275 |
| NX-6 | Keep `cacheComponents` off; turning it on needs the Lead. The wrapper reads request headers first, which stops prerendering. The build check (section 10.6) fails if any `/api` route shows as static (○). | `D/01-getting-started/15-route-handlers.md` L87-124; `version-16.md` L1242 |
| NX-7 | Request APIs are async-only. API code does not call `cookies()` or `headers()`. The wrapper reads `request.headers`, the Cookie header, `request.url` and `await context.params`. | `D/03-api-reference/03-file-conventions/route.md`; `version-16.md` L283-293 |
| NX-8 | Set and clear cookies only on the response (`NextResponse.cookies.set`) inside `server/http`. | `D/03-api-reference/04-functions/cookies.md` L6, L65-83 |
| NX-9 | A thrown error gives Next's empty-body 500; `redirect()`/`notFound()` give empty bodies too. So the wrapper catches everything, and API code MUST NOT import `next/navigation`. On an existing `route.ts`, a method it does not export gets Next's automatic **empty** 405, `HEAD` runs `GET`, and `OPTIONS` gets 204 with `Allow`. Hence `methodsNotAllowed`. | `N/build/templates/app-route.js` L345-365; `N/server/route-modules/app-route/module.js` L464-497; `N/server/route-modules/app-route/helpers/auto-implement-methods.js` L16-20, L38-63 |
| NX-10 | `after()` is for best-effort work only: the last-seen update and metrics. It runs even when the handler failed, is lost on a crash, and throws outside a request scope. Always call it through `runAfter()`. Never for audit rows, money, sessions, lockouts or email. | `D/03-api-reference/04-functions/after.md` L53; throws: `N/server/after/after.js` L13-20; `D/02-guides/self-hosting.md` L295-299 |
| NX-11 | Every file in `src/server/**` starts with `import "server-only";` (not `lib/node-hooks/*`). The npm package is not installed: Next resolves the name itself. Outside Next (tests, worker, CLIs), use the resolve hook in section 10.2. | `D/02-guides/data-security.md` L243-255; `N/compiled/server-only/package.json`; `N/build/create-compiler-aliases.js` L218-229 |
| NX-12 | Only `config/env.ts` reads `process.env` in `src/server` (`next.config.ts` is build config). Parse lazily. Never `NEXT_PUBLIC_` for secrets. Avoid `$` in `.env` values. The standalone build copies `.env` and `.env.production` into the artifact, so production secrets come only from a root-owned systemd `EnvironmentFile`. **`next.config` is read at build time and frozen into `server.js`**: `deploymentId`, `compress` and the CSP's production switch are fixed by the build, so build with `NODE_ENV=production` and `DEPLOYMENT_VERSION=<release>`. | `D/02-guides/environment-variables.md`; `D/02-guides/data-security.md` L132; `N/build/index.js` L330-336, L569; `N/build/utils.js` L1131 |
| NX-13 | `src/instrumentation.ts`, not inside `app/`. `register()` runs once per instance before requests are served; a throw is re-thrown to every request or stops the start; it is skipped during `next build`. Import Node code inside a **positive** `NEXT_RUNTIME === "nodejs"` check (the docs' form). `boot()` never throws outside production (the UI shares the dev server). `onRequestError` MUST NOT log `request.headers`. | `D/03-api-reference/03-file-conventions/instrumentation.md` L16-18, L36-145; `D/02-guides/instrumentation.md` L70-95; `N/server/lib/router-utils/instrumentation-globals.external.js` L52-68; `N/server/route-modules/route-module.js` L371-377 |
| NX-14 | `pg`, `argon2`, `bcrypt`, `sharp`, `puppeteer-core` and `@react-pdf/renderer` are already external: do not list them. `nodemailer` is NOT on the list, so it is bundled; if the build or smoke test shows a problem, add `serverExternalPackages: ["nodemailer"]` with the Lead's OK. The step 2 build imports nodemailer once to find out. | `D/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`; `N/lib/server-external-packages.jsonc` |
| NX-15 | No Server Actions for data. Server Components never fetch our own `/api`. One API serves web and mobile. | `D/02-guides/backend-for-frontend.md` L879-902; `D/02-guides/data-security.md` L544-552 |
| NX-16 | `output: "standalone"`. The tracing root is the HMS folder, so the server is `.next/standalone/web-app/server.js`; it `chdir`s to its own folder and serves `web-app/public` and `web-app/.next/static` from there. Copy with: `cp -r public ".next/standalone/web-app/public" && cp -r .next/static ".next/standalone/web-app/.next/static"`. Start with `PORT`, `HOSTNAME=127.0.0.1` (always set it: the default is 0.0.0.0) and `KEEP_ALIVE_TIMEOUT=70000` (above nginx's 60 s). | `D/03-api-reference/05-config/01-next-config-js/output.md` L36-54; `N/build/utils.js` L1107-1135; `D/03-api-reference/06-cli/next.md` L356-364 |
| NX-17 | Graceful stop: on SIGTERM Next closes its listener at once, finishes in-flight requests and `after()` tasks, then exits 143. So a readiness flip cannot drain: nginx must stop sending first (OP-10). MUST NOT set `NEXT_MANUAL_SIG_HANDLE`. MUST NOT call `pool.end()`. | `N/server/lib/start-server.js` L320-390 |
| NX-18 | All instances of one release use the same `deploymentId`. It **detects** skew (a mismatch reloads the page); it does **not** route. nginx keeps the previous release's static files (OP-10). `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` only matters if Server Actions are ever used. | `D/03-api-reference/05-config/01-next-config-js/deploymentId.md` L36, L71; `D/02-guides/self-hosting.md` L187-237 |
| NX-19 | Build production on Linux (`argon2` is native); smoke-test `node -e "require('argon2')"` inside the standalone folder. **Never run `next build` inside the shared `web-app` folder, with any distDir**: it rewrites `next-env.d.ts` and the `tsconfig.json` include list for its distDir (today both already point at a deleted `.next-be`), and its output breaks the dev server's Tailwind scan. Build in a separate copy (section 10.7). | `N/lib/typescript/writeAppTypeDeclarations.js` L52; `N/lib/typescript/writeConfigurationDefaults.js` L286-314; memory note "web-dev-server-build-gotcha" |
| NX-20 | Next logs incoming requests in development only; our access line (section 9) is the production log. `maxDuration` is a hint for platforms; `next start` is not documented to enforce it (inference), so every external wait has its own timeout. | `D/03-api-reference/05-config/01-next-config-js/logging.md` L59-62; `.../02-route-segment-config/maxDuration.md` L6 |
| NX-21 | With the default `trailingSlash: false`, `/api/v1/x/` gets a 308 redirect. Clients never add a trailing slash; the contract test checks every client path. | Next default behaviour |
| NX-22 | Pages stream (Suspense, `loading.tsx`): nginx MUST NOT buffer page responses (`proxy_buffering off` on `location /`). Next's gzip is off in production (`compress`), so nginx gzips `text/x-component` (the RSC payload) too. | `D/02-guides/self-hosting.md` L239-261; `N/client/components/app-router-headers.js` L102; `.../01-next-config-js/compress.md` |

### 3.7 `next.config.ts` (exact; type-checked; shared file: Lead's OK)

Changes from today: standalone output, tracing root, `deploymentId`, `compress` off in production, a page CSP, the `/api` no-store backup. `NEXT_DIST_DIR` is gone (builds happen in a separate copy). HSTS is sent by nginx only.

<!-- verified: next.config.ts -->
```ts
import path from "node:path";
import type { NextConfig } from "next";

// next.config is read at BUILD time and copied into the standalone server.js (next/dist/build/utils.js): every value
// below is fixed by the build. Build production with NODE_ENV=production and DEPLOYMENT_VERSION=<release> set.
const isProduction = process.env.NODE_ENV === "production";
// ui-shared/ sits next to web-app/, so Turbopack must see the parent folder. Next forces outputFileTracingRoot to the
// same value (next/dist/server/config.js); set both. Result: the standalone server is .next/standalone/web-app/server.js.
const root = path.join(__dirname, "..");

// Page CSP: the docs' policy for apps without nonces (02-guides/content-security-policy.md, "Without Nonces"). Next's
// App Router writes inline scripts, so script-src needs 'unsafe-inline' here; a nonce policy is a later Lead decision.
const pageCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  output: "standalone",
  poweredByHeader: false,
  // React Compiler (approved by MJ).
  reactCompiler: true,
  // Detects version skew (a mismatch reloads the page). It does not route: nginx keeps the previous release's static files.
  deploymentId: process.env.DEPLOYMENT_VERSION || undefined,
  // nginx compresses in production; Next's own gzip stays on for local development only.
  compress: !isProduction,
  logging: { incomingRequests: { ignore: [/\/api\/v1\/health/] } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: pageCsp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // HSTS is sent by nginx only (section 9), never twice.
        ],
      },
      // Backup for the route wrapper: no API response may ever be stored by a browser, nginx or a CDN.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
```

The UI sessions MUST check the dev server and every screen once with the CSP on (fonts come from `next/font/google`, which self-hosts them, so `font-src 'self'` holds).

### 3.8 ESLint boundary rules (exact; verified on planted violations)

Add this block to `web-app/eslint.config.mjs` after `...nextTs`. The file groups do not overlap on purpose: in flat config, the last matching block replaces a rule's options. The `db/tx` patterns enforce SE-3: hotel access only through the wrapper (`enterHotel`) or jobs (`withHotelForSystem`); transactions only where listed.

```js
const restricted = "@typescript-eslint/no-restricted-imports";
const banPg = { name: "pg", message: "Only src/server/db may import pg." };
const banNext = { group: ["next", "next/*"], message: "Only src/server/http, boot.ts and route files may import Next." };
const banNavigation = { group: ["next/navigation"], message: "redirect()/notFound() give empty-body responses in route handlers." };
const sharedTypesOnly = { group: ["@shared/dashboards/*", "@shared/auth/mock", "@shared/index"], allowTypeImports: true, message: "Server code imports TYPES only from ui-shared (those files hold mock data)." };
const serverTypesOnly = { group: ["@/server/*", "@/server/**"], allowTypeImports: true, message: "UI code may import types only from the server." };
const TX = ["**/db/tx", "@/server/db/tx"];
const txTypesOnly = { group: TX, allowTypeImports: true, message: "Only http/route.ts, auth/**, jobs/** and repos/rate-limit.repo.ts may use db/tx values (SE-3)." };
const txNoHotelEntry = { group: TX, importNames: ["enterHotel", "withHotelForSystem"], message: "enterHotel/withHotelForSystem: only http/route.ts (and jobs/** for withHotelForSystem) (SE-3)." };
const txNoEnterHotel = { group: TX, importNames: ["enterHotel"], message: "enterHotel: only http/route.ts (SE-3)." };
const serverCommon = { paths: [banPg], patterns: [banNext, sharedTypesOnly] };

// inside defineConfig([...]):
  { files: ["src/server/db/**/*.ts"], rules: { [restricted]: ["error", { patterns: [banNext, sharedTypesOnly] }] } },
  { files: ["src/server/http/**/*.ts"], rules: { [restricted]: ["error", { paths: [banPg], patterns: [banNavigation, sharedTypesOnly] }] } },
  { files: ["src/server/auth/**/*.ts"], rules: { [restricted]: ["error", { ...serverCommon, patterns: [...serverCommon.patterns, txNoHotelEntry] }] } },
  { files: ["src/server/jobs/**/*.ts"], rules: { [restricted]: ["error", { ...serverCommon, patterns: [...serverCommon.patterns, txNoEnterHotel] }] } },
  { files: ["src/server/repos/rate-limit.repo.ts"], rules: { [restricted]: ["error", { ...serverCommon, patterns: [...serverCommon.patterns, txNoHotelEntry] }] } },
  {
    files: ["src/server/**/*.ts"],
    ignores: ["src/server/db/**", "src/server/http/**", "src/server/auth/**", "src/server/jobs/**", "src/server/repos/rate-limit.repo.ts", "src/server/boot.ts"],
    rules: { [restricted]: ["error", { ...serverCommon, patterns: [...serverCommon.patterns, txTypesOnly] }] },
  },
  { files: ["src/app/api/**/*.ts"], rules: { [restricted]: ["error", { paths: [banPg], patterns: [banNavigation, sharedTypesOnly, txTypesOnly] }] } },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/**", "src/app/api/**", "src/instrumentation.ts"],
    rules: { [restricted]: ["error", { paths: [banPg], patterns: [serverTypesOnly] }] },
  },
```

Verified: a value import of `enterHotel` / `inTransaction` / a namespace import of `db/tx` in a service, `enterHotel` in a job, `withHotelForSystem` in auth, `inTransaction` in a route file, `autocommit` in another repo, and `pg` in a service were all flagged; a type-only import from `db/tx` and the real reference files were not.

A unit test adds the SQL side (SE-25): no file in `src/server` except `db/tx.ts` contains `set_config(`, `SET ROLE`, `RESET ROLE`, `SET SESSION`, `RESET ALL` or `current_setting(` in SQL text.

---

## 4. Request lifecycle and reference implementation

### 4.1 The steps of every request

1. **Trace id.** In production nginx sets `x-trace-id`; in development a valid incoming one is kept or a new one made. Stored in the request context (AsyncLocalStorage).
2. **CSRF check** for POST/PUT/PATCH/DELETE without a bearer token (SE-20).
3. **Body.** Require `Content-Type: application/json` (else 415). Stream the body with a byte cap (else 413). Malformed JSON gets 400. **No database connection yet.**
4. **Zod.** Parse body, query and params with strict schemas (else 422 with field names).
5. **No credential** on a session or hotel route: 401 `SESSION_EXPIRED`, still without touching the pool.
6. **Rate limits** declared by the route (Pallav throttles): one autocommit statement, so a hit counts even when the request then fails (429 with `Retry-After`).
7. **Public routes** run the handler now (sign-in manages its own two short transactions around argon2).
8. **One checkout, one transaction.** `BEGIN` (GET and HEAD use `BEGIN READ ONLY`).
9. **Authenticate:** one indexed query by token hash. It checks revoked, expired, idle (web, 120 min), replaced, deactivated, blocked and locked, and loads the active hotel and the grants (built-in or this hotel's role only).
10. **Password-change gate:** a user who must change the password may only call routes marked `allowPasswordChange`.
11. **Hotel routes:** active, current hotel → permission (a fixed need, a list where any one is enough, or a need worked out from the validated input) → `enterHotel` (role, search_path, TimeZone, actor; all `SET LOCAL`).
12. **Idempotent creates:** claim `(user, key)` in the same transaction; replay a stored response if the same request was already done.
13. **Handler** (service → repos). The Pallav `system_logs` row is written in the same transaction.
14. `COMMIT` → `{ "data": ... }` with `no-store`, `x-trace-id` and security headers. A handler that returned `failAfterCommit(error)` commits first, then answers the error. Any thrown error → `ROLLBACK` → the one JSON error body. A broken or timed-out connection is destroyed, never reused.
15. **Access log:** one line for every error and every slow request (≥ 500 ms), and for a sample of the rest (`ACCESS_LOG_SAMPLE`). Last-seen update via `runAfter()`, at most every 5 minutes.

### 4.2 Reference implementation

This code is complete and verified (section 0.2). Blocks marked `verified` are byte-for-byte the tested files. The cash-deposit endpoint is the **pattern** to copy. Business rules marked "per Pallav spec" come from the module's written behaviour spec. Unchanged existing files stay as they are: `errors/response.ts`, `errors/index.ts`, `validation/zodErrors.ts`, `logger/*`, `money/paise.ts`, `http/trace.ts`, `crypto/*`, `repos/entryNo.ts` (moved: only the import path changes, to `../db/types`). In `crypto/hash.ts`, `CodePurpose` becomes `"login" | "reset" | "enable"` (S02's `invite` goes).

#### 4.2.1 `ui-shared/errors.ts`: one error list for all calls (owned by the Lead)

Step 0 adds this file **only**. `AuthErrorCode` and `DashErrorCode` stay as they are until the Lead's Pallav login rewrite and the UI copy change land together: aliasing them now breaks `Record<AuthErrorCode, string>` in `ui-shared/auth/copy.ts` L236 and the code comparisons in `LinkProblemStep.tsx`, `ResetPasswordStep.tsx` and `AcceptInviteStep.tsx`. The server types on `ApiErrorCode`; the client adapter maps any code it does not know to `UNKNOWN`.

<!-- verified: ui-shared/errors.ts -->
```ts
// One list of error codes for every /api/v1 call (auth and dashboards). Owned by the Lead.
// The server maps each code to ONE HTTP status (web-app/src/server/errors/codes.ts).
// The apps show their own friendly text per code and act on the code, never on the HTTP status or the message.

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REPLACED'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_CODE'
  | 'FORBIDDEN'
  | 'ACCOUNT_DISABLED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'CHALLENGE_EXPIRED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'PASSWORD_TOO_WEAK'
  | 'PASSWORD_REUSED'
  | 'ACCOUNT_LOCKED'
  | 'RATE_LIMITED'
  | 'CODE_ATTEMPTS_EXCEEDED'
  | 'SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  // Made by the apps themselves; the server never sends these two.
  | 'NETWORK_OFFLINE'
  | 'UNKNOWN';

export interface ApiErrorDetails {
  /** VALIDATION_FAILED: field name -> problem. Never the value that was sent. */
  fields?: Record<string, string>;
  /** RATE_LIMITED, ACCOUNT_LOCKED, SERVICE_UNAVAILABLE (also sent as the Retry-After header). */
  retryAfterSeconds?: number;
  /** INVALID_CODE, only after the password was proven. */
  attemptsLeft?: number;
}

/** Every non-2xx JSON body. */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; traceId: string; details?: ApiErrorDetails };
}

/** Every 2xx JSON body. T is the contract type of that endpoint (for example CashList<CashDeposit>). */
export interface ApiDataBody<T> {
  data: T;
}
```

#### 4.2.2 `server/errors/codes.ts` and `server/errors/AppError.ts`

<!-- verified: src/server/errors/codes.ts -->
```ts
import "server-only";
// HTTP status per error code. Typed on the shared union: a new code in ui-shared fails the type check until it gets a status here.
import type { ApiErrorCode } from "@shared/errors";

export type { ApiErrorCode };

export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  SESSION_EXPIRED: 401,
  SESSION_REPLACED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_CODE: 401,
  FORBIDDEN: 403,
  ACCOUNT_DISABLED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  CHALLENGE_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  IDEMPOTENCY_KEY_REUSED: 422,
  PASSWORD_TOO_WEAK: 422,
  PASSWORD_REUSED: 422,
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  CODE_ATTEMPTS_EXCEEDED: 429,
  SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  NETWORK_OFFLINE: 503, // client-only; listed so the table stays complete
  UNKNOWN: 500, // client-only
};

/** Safe default English for logs and tools. The apps never show it. */
export const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  BAD_REQUEST: "The request could not be read",
  VALIDATION_FAILED: "Some details need fixing",
  SESSION_EXPIRED: "Please sign in again.",
  SESSION_REPLACED: "This account was signed in on another device, so this session was ended.",
  INVALID_CREDENTIALS: "Incorrect username or password.",
  INVALID_CODE: "That code is not right.",
  FORBIDDEN: "Not allowed",
  ACCOUNT_DISABLED: "This account is deactivated. Contact your administrator.",
  PASSWORD_CHANGE_REQUIRED: "Choose a new password first",
  NOT_FOUND: "Not found",
  METHOD_NOT_ALLOWED: "This endpoint does not take that method",
  CONFLICT: "Conflicts with a newer change",
  CHALLENGE_EXPIRED: "Ask for a new code to continue.",
  PAYLOAD_TOO_LARGE: "The request is too large",
  UNSUPPORTED_MEDIA_TYPE: "Send JSON (Content-Type: application/json)",
  IDEMPOTENCY_KEY_REUSED: "This Idempotency-Key was already used for a different request",
  PASSWORD_TOO_WEAK: "Password is too weak",
  PASSWORD_REUSED: "Choose a password different from the old one.",
  ACCOUNT_LOCKED: "Account is locked",
  RATE_LIMITED: "Too many requests",
  CODE_ATTEMPTS_EXCEEDED: "Too many wrong codes",
  SERVER_ERROR: "Something went wrong",
  SERVICE_UNAVAILABLE: "Service is busy. Try again shortly.",
  NETWORK_OFFLINE: "Offline",
  UNKNOWN: "Something went wrong",
};

export function statusFor(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code];
}
```

<!-- verified: src/server/errors/AppError.ts -->
```ts
import "server-only";
import type { ApiErrorDetails } from "@shared/errors";
import { DEFAULT_MESSAGE, type ApiErrorCode } from "./codes";

export type ErrorDetails = ApiErrorDetails;

/**
 * An error a service throws on purpose. The message must be safe for a log: never a secret, an ID number or SQL text.
 * Anything thrown that is not an AppError is a bug and is answered with SERVER_ERROR.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: ErrorDetails;

  constructor(code: ApiErrorCode, message?: string, details?: ErrorDetails, options?: { cause?: unknown }) {
    super(message ?? DEFAULT_MESSAGE[code], options);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
```

#### 4.2.3 `server/config/env.ts`: environment validation

<!-- verified: src/server/config/env.ts -->
```ts
import "server-only";
// The ONLY module that reads process.env (instrumentation.ts reads NEXT_RUNTIME, which Next itself sets).
// Parsed lazily on first use, never at import time: `next build` imports route modules without production secrets.
// Error messages name the variable, never its value.
import { z } from "zod";
import { parseBlindIndexKey, parseDataKeys } from "../crypto/aes";
import { parseHashKey } from "../crypto/hash";

const postgresUrl = z.string().refine((v) => /^postgres(ql)?:\/\//.test(v), { message: "must be a postgres:// connection string" });
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;
const originList = z.string().refine((v) => v.split(",").every((o) => ORIGIN.test(o.trim())), {
  message: "must be a comma-separated list of exact origins (scheme://host[:port])",
});
/** True when the parser accepts the value. Its own message (which names no value) is not used. */
const accepts = (check: (value: string) => unknown) => (value: string): boolean => {
  try {
    check(value);
    return true;
  } catch {
    return false;
  }
};

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
    /** hms_app connection string. Optional only outside production, until the database exists. */
    DATABASE_URL: postgresUrl.optional(),
    /** The role boot() expects to be connected as (hms_app for the web, hms_worker for the worker). */
    DB_APP_ROLE: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/).default("hms_app"),
    /** Connections per Node process. The sum over all processes stays inside the budget in section 8.2. */
    DB_POOL_MAX: z.coerce.number().int().min(2).max(50).default(10),
    /** Waiting longer than this for a free connection answers 503 SERVICE_UNAVAILABLE instead of hanging. */
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(250).max(10_000).default(2_000),
    /** Client-side wait for one query (network partition guard). Above the role's statement_timeout. Worker: 90000. */
    DB_QUERY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(15_000),
    /** Exact browser origins allowed to send cookie-authenticated writes, e.g. https://app.example.in */
    APP_ORIGINS: originList.optional(),
    /** 1 only behind our own nginx: then X-Real-IP is the client address. */
    TRUST_PROXY: z.enum(["0", "1"]).default("0"),
    /** Default JSON body cap. A route may set its own (uploads use their own routes). */
    API_MAX_BODY_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(262_144),
    /** argon2 hashes running at once in THIS process (section 6.2, SE-16). Server-wide = this x processes. */
    ARGON2_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
    /** Hash requests allowed to wait; more answers 503 at once. */
    ARGON2_MAX_QUEUE: z.coerce.number().int().min(0).max(1_000).default(16),
    /** Share of fast 2xx requests that get an access-log line (errors and slow requests always do). */
    ACCESS_LOG_SAMPLE: z.coerce.number().min(0).max(1).default(1),
    /** Data-at-rest keys "keyId:base64key,...": the first is current, all can decrypt (crypto/aes.ts). */
    HMS_DATA_KEYS: z.string().refine(accepts(parseDataKeys), { message: "is not a valid key list (keyId:base64,... with 32-byte keys)" }).optional(),
    /** HMAC key for one-time codes and sign-in identifiers (crypto/hash.ts): base64, 32+ bytes. */
    HMS_HASH_KEY: z.string().refine(accepts(parseHashKey), { message: "must be base64 of at least 32 bytes" }).optional(),
    /** Blind-index key for encrypted columns: base64, 32+ bytes, different from the hash key. */
    HMS_BLIND_INDEX_KEY: z.string().refine(accepts(parseBlindIndexKey), { message: "must be base64 of at least 32 bytes" }).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    for (const name of ["DATABASE_URL", "APP_ORIGINS", "HMS_DATA_KEYS", "HMS_HASH_KEY", "HMS_BLIND_INDEX_KEY"] as const) {
      if (env[name] === undefined) ctx.addIssue({ code: "custom", path: [name], message: "is required in production" });
    }
    if (env.TRUST_PROXY !== "1") ctx.addIssue({ code: "custom", path: ["TRUST_PROXY"], message: "must be 1 in production (behind nginx)" });
    if (env.APP_ORIGINS !== undefined && env.APP_ORIGINS.split(",").some((o) => !o.trim().toLowerCase().startsWith("https://"))) {
      ctx.addIssue({ code: "custom", path: ["APP_ORIGINS"], message: "must use https:// origins in production" });
    }
  });

export type AppConfig = Readonly<z.output<typeof schema>>;

export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function withoutBlanks(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = env[key];
    if (value !== undefined && value.trim() !== "") out[key] = value.trim();
  }
  return out;
}

export function loadConfig(env: Env): AppConfig {
  const result = schema.safeParse(withoutBlanks(env));
  if (result.success) return Object.freeze(result.data);
  throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join(".") || "(env)"}: ${issue.message}`));
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= loadConfig(process.env);
  return cached;
}

/** For tests only. */
export function resetConfigCache(): void {
  cached = undefined;
}

/** NODE_ENV alone, without parsing the rest: boot() needs it even when the rest of the environment is broken. */
export function isProductionProcess(env: Env = process.env): boolean {
  return env.NODE_ENV === "production";
}

export const isDatabaseConfigured = (config: AppConfig): boolean => config.DATABASE_URL !== undefined;

/** Browser origins for the CSRF check. Outside production it falls back to the local dev servers. */
export function appOrigins(config: AppConfig = getConfig()): readonly string[] {
  const listed = (config.APP_ORIGINS ?? "").split(",").map((o) => o.trim()).filter((o) => o !== "");
  if (listed.length > 0 || config.NODE_ENV === "production") return listed;
  return ["http://localhost:3000", "http://localhost:3001"];
}

/**
 * Script-only secrets must never reach the web server (Next loads every variable of web-app/.env*). They live in
 * db/.env.local. boot() refuses to start in production if one is present, and logs an error in development.
 */
const SCRIPT_ONLY: ReadonlySet<string> = new Set(["PGSUPERUSER_URL", "TEST_DATABASE_URL"]);
const OWNER_URL = /_OWNER_URL$/;

export function scriptOnlySecretsPresent(env: Env = process.env): string[] {
  return Object.keys(env)
    .filter((name) => SCRIPT_ONLY.has(name) || OWNER_URL.test(name))
    .filter((name) => (env[name] ?? "").trim() !== "")
    .sort();
}
```

#### 4.2.4 `server/lib/request-context.ts`

(The draft's `lib/lifecycle.ts` is gone: draining happens at nginx, NX-17.)

<!-- verified: src/server/lib/request-context.ts -->
```ts
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request facts for logs and audit rows. Set by the route wrapper only. */
export interface RequestContext {
  readonly traceId: string;
  readonly route: string;
  ip: string | null;
  userId?: string;
  hotelId?: string;
  dbQueries: number;
  dbMs: number;
}

// Kept on globalThis: Next compiles instrumentation and each route into separate module instances.
const g = globalThis as typeof globalThis & { __hmsRequestContext?: AsyncLocalStorage<RequestContext> };
const storage = (g.__hmsRequestContext ??= new AsyncLocalStorage<RequestContext>());

export function runWithContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}
```

#### 4.2.5 `server/db/types.ts`, `pool.ts`, `tx.ts`: the pool and the transaction

<!-- verified: src/server/db/types.ts -->
```ts
import "server-only";
// The smallest client shape the data layer needs (Backend 1's src/db/types.ts, moved here and given typed rows).
// node-postgres' PoolClient fits it, and so does the fake used in unit tests.
import type { QueryResultRow } from "pg";

export interface SqlResult<R> {
  rows: R[];
  rowCount: number | null;
}

export interface SqlClient {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<SqlResult<R>>;
}

declare const inTransaction: unique symbol;

/**
 * A client inside BEGIN ... COMMIT. Repositories and helpers that rely on transaction scope (SET LOCAL, advisory
 * xact locks) take a TxClient, so a bare client cannot be passed by mistake. Only db/tx.ts (and tests) make one.
 */
export interface TxClient extends SqlClient {
  readonly [inTransaction]: true;
}

export function assumeTransaction(client: SqlClient): TxClient {
  return client as TxClient;
}
```

<!-- verified: src/server/db/pool.ts -->
```ts
import "server-only";
// The ONE pg.Pool of this process. Only files in src/server/db may import "pg".
import { Pool, types } from "pg";
import { getConfig } from "../config/env";
import { AppError } from "../errors";
import { getLogger } from "../logger";

// Type parsers, set once per process (pg is external to the Next bundles, so there is one shared copy).
// int8/bigint (OID 20): paise and counts arrive as numbers, never strings; anything outside the safe range is a bug.
types.setTypeParser(20, (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("int8 value outside the safe integer range");
  return n;
});
// date (OID 1082): keep 'YYYY-MM-DD'. The default makes a JS Date at local midnight and shifts stay nights by a day.
types.setTypeParser(1082, (value: string) => value);
// numeric (OID 1700) and time (OID 1083) stay strings on purpose: neither is ever used for money.

// Cached on globalThis: dev hot reload and separate route bundles must not open a second pool.
const g = globalThis as typeof globalThis & { __hmsPgPool?: Pool };

export function getPool(): Pool {
  if (g.__hmsPgPool) return g.__hmsPgPool;
  const config = getConfig();
  if (config.DATABASE_URL === undefined) throw new AppError("SERVICE_UNAVAILABLE", "Database is not configured");
  const pool = new Pool({
    connectionString: config.DATABASE_URL, // carries sslmode=verify-full&sslrootcert=... when the database is on another host
    max: config.DB_POOL_MAX,
    connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS, // pg's default 0 waits forever
    query_timeout: config.DB_QUERY_TIMEOUT_MS, // a dead network must not hang a request; tx.ts then destroys the client
    keepAlive: true, // TCP keep-alive on idle pooled sockets
    idleTimeoutMillis: 30_000,
    maxLifetimeSeconds: 900, // recycle backends: their catalog cache grows with every hotel schema they touch (section 8.9)
    application_name: `hms-web:${process.pid}`,
  });
  // Without a listener, an error on an idle client crashes the whole process.
  pool.on("error", (error) => getLogger().error("pg idle client error", { cause: error }));
  g.__hmsPgPool = pool;
  return pool;
}
```

The worker uses the same file with `DB_POOL_MAX=5`, `DB_QUERY_TIMEOUT_MS=90000` and `DB_APP_ROLE=hms_worker` in its environment.

<!-- verified: src/server/db/tx.ts -->
```ts
import "server-only";
import type { PoolClient, QueryResultRow } from "pg";
import { AppError } from "../errors";
import { currentContext } from "../lib/request-context";
import { getLogger } from "../logger";
import { getPool } from "./pool";
import { hotelRoleName, hotelSearchPath } from "./schemaName";
import { assumeTransaction, type SqlResult, type TxClient } from "./types";

export interface TxOptions {
  /** GET handlers run READ ONLY: an accidental write fails instead of happening. */
  readonly readOnly?: boolean;
}

export interface HotelRef {
  readonly id: string;
  readonly timezone: string;
}

const SLOW_QUERY_MS = 250;

/** pg's client-side query_timeout fired (pool.ts). The server side may still be busy. */
export function isClientTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === "Query read timeout";
}

function wrap(client: PoolClient): TxClient {
  return assumeTransaction({
    async query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<SqlResult<R>> {
      const started = performance.now();
      try {
        return await client.query<R>(text, values === undefined ? undefined : [...values]);
      } finally {
        const ms = performance.now() - started;
        const ctx = currentContext();
        if (ctx) {
          ctx.dbQueries += 1;
          ctx.dbMs += ms;
        }
        // SQL text only: every value is a $n parameter, so the text holds no personal data.
        if (ms > SLOW_QUERY_MS) getLogger().warn("slow query", { traceId: ctx?.traceId, route: ctx?.route, ms: Math.round(ms), sql: text.slice(0, 200) });
      }
    },
  });
}

async function acquire(): Promise<PoolClient> {
  try {
    return await getPool().connect();
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    // Pool exhausted (connectionTimeoutMillis), database down or refusing: fail fast, never hang (R8 fallback).
    throw new AppError("SERVICE_UNAVAILABLE", "Database is busy or unreachable", { retryAfterSeconds: 2 }, { cause });
  }
}

/**
 * One checkout, one transaction. COMMIT on success; ROLLBACK on any error. A connection that errored, timed out on the
 * client side or cannot even roll back is destroyed (release(err)) instead of going back to the pool.
 * No network I/O (email, HTTP, argon2) inside `fn`.
 */
export async function inTransaction<T>(fn: (tx: TxClient) => Promise<T>, options: TxOptions = {}): Promise<T> {
  const client = await acquire();
  let broken: Error | undefined;
  // pg-pool removes its own error listener while a client is checked out. If the server ends this backend now
  // (idle_in_transaction_session_timeout, transaction_timeout, restart, network reset), pg emits "error" on the client,
  // and with no listener Node kills the WHOLE process (tested on pg 8.23.1). So listen for the length of the checkout.
  const onError = (error: Error): void => {
    broken = error;
    getLogger().warn("pg client error during a transaction", { cause: error });
  };
  client.on("error", onError);
  try {
    await client.query(options.readOnly === true ? "BEGIN READ ONLY" : "BEGIN");
    const result = await fn(wrap(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (isClientTimeout(error)) {
      // pg gave up waiting (query_timeout) but the server may still be running the query: never reuse this connection.
      broken = error as Error;
    } else {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        broken = rollbackError instanceof Error ? rollbackError : new Error("ROLLBACK failed");
      }
    }
    throw error;
  } finally {
    client.removeListener("error", onError);
    client.release(broken);
  }
}

/**
 * ONE statement outside any transaction (autocommit). Only for writes that must stay even if the request then fails:
 * rate-limit hits (repos/rate-limit.repo.ts). Same fail-fast checkout and broken-connection rules as inTransaction.
 */
export async function autocommit<R extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<SqlResult<R>> {
  const client = await acquire();
  let broken: Error | undefined;
  const onError = (error: Error): void => {
    broken = error;
  };
  client.on("error", onError);
  try {
    return await wrap(client).query<R>(text, values);
  } catch (error) {
    if (isClientTimeout(error)) broken = error as Error;
    throw error;
  } finally {
    client.removeListener("error", onError);
    client.release(broken);
  }
}

/**
 * Switches THIS transaction to one hotel: search_path, role, time zone and actor, all transaction-local
 * (set_config(..., true) = SET LOCAL), all bind parameters. They end at COMMIT/ROLLBACK, so nothing leaks to the next
 * request on this pooled connection, and it is safe under PgBouncer transaction pooling.
 * Called only by the route wrapper (hotel from the verified session) and withHotelForSystem (hotel from our own rows).
 */
export async function enterHotel(tx: TxClient, hotel: HotelRef, actorUserId: string | null): Promise<void> {
  await tx.query(
    `SELECT set_config('search_path', $1, true),
            set_config('role', $2, true),
            set_config('TimeZone', $3, true),
            set_config('hms.hotel_id', $4, true),
            set_config('hms.user_id', $5, true)`,
    [hotelSearchPath(hotel.id), hotelRoleName(hotel.id), hotel.timezone, hotel.id, actorUserId ?? ""],
  );
}

/** Jobs and signature-verified webhooks ONLY (lint-restricted). The hotel comes from our own rows, never from input. */
export function withHotelForSystem<T>(hotel: HotelRef, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return inTransaction(async (tx) => {
    await enterHotel(tx, hotel, null);
    return fn(tx);
  });
}
```

There is **no exported function that takes a hotel id from a route.** Request code reaches a hotel only through `hotelRoute`; ESLint (3.8) keeps `enterHotel` in `http/route.ts` and `withHotelForSystem` in `jobs/**`.

#### 4.2.6 `server/db/schemaName.ts`, `schema-version.ts`, `pg-errors.ts`, `health.ts`

<!-- verified: src/server/db/schemaName.ts -->
```ts
import "server-only";
// Hotel schema and role names. The id comes from the verified session (or our own records for jobs), never from a
// request, and is still checked here so a bug elsewhere cannot become an injected identifier.
// Names as already built and tested by Backend 1 (src/db/schemaName.ts, db/scripts/create-hotel.ts).
import { AppError } from "../errors";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BARE_UUID = /^[0-9a-f]{32}$/;
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export const HOTEL_SCHEMA_PREFIX = "hotel_";
export const HOTEL_ROLE_SUFFIX = "_rw";

function invalidHotel(): AppError {
  return new AppError("FORBIDDEN", "Hotel is not available");
}

export function assertSafeIdentifier(name: string): void {
  if (!SAFE_IDENTIFIER.test(name)) throw invalidHotel();
}

/** "hotel_<32 hex>" (= platform.hotels.schema_name, which is generated from the id) */
export function hotelSchemaName(hotelId: unknown): string {
  if (typeof hotelId !== "string") throw invalidHotel();
  let hex: string;
  if (CANONICAL_UUID.test(hotelId)) hex = hotelId.replaceAll("-", "");
  else if (BARE_UUID.test(hotelId)) hex = hotelId;
  else throw invalidHotel();
  const name = `${HOTEL_SCHEMA_PREFIX}${hex}`;
  assertSafeIdentifier(name);
  return name;
}

/** "hotel_<32 hex>_rw": the NOLOGIN role that alone may touch that schema (section 7.2). */
export function hotelRoleName(hotelId: unknown): string {
  const name = `${hotelSchemaName(hotelId)}${HOTEL_ROLE_SUFFIX}`;
  assertSafeIdentifier(name);
  return name;
}

/** search_path inside a hotel transaction: the hotel schema, then pg_catalog. Never platform, never public. */
export function hotelSearchPath(hotelId: unknown): string {
  return `${hotelSchemaName(hotelId)}, pg_catalog`;
}

/** Second guard for the few places a name must sit inside SQL text (migration runner, create-hotel). */
export function quoteIdentifier(name: string): string {
  assertSafeIdentifier(name);
  return `"${name}"`;
}
```

<!-- verified: src/server/db/schema-version.ts -->
```ts
import "server-only";

/**
 * The oldest hotel template version this code can serve. The migration runner stores each hotel's version in
 * platform.hotels.schema_version. A hotel below this answers 503 "being upgraded" instead of failing half way
 * (expand/contract, section 7.6). Raise it only in the release that NEEDS the new columns.
 */
export const REQUIRED_HOTEL_SCHEMA_VERSION = 1;
```

<!-- verified: src/server/db/pg-errors.ts -->
```ts
import "server-only";
import { DatabaseError } from "pg";
import { AppError } from "../errors";

const busy = (cause: unknown): AppError =>
  new AppError("SERVICE_UNAVAILABLE", "The database is busy or unreachable. Try again.", { retryAfterSeconds: 2 }, { cause });

/**
 * Known PostgreSQL errors become API errors. The driver message, table, constraint and SQL never reach the client.
 * Services catch the constraints they know first and throw Pallav's own message (e.g. "This bill number already exists.").
 * Everything else (including 42501 insufficient_privilege, which means a cross-hotel bug) stays a SERVER_ERROR, logged.
 */
export function mapDbError(thrown: unknown): unknown {
  if (thrown instanceof DatabaseError) {
    const options = { cause: thrown };
    const code = thrown.code ?? "";
    switch (code) {
      case "23505": // unique_violation
        return new AppError("CONFLICT", "Duplicate value", undefined, options);
      case "23503": // foreign_key_violation
        return new AppError("CONFLICT", "A linked record is missing or still in use", undefined, options);
      case "40001": // serialization_failure
      case "40P01": // deadlock_detected
      case "55P03": // lock_not_available (lock_timeout)
        return new AppError("CONFLICT", "The record is busy. Try again.", undefined, options);
      case "57014": // query_canceled (statement_timeout)
      case "53300": // too_many_connections
      case "57P01": // admin_shutdown
      case "57P02": // crash_shutdown
      case "57P03": // cannot_connect_now (starting up, failover)
        return busy(thrown);
      default:
        // class 08 = connection exception (also what PgBouncer sends when query_wait_timeout fires: 08P01)
        return code.startsWith("08") ? busy(thrown) : thrown;
    }
  }
  // Raised by the driver itself, not by the server: query_timeout, a dropped socket.
  if (thrown instanceof Error && /^(Query read timeout|Connection terminated|Client has encountered a connection error)/.test(thrown.message)) {
    return busy(thrown);
  }
  return thrown;
}

/** True when a unique violation hit this exact constraint (for Pallav-specific messages in services). */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return error instanceof DatabaseError && error.code === "23505" && error.constraint === constraint;
}
```

<!-- verified: src/server/db/health.ts -->
```ts
import "server-only";
import { setInterval } from "node:timers";
import { AppError } from "../errors";
import { getLogger } from "../logger";
import { getPool } from "./pool";

/**
 * One line per minute per process. waiting > 0 means requests queue for a connection: the pool is the bottleneck.
 * cacheMb is the catalog cache of ONE pooled backend (section 8.9): it grows with every hotel schema a backend touches.
 */
export function startPoolStats(): void {
  const timer = setInterval(() => {
    const pool = getPool();
    pool
      .query<{ cache_mb: number }>(
        `WITH c AS (SELECT path[array_length(path, 1)] AS id FROM pg_backend_memory_contexts WHERE name = 'CacheMemoryContext')
         SELECT (sum(m.total_bytes) / 1048576)::int AS cache_mb FROM pg_backend_memory_contexts m, c WHERE c.id = ANY (m.path)`,
      )
      .then(({ rows }) => {
        getLogger().info("pg pool", { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, cacheMb: rows[0]?.cache_mb });
      })
      .catch((error: unknown) => getLogger().warn("pg pool stats failed", { cause: error }));
  }, 60_000);
  timer.unref();
}

const READY_TIMEOUT_MS = 1_000;

/** Readiness: the database answers SELECT 1 within one second. Says nothing about versions or hosts. */
export async function checkReady(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new AppError("SERVICE_UNAVAILABLE", "Database did not answer in time")), READY_TIMEOUT_MS);
  });
  try {
    await Promise.race([getPool().query("SELECT 1"), timeout]);
  } catch (cause) {
    throw cause instanceof AppError ? cause : new AppError("SERVICE_UNAVAILABLE", "Database unreachable", undefined, { cause });
  } finally {
    clearTimeout(timer);
  }
}

/** Boot guard: the web app must be connected as the limited role, never as an owner or superuser. */
export async function assertSafeAppRole(expectedRole: string): Promise<void> {
  const { rows } = await getPool().query<{ role: string; superuser: boolean; bypassrls: boolean; createrole: boolean; createdb: boolean }>(
    `SELECT current_user AS role, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
            r.rolcreaterole AS createrole, r.rolcreatedb AS createdb
       FROM pg_roles r
      WHERE r.rolname = current_user`,
  );
  const me = rows[0];
  if (me === undefined || me.role !== expectedRole || me.superuser || me.bypassrls || me.createrole || me.createdb) {
    throw new Error(`Unsafe database role for the web app: expected ${expectedRole} without SUPERUSER, BYPASSRLS, CREATEROLE or CREATEDB`);
  }
}
```

`pg_backend_memory_contexts` is closed to `hms_app` by default (tested). Setup grants exactly `SELECT` on the view and `EXECUTE` on `pg_get_backend_memory_contexts()`; that shows a backend only its own memory.

#### 4.2.7 `server/auth/permission-keys.ts`, `permissions.ts`, `policy.ts`, `session.ts`, `tokens.ts`

`permission-keys.ts` is **generated** by `db/scripts/generate-platform-seeds.ts` from `db/seeds/source/pallav-permissions.json` (the same source as the seed: 13 modules, 37 parts, 6 abilities). Excerpt:

<!-- verified: src/server/auth/permission-keys.ts -->
```ts
import "server-only";
// GENERATED by db/scripts/generate-platform-seeds.ts from db/seeds/source/pallav-permissions.json (same source as the
// platform.permissions seed). Do not edit by hand. Shortened here to a few keys; the real file lists all 56.

export const PERMISSION_KEYS = [
  "dashboard", "revenue", "expense", "handover", "bills", "companies", "payroll", "reports", "pms", "website",
  "users", "access", "masters",
  "revenue.hotel", "revenue.food", "payroll.salary-slip",
  "users.password", "users.set-password", "users.activity", "website.secrets", "system.backdate", "system.force",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** A part's module: Pallav "a module's own permission stands for all of it". Abilities have no parent. */
export const PARENT_OF: Readonly<Partial<Record<PermissionKey, PermissionKey>>> = {
  "revenue.hotel": "revenue",
  "revenue.food": "revenue",
  "payroll.salary-slip": "payroll",
};
```

<!-- verified: src/server/auth/permissions.ts -->
```ts
import "server-only";
// MJ's four levels (View Only < View & Create < View & Edit < Full Access) on Pallav's permission keys (13 modules, their
// parts, and one-off abilities), as seeded in platform.permissions. Type-only import from the admin contract: that file
// also holds mock data, which must never be bundled into the server.
import type { PermissionLevel } from "@shared/dashboards/admin";
import { AppError } from "../errors";
import { PARENT_OF, PERMISSION_KEYS, type PermissionKey } from "./permission-keys";

export type Level = PermissionLevel;

/** What a route needs: the permission key and the lowest level that may call it. */
export interface Permission {
  readonly key: PermissionKey;
  readonly level: Exclude<Level, "none">;
}

/** One user's grants in the ACTIVE hotel: role levels plus that user's own grants and revokes. */
export interface Grants {
  readonly levels: ReadonlyMap<PermissionKey, Level>;
  readonly revoked: ReadonlySet<PermissionKey>;
}

const RANK: Readonly<Record<Level, number>> = { none: 0, view: 1, create: 2, edit: 3, full: 4 };

const isKey = (value: unknown): value is PermissionKey => typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);
const isLevel = (value: unknown): value is Level => typeof value === "string" && Object.hasOwn(RANK, value);

export const NO_GRANTS: Grants = { levels: new Map(), revoked: new Set() };

/**
 * roleLevels: {key: level}, the role's FULL effective grant (the Pallav ladder is already folded in when a role is saved).
 * overrides: [{key, level, granted}] for this user in this hotel; granted=false is a revoke. Unknown data is ignored (deny).
 */
export function grantsFrom(roleLevels: unknown, overrides: unknown): Grants {
  const levels = new Map<PermissionKey, Level>();
  const revoked = new Set<PermissionKey>();
  if (typeof roleLevels === "object" && roleLevels !== null) {
    for (const [key, level] of Object.entries(roleLevels)) if (isKey(key) && isLevel(level)) levels.set(key, level);
  }
  if (Array.isArray(overrides)) {
    for (const item of overrides as unknown[]) {
      if (typeof item !== "object" || item === null) continue;
      const { key, level, granted } = item as { key?: unknown; level?: unknown; granted?: unknown };
      if (!isKey(key)) continue;
      if (granted === false) revoked.add(key);
      else if (isLevel(level)) levels.set(key, level);
    }
  }
  return { levels, revoked };
}

/** Pallav: a revoke always wins; a part without its own grant takes its module's level; abilities never inherit. */
export function levelFor(grants: Grants, key: PermissionKey): Level {
  if (grants.revoked.has(key)) return "none";
  const own = grants.levels.get(key);
  if (own !== undefined) return own;
  const parent = PARENT_OF[key];
  return parent === undefined ? "none" : levelFor(grants, parent);
}

export function hasPermission(grants: Grants, need: Permission): boolean {
  return RANK[levelFor(grants, need.key)] >= RANK[need.level];
}

/** One permission, or a list where ANY one is enough (Pallav Permissions::requirementsFor: "any one will do"). */
export type PermissionNeed = Permission | readonly Permission[];

/** Every hotel route declares its need; the wrapper calls this before the handler. Services re-check finer rules. */
export function requirePermission(grants: Grants, need: PermissionNeed): void {
  const options: readonly Permission[] = Array.isArray(need) ? need : [need as Permission];
  if (!options.some((one) => hasPermission(grants, one))) throw new AppError("FORBIDDEN");
}
```

<!-- verified: src/server/auth/policy.ts -->
```ts
import "server-only";
// Where HMS may differ from Pallav's sign-in, each change waits for MJ (section 15, Q2). Until MJ answers, every switch
// keeps Pallav's behaviour. Each switch is read in ONE place, and tests run both settings.

export const AUTH_POLICY = {
  /** Q2(a). false = Pallav: 5 wrong passwords or codes block with no timer (OneTimeCode::block). */
  timedLockout: false,
  /** Q2(b). false = Pallav: "locked" is shown before the password is checked; forgot-password names the masked email. */
  hideAccountState: false,
  /** Q2(c). false = Pallav: 5 wrong reset codes block the account; no cap on wrong codes across sends. */
  resetCodeCap: false,
  /** Q2(d). false = Pallav: the emailed code only when the user turned it on (platform accounts always need it, SE-7). */
  codeForAllAdmins: false,
  /** Q2(f). true = Pallav: a block (any reason) also ends live web sessions and phone tokens (EnsureAccountIsUsable). */
  blockEndsSessions: true,
} as const;
```

<!-- verified: src/server/auth/session.ts -->
```ts
import "server-only";
import { sha256Hex } from "../crypto/hash";
import { REQUIRED_HOTEL_SCHEMA_VERSION } from "../db/schema-version";
import { inTransaction, type HotelRef } from "../db/tx";
import type { TxClient } from "../db/types";
import { AppError } from "../errors";
import { grantsFrom, NO_GRANTS, type Grants } from "./permissions";
import { AUTH_POLICY } from "./policy";

export interface Credentials {
  readonly client: "web" | "mobile";
  readonly token: string;
}

export interface Principal {
  readonly sessionId: string;
  readonly client: "web" | "mobile";
  readonly userId: string;
  readonly displayName: string;
  /** The active hotel from the SESSION ROW (platform.sessions.hotel_id) and an active membership. Never from the request. */
  readonly hotel: HotelRef | null;
  readonly hotelUpgrading: boolean;
  readonly grants: Grants;
  readonly mustChangePassword: boolean;
  readonly needsTouch: boolean;
}

export interface HotelPrincipal extends Principal {
  readonly hotel: HotelRef;
}

interface SessionRow {
  session_id: string;
  client: "web" | "mobile";
  user_id: string;
  display_name: string;
  revoked_at: Date | null;
  revoked_reason: string | null;
  within_expiry: boolean;
  within_idle: boolean;
  needs_touch: boolean;
  is_active: boolean;
  is_blocked: boolean;
  blocked_by_admin: boolean;
  is_admin_locked: boolean;
  must_change_password: boolean;
  active_hotel_id: string | null;
  hotel_timezone: string | null;
  hotel_active: boolean | null;
  hotel_current: boolean | null;
  role_levels: unknown;
  overrides: unknown;
}

// ONE indexed lookup per request (unique index on token_hash). Pallav re-checks active / blocked / single session on
// every request; so do we. Columns added in Phase 1 step 3 (section 7.9): users.blocked_at, users.blocked_kind,
// hotels.schema_version, user_permissions.hotel_id. The role must be built-in (hotel_id NULL) or belong to THIS hotel:
// a custom role of another hotel gives nothing here (SE-4b).
const SESSION_SQL = `
SELECT s.id AS session_id, s.client, s.user_id, u.display_name, s.revoked_at, s.revoked_reason,
       s.expires_at > now() AS within_expiry,
       (s.client <> 'web' OR COALESCE(s.last_seen_at, s.issued_at) > now() - interval '120 minutes') AS within_idle,
       COALESCE(s.last_seen_at, s.issued_at) < now() - interval '5 minutes' AS needs_touch,
       (u.status = 'active' AND u.deleted_at IS NULL) AS is_active,
       u.blocked_at IS NOT NULL AS is_blocked,
       COALESCE(u.blocked_kind = 'admin', false) AS blocked_by_admin,
       COALESCE(u.locked_until > now(), false) AS is_admin_locked,
       u.must_change_password,
       uh.hotel_id AS active_hotel_id, h.timezone AS hotel_timezone,
       (h.status = 'active' AND h.deleted_at IS NULL) AS hotel_active,
       h.schema_version >= $3 AS hotel_current,
       (SELECT jsonb_object_agg(p.key, rp.level)
          FROM platform.roles r
          JOIN platform.role_permissions rp ON rp.role_id = r.id
          JOIN platform.permissions p ON p.id = rp.permission_id
         WHERE r.id = COALESCE(uh.role_id, u.role_id)
           AND (r.hotel_id IS NULL OR r.hotel_id = uh.hotel_id)) AS role_levels,
       (SELECT jsonb_agg(jsonb_build_object('key', p.key, 'level', up.level, 'granted', up.granted))
          FROM platform.user_permissions up JOIN platform.permissions p ON p.id = up.permission_id
         WHERE up.user_id = u.id AND up.hotel_id = uh.hotel_id) AS overrides
  FROM platform.sessions s
  JOIN platform.users u ON u.id = s.user_id
  LEFT JOIN platform.user_hotels uh ON uh.user_id = s.user_id AND uh.hotel_id = s.hotel_id AND uh.status = 'active'
  LEFT JOIN platform.hotels h ON h.id = uh.hotel_id
 WHERE s.token_hash = $1 AND s.client = $2`;

/** Verifies the token against the database on EVERY request. Throws the error code the apps act on. */
export async function authenticate(tx: TxClient, credentials: Credentials | null): Promise<Principal> {
  if (credentials === null) throw new AppError("SESSION_EXPIRED");
  const { rows } = await tx.query<SessionRow>(SESSION_SQL, [sha256Hex(credentials.token), credentials.client, REQUIRED_HOTEL_SCHEMA_VERSION]);
  const row = rows[0];
  if (row === undefined) throw new AppError("SESSION_EXPIRED");
  if (row.revoked_at !== null) throw new AppError(row.revoked_reason === "replaced" ? "SESSION_REPLACED" : "SESSION_EXPIRED");
  if (!row.within_expiry || !row.within_idle) throw new AppError("SESSION_EXPIRED");
  if (!row.is_active) throw new AppError("ACCOUNT_DISABLED");
  // Pallav (EnsureAccountIsUsable): any block or admin lock ends the session. Q2(f) would keep sessions alive when the
  // block came only from wrong passwords or codes typed by someone else.
  const blocked = row.is_blocked && (AUTH_POLICY.blockEndsSessions || row.blocked_by_admin);
  if (blocked || row.is_admin_locked) throw new AppError("ACCOUNT_LOCKED");

  const hotel = row.active_hotel_id !== null && row.hotel_timezone !== null && row.hotel_active === true
    ? { id: row.active_hotel_id, timezone: row.hotel_timezone }
    : null;
  return {
    sessionId: row.session_id,
    client: row.client,
    userId: row.user_id,
    displayName: row.display_name,
    hotel,
    hotelUpgrading: hotel !== null && row.hotel_current !== true,
    grants: hotel === null ? NO_GRANTS : grantsFrom(row.role_levels, row.overrides),
    mustChangePassword: row.must_change_password,
    needsTouch: row.needs_touch,
  };
}

/** Hotel routes only: there must be an active, current hotel. */
export function requireHotel(principal: Principal): HotelPrincipal {
  const hotel = principal.hotel;
  if (hotel === null) throw new AppError("FORBIDDEN", "Hotel is not available");
  if (principal.hotelUpgrading) throw new AppError("SERVICE_UNAVAILABLE", "Hotel is being upgraded", { retryAfterSeconds: 30 });
  return { ...principal, hotel };
}

/** After the response, at most once per 5 minutes per session (a HOT update: last_seen_at has no index). */
export async function touchSession(sessionId: string): Promise<void> {
  await inTransaction(async (tx) => {
    await tx.query("UPDATE platform.sessions SET last_seen_at = now() WHERE id = $1 AND COALESCE(last_seen_at, issued_at) < now() - interval '5 minutes'", [sessionId]);
  });
}
```

<!-- verified: src/server/auth/tokens.ts -->
```ts
import "server-only";
import { randomBytes, randomInt } from "node:crypto";
// Hashing lives in crypto/hash.ts: sha256Hex for these 256-bit tokens, hashAuthCode (HMAC) for 6-digit codes.

/** Web session token: 256 random bits. Only sha256Hex(token) is stored (platform.sessions.token_hash). */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Mobile bearer token, 90 days (Pallav MobileToken::DAYS). Only sha256Hex(token) is stored. */
export function newMobileToken(): string {
  return `hms_m_${randomBytes(32).toString("base64url")}`;
}

/** Six digits, uniform (Pallav OneTimeCode). */
export function newOneTimeCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
```

#### 4.2.8 `server/http/*`: respond, body, origin, client IP, cookies, after

<!-- verified: src/server/http/respond.ts -->
```ts
import "server-only";
import { NextResponse } from "next/server";
import { toErrorResult } from "../errors";
import type { Logger } from "../logger";
import { TRACE_HEADER } from "./trace";

/** Sent on EVERY API response, success or error. Next adds no Cache-Control to dynamic route handler responses. */
export const API_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
};

export function jsonBody(body: unknown, status: number, traceId: string, extra: Readonly<Record<string, string>> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...API_HEADERS, [TRACE_HEADER]: traceId, ...extra } });
}

/** The one error format (MASTER 7). The real cause goes to the log only, redacted by the logger. */
export function jsonError(thrown: unknown, traceId: string, logger: Logger): NextResponse {
  const { status, body, unexpected } = toErrorResult(thrown, traceId);
  const extra: Record<string, string> = {};
  const retryAfter = body.error.details?.retryAfterSeconds;
  if (retryAfter !== undefined) extra["retry-after"] = String(Math.max(0, Math.ceil(retryAfter)));
  const fields = { code: body.error.code, status, cause: thrown };
  if (unexpected) logger.error("request failed", fields);
  else logger.warn("request rejected", fields);
  return jsonBody(body, status, traceId, extra);
}
```

<!-- verified: src/server/http/body.ts -->
```ts
import "server-only";
import { AppError } from "../errors";

const JSON_TYPE = /^application\/json\s*(;|$)/i;

export interface JsonBody {
  /** Exact text received (the idempotency hash uses the parsed values, see route.ts). */
  readonly text: string;
  readonly value: unknown;
}

/**
 * Reads a JSON body with a hard byte cap, BEFORE any database connection is taken.
 * Route handlers have no built-in body limit (serverActions.bodySizeLimit covers Server Actions only).
 * A body can be read once.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  if (!JSON_TYPE.test(request.headers.get("content-type") ?? "")) throw new AppError("UNSUPPORTED_MEDIA_TYPE");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE");
  if (request.body === null) throw new AppError("BAD_REQUEST", "A JSON body is required");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new AppError("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new AppError("BAD_REQUEST", "Body is not valid UTF-8");
  }
  try {
    return { text, value: JSON.parse(text) as unknown };
  } catch {
    throw new AppError("BAD_REQUEST", "Body is not valid JSON");
  }
}
```

<!-- verified: src/server/http/origin.ts -->
```ts
import "server-only";
import { appOrigins } from "../config/env";
import { AppError } from "../errors";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF guard. Next.js checks Origin only for Server Actions, not for route handlers.
 * - Bearer requests (mobile) are exempt: they carry no ambient credential, and the cookie is ignored for them.
 * - Origin present: it must be one of APP_ORIGINS (browsers send it on every cross-site write).
 * - Origin absent with a session cookie: only Sec-Fetch-Site same-origin passes.
 * - Origin absent and no cookie (native app sign-in, curl): allowed, there is nothing to forge.
 * JSON-only bodies (body.ts) are the second layer: an HTML form cannot send application/json.
 */
export function assertTrustedOrigin(request: Request, hasSessionCookie: boolean): void {
  if (!UNSAFE.has(request.method)) return;
  if (request.headers.has("authorization")) return;
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (!appOrigins().includes(origin)) throw new AppError("FORBIDDEN", "Origin not allowed");
    return;
  }
  if (hasSessionCookie && request.headers.get("sec-fetch-site") !== "same-origin") {
    throw new AppError("FORBIDDEN", "Origin not allowed");
  }
}
```

<!-- verified: src/server/http/client-ip.ts -->
```ts
import "server-only";
import { getConfig } from "../config/env";

const IP = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * NextRequest has no `ip` any more. Behind our nginx (TRUST_PROXY=1) the client address is X-Real-IP, which nginx
 * overwrites on every request (`proxy_set_header X-Real-IP $remote_addr`). Next listens on 127.0.0.1 only, so nobody
 * can reach it without nginx. Used for rate limits and audit rows, never for authorization.
 */
export function clientIp(request: Request): string | null {
  if (getConfig().TRUST_PROXY !== "1") return null;
  const value = request.headers.get("x-real-ip")?.trim() ?? "";
  return IP.test(value) ? value : null;
}

/**
 * The rate-limit bucket of an address: IPv4 as it is; IPv6 cut to its /64, because one phone or home network owns a
 * whole /64 and could otherwise rotate addresses for ever. A missing address (development) shares one bucket.
 */
export function ipBucket(ip: string | null): string {
  if (ip === null) return "ip:none";
  if (!ip.includes(":")) return `ip:${ip}`;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return `ip:${mapped[1]}`;
  const [head = "", tail] = ip.toLowerCase().split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `ip:${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
```

<!-- verified: src/server/http/cookies.ts -->
```ts
import "server-only";
import type { NextResponse } from "next/server";

/** __Host-: Secure, Path=/, no Domain, so a sibling subdomain cannot set or read it. */
export const SESSION_COOKIE = "__Host-hms_session";

/** Browser lifetime only. Validity is decided on the server on every request (idle and absolute limits, revocation). */
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({ name: SESSION_COOKIE, value: token, httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: COOKIE_MAX_AGE_SECONDS });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}
```

<!-- verified: src/server/http/after.ts -->
```ts
import "server-only";
import { after } from "next/server";
import { getLogger } from "../logger";

/**
 * Best-effort work after the response is sent (last-seen touch, metrics). NEVER money, audit rows, sessions,
 * lockouts or email: after() also runs when the handler failed, and is lost if the process crashes.
 */
export function runAfter(task: () => Promise<void>): void {
  const safe = (): Promise<void> => task().catch((error: unknown) => getLogger().warn("after-task failed", { cause: error }));
  try {
    after(safe);
  } catch {
    // Outside a Next.js request (unit tests, the worker) after() throws: run now, without waiting.
    void safe();
  }
}
```

#### 4.2.9 `server/http/route.ts`: the handler wrapper

<!-- verified: src/server/http/route.ts -->
```ts
import "server-only";
// The ONLY way to write an API endpoint. Every route.ts exports  GET/POST/... = publicRoute | sessionRoute | hotelRoute,
// and the methods it does not serve as methodsNotAllowed.
// Order for every request: trace id -> CSRF origin check -> body (capped) and zod parsing, all BEFORE any database work
// -> (no credential: 401 without a connection) -> rate limits (own short statement) -> one transaction: session check
// -> password-change gate -> hotel + permission -> SET LOCAL hotel -> idempotency claim -> handler -> COMMIT -> { data }.
// Anything thrown becomes the one JSON error body (never Next's empty 500).
import { createHash } from "node:crypto";
import { z } from "zod";
import { requirePermission, type PermissionNeed } from "../auth/permissions";
import { authenticate, requireHotel, touchSession, type Credentials, type HotelPrincipal, type Principal } from "../auth/session";
import { getConfig } from "../config/env";
import { mapDbError } from "../db/pg-errors";
import { enterHotel, inTransaction } from "../db/tx";
import type { TxClient } from "../db/types";
import { AppError } from "../errors";
import { getLogger } from "../logger";
import { runWithContext, type RequestContext } from "../lib/request-context";
import { claimIdempotencyKey, saveIdempotentResponse } from "../repos/idempotency.repo";
import { consumeRateLimits, type LimitRule } from "../repos/rate-limit.repo";
import { parseInput } from "../validation/zodErrors";
import { runAfter } from "./after";
import { readJsonBody } from "./body";
import { clientIp, ipBucket } from "./client-ip";
import { clearSessionCookie, readCookie, SESSION_COOKIE, setSessionCookie } from "./cookies";
import { assertTrustedOrigin } from "./origin";
import { jsonBody, jsonError } from "./respond";
import { traceIdFromRequest } from "./trace";

type AnySchema = z.ZodType;
type Parsed<S> = S extends AnySchema ? z.output<S> : undefined;
type SuccessStatus = 200 | 201 | 202;
type RouteParams = Record<string, string | string[] | undefined>;

/** What a route.ts exports. Accepts a plain Request so tests can call it directly; compatible with Next's checks. */
export type RouteHandler = (request: Request, context?: { params: Promise<RouteParams> }) => Promise<Response>;

// ---------------------------------------------------------------- replies (status / session cookie / failure after commit)

const REPLY = Symbol("hms.reply");
const FAIL = Symbol("hms.fail");
type SessionChange = { readonly set: string } | "clear";

export interface Reply<T> {
  readonly [REPLY]: true;
  readonly data: T;
  readonly status?: SuccessStatus;
  readonly session?: SessionChange;
}

/** Only for auth routes (set or clear the web session cookie) or a status other than the route default. */
export function reply<T>(data: T, options: { status?: SuccessStatus; session?: SessionChange } = {}): Reply<T> {
  return { [REPLY]: true, data, ...options };
}

function isReply(value: unknown): value is Reply<unknown> {
  return typeof value === "object" && value !== null && REPLY in value;
}

export interface Failure {
  readonly [FAIL]: AppError;
}

/**
 * COMMIT what the handler wrote (an attempt counter, a block, an audit row of a refusal), THEN answer with `error`.
 * A plain `throw` rolls the transaction back, so a wrong code would never be counted (SE-11). Not for idempotent routes.
 */
export function failAfterCommit(error: AppError): Failure {
  return { [FAIL]: error };
}

function failureOf(value: unknown): AppError | null {
  return typeof value === "object" && value !== null && FAIL in value ? (value as Failure)[FAIL] : null;
}

// ---------------------------------------------------------------- route specs

interface BaseSpec<B, Q, P> {
  /** Stable id, e.g. "cash.deposits.create": logs, idempotency scope and the route inventory (docs/API.md). */
  readonly name: string;
  readonly body?: B;
  readonly query?: Q;
  readonly params?: P;
  readonly maxBodyBytes?: number;
  readonly status?: SuccessStatus;
  /** Pallav throttles (SE-22): counted in their own statement before the main transaction, so a refusal still counts. */
  readonly limits?: (inputs: Inputs<B, Q, P>, ip: string) => readonly LimitRule[];
  /** Log at debug level (health checks). */
  readonly quiet?: boolean;
}

export interface Inputs<B, Q, P> {
  readonly request: Request;
  readonly traceId: string;
  readonly body: Parsed<B>;
  readonly query: Parsed<Q>;
  readonly params: Parsed<P>;
}

export interface PublicSpec<B, Q, P> extends BaseSpec<B, Q, P> {
  readonly handler: (ctx: Inputs<B, Q, P>) => Promise<unknown>;
}

export interface SessionSpec<B, Q, P> extends BaseSpec<B, Q, P> {
  /** May be called while the account must change its password (change password, sign out, session). */
  readonly allowPasswordChange?: boolean;
  readonly handler: (ctx: Inputs<B, Q, P> & { readonly tx: TxClient; readonly principal: Principal }) => Promise<unknown>;
}

/** A fixed need, or one worked out from the validated input (Pallav's part permissions, e.g. revenue.hotel vs revenue.food). */
export type PermissionRule<B, Q, P> = PermissionNeed | ((inputs: Inputs<B, Q, P>) => PermissionNeed);

export interface HotelSpec<B, Q, P> extends BaseSpec<B, Q, P> {
  /** Checked before the handler. Deny by default: a hotel route cannot be declared without one. */
  readonly permission: PermissionRule<B, Q, P>;
  /** Money, booking and payment creates: require an Idempotency-Key header (MASTER 7). */
  readonly idempotent?: boolean;
  readonly handler: (ctx: Inputs<B, Q, P> & { readonly tx: TxClient; readonly principal: HotelPrincipal }) => Promise<unknown>;
}

type AnyBase = BaseSpec<AnySchema | undefined, AnySchema | undefined, AnySchema | undefined>;
type AnyInputs = Inputs<AnySchema | undefined, AnySchema | undefined, AnySchema | undefined>;

type Plan =
  | { readonly mode: "public"; readonly run: (inputs: AnyInputs) => Promise<unknown> }
  | { readonly mode: "session"; readonly allowPasswordChange: boolean; readonly run: (inputs: AnyInputs, tx: TxClient, principal: Principal) => Promise<unknown> }
  | {
      readonly mode: "hotel";
      readonly need: (inputs: AnyInputs) => PermissionNeed;
      readonly idempotent: boolean;
      readonly run: (inputs: AnyInputs, tx: TxClient, principal: HotelPrincipal) => Promise<unknown>;
    };

type Opt = AnySchema | undefined;

export function publicRoute<B extends Opt = undefined, Q extends Opt = undefined, P extends Opt = undefined>(spec: PublicSpec<B, Q, P>): RouteHandler {
  return build(spec as AnyBase, { mode: "public", run: (inputs) => spec.handler(inputs as Inputs<B, Q, P>) });
}

export function sessionRoute<B extends Opt = undefined, Q extends Opt = undefined, P extends Opt = undefined>(spec: SessionSpec<B, Q, P>): RouteHandler {
  return build(spec as AnyBase, {
    mode: "session",
    allowPasswordChange: spec.allowPasswordChange === true,
    run: (inputs, tx, principal) => spec.handler({ ...(inputs as Inputs<B, Q, P>), tx, principal }),
  });
}

export function hotelRoute<B extends Opt = undefined, Q extends Opt = undefined, P extends Opt = undefined>(spec: HotelSpec<B, Q, P>): RouteHandler {
  const rule = spec.permission;
  return build(spec as AnyBase, {
    mode: "hotel",
    need: (inputs) => (typeof rule === "function" ? rule(inputs as Inputs<B, Q, P>) : rule),
    idempotent: spec.idempotent === true,
    run: (inputs, tx, principal) => spec.handler({ ...(inputs as Inputs<B, Q, P>), tx, principal }),
  });
}

/**
 * For every method a route.ts does not serve:  export const { PUT, PATCH, DELETE } = methodsNotAllowed;
 * Without it Next answers 405 with an EMPTY body (auto-implement-methods.js), outside the one error format.
 */
const notAllowed = publicRoute({
  name: "api.method_not_allowed",
  handler: async () => {
    throw new AppError("METHOD_NOT_ALLOWED");
  },
});
export const methodsNotAllowed = { GET: notAllowed, POST: notAllowed, PUT: notAllowed, PATCH: notAllowed, DELETE: notAllowed } as const;

// ---------------------------------------------------------------- engine

const BEARER = /^Bearer ([A-Za-z0-9_-]{20,200})$/;
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;
const IdempotencyKey = z.uuid();
const SLOW_REQUEST_MS = 500;

/** Bearer wins: a request with an Authorization header never falls back to the cookie. Malformed = no credentials. */
function credentialsOf(request: Request): Credentials | null {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const match = BEARER.exec(authorization);
    return match ? { client: "mobile", token: match[1] } : null;
  }
  const cookie = readCookie(request, SESSION_COOKIE);
  return cookie !== null && TOKEN.test(cookie) ? { client: "web", token: cookie } : null;
}

function idempotencyKeyOf(request: Request): string {
  const parsed = IdempotencyKey.safeParse(request.headers.get("idempotency-key"));
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "Idempotency-Key header must be a UUID", { fields: { "Idempotency-Key": "Required: a UUID" } });
  }
  return parsed.data.toLowerCase();
}

/** Same key + different method, route, path ids, query or body = a different request (422 IDEMPOTENCY_KEY_REUSED). */
function requestHashOf(method: string, route: string, inputs: AnyInputs): string {
  const canonical = JSON.stringify([method, route, inputs.params ?? null, inputs.query ?? null, inputs.body ?? null]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function finalBody(result: unknown, defaultStatus: SuccessStatus): { status: SuccessStatus; body: { data: unknown } } {
  if (isReply(result)) return { status: result.status ?? defaultStatus, body: { data: result.data } };
  return { status: defaultStatus, body: { data: result } };
}

function toResponse(result: unknown, defaultStatus: SuccessStatus, traceId: string): Response {
  const failed = failureOf(result);
  if (failed !== null) throw failed;
  const { status, body } = finalBody(result, defaultStatus);
  const response = jsonBody(body, status, traceId);
  if (isReply(result) && result.session !== undefined) {
    if (result.session === "clear") clearSessionCookie(response);
    else setSessionCookie(response, result.session.set);
  }
  return response;
}

type Outcome = { readonly kind: "fresh"; readonly result: unknown } | { readonly kind: "replay"; readonly status: number; readonly body: unknown };

async function execute(spec: AnyBase, plan: Plan, request: Request, routeContext: { params: Promise<RouteParams> } | undefined, ctx: RequestContext): Promise<Response> {
  const config = getConfig();
  ctx.ip = clientIp(request);
  const credentials = credentialsOf(request);
  assertTrustedOrigin(request, credentials?.client === "web");

  // 1. Everything that needs no database: a slow or invalid request never holds a pooled connection.
  const raw = spec.body ? await readJsonBody(request, spec.maxBodyBytes ?? config.API_MAX_BODY_BYTES) : null;
  const inputs: AnyInputs = {
    request,
    traceId: ctx.traceId,
    body: spec.body ? parseInput(spec.body, raw?.value) : undefined,
    query: spec.query ? parseInput(spec.query, Object.fromEntries(new URL(request.url).searchParams)) : undefined,
    params: spec.params ? parseInput(spec.params, routeContext ? await routeContext.params : {}) : undefined,
  };
  const defaultStatus = spec.status ?? 200;
  // No token at all: answer without touching the pool, so anonymous floods cannot drain it.
  if (plan.mode !== "public" && credentials === null) throw new AppError("SESSION_EXPIRED");
  // 2. Throttles in their own autocommit statement: they count even when the request then fails.
  if (spec.limits) await consumeRateLimits(spec.limits(inputs, ipBucket(ctx.ip)));
  if (plan.mode === "public") return toResponse(await plan.run(inputs), defaultStatus, ctx.traceId);

  const key = plan.mode === "hotel" && plan.idempotent ? idempotencyKeyOf(request) : null;
  const readOnly = request.method === "GET" || request.method === "HEAD";

  // 3. One checkout, one transaction for the whole request.
  const outcome = await inTransaction(async (tx): Promise<Outcome> => {
    const principal = await authenticate(tx, credentials);
    ctx.userId = principal.userId;
    if (principal.mustChangePassword && !(plan.mode === "session" && plan.allowPasswordChange)) throw new AppError("PASSWORD_CHANGE_REQUIRED");
    if (principal.needsTouch) runAfter(() => touchSession(principal.sessionId));
    if (plan.mode === "session") return { kind: "fresh", result: await plan.run(inputs, tx, principal) };

    const hotelPrincipal = requireHotel(principal);
    requirePermission(hotelPrincipal.grants, plan.need(inputs));
    ctx.hotelId = hotelPrincipal.hotel.id;
    await enterHotel(tx, hotelPrincipal.hotel, hotelPrincipal.userId);
    if (key === null) return { kind: "fresh", result: await plan.run(inputs, tx, hotelPrincipal) };

    const claim = await claimIdempotencyKey(tx, hotelPrincipal.userId, key, spec.name, requestHashOf(request.method, spec.name, inputs));
    if (claim.kind === "replay") return claim;
    const result = await plan.run(inputs, tx, hotelPrincipal);
    if (failureOf(result) !== null) throw new Error(`${spec.name}: failAfterCommit is not allowed on an idempotent route`);
    const { status, body } = finalBody(result, defaultStatus);
    await saveIdempotentResponse(tx, hotelPrincipal.userId, key, status, body);
    return { kind: "fresh", result };
  }, { readOnly });

  if (outcome.kind === "replay") return jsonBody(outcome.body, outcome.status, ctx.traceId, { "idempotent-replayed": "true" });
  return toResponse(outcome.result, defaultStatus, ctx.traceId);
}

function accessLogSample(): number {
  try {
    return getConfig().ACCESS_LOG_SAMPLE;
  } catch {
    return 1;
  }
}

function build(spec: AnyBase, plan: Plan): RouteHandler {
  return async (request, routeContext) => {
    // Reading request headers first also keeps every API route dynamic (never prerendered), even under Cache Components.
    const traceId = traceIdFromRequest(request);
    const ctx: RequestContext = { traceId, route: spec.name, ip: null, dbQueries: 0, dbMs: 0 };
    return runWithContext(ctx, async () => {
      const started = performance.now();
      const log = getLogger().child({ traceId, route: spec.name });
      let response: Response;
      try {
        response = await execute(spec, plan, request, routeContext, ctx);
      } catch (thrown) {
        response = jsonError(mapDbError(thrown), traceId, log);
      }
      const ms = Math.round(performance.now() - started);
      const line = { method: request.method, status: response.status, ms, dbQueries: ctx.dbQueries, dbMs: Math.round(ctx.dbMs), userId: ctx.userId, hotelId: ctx.hotelId };
      // Every error and every slow request; a sample of the fast successes (OP-1). Health checks at debug level.
      if (spec.quiet === true) log.debug("request", line);
      else if (response.status >= 400 || ms >= SLOW_REQUEST_MS || Math.random() < accessLogSample()) log.info("request", line);
      return response;
    });
  };
}
```

#### 4.2.10 Repositories: `sql.ts`, `system-log.repo.ts`, `idempotency.repo.ts`, `rate-limit.repo.ts`, `cash/deposits.repo.ts`

<!-- verified: src/server/repos/sql.ts -->
```ts
import "server-only";

/** ILIKE '%text%' pattern with %, _ and \ escaped. Use with ESCAPE '\'. Undefined or blank means "no filter". */
export function containsPattern(text: string | undefined): string | null {
  if (text === undefined || text === "") return null;
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}
```

<!-- verified: src/server/repos/system-log.repo.ts -->
```ts
import "server-only";
// Pallav's SystemLogger (app/Support/SystemLogger.php), ported: the hotel's own system_logs table (hotel template 0001).
// One difference on purpose: Pallav writes the log after the change and swallows failures; here the row is written in
// the SAME transaction as the change (MASTER 4.4), so a change can never exist without its log line, nor the reverse.
// trace_id is the one added column (an additive deviation, listed in docs/DATABASE.md).
import type { TxClient } from "../db/types";
import { currentContext } from "../lib/request-context";
import { redact } from "../logger";

export interface LogActor {
  readonly id: string;
  readonly name: string;
}

export interface SystemLogEntry {
  /** Pallav's module key, e.g. "revenue". */
  readonly module: string;
  /** Pallav's action words: "created", "updated", "deleted", ... */
  readonly action: string;
  /** e.g. "Hotel deposit" (Pallav: the book label + " deposit"). */
  readonly entity: string;
  readonly summary: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly subjectId?: string;
  readonly subjectLabel?: string;
  readonly status?: "success" | "failed";
  /** null = a job or the system (Pallav: "System"). */
  readonly actor: LogActor | null;
}

/** mb_substr: cut by characters, never in the middle of one. */
const cut = (text: string, max: number): string => Array.from(text).slice(0, max).join("");

export async function writeSystemLog(tx: TxClient, entry: SystemLogEntry): Promise<void> {
  const ctx = currentContext();
  const details = entry.details !== undefined && Object.keys(entry.details).length > 0 ? JSON.stringify(redact(entry.details)) : null;
  await tx.query(
    `INSERT INTO system_logs (module, user_id, user_name, action, status, entity, subject_id, subject_label, summary, details, ip_address, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
    [
      entry.module,
      entry.actor?.id ?? null,
      entry.actor === null ? "System" : cut(entry.actor.name, 150),
      entry.action,
      entry.status ?? "success",
      entry.entity,
      entry.subjectId ?? null,
      entry.subjectLabel === undefined ? null : cut(entry.subjectLabel, 255),
      cut(entry.summary, 500),
      details,
      ctx?.ip ?? null,
      ctx?.traceId ?? null,
    ],
  );
}

/** SystemLogger::created(): "Added {entity}: {label}", the detail is what the record was created holding. */
export function logCreated(tx: TxClient, actor: LogActor | null, module: string, entity: string, subjectId: string, label: string, details: Readonly<Record<string, unknown>>): Promise<void> {
  return writeSystemLog(tx, { module, action: "created", entity, summary: `Added ${entity}: ${label}`, details, subjectId, subjectLabel: label, actor });
}
```

`logUpdated` (only the fields that moved, "was X, became Y") and `logDeleted` follow `SystemLogger::updated/deleted/diff` the same way.

<!-- verified: src/server/repos/idempotency.repo.ts -->
```ts
import "server-only";
import type { TxClient } from "../db/types";
import { AppError } from "../errors";

export type IdempotencyClaim = { readonly kind: "claimed" } | { readonly kind: "replay"; readonly status: number; readonly body: unknown };

/**
 * Claims (user, key) INSIDE the request transaction, before the work. A parallel request with the same key waits on the
 * primary key until the first transaction ends (bounded by lock_timeout, then 409), and then replays the stored
 * response. If the first request rolled back, its claim is gone and the retry runs normally. (Verified on PostgreSQL 18.)
 */
export async function claimIdempotencyKey(tx: TxClient, userId: string, key: string, route: string, requestHash: string): Promise<IdempotencyClaim> {
  const inserted = await tx.query(
    `INSERT INTO idempotency_keys (user_id, key, route, request_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, key) DO NOTHING`,
    [userId, key, route, requestHash],
  );
  if (inserted.rowCount === 1) return { kind: "claimed" };

  const { rows } = await tx.query<{ route: string; request_hash: string; response_status: number | null; response_body: unknown }>(
    "SELECT route, request_hash, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2",
    [userId, key],
  );
  const row = rows[0];
  if (row === undefined || row.response_status === null) throw new AppError("CONFLICT", "A request with this key is still running");
  if (row.route !== route || row.request_hash !== requestHash) throw new AppError("IDEMPOTENCY_KEY_REUSED");
  return { kind: "replay", status: row.response_status, body: row.response_body };
}

export async function saveIdempotentResponse(tx: TxClient, userId: string, key: string, status: number, body: unknown): Promise<void> {
  await tx.query(
    "UPDATE idempotency_keys SET response_status = $3, response_body = $4::jsonb WHERE user_id = $1 AND key = $2",
    [userId, key, status, JSON.stringify(body)],
  );
}
```

<!-- verified: src/server/repos/rate-limit.repo.ts -->
```ts
import "server-only";
// Security throttles that must be exact across every Node process: one UNLOGGED table in PostgreSQL (section 7.9).
// Called by the route wrapper BEFORE the main transaction, in its own autocommit statement, so a hit still counts when
// the request then fails (a rolled-back hit would let an attacker guess for free).
import { autocommit } from "../db/tx";
import { AppError } from "../errors";

export interface LimitRule {
  /** e.g. "login:ip:203.0.113.9" or "login:user:asha". Unique per route; never a secret (keys are stored in clear). */
  readonly key: string;
  readonly max: number;
  readonly windowSeconds: number;
}

const CONSUME_SQL = `
INSERT INTO platform.rate_limits AS b (key, window_start, window_seconds, hits)
SELECT k.key, date_bin(make_interval(secs => k.secs), now(), timestamptz '2000-01-01 00:00:00+00'), k.secs, 1
  FROM unnest($1::text[], $2::int[]) AS k(key, secs)
ON CONFLICT (key) DO UPDATE
   SET hits = CASE WHEN b.window_start = EXCLUDED.window_start THEN b.hits + 1 ELSE 1 END,
       window_start = EXCLUDED.window_start,
       window_seconds = EXCLUDED.window_seconds
RETURNING key, hits, ceil(extract(epoch FROM window_start + make_interval(secs => window_seconds) - now()))::int AS retry_after_seconds`;

/** Counts one hit on every rule (one round trip); answers 429 RATE_LIMITED with Retry-After when any rule is over. */
export async function consumeRateLimits(rules: readonly LimitRule[]): Promise<void> {
  const byKey = new Map(rules.map((rule) => [rule.key, rule]));
  if (byKey.size === 0) return;
  const { rows } = await autocommit<{ key: string; hits: number; retry_after_seconds: number }>(CONSUME_SQL, [
    [...byKey.keys()],
    [...byKey.values()].map((rule) => rule.windowSeconds),
  ]);
  let wait = 0;
  for (const row of rows) {
    const rule = byKey.get(row.key);
    if (rule !== undefined && row.hits > rule.max) wait = Math.max(wait, row.retry_after_seconds, 1);
  }
  if (wait > 0) throw new AppError("RATE_LIMITED", undefined, { retryAfterSeconds: wait });
}
```

The deposit repo uses the hotel template's real columns (`db/migrations/hotel/0003_cash_books.sql` L31-55), which are Pallav's: `date` + `time` on the hotel's wall clock, `user_id`, `full_name`, `amount_in_words`, `reason`. The contract's `at` is computed in SQL inside the hotel's time zone.

<!-- verified: src/server/repos/cash/deposits.repo.ts -->
```ts
import "server-only";
// SQL only. Unqualified names = the hotel schema (search_path set by enterHotel). platform.* is reached only through
// views granted to every hotel role (platform.hotel_user_names). Pallav keeps the two books in two tables
// (hotel_cash_deposits, food_cash_deposits); table names in SQL text come ONLY from the fixed map below.
// Columns are the hotel template's (db/migrations/hotel/0003_cash_books.sql), i.e. Pallav's: date + time (hotel wall
// clock), user_id, full_name, amount_paise, amount_in_words, reason, created_by, updated_by, entry_no, deleted_at.
import type { CashBook, CashBookFilter } from "@shared/dashboards/cash";
import type { TxClient } from "../../db/types";
import { nextEntryNo } from "../entryNo";
import { containsPattern } from "../sql";

const TABLE = { hotel: "hotel_cash_deposits", food: "food_cash_deposits" } as const satisfies Record<CashBook, string>;

export interface DepositRow {
  id: string;
  entry_no: number;
  book: CashBook;
  /** 'YYYY-MM-DD' (date parser) and 'HH:MM:SS', the hotel's wall clock, as Pallav stores them. */
  date: string;
  time: string;
  /** date + time as an instant (computed in the hotel's time zone). */
  at: Date;
  user_id: string;
  full_name: string | null;
  recorded_by_name: string | null;
  depositor: string;
  amount_paise: number;
  reason: string | null;
  created_at: Date;
  updated_at: Date;
  is_latest: boolean;
}

export interface DepositFilter {
  readonly book: CashBookFilter;
  readonly search?: string;
  /** Inclusive 'YYYY-MM-DD' range on the date column (Pallav Books::scope: the accounting years on screen). null = open. */
  readonly from: string | null;
  readonly to: string | null;
}

export interface NewDeposit {
  readonly book: CashBook;
  readonly depositor: string;
  readonly amountPaise: number;
  readonly amountInWords: string;
  readonly reason: string | null;
  /** null = the moment of saving, to the second (Pallav CashLedger::stamp). */
  readonly date: string | null;
  readonly time: string | null;
  readonly userId: string;
  readonly fullName: string;
}

/** ORDER BY comes ONLY from this map. Request text never reaches SQL. Pallav's default is date, time, id, newest first. */
const SORT_SQL = { at: ["d.date", "d.time"], amount: ["d.amount_paise"], entryNo: ["d.entry_no"] } as const;
export type DepositSort = keyof typeof SORT_SQL;

// Both books as one row set. The planner pushes the WHERE below into each branch, so each table's indexes are used.
const BOTH_BOOKS = `(
  SELECT 'hotel'::text AS book, id, entry_no, date, time, user_id, full_name, depositor, amount_paise, reason, created_at, updated_at, deleted_at FROM hotel_cash_deposits
  UNION ALL
  SELECT 'food'::text, id, entry_no, date, time, user_id, full_name, depositor, amount_paise, reason, created_at, updated_at, deleted_at FROM food_cash_deposits
) d`;

// $1 search pattern, $2 from, $3 to (the service defaults them to the current accounting year, as Pallav does).
// Pallav's search has words, "quoted phrases" and -exclusions (CashLedger::search): the module spec ports it exactly;
// this shows only the parameter pattern.
const FILTER_SQL = `d.deleted_at IS NULL
  AND ($2::date IS NULL OR d.date >= $2::date)
  AND ($3::date IS NULL OR d.date <= $3::date)
  AND ($1::text IS NULL OR d.depositor ILIKE $1 ESCAPE '\\' OR d.reason ILIKE $1 ESCAPE '\\')`;

const filterValues = (f: DepositFilter): unknown[] => [containsPattern(f.search), f.from, f.to];

/** Pallav CashLedger::newestId: the book's latest entry by date, time, then id (UUIDv7, so insertion order). */
const LATEST_SQL = `latest AS (
  SELECT 'hotel'::text AS book, (SELECT id FROM hotel_cash_deposits WHERE deleted_at IS NULL ORDER BY date DESC, time DESC, id DESC LIMIT 1) AS id
  UNION ALL
  SELECT 'food', (SELECT id FROM food_cash_deposits WHERE deleted_at IS NULL ORDER BY date DESC, time DESC, id DESC LIMIT 1))`;

/** Pallav Master Data: each book's depositor list is an option set (CashLedger::DEPOSITOR_SETS). */
const DEPOSITOR_LIST = { hotel: "revenue_depositor_hotel", food: "revenue_depositor_food" } as const satisfies Record<CashBook, string>;

export async function depositorExists(tx: TxClient, book: CashBook, name: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    `SELECT 1 FROM option_items i JOIN option_sets s ON s.id = i.option_set_id
      WHERE s.key = $1 AND i.value = $2 AND i.is_active LIMIT 1`,
    [DEPOSITOR_LIST[book], name],
  );
  return rowCount === 1;
}

/** Pallav Books::current(): the latest accounting year started. null when none was ever started (then no bound). */
export async function currentAccountingYear(tx: TxClient): Promise<{ from: string; to: string } | null> {
  const { rows } = await tx.query<{ starts_on: string; ends_on: string }>("SELECT starts_on, ends_on FROM accounting_years ORDER BY starts_on DESC LIMIT 1");
  const year = rows[0];
  return year === undefined ? null : { from: year.starts_on, to: year.ends_on };
}

/** The hotel's "today" (TimeZone is the hotel's zone inside enterHotel). Never new Date() in JavaScript. */
export async function hotelToday(tx: TxClient): Promise<string> {
  const { rows } = await tx.query<{ today: string }>("SELECT current_date AS today");
  return rows[0].today;
}

/** Pallav HasEntryNumber through Backend 1's nextEntryNo (transaction advisory lock per hotel schema and table). */
export async function insertDeposit(tx: TxClient, d: NewDeposit): Promise<DepositRow> {
  const table = TABLE[d.book];
  const entryNo = await nextEntryNo(tx, table);
  const { rows } = await tx.query<DepositRow>(
    `WITH ins AS (
       INSERT INTO ${table} (entry_no, date, time, user_id, full_name, depositor, amount_paise, amount_in_words, reason, created_by, updated_by)
       VALUES ($1, COALESCE($2::date, current_date), COALESCE($3::time, localtime(0)), $4, $5, $6, $7, $8, $9, $4, $4)
       RETURNING *)
     SELECT ins.id, ins.entry_no, $10::text AS book, ins.date, ins.time, (ins.date + ins.time)::timestamptz AS at,
            ins.user_id, ins.full_name, u.display_name AS recorded_by_name, ins.depositor, ins.amount_paise, ins.reason,
            ins.created_at, ins.updated_at,
            NOT EXISTS (SELECT 1 FROM ${table} o
                         WHERE o.deleted_at IS NULL AND (o.date, o.time, o.id) > (ins.date, ins.time, ins.id)) AS is_latest
       FROM ins
       LEFT JOIN platform.hotel_user_names u ON u.id = ins.user_id`,
    [entryNo, d.date, d.time, d.userId, d.fullName, d.depositor, d.amountPaise, d.amountInWords, d.reason, d.book],
  );
  return rows[0];
}

/** One page, stable order (sort columns + id). Names come in the same query: never one query per row. */
export async function findDepositPage(
  tx: TxClient, f: DepositFilter, sort: DepositSort, dir: "asc" | "desc", limit: number, offset: number,
): Promise<DepositRow[]> {
  const direction = dir === "asc" ? "ASC" : "DESC";
  const orderBy = [...SORT_SQL[sort], "d.id"].map((column) => `${column} ${direction}`).join(", ");
  const { rows } = await tx.query<DepositRow>(
    `WITH ${LATEST_SQL}
     SELECT d.id, d.entry_no, d.book, d.date, d.time, (d.date + d.time)::timestamptz AS at, d.user_id, d.full_name,
            u.display_name AS recorded_by_name, d.depositor, d.amount_paise, d.reason, d.created_at, d.updated_at,
            d.id = latest.id AS is_latest
       FROM ${BOTH_BOOKS}
       JOIN latest ON latest.book = d.book
       LEFT JOIN platform.hotel_user_names u ON u.id = d.user_id
      WHERE ${FILTER_SQL}
        AND ($4::text = 'all' OR d.book = $4::text)
      ORDER BY ${orderBy}
      LIMIT $5 OFFSET $6`,
    [...filterValues(f), f.book, limit, offset],
  );
  return rows;
}

export interface DepositTotals {
  all_count: number;
  hotel_count: number;
  food_count: number;
  shown_total_paise: number;
}

/** Tab counts and the shown total in ONE aggregate over the bounded window. count(*) and ::bigint arrive as numbers. */
export async function depositTotals(tx: TxClient, f: DepositFilter): Promise<DepositTotals> {
  const { rows } = await tx.query<DepositTotals>(
    `SELECT count(*) AS all_count,
            count(*) FILTER (WHERE d.book = 'hotel') AS hotel_count,
            count(*) FILTER (WHERE d.book = 'food') AS food_count,
            COALESCE(sum(d.amount_paise) FILTER (WHERE $4::text = 'all' OR d.book = $4::text), 0)::bigint AS shown_total_paise
       FROM ${BOTH_BOOKS}
      WHERE ${FILTER_SQL}`,
    [...filterValues(f), f.book],
  );
  return rows[0];
}

export interface DepositStats {
  today_paise: number;
  month_paise: number;
  hotel_month_paise: number;
  food_month_paise: number;
}

/**
 * Pallav RevenueController::index stats: today and this month for the books on screen, plus each book's month.
 * current_date is the hotel's business day (TimeZone = the hotel's zone inside enterHotel). Uses the (date, time) index.
 */
export async function depositStats(tx: TxClient, book: CashBookFilter): Promise<DepositStats> {
  const { rows } = await tx.query<DepositStats>(
    `SELECT COALESCE(sum(d.amount_paise) FILTER (WHERE d.date = current_date AND ($1::text = 'all' OR d.book = $1::text)), 0)::bigint AS today_paise,
            COALESCE(sum(d.amount_paise) FILTER (WHERE $1::text = 'all' OR d.book = $1::text), 0)::bigint AS month_paise,
            COALESCE(sum(d.amount_paise) FILTER (WHERE d.book = 'hotel'), 0)::bigint AS hotel_month_paise,
            COALESCE(sum(d.amount_paise) FILTER (WHERE d.book = 'food'), 0)::bigint AS food_month_paise
       FROM ${BOTH_BOOKS}
      WHERE d.deleted_at IS NULL
        AND d.date BETWEEN date_trunc('month', current_date)::date AND (date_trunc('month', current_date) + interval '1 month - 1 day')::date`,
    [book],
  );
  return rows[0];
}
```

Measured on 66,000 seeded deposits (section 0.2): the page query is a Merge Append of two backward index scans on `(date, time)`, 0.2 ms to run (0.5 ms warm planning, 3 ms the first time in a backend). The year totals took 5.7 ms; with a covering partial index `(date) INCLUDE (amount_paise) WHERE deleted_at IS NULL` on each book they took 3.4 ms (index-only). Add that index to both books in the template (DB-33).

#### 4.2.11 Service and zod schemas: `services/cash/deposits.schema.ts`, `deposits.service.ts`

<!-- verified: src/server/services/cash/deposits.schema.ts -->
```ts
import "server-only";
// Request schemas: strict (unknown keys such as hotelId, recordedBy or isAdmin are rejected), bounded, and matching the
// contract types in ui-shared/dashboards/cash.ts (DepositInput, DepositQuery). Server-controlled fields never appear here.
import { z } from "zod";

const MAX_AMOUNT_PAISE = 999_999_999_999; // = MAX_AMOUNT_PAISE in ui-shared/dashboards/cash.ts (contract test checks it)

const Book = z.enum(["hotel", "food"]);

export const CreateDepositBody = z.strictObject({
  book: Book,
  depositor: z.string().trim().min(1).max(100),
  amountPaise: z.number().int().min(1).max(MAX_AMOUNT_PAISE),
  instruction: z.string().trim().max(500),
  /** null = stamp the moment of saving; set = picked by hand (Pallav: the date may not be after today). */
  stamp: z.strictObject({
    date: z.iso.date(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }).nullable(),
});
export type CreateDepositBody = z.output<typeof CreateDepositBody>;

export const ListDepositsQuery = z
  .strictObject({
    search: z.string().trim().max(120).optional(), // Pallav CashLedger::query: 120 characters
    book: z.enum(["all", "hotel", "food"]).default("all"),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    sort: z.enum(["at", "amount", "entryNo"]).default("at"),
    dir: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => q.page * q.pageSize <= 10_000, { message: "Page is too deep; narrow the filters", path: ["page"] })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, { message: "From must be on or before To", path: ["from"] });
export type ListDepositsQuery = z.output<typeof ListDepositsQuery>;
```

<!-- verified: src/server/services/cash/deposits.service.ts -->
```ts
import "server-only";
// Business rules (the Pallav port) live here. No "next/*", no "pg": a service receives a TxClient, a verified principal
// and already-validated input, and returns the contract type or throws AppError. That keeps golden tests framework-free.
// Source: Pallav RevenueController::store/index, CashLedger, SystemLogger (file and line in the module spec).
import type { CashBook, CashDeposit, CashList } from "@shared/dashboards/cash";
import type { HotelPrincipal } from "../../auth/session";
import type { TxClient } from "../../db/types";
import { AppError } from "../../errors";
import { toRupeeString } from "../../money/paise";
import { amountInWords } from "../../money/words";
import * as deposits from "../../repos/cash/deposits.repo";
import { logCreated } from "../../repos/system-log.repo";
import type { CreateDepositBody, ListDepositsQuery } from "./deposits.schema";

/** The two books' names in HMS (Pallav CashLedger::BOOK_NAMES "Hotel Pallav"/"Pallav Food" became Hotel and Food). */
const BOOK_LABEL: Record<CashBook, string> = { hotel: "Hotel", food: "Food" };

/** Pallav HasEntryNumber::entryNumber(): "0042". */
const entryLabel = (n: number): string => String(n).padStart(4, "0");

/** mb_substr: cut by characters (full_name is varchar(20), as in Pallav). */
const cut = (text: string, max: number): string => Array.from(text).slice(0, max).join("");

/** Row -> contract DTO, field by field. Raw rows never leave the server. */
function toDeposit(row: deposits.DepositRow): CashDeposit {
  return {
    id: row.id,
    entryNo: row.entry_no,
    at: row.at.toISOString(),
    // Pallav: the user's current display name, else the name saved on the row.
    recordedBy: { id: row.user_id, name: row.recorded_by_name ?? row.full_name ?? "Former user" },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    isLatest: row.is_latest,
    book: row.book,
    depositor: row.depositor,
    amountPaise: row.amount_paise,
    instruction: row.reason,
  };
}

export async function createDeposit(tx: TxClient, actor: HotelPrincipal, input: CreateDepositBody): Promise<CashDeposit> {
  if (!(await deposits.depositorExists(tx, input.book, input.depositor))) {
    // RevenueController::messages(), word for word.
    throw new AppError("VALIDATION_FAILED", "Unknown depositor", {
      fields: { depositor: `Choose a depositor from the ${BOOK_LABEL[input.book]} list. The SuperAdmin adds names in Master Data.` },
    });
  }
  if (input.stamp !== null && input.stamp.date > (await deposits.hotelToday(tx))) {
    // 'date' => before_or_equal:today (Laravel's own message). Pallav checks the date only, not the time.
    throw new AppError("VALIDATION_FAILED", "Date after today", { fields: { date: "The date field must be a date before or equal to today." } });
  }
  const row = await deposits.insertDeposit(tx, {
    book: input.book,
    depositor: input.depositor,
    amountPaise: input.amountPaise,
    amountInWords: amountInWords(input.amountPaise),
    reason: input.instruction === "" ? null : input.instruction,
    date: input.stamp?.date ?? null,
    time: input.stamp === null ? null : `${input.stamp.time}:00`, // CashLedger::stamp: a hand-picked minute keeps :00
    userId: actor.userId, // from the session, never from the body
    fullName: cut(actor.displayName, 20),
  });
  await logCreated(tx, { id: actor.userId, name: actor.displayName }, "revenue", `${BOOK_LABEL[row.book]} deposit`, row.id, entryLabel(row.entry_no), {
    Depositor: row.depositor,
    Amount: toRupeeString(BigInt(row.amount_paise)),
    Instruction: row.reason,
    Date: row.date.split("-").reverse().join("-"), // d-m-Y
  });
  return toDeposit(row);
}

export async function listDeposits(tx: TxClient, query: ListDepositsQuery): Promise<CashList<CashDeposit>> {
  // Pallav Books::scope: the accounting years on screen; by default the current one.
  const year = query.from === undefined && query.to === undefined ? await deposits.currentAccountingYear(tx) : null;
  const filter: deposits.DepositFilter = {
    book: query.book,
    search: query.search,
    from: query.from ?? year?.from ?? null,
    to: query.to ?? year?.to ?? null,
  };
  const offset = (query.page - 1) * query.pageSize;
  // A few bounded queries on one connection; never one query per row.
  const rows = await deposits.findDepositPage(tx, filter, query.sort, query.dir, query.pageSize, offset);
  const totals = await deposits.depositTotals(tx, filter);
  const stats = await deposits.depositStats(tx, query.book);
  const counts = { all: totals.all_count, hotel: totals.hotel_count, food: totals.food_count };
  return {
    items: rows.map(toDeposit),
    total: counts[query.book],
    page: query.page,
    pageSize: query.pageSize,
    stats: {
      todayPaise: stats.today_paise,
      monthPaise: stats.month_paise,
      hotelMonthPaise: stats.hotel_month_paise,
      foodMonthPaise: stats.food_month_paise,
    },
    counts,
    shownTotalPaise: totals.shown_total_paise,
  };
}
```

`money/words.ts` is new: `export function amountInWords(paise: number): string`, a word-for-word port of Pallav `app/Support/NumberToWords.php::convert`, golden-tested with fixtures generated by PHP (the pattern in `db/scripts/php` exists).

"Per Pallav spec" in this example: the depositor list and its message, the date rule, the stamp to the second, `full_name`, `amount_in_words`, the latest-entry rule, the default accounting-year window, the `SystemLogger` line and its details. The module spec confirms each one (with Pallav file and line) before the real endpoint is built. Update and delete add Pallav's `CashLedger::editable`/`blocked` rules and force mode.

#### 4.2.12 Route files

`src/app/api/v1/cash/deposits/route.ts`: the pattern for every endpoint. The screen needs `revenue` at view; a save needs the book's own part (Pallav `routes/web.php` L400-406, `Permissions::requirementsFor` L540-561).

<!-- verified: src/app/api/v1/cash/deposits/route.ts -->
```ts
// Thin HTTP edge: declarations only. No SQL, no business rules, no try/catch, no Response building.
import { hotelRoute, methodsNotAllowed } from "@/server/http/route";
import { CreateDepositBody, ListDepositsQuery } from "@/server/services/cash/deposits.schema";
import { createDeposit, listDeposits } from "@/server/services/cash/deposits.service";

/** Pallav Permissions::requirementsFor: the Revenue screen needs revenue.view; a save needs the book's own part. */
const PART = { hotel: "revenue.hotel", food: "revenue.food" } as const;

export const GET = hotelRoute({
  name: "cash.deposits.list",
  permission: { key: "revenue", level: "view" },
  query: ListDepositsQuery,
  handler: ({ tx, query }) => listDeposits(tx, query),
});

export const POST = hotelRoute({
  name: "cash.deposits.create",
  permission: ({ body }) => ({ key: PART[body.book], level: "create" }),
  body: CreateDepositBody,
  idempotent: true,
  status: 201,
  handler: ({ tx, principal, body }) => createDeposit(tx, principal, body),
});

export const { PUT, PATCH, DELETE } = methodsNotAllowed;
```

`src/app/api/v1/health/route.ts`, `src/app/api/v1/health/ready/route.ts` and `src/app/api/[[...path]]/route.ts`:

<!-- verified: src/app/api/v1/health/route.ts -->
```ts
// Liveness: the process answers. No database, no versions, no host names.
import { methodsNotAllowed, publicRoute } from "@/server/http/route";

export const GET = publicRoute({
  name: "health.live",
  quiet: true,
  handler: async () => ({ status: "ok" as const }),
});

export const { POST, PUT, PATCH, DELETE } = methodsNotAllowed;
```

<!-- verified: src/app/api/v1/health/ready/route.ts -->
```ts
// Readiness: the database answers within 1 s. The deploy script waits for it after each restart (section 9, OP-10).
import { checkReady } from "@/server/db/health";
import { methodsNotAllowed, publicRoute } from "@/server/http/route";

export const GET = publicRoute({
  name: "health.ready",
  quiet: true,
  handler: async () => {
    await checkReady();
    return { status: "ready" as const };
  },
});

export const { POST, PUT, PATCH, DELETE } = methodsNotAllowed;
```

<!-- verified: src/app/api/[[...path]]/route.ts -->
```ts
// Unknown /api paths (and /api itself: optional catch-all) answer the JSON NOT_FOUND error, never the HTML 404 page.
// Static routes always win over this.
import { AppError } from "@/server/errors";
import { publicRoute } from "@/server/http/route";

const notFound = publicRoute({
  name: "api.not_found",
  handler: async () => {
    throw new AppError("NOT_FOUND", "No such API endpoint");
  },
});

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
```

#### 4.2.13 `server/boot.ts` and `src/instrumentation.ts`

<!-- verified: src/server/boot.ts -->
```ts
import "server-only";
import type { Instrumentation } from "next";
import { ConfigError, getConfig, isProductionProcess, scriptOnlySecretsPresent, type AppConfig } from "./config/env";
import { assertSafeAppRole, startPoolStats } from "./db/health";
import { getLogger } from "./logger";

/**
 * Runs once per server instance, before it accepts requests (instrumentation register()). In production a throw stops
 * the start (systemd retries, section 9). In development it never throws: the UI sessions share the dev server, and
 * Next exits or fails every request when register() throws.
 */
export async function boot(): Promise<void> {
  const log = getLogger();
  const production = isProductionProcess();
  let config: AppConfig;
  try {
    config = getConfig();
    const leaked = scriptOnlySecretsPresent();
    if (leaked.length > 0) {
      throw new ConfigError(leaked.map((name) => `${name}: script-only secret loaded into the web server; keep it in db/.env.local`));
    }
  } catch (error) {
    if (production) throw error;
    log.error("boot: environment problem; API routes will fail until it is fixed (development continues)", { cause: error });
    return;
  }

  if (config.DATABASE_URL === undefined) {
    log.warn("boot: DATABASE_URL is not set; database routes answer 503 (development only)");
    return;
  }
  try {
    await assertSafeAppRole(config.DB_APP_ROLE);
    startPoolStats();
    log.info("boot: database role checked");
  } catch (error) {
    // The UI sessions share the dev server: a missing local database must not stop their work.
    if (production) throw error;
    log.warn("boot: database check failed; development continues", { cause: error });
  }
}

type RequestErrorArgs = Parameters<Instrumentation.onRequestError>;

/** Safety net for errors outside the route wrapper. Never logs request.headers (they hold Cookie and Authorization). */
export function reportRequestError(error: RequestErrorArgs[0], request: RequestErrorArgs[1], context: RequestErrorArgs[2]): void {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : undefined;
  getLogger().error("unhandled request error", {
    routePath: context.routePath,
    routeType: context.routeType,
    method: request.method,
    path: request.path.split("?")[0],
    digest,
    cause: error,
  });
}
```

<!-- verified: src/instrumentation.ts -->
```ts
// src/instrumentation.ts (next to app/, not inside it). register() runs once per server instance and must finish
// before requests are served; it is skipped during `next build`. Node-only code is imported inside the positive
// NEXT_RUNTIME check, the form the docs use, so it can never end up in an edge bundle.
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { boot } = await import("./server/boot");
    await boot();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportRequestError } = await import("./server/boot");
    reportRequestError(error, request, context);
  }
};
```

### 4.3 How to write a new endpoint

1. Read the Pallav controller, model, support classes and tests. Write the behaviour spec: rules, formulas, messages word for word, permission keys (module or part), the `SystemLogger` lines, edge cases. Cite file and line.
2. Write golden tests from Pallav's own tests first. This is high-risk work.
3. Write the zod schema next to the service: strict, bounded, matching the ui-shared type.
4. Write the repo: parameters only, a whitelisted ORDER BY, no query per row, the plan checked (DB-33).
5. Write the service: rules, the `system_logs` row, the contract DTO. Counters that must survive a refusal use `failAfterCommit`.
6. Write `route.ts`: one `hotelRoute`/`sessionRoute`/`publicRoute` per method, a unique `name`, a `permission` (fixed, any-of, or worked out from the input), Pallav throttles as `limits`, and `methodsNotAllowed` for the rest.
7. Tick the definition of done (section 14).

---

## 5. API contract conventions

| ID | Rule |
|---|---|
| AP-1 | **URLs:** `/api/v1/<group>/<resource>[/<id>[/<action>]]`. kebab-case, plural nouns, no trailing slash (Next redirects one with 308, NX-21). Groups match the UI groups: `auth`, `me`, `overview`, `front-office`, `billing`, `cash`, `companies`, `corporate`, `guest`, `payroll`, `website`, `admin`. Commands are `POST` on a verb path (`/bills/{id}/settle`). Payroll is company-scoped (`/payroll/companies/{companyId}/...`). **No hotel id in any URL.** No token or code in any URL. |
| AP-2 | **Methods:** GET only reads (it runs READ ONLY). POST creates (201) or runs a command (200, or 202 for queued work). PATCH changes part of a record and sends `version` once Q5 is approved. PUT is only for singleton settings. DELETE is a soft delete and returns `{data:{id}}`. No toggle endpoints: send the target state (`{active:false}`). An upsert by nullable id becomes POST + PATCH. Every other method of a route gets `methodsNotAllowed` (JSON 405). |
| AP-3 | **Body:** JSON only (else 415). 256 KB default (else 413). Strict schema (else 422 with field names). Unreadable JSON is 400. Uploads use their own multipart routes with their own limits (SE-30). |
| AP-4 | **Envelope:** success is `{ "data": T }`, where T is exactly the ui-shared contract type. Error is `{ "error": { code, message, traceId, details? } }`. `meta` is reserved and may only be added later, additively. |
| AP-5 | **Errors:** codes from `ui-shared/errors.ts` only. One HTTP status per code (table below). `message` is safe English for logs; **the apps show their own text and act on the code**, never on the status. For Pallav field messages, the exact Pallav words go in `details.fields`. |
| AP-6 | **Headers:** see the table below. |
| AP-7 | **Lists:** `page` ≥ 1; `pageSize` 1–100 (default per contract, usually 20); `page × pageSize ≤ 10,000`. `sort` is a per-endpoint enum mapped to SQL, plus `id` as a tie-break. `dir` is `asc`/`desc`. `search` is bounded and LIKE-escaped. A book list is bounded by Pallav's window (the accounting years on screen; by default the current one). Aggregates over the window (counts, totals, stats) MUST use an index-only or index plan and stay ≤ 5 ms p95 on the seeded hotel; otherwise they SHOULD be sent only with page 1 / a filter change (contract change: Lead). Append-only logs use a keyset `cursor` once the Lead adds it. |
| AP-8 | **Money:** integers in paise, field names end with `Paise`, `z.number().int()` with bounds. Percentages and quantities are decimals with at most 2 places, validated as text. All math goes through `money/paise.ts` (PHP half-away-from-zero rounding). Never float math. **Totals, GST, balances and states are computed by the server.** Request bodies never carry totals. |
| AP-9 | **Dates:** instants are ISO-8601 UTC with `Z`. Business dates (stay nights, bill dates, Pallav's `date` columns) are `YYYY-MM-DD` in the hotel's calendar. Months are `YYYY-MM`. Times are `HH:MM` (24 h). The hotel time zone comes from `platform.hotels.timezone`. The server decides "today" (in SQL, inside the hotel transaction). |
| AP-10 | **IDs:** UUIDv7 strings (`z.uuid()`), made by the database. Human numbers (bill no., entry no.) are separate fields. A missing record **or one outside your scope** gets 404, never 403. |
| AP-11 | **Idempotency:** creates of money, bookings, payments and email sends MUST set `idempotent: true`. `Idempotency-Key` is a UUID, scoped per user, kept 24 h. A repeat replays the stored response with `Idempotent-Replayed: true`. The request hash covers method, route name, path ids, query and body (the parsed values), so the same key on another record is refused with 422 `IDEMPOTENCY_KEY_REUSED`. A request still running waits, then 409. The client makes one key per user action and reuses it on retry. |
| AP-12 | **Identity comes from the session only.** No request may carry an actor, role, isAdmin, hotelId, recordedBy, bookedBy or sentBy. Contracts that have them are fixed by the Lead before that module ships (section 11). |
| AP-13 | **Versioning:** inside `/api/v1`, additive changes only. A breaking change goes to a new `api/v2` folder. Mobile sends `X-App-Version`; `426` comes later. Remove a version only after store apps no longer use it. |
| AP-14 | **Async work** returns `202 {data:{jobId,status:"queued"}}`. A status endpoint comes with the jobs module. Anything that would run over 1 second in a request becomes a job. |
| AP-15 | **Route inventory:** every route has a unique `name`. `docs/API.md` lists method, path, name, auth mode, permission, idempotent, limits, request schema, response type and errors. A contract test fails on a route missing there, and on a `route.ts` that does not export all five of GET/POST/PUT/PATCH/DELETE (served or `methodsNotAllowed`; the catch-all exports all five itself). |
| AP-16 | **Client adapter (Lead's work, for reference):** never throws. A fetch failure becomes `NETWORK_OFFLINE`; a non-JSON error body or an unknown code becomes `UNKNOWN`. Timeout 15 s. `SESSION_EXPIRED` and `SESSION_REPLACED` go to sign-in. Web uses relative URLs and the cookie. Mobile uses the base URL, a bearer token and secure storage, sends its device id at sign-in (SE-10) and the affinity hint `X-Hms-Aff` (section 8.9). Every call takes an optional `AbortSignal`. Expo in development calls `http://<LAN IP>:3000` with the bearer token (no cookie, no CORS needed). |

**Error codes:**

| Code | HTTP | When | What the app does |
|---|---|---|---|
| `BAD_REQUEST` | 400 | Body is not readable JSON or UTF-8 | Generic error |
| `VALIDATION_FAILED` | 422 | Schema or business rule failed; `details.fields` (Pallav's words) | Highlight fields |
| `SESSION_EXPIRED` | 401 | No, unknown, revoked, expired or idle token | Go to sign-in |
| `SESSION_REPLACED` | 401 | Signed in on another device (web) | Sign-in, with Pallav's message |
| `INVALID_CREDENTIALS` | 401 | Sign-in failed (same answer for unknown user and wrong password) | Show error, stay |
| `INVALID_CODE` | 401 | Wrong emailed code; `attemptsLeft` | Show tries left |
| `FORBIDDEN` | 403 | Permission level too low; cross-site origin | Show no-access state |
| `ACCOUNT_DISABLED` | 403 | User deactivated | Sign out, show message |
| `PASSWORD_CHANGE_REQUIRED` | 403 | `must_change_password` set | Go to change-password |
| `NOT_FOUND` | 404 | Missing or out of scope; unknown API path | Not-found state |
| `METHOD_NOT_ALLOWED` | 405 | A method the route does not serve | Generic error (a bug) |
| `CONFLICT` | 409 | Unique clash, stale version, busy record, key still running | Reload prompt |
| `CHALLENGE_EXPIRED` | 410 | Pending sign-in or reset step timed out | Restart the step |
| `PAYLOAD_TOO_LARGE` | 413 | Over the byte cap | Generic error |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Not JSON | Generic error (a bug) |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key, different request | Generic error (a bug) |
| `PASSWORD_TOO_WEAK` / `PASSWORD_REUSED` | 422 | Pallav PasswordPolicy | Field error |
| `ACCOUNT_LOCKED` | 423 | Blocked or locked | Show message |
| `RATE_LIMITED` / `CODE_ATTEMPTS_EXCEEDED` | 429 | Too many requests or codes; `Retry-After` | Wait message |
| `SERVER_ERROR` | 500 | A bug; nothing leaked | Retry button |
| `SERVICE_UNAVAILABLE` | 503 | Pool busy, DB down, hotel upgrading, sign-in queue full; `Retry-After` | Retry later |

**Headers:**

| Direction | Header | Rule |
|---|---|---|
| Request | `Cookie: __Host-hms_session=…` | Web only |
| Request | `Authorization: Bearer hms_m_…` | Mobile only. When present, the cookie is ignored. |
| Request | `Cookie: hms_aff=…` / `X-Hms-Aff: …` | Routing hint only (section 8.9); never trusted |
| Request | `Content-Type: application/json` | Every body |
| Request | `Idempotency-Key: <uuid>` | Idempotent creates |
| Request | `x-trace-id` | Development only; in production nginx replaces it with its own id |
| Response | `x-trace-id`, `cache-control: no-store`, `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; frame-ancestors 'none'`, `cross-origin-resource-policy`, `referrer-policy` | Always |
| Response | `retry-after` | 429, 423, 503 |
| Response | `idempotent-replayed: true` | On replay |

---

## 6. Security standard (checklist)

### 6.1 Isolation and access

- [ ] **SE-1** The hotel comes only from `platform.sessions.hotel_id` plus an active membership (`user_hotels.status='active'`). Never from body, URL, query, header or cookie value.
- [ ] **SE-2** Switching hotel (an HMS feature; Pallav has one hotel, and its `unit.switch` only picks the Hotel or Food business unit) is one `POST /api/v1/me/active-hotel`. It checks membership, issues a **new** session token (revoking the old row), sets the new affinity hint and writes `platform.audit_log`.
- [ ] **SE-3** Hotel data is reached only through `hotelRoute` (request code) or `withHotelForSystem` (jobs and verified webhooks). ESLint enforces it (section 3.8).
- [ ] **SE-4** Every read or write of an object by id puts the caller's scope in the same SQL (`AND guest_user_id = $n`, `AND company_id = $n`). Out of scope gets 404.
- [ ] **SE-4b Platform-scoped admin actions.** User, role and membership rows live in `platform`, where `hms_app` may write (`0099_grants.sql` L17-23). The per-hotel role does not guard them, so services MUST:
  1. Treat built-in roles (`roles.hotel_id IS NULL`) and their `role_permissions` as read-only from hotel routes. A hotel admin edits only roles with `hotel_id` = the active hotel (copy a built-in role to customise it).
  2. Never write `users.role_id` from a hotel route; change only `user_hotels.role_id` of the active hotel and `user_permissions` rows with `hotel_id` = the active hotel.
  3. Allow account-wide actions (set password, block or unblock, deactivate, change username or email, sign out everywhere) from a hotel only when every active membership of the target is in that hotel and the target's role level is below the actor's (MASTER 2: "creates users only at its own level and below"; Pallav `canManage`). Otherwise only the platform path (SE-6) may do it.
  4. Leave `hotels`, `hotel_groups` and `group_members` writes to platform admins only.

  The database backs this up: triggers refuse a hotel's custom role as `users.role_id` and refuse it in another hotel's `user_hotels` (section 7.9), and the session query ignores a role that belongs to another hotel (tested). The isolation suite covers each case (10.5).
- [ ] **SE-5** Every hotel route declares `permission`, so deny is the default. Where Pallav needs a part key (`revenue.hotel`, `revenue.food`), the route works it out from the validated input. Services re-check finer Pallav rules: "only the latest entry can be edited", "Admin may delete", force mode, the SuperAdmin-only screens.
- [ ] **SE-6** Group or platform access to another hotel is not built in Phase 1. Before the group-admin module: a separate route mode (`groupRoute`) in `http/route.ts`, where the hotel id comes from the request but the wrapper checks `platform.group_members` against the actor's group-admin membership (or a platform admin), writes `platform.audit_log` with a required `reason` first, then calls `enterHotel`. It gets its own isolation tests.

### 6.2 Login (Pallav port), sessions and tokens

Q2 (section 15) must be answered before the login phase starts. Until then build Pallav exactly, behind `AUTH_POLICY`.

- [ ] **SE-7 Sign-in order** (Pallav `Auth/AuthController.php::login` L58-119; messages word for word):
  1. Validate: username ≤ 50, password ≤ 128.
  2. Route throttle: 30 per minute per address (`throttle:30,1`, as `limits`).
  3. Per-address brake: 20 failures per 15 min (`login-ip`). Pallav counts every try and clears the brake on any success; that lets one valid account reset it for unlimited guesses (a defect). HMS counts failed tries only and a success never clears it.
  4. Look up by the lower-cased, trimmed username.
  5. Locked or blocked → Pallav's message (Pallav checks this before the password; Q2(b)).
  6. Wrong password → count it atomically (SE-11). The 5th miss blocks the account (`blocked_kind = 'auto'`) and shows Pallav's block message.
  7. Deactivated → message.
  8. Success → that user's failed count goes back to 0 (nothing else is cleared).
  9. `must_change_password` → a change challenge, no session (the phone app gets Pallav's "sign in on the website once" refusal).
  10. Two-factor on and an email on file → emailed code challenge; otherwise signed in. **Platform accounts (`super_admin`, `platform_admin`) always need the emailed code** (MASTER 4.2's default; Pallav has no cross-hotel accounts, so nothing in Pallav contradicts it). Q2(d) covers hotel admins.
- [ ] **SE-8** Always run exactly one argon2 verify: against `DUMMY_HASH` when the user does not exist or the stored hash is not argon2id. Unknown user and wrong password get the same body, status and similar time.
- [ ] **SE-9 Web session:** 256-bit random token in `__Host-hms_session` (HttpOnly, Secure, SameSite=Lax, Path=/, no Domain). The database stores only `sha256Hex(token)`. Idle limit 120 min (Pallav `SESSION_LIFETIME`). One live web session per user: unique partial index on `(user_id) WHERE client='web' AND revoked_at IS NULL`. The sign-in transaction first locks the user row (`SELECT ... FROM platform.users WHERE id = $1 FOR UPDATE`), then revokes the old session with reason `replaced`, then inserts. Without the lock a second parallel sign-in fails with a unique violation (409); with it the later sign-in wins (tested). A new token is issued at sign-in, hotel switch and password change.
- [ ] **SE-10 Phone token:** `hms_m_` + 256 bits, returned once, stored as a hash. 90 days, no sliding (Pallav `MobileToken::DAYS`). The app makes a random device id at install, keeps it in secure storage and sends it at sign-in; a new sign-in on the same device revokes that device's old token (unique index). Pallav has no device limit, so none is added. Like Pallav, a token is refused while the account is blocked, locked or deactivated and works again after unblock. It is revoked on sign-out, password change or reset, and admin "sign out everywhere". It does not touch the web slot. Do **not** port Pallav's stateless HMAC token with a cache-based revocation list.
- [ ] **SE-11 Counters survive the refusal.** Failed passwords, code attempts and code sends use one `UPDATE … RETURNING` in the auth transaction; the code-attempt slot is taken **before** the code is compared. The transaction must COMMIT although the answer is an error: public auth routes commit their own short transaction and then throw; session routes return `failAfterCommit(error)`. Route throttles use `limits` (own statement). A plain `throw` after a counter update is forbidden (review item and a wrapper-level test). Read-modify-write in JavaScript is forbidden (Pallav's version races).
- [ ] **SE-12 Emailed codes** (Pallav `OneTimeCode`): 6 digits from `crypto.randomInt`, valid 10 min, single use; one live code per user (a new send replaces the old one: unique index); bound to one challenge and purpose (`login`, `reset`, `enable`); resend after 60 s at the earliest; 5 sends per run, then waits of 15 → 30 → 60 → 180 → 480 → 1440 min (`LOCK_STEPS`); 5 wrong codes block the account (Pallav; Q2(c)); stored as `hashAuthCode` (HMAC with `HMS_HASH_KEY`), compared in constant time.
- [ ] **SE-13 Pending steps** (Pallav keeps them in the session or cache) are rows in `platform.auth_challenges`: token hash, purpose, user (NULL for an unknown username), code hash, `code_sent_at`, `code_attempts`, `change_reason` (Pallav's `first` or `reset`) and expiry (10 min for codes, 15 min for the change step). The opaque challenge token travels in the response body and the next request body, for web and mobile alike.
- [ ] **SE-14 Forgot password:** Pallav exact by default (`AuthController.php` L460-543): a 10-per-15-min per-address brake; a code is sent when the user is active and has an email, **even when blocked** (a reset by code clears the block, so this is how owners recover); the answer names the masked email when sent. That answer and the resend answers tell an attacker whether a username exists. With Q2(b) every answer is one fixed message, reset emails go through the outbox (constant time) and no masked email is shown. With Q2(c) wrong codes are capped per user across sends.
- [ ] **SE-15 Change password:** Pallav `PasswordPolicy::REGEX`, at most 128 characters, NFC, and different from the old or temporary password (Pallav's two messages). Then revoke **all** web sessions and phone tokens, write the audit row, and end on the sign-in screen. A reset by code also clears the block and the cooldown (Pallav).
- [ ] **SE-16 Passwords:** argon2id with fixed options `m=19456 KiB, t=2, p=1`; re-hash on sign-in when the options change. Hashing is capped **per process** at `ARGON2_MAX_CONCURRENCY` (default 1) with a queue of `ARGON2_MAX_QUEUE` (default 16); beyond that the answer is 503 at once. On the 8-vCPU app server that is 6 hashes at a time, about 180 per second, against a need of 5 per second. nginx adds 2 requests per second per address on `/api/v1/auth/` (section 9). libuv's default thread pool (4) is enough.

<!-- verified: src/server/auth/password.ts -->
```ts
import "server-only";
import { argon2id, hash, needsRehash, verify } from "argon2";
import { getConfig } from "../config/env";
import { AppError } from "../errors";
import { getLogger } from "../logger";

/** OWASP argon2id minimum, fixed here (never the library defaults, which change between versions). */
const OPTIONS = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const COST = { memoryCost: OPTIONS.memoryCost, timeCost: OPTIONS.timeCost, parallelism: OPTIONS.parallelism };

/**
 * Checked when nobody matches, so an unknown username costs the same ~30 ms as a real one. A constant (a hash of 32
 * random bytes nobody kept), not built at run time: a lazily built dummy can fail once and then fail for ever.
 * A unit test asserts passwordNeedsRehash(DUMMY_HASH) === false; regenerate it whenever OPTIONS change.
 */
export const DUMMY_HASH = "$argon2id$v=19$m=19456,p=1,t=2$RiIGDYY7V7BoWbbxuJBRIA$gbklXVQLOnRITCnH1/XwIYTyDPi2kUB91EPMuoFo02Q";

// argon2 runs on libuv's thread pool and burns a full core for ~30 ms. The cap is PER PROCESS: server-wide it is
// ARGON2_MAX_CONCURRENCY x web processes (6 x 1 on the 8-vCPU app server, section 8.1). Extra requests wait in a short
// queue; beyond it the answer is 503 at once, so a sign-in flood cannot take the CPU from every other request.
let running = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  const { ARGON2_MAX_CONCURRENCY: maxRunning, ARGON2_MAX_QUEUE: maxWaiting } = getConfig();
  if (running < maxRunning) running += 1;
  else if (waiting.length < maxWaiting) await new Promise<void>((resolve) => waiting.push(resolve)); // slot handed over on wake
  else throw new AppError("SERVICE_UNAVAILABLE", "Too many sign-ins at once", { retryAfterSeconds: 2 });
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

/** Callers have already rejected passwords over 128 characters (Pallav max:128) BEFORE hashing. */
export function hashPassword(password: string): Promise<string> {
  return withSlot(() => hash(password.normalize("NFC"), OPTIONS));
}

/**
 * Always runs ONE argon2 verify of the same cost: against DUMMY_HASH when the user does not exist or the stored hash is
 * not argon2id (argon2 returns false at once for a bcrypt string, which would leak timing). A hash that cannot be read is
 * logged and counts as "no match"; only a full queue (503) is thrown.
 */
export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
  const usable = storedHash !== null && storedHash.startsWith("$argon2id$");
  const target = usable ? storedHash : DUMMY_HASH;
  let ok = false;
  try {
    ok = await withSlot(() => verify(target, password.normalize("NFC")));
  } catch (error) {
    if (error instanceof AppError) throw error;
    getLogger().error("password hash could not be checked", { cause: error });
  }
  return usable && ok;
}

export function passwordNeedsRehash(storedHash: string): boolean {
  return needsRehash(storedHash, COST);
}
```

- [ ] **SE-17** Never hold a DB connection while hashing. Sign-in = short transaction (look up and brake check), argon2 outside any transaction, short transaction (record the result, commit, then answer).
- [ ] **SE-18** Every auth event writes `platform.auth_events` with Pallav's labels (`UserAuditLog`: `login.verified`, `login.password_only`, `login.blocked`, `otp.cooldown`, `password.reset_by_code`, `user.first_password_set`; `ActivityLog` sign-in and sign-out times), IP and a user-agent label. The `event` CHECK in `0005_audit.sql` is edited in place to these labels. Never a password, code, token or full email body.
- [ ] **SE-19 Imported Pallav users** have bcrypt hashes. Ruling Q1 (`docs/DATABASE.md` L218-220) already plans an argon2id placeholder plus `must_change_password`, so each imported user resets by emailed code. Use `status = 'active'` (not `invited`), so Pallav's forgot-password flow works unchanged. Q3 asks MJ whether old passwords must keep working.

### 6.3 Requests

- [ ] **SE-20** CSRF: the wrapper's `assertTrustedOrigin` plus JSON-only bodies. No GET changes data: Pallav's GET routes that change state (Google refresh/connect) become POST.
- [ ] **SE-21** No CORS headers in production. If Expo web is ever needed in development, the Lead approves a dev-only allowlist.
- [ ] **SE-22 Rate limits.** Port every Pallav throttle as route `limits` (PostgreSQL, exact across processes):

  | Route (Pallav) | Limit |
  |---|---|
  | sign-in, sign-in code (web and phone) | 30/min per address |
  | code resend, reset-code resend | 6/min |
  | forgot password | 10/min |
  | forgot-password code | 30/min |
  | change password | 10/min |
  | 2FA confirm | 20/min |
  | portal register | 10/min |
  | Razorpay webhook | 120/min |
  | site availability, reviews | 60/min |
  | website enquiry | 5 per 600 s (`config/site.php` L25-26) |

  Plus the controller brakes: 20 sign-in failures and 10 reset requests per 15 min per address. Answer 429 with `Retry-After`. Public forms (enquiry, portal register) keep Pallav's honeypot; a captcha needs approval (section 12). nginx `limit_req` sits at the edge.
- [ ] **SE-23** Client IP only via `clientIp()` (`X-Real-IP` set by our nginx when `TRUST_PROXY=1`), counted by `ipBucket()` (IPv6 per /64). Used for limits and audit, never for authorization. Hotels put many staff behind one address (NAT, mobile CGNAT): per-address limits count failures, not successes, and nginx keys its general limit on the credential when there is one (section 9).
- [ ] **SE-24** Headers as in section 5. HSTS from nginx only. Never copy request headers into a response.

### 6.4 Data, SQL and secrets

- [ ] **SE-25** SQL values are always `$n` parameters. Identifiers only from code constants or the validated schema and role names. LIKE input is escaped. ORDER BY text comes only from whitelist maps. No SQL text outside `db/tx.ts` sets the role, a GUC or the session (unit grep test, section 3.8). A test feeds hostile input to every search, sort and filter parameter. This is the first defence: the per-hotel role does not stop injected SQL.
- [ ] **SE-26** Strict input schemas reject unknown keys, so `hotelId`, `role`, `isAdmin`, totals and statuses can never be sent. Outputs are explicit DTOs: no `SELECT *` in `src/server` (except `RETURNING *` inside a repo CTE), never hashes or encrypted values. ID numbers show only the last 4 (`maskLast4`).
- [ ] **SE-27** Secrets come only from the environment through `config/env.ts`. In production they come from `/etc/hms/*.env` (root-owned, 0600) through systemd `EnvironmentFile`, never from files inside `web-app` (NX-12). Script-only secrets live in `db/.env.local`; boot refuses to start in production if one is loaded. Per-hotel integration secrets (SMTP password, Razorpay keys, Google refresh tokens) are AES-GCM-encrypted in the hotel's settings under `HMS_DATA_KEYS`; APIs return only `isSet` and `updatedAt`; inputs use `{op:'keep'|'set'|'clear'}`. When PostgreSQL runs on another server without a private network, `DATABASE_URL` carries `sslmode=verify-full&sslrootcert=/etc/hms/pg-ca.crt` (pg-connection-string 2.14 reads both).
- [ ] **SE-28** Field encryption (existing `crypto/aes.ts`): ID numbers, bank account and IFSC, emergency contacts, 2FA and integration secrets. A blind index where lookups are needed.
- [ ] **SE-29** Logs go through the logger, which redacts. Never log bodies of auth, payment or ID-proof requests, tokens, codes or cookies. Keep IP-bearing logs at most 90 days.

### 6.5 Files, webhooks, outbound calls, browser

- [ ] **SE-30 Uploads** (ID proofs, photos, signatures, logos, invoice PDFs):
  - private storage outside `public/`, at `<root>/<hotel_id>/<uuid>.<ext>`, never the client's file name;
  - checked by magic bytes and an extension allowlist (jpg, jpeg, png, webp, pdf), with a size cap while streaming;
  - served only by an authenticated hotel route that checks the owning record's permission, with `Content-Disposition`, `nosniff`, `Cache-Control: private, no-store`;
  - ID images encrypted at rest;
  - SVG and ICO refused unless MJ approves a sanitizer.

  Pallav's `/media` route and public disk MUST NOT be ported as they are.
- [ ] **SE-31 Razorpay webhook** (`POST /api/v1/webhooks/razorpay/{hotelWebhookId}/{business}`): read the raw body (capped at 256 KB) before parsing; choose the secret by the opaque per-hotel id in the path; check HMAC-SHA256 with `timingSafeEqual`; **only then** insert the event id (`UNIQUE`, `ON CONFLICT DO NOTHING`); keep amounts in paise; match the payment to our own order record before marking anything paid; from a bad signature keep only metadata, in a capped table. Pallav's dedupe-before-verify and float rupees MUST NOT be ported.
- [ ] **SE-32** Outbound HTTP only through one `safeFetch()`: https, an exact host allowlist (Google APIs, `api.razorpay.com`), `redirect:'manual'`, `AbortSignal.timeout`, size cap, zod-validated JSON. Never fetch a URL a user typed.
- [ ] **SE-33** Mock modules and demo passwords are never imported by `src/server` or `src/app/api` (ESLint, section 3.8). No demo user exists in production.
- [ ] **SE-34** Keep `next` and `react` patched. Run `npm audit --omit=dev` in the gate and block on high or critical. nginx clears Next-internal request headers (section 9); Next 16 also filters its own list (`N/server/lib/server-ipc/utils.js` L60-81).
- [ ] **SE-35 Page CSP** (with the Lead; `next.config.ts` is shared): the docs' policy without nonces (section 3.7). It blocks external scripts, plugins, framing, `<base>` hijack and foreign form posts; it does not stop inline-script XSS, so React escaping stays the main guard and `dangerouslySetInnerHTML` is used only with an approved sanitizer. A nonce policy (which makes every page dynamic) is a later Lead decision.
- [ ] **SE-36 Key rotation.** `HMS_DATA_KEYS`: add the new key first in the list (all keys decrypt), deploy, run a re-encrypt job, then drop the old key. `HMS_HASH_KEY`: rotate on a restart; codes in flight (≤ 10 min) stop working and users ask for a new one. `HMS_BLIND_INDEX_KEY`: needs a second blind-index column and a backfill job (expand/contract). Old backups keep needing the old keys: keep retired keys, encrypted, as long as those backups.
- [ ] **SE-37 Security notices** (Q2(g)): Pallav sends none. If MJ agrees, email the person when the password is changed or reset, when the account is blocked, and when a new phone signs in (outbox).
- [ ] **SE-38 Break-glass.** When every admin of a hotel (or the platform) is blocked: `npm run db:unblock -- --username <name> --reason "<text>"` run on the server as `hms_owner`; it clears the block, writes `platform.audit_log` with the reason, and prints nothing secret.

---

## 7. Database standard

### 7.1 Roles (verified on PostgreSQL 18.6)

One-time setup, run as superuser by `src/server/db/cli/setup.ts` (logic in `db/scripts/setup-db.ts`), which reads `db/.env.local`. Databases: `hms_dev` and `hms_test` (as built), `hms` in production.

```sql
CREATE ROLE hms_owner  LOGIN CREATEROLE PASSWORD '…';  -- owns every object; migrations, create-hotel, imports
CREATE ROLE hms_app    LOGIN NOINHERIT PASSWORD '…';   -- the web app; owns nothing; no DDL
CREATE ROLE hms_worker LOGIN NOINHERIT PASSWORD '…';   -- the job worker; like hms_app, longer timeouts, purge DELETEs
CREATE ROLE hms_tenant NOLOGIN;                        -- what every hotel role shares (platform views, job inserts)
GRANT hms_tenant TO hms_owner WITH ADMIN OPTION, INHERIT FALSE, SET FALSE;
CREATE DATABASE hms_dev OWNER hms_owner;               -- and hms_test the same way
\c hms_dev
REVOKE ALL ON DATABASE hms_dev FROM PUBLIC;            -- also removes TEMP (tested: hms_app cannot create temp tables)
GRANT CONNECT ON DATABASE hms_dev TO hms_app, hms_worker;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT SELECT ON pg_catalog.pg_backend_memory_contexts TO hms_app, hms_worker;           -- pool stats: own backend only
GRANT EXECUTE ON FUNCTION pg_catalog.pg_get_backend_memory_contexts() TO hms_app, hms_worker;
ALTER ROLE hms_app SET search_path = pg_catalog;       -- unqualified hotel SQL outside a hotel transaction fails (fail closed)
ALTER ROLE hms_app SET statement_timeout = '5s';
ALTER ROLE hms_app SET lock_timeout = '3s';
ALTER ROLE hms_app SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE hms_app SET transaction_timeout = '30s';
ALTER ROLE hms_app SET timezone = 'UTC';
-- hms_worker: the same six settings, but statement_timeout '60s' and transaction_timeout '120s'.
```

| ID | Rule |
|---|---|
| DB-1 | `hms_app` and `hms_worker`: LOGIN, NOINHERIT, no SUPERUSER, CREATEDB, CREATEROLE or BYPASSRLS. They own nothing and have no CREATE anywhere. `boot()` checks this. |
| DB-2 | Timeouts are set per role with `ALTER ROLE`, never in `postgresql.conf`, never as connection options (PgBouncer drops them). Request code MUST NOT raise them. Anything that needs more than about 1 second becomes a job (AP-14). |
| DB-3 | Platform grants stay in `0099_grants.sql` (as built), plus the additions in 7.9. Audit tables get INSERT and SELECT only. |

### 7.2 One schema per hotel, guarded by its own role (verified)

`create-hotel` runs as `hms_owner`. Step 1 is **one transaction** (DDL, including `CREATE ROLE`, is transactional). The psql below is the exact shape that was run on 18.6; `db/scripts/create-hotel.ts` (built, with its compensating clean-up) is changed to produce it.

<!-- verified: ../pgx/v/create-hotel.sql -->
```sql
-- psql -v name=... -v slug=... : section 7.2 create-hotel, as hms_owner, in one transaction
\set ON_ERROR_STOP 1
SET ROLE hms_owner;
BEGIN;
INSERT INTO platform.hotels (name, slug, status, timezone, schema_version) VALUES (:'name', :'slug', 'provisioning', 'Asia/Kolkata', 0)
RETURNING id AS hotel_id, schema_name AS hotel_schema, schema_name || '_rw' AS hotel_role \gset
CREATE SCHEMA :"hotel_schema";
CREATE ROLE :"hotel_role" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS IN ROLE hms_tenant;
GRANT USAGE ON SCHEMA :"hotel_schema" TO :"hotel_role";
SELECT set_config('search_path', :'hotel_schema' || ', pg_catalog', true);
\i ../template.sql
\i hotel-additions.sql
\i C:/Users/infoj/Desktop/HMS/db/seeds/hotel/0001_defaults.sql
-- grant sync (the runner does this after every hotel migration, from the table markers)
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA :"hotel_schema" TO :"hotel_role";
REVOKE UPDATE ON system_logs, user_audit_logs, force_logs, schema_migrations FROM :"hotel_role";
REVOKE ALL ON schema_migrations FROM :"hotel_role";
GRANT DELETE ON idempotency_keys TO :"hotel_role";
GRANT EXECUTE ON FUNCTION touch_updated_at(), forbid_change() TO :"hotel_role";
GRANT :"hotel_role" TO hms_app WITH INHERIT FALSE, SET TRUE;
GRANT :"hotel_role" TO hms_worker WITH INHERIT FALSE, SET TRUE;
UPDATE platform.hotels SET status = 'active', schema_version = 1 WHERE id = :'hotel_id';
COMMIT;
\echo created :hotel_schema
```

In the TypeScript version the migration and seed runners still commit file by file after step 1 (as built), with the hotel in `provisioning` until the last file; a failure runs the existing compensating clean-up.

| ID | Rule |
|---|---|
| DB-4 | `hms_app` MUST NOT hold USAGE or table rights on any hotel schema. **Tested:** without the role switch, "permission denied for schema"; inside hotel A, a qualified `hotel_B.table` is refused; switching to `hms_owner` is refused. |
| DB-4b | **Limit (tested):** inside hotel A's transaction, `SET LOCAL ROLE hotel_<B>_rw` succeeds and reads B, and `RESET ROLE` returns to `hms_app` with its platform rights, because SET ROLE is checked against the session user. The role is a guard against mistakes; SE-25 is the guard against injection. The isolation suite keeps a test that documents this, so a future change is visible. |
| DB-5 | Schema name = `hotel_<32 hex>`, generated from the hotel id (`platform.hotels.schema_name` is a GENERATED column, as built). Role name = `hotel_<32 hex>_rw`. Both are checked by regex before any use. |
| DB-6 | Hotel code reaches platform data only through narrow views granted to `hms_tenant` and filtered by `current_setting('hms.hotel_id')`, for example `platform.hotel_user_names`. Platform tables stay schema-qualified (`platform.x`); hotel tables stay unqualified (the SQL lint already checks this). Application SQL MUST NOT contain a literal `hotel_<hex>` (grep test). |
| DB-7 | No cross-schema foreign keys. References to platform users are plain indexed `uuid` columns; the service checks they exist. |
| DB-7b | **Hotel grants come from table markers, not from hotel SQL files** (lint rule 13 stays: hotel files hold no GRANT). Default privileges give the hotel role SELECT, INSERT, UPDATE (never DELETE: today's `create-hotel.ts` L98 grants DELETE on everything, and must change). After every hotel migration the runner syncs, idempotently: `-- append-only` tables lose UPDATE (and have the `forbid_change` trigger); `-- no-app-access` tables lose everything; `-- hard-delete: <Pallav reason>` tables and `idempotency_keys` get DELETE. Money, booking and audit tables never get DELETE (MASTER 4.4). The drift check (DB-19) compares grants too. |

### 7.3 Transactions, search_path and time

| ID | Rule |
|---|---|
| DB-8 | Every hotel query runs inside `inTransaction` + `enterHotel`. These settings are transaction-local: `search_path = 'hotel_<hex>, pg_catalog'`, `role = hotel_<hex>_rw`, `TimeZone = <hotel tz>`, and `hms.hotel_id` / `hms.user_id`. **Tested:** all reset after COMMIT and after ROLLBACK. Plain `SET` (session-level) is forbidden. |
| DB-9 | Inside a hotel transaction `TimeZone` is the hotel's zone, so `current_date`, `localtime`, `date_trunc` and `date + time` casts are in the hotel's calendar (tested: `2026-10-05 23:30 → +05:30`). Outside, the role default is UTC. JavaScript MUST NOT compute business dates with `new Date()`. |
| DB-10 | No network I/O inside a transaction: no SMTP, HTTP, argon2 or PDF. Do it before or after COMMIT, or put it in the outbox. The same holds for jobs: a job holds a connection only for its short transactions. |
| DB-11 | One checkout per request (the wrapper), plus at most one autocommit statement for rate limits. Sign-in is the exception: two short transactions around argon2. |
| DB-12 | GET runs `BEGIN READ ONLY`. A GET that needs to write is a design error. |

### 7.4 Rules that keep the SQL ready for PgBouncer (from day one)

- [ ] **DB-13** Per-request state only via `set_config(…, true)` inside BEGIN…COMMIT. Never session `SET` or `RESET`.
- [ ] **DB-14** No named prepared statements (never pass `name:` to `query`). No SQL `PREPARE`.
- [ ] **DB-15** Advisory locks in app code are `pg_advisory_xact_lock` only. Session locks (the migration runner) use a direct connection.
- [ ] **DB-16** No `LISTEN`, no `WITH HOLD` cursors, no temp tables in the web app. The worker polls.
- [ ] **DB-16b When PgBouncer is added** (SC-3): `query_wait_timeout` about 2 s (the same fail-fast budget as `DB_CONNECT_TIMEOUT_MS`, which no longer fires because the pool connects to PgBouncer at once); its errors (class `08`, closed sockets) already map to 503 in `pg-errors.ts`; add a per-process concurrency cap equal to the process's share of PgBouncer's server pool.

### 7.5 Migration runner (keep Backend 1's design; complete it)

Already built and correct: one run at a time (advisory lock); platform first, then every hotel; checksums; immutable applied files; **all hotels checked before any is applied**; one transaction per file per schema; resume by re-running; `-- migrate: no-transaction` files; a required `-- rollback:` line; dry run.

| ID | Add |
|---|---|
| DB-17 | Each file runs with `lock_timeout = '1s'` (`SET LOCAL` in transactional files, a session setting in no-transaction files). A waiting ALTER blocks every new reader of that table, so it must give up quickly: retry 5 times with jittered backoff, then stop and name the schema and file. The run reports time per file per schema and a total; a dry run estimates it. |
| DB-18 | After a hotel reaches head, set `platform.hotels.schema_version` in the same transaction as the last file. |
| DB-19 | **Drift check** (gate and nightly): every active hotel's catalog (tables, columns, types, indexes, constraints, triggers, grants for `hotel_<hex>_rw`) equals a fresh template schema built in `hms_test`. |
| DB-20 | **FK index check** (catalog query): every foreign-key column has an index whose first column is that column. It complements the text-based SQL lint. |
| DB-21 | `create-hotel` and `migrate` take the same advisory lock, so a hotel created during a run cannot miss a file. |
| DB-22 | The command-line tools (`setup`, `migrate`, `create-hotel`, `unblock`) live in `web-app/src/server/db/cli/` and call the pure logic in `db/scripts/`. They connect as `hms_owner` (setup as superuser) over a **direct** connection (never PgBouncer) and load `db/.env.local` with `process.loadEnvFile`. `env-store.ts` writes owner and superuser values to `db/.env.local`, and only `DATABASE_URL` and `HMS_*` keys to `web-app/.env.local`. |
| DB-22b | The runner applies hotels one at a time today (`migrate.ts` L214-215). With hundreds of hotels it MAY apply N hotels in parallel (N ≤ 4, one direct connection each), still checking all first and stopping at the first failure. |

### 7.6 Expand/contract (hotels migrate one by one)

- [ ] **DB-23** Every migration works with the code that is running now. Order:
  1. Expand: nullable column, new table, or index created `CONCURRENTLY` in a no-transaction file.
  2. Deploy code that writes both shapes.
  3. Backfill in batches of at most 5,000 rows per transaction.
  4. Add `CHECK … NOT VALID`, then `VALIDATE CONSTRAINT`.
  5. Contract (drop the old shape) in a **later** release.
- [ ] **DB-24** Never rename or drop something the running code reads. Raise `REQUIRED_HOTEL_SCHEMA_VERSION` only in the release that needs it. Hotels below it answer 503 "being upgraded".
- [ ] **DB-25** High-risk migrations (money, bookings, deletes) need MJ's go and a tested rollback note.
- [ ] **DB-25b** `CREATE INDEX CONCURRENTLY` waits for every older snapshot in the database, so it can wait on the worker's long transactions (up to 120 s) once per hotel. Stop the worker (or let it finish its jobs) during a CIC run, and run expand migrations ahead of the deploy, never inline in it.

### 7.7 Schema design

| ID | Rule |
|---|---|
| DB-26 | Primary key `id uuid DEFAULT uuidv7()` (built into PostgreSQL 18). Imported rows carry `legacy_id bigint` with a partial UNIQUE index (SQL lint `legacy-id`); the import inserts in `legacy_id` order, so `id` order follows Pallav's. Human numbers (`entry_no`, bill no.) are separate columns with UNIQUE. |
| DB-27 | Money is `bigint` `*_paise` with sign CHECKs. **Never `numeric` or float for money** (lint `money`). Percentages and quantities are `numeric(p,s)` with CHECK ranges, as Pallav has them. Pallav decimals become paise in the import through `fromRupees` (exact). |
| DB-28 | Type parsers (pool.ts): `int8` becomes a safe-integer number; `date` stays a string; `numeric` and `time` stay strings. Cast aggregates: `sum(x)::bigint`; `count(*)` is int8 and arrives as a number. |
| DB-29 | `timestamptz` for instants. Pallav's `date` + `time` pairs stay as they are (the hotel's wall clock); the API turns them into instants in SQL inside the hotel's time zone. `platform.hotels.timezone` default `Asia/Kolkata`. |
| DB-30 | Soft delete where Pallav soft-deletes (`deleted_at`, `deleted_by`). Money and booking rows are never hard-deleted (MASTER 4.4). Partial UNIQUE indexes use `WHERE deleted_at IS NULL`. |
| DB-31 | Enums are `text` + CHECK (lint `status-check`). JSON is `jsonb`, only where Pallav had JSON. Constraints are always named. |
| DB-32 | `created_at` and `updated_at` everywhere (except tables marked `-- append-only` or `-- no-standard-columns`). `updated_at` is set by the `touch_updated_at` trigger (as built). Append-only tables (`system_logs`, `user_audit_logs`, `force_logs`, `platform.audit_log`, `platform.auth_events`) have the `forbid_change` trigger and no UPDATE grant. |
| DB-33 | Index every foreign key and every filter or sort column a list uses. Each list's `EXPLAIN (ANALYZE, BUFFERS)` on a seeded large hotel (3 years: about 100k reservations, 300k charges, 1M log rows, 60k cash entries) is attached to the report. A hot path rejects: a Seq Scan on a table over 10k rows that is not bounded by the list's window, a Sort without LIMIT, more than 1,000 nested-loop iterations, estimates 10× off, and window aggregates over 5 ms. Use covering partial indexes for totals (`(date) INCLUDE (amount_paise) WHERE deleted_at IS NULL`: 5.7 → 3.4 ms measured). `ILIKE '%x%'` cannot use a btree; for big lists `pg_trgm` needs approval (section 12). Every new index costs catalog-cache memory in every backend for every hotel (section 8.9): justify each one. |
| DB-34 | Sessions table: `fillfactor = 70`, and **no index on `last_seen_at`** (HOT updates). |

### 7.8 Concurrency patterns

| ID | Pattern | SQL / code |
|---|---|---|
| DB-35 | **Entry numbers** (Pallav `HasEntryNumber`) | `repos/entryNo.ts` (built): `pg_advisory_xact_lock(hashtextextended(current_schema() \|\| '.' \|\| table, 0))`, then `max(entry_no)+1` over all rows, plus UNIQUE as a backstop. Pallav's `max() … FOR UPDATE` fails on PostgreSQL; never port it literally. |
| DB-36 | **Fiscal-year counters** (`site_reference_counters`) | `INSERT … ON CONFLICT (fiscal_year) DO UPDATE SET counter = counter + 1 RETURNING counter` |
| DB-37 | **One guest per room at a time** (Pallav checks "room free" outside its transaction, a race) | `CREATE UNIQUE INDEX one_in_house_stay_per_room ON pms_stays (room_id) WHERE status = 'in_house';` and map that constraint's 23505 to Pallav's message "Room X is not free. Choose another." |
| DB-38 | **Room-type inventory** (Pallav `Availability`) | Same lock order as Pallav, inside one transaction: `SELECT … FROM site_rooms WHERE id=$1 FOR UPDATE`, then the reservation `FOR UPDATE`, then the sold-vs-capacity check on half-open `[check_in, check_out)` |
| DB-39 | **Idempotency** | `repos/idempotency.repo.ts` + per-hotel `idempotency_keys` (7.9), purged after 24 h by the worker. **Race tested:** the second request waits, inserts nothing, and replays the 201. |
| DB-40 | **Counters** (lock, codes, sends) | `UPDATE … SET n = n + 1 WHERE … RETURNING n`. Decide in SQL, in the same transaction, and commit it even when the answer is a refusal (SE-11). |
| DB-41 | **Stale edits** (Q5) | `version integer NOT NULL DEFAULT 1` on editable bookings, folios, bills and cash entries. `UPDATE … SET version = version + 1 WHERE id=$1 AND version=$2 RETURNING version`; 0 rows → 409. Add the column now; enforce only after Q5. |
| DB-42 | **Payroll generate** | `pg_advisory_xact_lock(hashtextextended(current_schema() \|\| '.salary.' \|\| company \|\| month, 0))`. Batch-load all employees' inputs with `= ANY($1)`. Long runs become a job. |
| DB-43 | **Sign-in** (SE-9) | `SELECT id FROM platform.users WHERE id = $1 FOR UPDATE`, then revoke the live web session, then insert. **Tested** both ways. |
| DB-44 | **Job claim** (SC-7) | Oldest-first across hotels, at most k per hotel per poll, `FOR UPDATE SKIP LOCKED` (SQL below). **Tested:** 1,000 jobs of hotel A did not starve hotel B's 3; two workers claimed different rows without blocking. |
| DB-45 | **Churn tables** | `platform.sessions`, `platform.jobs`, `platform.rate_limits` and every `idempotency_keys` get `autovacuum_vacuum_scale_factor = 0.02` and `autovacuum_analyze_scale_factor = 0.02` (per table). Watch autovacuum with many hotels: it visits every relation of every hotel. |

### 7.9 Platform objects to add or change in Phase 1 (verified SQL)

`0003_users.sql` and `0004_auth.sql` have never been applied anywhere, so they are **edited in place**: sessions lose `family_id`, `replaced_by` and the `rotated`/`reuse_detected` reasons (add `password_changed`, `deactivated`, `blocked`); `auth_codes` and `login_attempts` are dropped (replaced by `auth_challenges`, `rate_limits` and `auth_events`); `users.status` drops `invited` (SE-19); `users.two_factor_secret` goes (Pallav uses the emailed code, not TOTP). The SQL below was applied on 18.6 on top of the real `0000`–`0006` to prove it; in the repo the same objects go into `0003`/`0004` and a new `0007_jobs_and_limits.sql`. Tables without `id`/timestamps carry `-- no-standard-columns` for the SQL lint.

<!-- verified: ../pgx/v/platform-additions.sql -->
```sql
-- Phase 1 step 3 shapes, applied here ON TOP of the real 0000-0006 (in the repo they are edits of 0003/0004 + new files).
ALTER TABLE platform.users
  ADD COLUMN blocked_at timestamptz,
  ADD COLUMN blocked_kind text CHECK (blocked_kind IN ('auto', 'admin')),
  ADD COLUMN blocked_reason text CHECK (char_length(blocked_reason) <= 120),
  ADD COLUMN otp_sends smallint NOT NULL DEFAULT 0 CHECK (otp_sends >= 0),
  ADD COLUMN otp_cooldown_level smallint NOT NULL DEFAULT 0 CHECK (otp_cooldown_level >= 0),
  ADD COLUMN otp_cooldown_until timestamptz,
  ADD CONSTRAINT users_blocked_pair CHECK ((blocked_at IS NULL) = (blocked_kind IS NULL));

DROP INDEX platform.sessions_one_active_per_user_key;
CREATE UNIQUE INDEX sessions_one_live_web_key ON platform.sessions (user_id) WHERE client = 'web' AND revoked_at IS NULL;
ALTER TABLE platform.sessions ADD COLUMN device_id text CHECK (device_id ~ '^[A-Za-z0-9_-]{16,64}$');
CREATE UNIQUE INDEX sessions_one_live_token_per_device_key ON platform.sessions (user_id, device_id) WHERE client = 'mobile' AND revoked_at IS NULL;
ALTER TABLE platform.sessions SET (fillfactor = 70);

ALTER TABLE platform.hotels ADD COLUMN schema_version integer NOT NULL DEFAULT 0,
  ADD COLUMN db_cluster text NOT NULL DEFAULT 'main' CHECK (db_cluster ~ '^[a-z][a-z0-9_]{0,30}$');
ALTER TABLE platform.hotels DROP CONSTRAINT hotels_status_check,
  ADD CONSTRAINT hotels_status_check CHECK (status IN ('provisioning', 'active', 'suspended', 'closed'));

ALTER TABLE platform.user_permissions ADD COLUMN hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE;
ALTER TABLE platform.user_permissions DROP CONSTRAINT user_permissions_pair_key,
  ADD CONSTRAINT user_permissions_user_hotel_permission_key UNIQUE (user_id, hotel_id, permission_id);
CREATE INDEX user_permissions_hotel_id_idx ON platform.user_permissions (hotel_id);

-- a role given to a person must be built-in, or belong to the hotel it is given in (SE-4b)
CREATE FUNCTION platform.users_role_builtin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.roles r WHERE r.id = NEW.role_id AND r.hotel_id IS NOT NULL) THEN
    RAISE EXCEPTION 'users.role_id must be a built-in role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION platform.user_hotels_role_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.roles r WHERE r.id = NEW.role_id AND r.hotel_id IS NOT NULL AND r.hotel_id <> NEW.hotel_id) THEN
    RAISE EXCEPTION 'a custom role can only be given in its own hotel' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_role_builtin BEFORE INSERT OR UPDATE OF role_id ON platform.users FOR EACH ROW EXECUTE FUNCTION platform.users_role_builtin();
CREATE TRIGGER user_hotels_role_scope BEFORE INSERT OR UPDATE OF role_id, hotel_id ON platform.user_hotels FOR EACH ROW EXECUTE FUNCTION platform.user_hotels_role_scope();

CREATE TABLE platform.auth_challenges (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  purpose text NOT NULL CHECK (purpose IN ('login', 'reset', 'enable', 'change_password')),
  user_id uuid REFERENCES platform.users (id) ON DELETE CASCADE,
  client text NOT NULL CHECK (client IN ('web', 'mobile')),
  device_label text CHECK (char_length(device_label) <= 120),
  code_hash text CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  code_sent_at timestamptz,
  code_attempts smallint NOT NULL DEFAULT 0 CHECK (code_attempts BETWEEN 0 AND 10),
  change_reason text CHECK (change_reason IN ('first', 'reset')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_challenges_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX auth_challenges_token_hash_key ON platform.auth_challenges (token_hash);
CREATE UNIQUE INDEX auth_challenges_one_live_code_key ON platform.auth_challenges (user_id) WHERE code_hash IS NOT NULL AND consumed_at IS NULL;
CREATE INDEX auth_challenges_user_id_idx ON platform.auth_challenges (user_id);
CREATE INDEX auth_challenges_expires_at_idx ON platform.auth_challenges (expires_at);
CREATE TRIGGER auth_challenges_touch_updated_at BEFORE UPDATE ON platform.auth_challenges FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE UNLOGGED TABLE platform.rate_limits (
  key text PRIMARY KEY CHECK (char_length(key) <= 200),
  window_start timestamptz NOT NULL,
  window_seconds integer NOT NULL CHECK (window_seconds BETWEEN 1 AND 86400),
  hits integer NOT NULL CHECK (hits >= 0)
);
CREATE INDEX rate_limits_window_start_idx ON platform.rate_limits (window_start);

CREATE TABLE platform.jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid DEFAULT nullif(current_setting('hms.hotel_id', true), '')::uuid REFERENCES platform.hotels (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'),
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'dead')),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 50),
  locked_until timestamptz,
  last_error text CHECK (char_length(last_error) <= 500),
  dedupe_key text CHECK (char_length(dedupe_key) <= 200),
  created_by uuid DEFAULT nullif(current_setting('hms.user_id', true), '')::uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_hotel_id_idx ON platform.jobs (hotel_id);
CREATE INDEX jobs_ready_idx ON platform.jobs (hotel_id, run_at) WHERE status = 'queued';
CREATE INDEX jobs_lease_idx ON platform.jobs (locked_until) WHERE status = 'running';
CREATE UNIQUE INDEX jobs_dedupe_key ON platform.jobs (hotel_id, dedupe_key) NULLS NOT DISTINCT WHERE dedupe_key IS NOT NULL;
CREATE FUNCTION platform.jobs_tenant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- only inside a hotel transaction (current_user is the hotel role, session_user is hms_app or hms_worker)
  IF current_user <> session_user AND pg_has_role(current_user, 'hms_tenant', 'USAGE') THEN
    IF NEW.kind <> ALL (ARRAY['mail.send', 'pdf.render', 'export.csv']) THEN
      RAISE EXCEPTION 'job kind % is not allowed from a hotel', NEW.kind USING ERRCODE = '42501';
    END IF;
    IF NEW.hotel_id IS NULL OR NEW.hotel_id IS DISTINCT FROM nullif(current_setting('hms.hotel_id', true), '')::uuid THEN
      RAISE EXCEPTION 'a hotel may queue jobs only for itself' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_tenant_guard BEFORE INSERT ON platform.jobs FOR EACH ROW EXECUTE FUNCTION platform.jobs_tenant_guard();
CREATE TRIGGER jobs_touch_updated_at BEFORE UPDATE ON platform.jobs FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE VIEW platform.hotel_user_names AS
  SELECT u.id, u.display_name
    FROM platform.users u
    JOIN platform.user_hotels uh ON uh.user_id = u.id
   WHERE uh.hotel_id = nullif(current_setting('hms.hotel_id', true), '')::uuid;
```

Grants added to `0099_grants.sql` (verified):

<!-- verified: ../pgx/v/grants-additions.sql -->
```sql
GRANT USAGE ON SCHEMA platform TO hms_tenant, hms_worker;
GRANT SELECT ON platform.hotel_user_names TO hms_tenant;
GRANT INSERT (kind, payload, run_at) ON platform.jobs TO hms_tenant;
GRANT EXECUTE ON FUNCTION platform.jobs_tenant_guard() TO hms_tenant, hms_app, hms_worker;
GRANT EXECUTE ON FUNCTION platform.users_role_builtin(), platform.user_hotels_role_scope() TO hms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.auth_challenges TO hms_app;
GRANT SELECT, INSERT, UPDATE ON platform.rate_limits TO hms_app;
GRANT INSERT (kind, payload, run_at) ON platform.jobs TO hms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.jobs TO hms_worker;
GRANT SELECT ON platform.hotels TO hms_worker;
GRANT SELECT, DELETE ON platform.sessions, platform.auth_challenges, platform.rate_limits TO hms_worker;
GRANT SELECT (id, email, display_name, status) ON platform.users TO hms_worker;
GRANT EXECUTE ON FUNCTION platform.touch_updated_at() TO hms_worker;
```

What the jobs design guarantees (tested): a hotel role can queue only `mail.send`, `pdf.render` and `export.csv`, only for its own hotel, and cannot set `hotel_id` or `dedupe_key` (column grants; `ON CONFLICT` would need SELECT, which tenants do not get). The scheduler (worker) sets `hotel_id` and `dedupe_key` itself; dedupe is unique per hotel (`NULLS NOT DISTINCT` covers platform jobs), so one hotel cannot pre-empt another hotel's backup.

The fair claim (DB-44, verified):

```sql
WITH hotels AS (
  SELECT hotel_id, min(run_at) AS oldest
    FROM platform.jobs
   WHERE status = 'queued' AND run_at <= now() AND kind = ANY($1::text[])
   GROUP BY hotel_id
   ORDER BY oldest
   LIMIT 50
), picked AS (
  SELECT j.id
    FROM hotels h
    CROSS JOIN LATERAL (
      SELECT q.id FROM platform.jobs q
       WHERE q.hotel_id IS NOT DISTINCT FROM h.hotel_id
         AND q.status = 'queued' AND q.run_at <= now() AND q.kind = ANY($1::text[])
       ORDER BY q.run_at
       LIMIT $3                               -- at most this many per hotel per poll
       FOR UPDATE SKIP LOCKED) j
   LIMIT $2                                   -- batch size
)
UPDATE platform.jobs j
   SET status = 'running', attempts = j.attempts + 1, locked_until = now() + make_interval(secs => $4), updated_at = now()
  FROM picked
 WHERE j.id = picked.id
RETURNING j.id, j.hotel_id, j.kind, j.payload, j.attempts;
```

**Hotel template additions** (verified; in the repo: edits of the never-applied `0000`/`0001` plus a new file for `idempotency_keys`):

<!-- verified: ../pgx/v/hotel-additions.sql -->
```sql
-- hotel template additions (in the repo: db/migrations/hotel/0010_platform_guards.sql)
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the table is insert-only', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;
ALTER TABLE system_logs ADD COLUMN trace_id text CHECK (trace_id ~ '^[A-Za-z0-9_-]{8,64}$');
CREATE TRIGGER system_logs_forbid_change BEFORE UPDATE OR DELETE ON system_logs FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER user_audit_logs_forbid_change BEFORE UPDATE OR DELETE ON user_audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER force_logs_forbid_change BEFORE UPDATE OR DELETE ON force_logs FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- no-standard-columns: one row per (user, Idempotency-Key), purged after 24 h
CREATE TABLE idempotency_keys (
  user_id uuid NOT NULL,
  key uuid NOT NULL,
  route text NOT NULL CHECK (char_length(route) <= 80),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer CHECK (response_status BETWEEN 200 AND 299),
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_pkey PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys (created_at);
```

Also in the template: the covering partial `(date) INCLUDE (amount_paise) WHERE deleted_at IS NULL` index on each cash book (DB-33), `version` columns (DB-41), `-- hard-delete:` markers (DB-7b). The hotel's `user_audit_logs` keeps Pallav's imported history; new account events are platform-level in HMS (SE-18), so the "User activity" screen reads both (module spec).

---

## 8. Scalability for 10,000 concurrent active users

### 8.1 Capacity model (the budget every design is checked against)

| Quantity | Value | How |
|---|---|---|
| Active users | 10,000 at once | Target |
| Average load | **1,000 requests/s** | 1 API call per user every 10 s (2–4 calls per screen, 20–40 s of thinking) |
| Peak load | **3,000 requests/s** for up to 15 min | ×3: check-out rush, shift change, night audit |
| Sign-in burst | 5 sign-ins/s (300/min) | 20 % of staff within 15 min of a shift change |
| Round trips, measured | list 8 (BEGIN, session, enterHotel, year, page, totals, stats, COMMIT); create 11 | Through the real wrapper (section 0.2) |
| Request time, measured (dev PC, local PostgreSQL, 66k deposits) | list 7.8 ms avg, 11 ms p95; create 7.5 ms avg, 9 ms p95 | Almost all of it holds the connection |
| Connection hold on two servers | ≈ 10–13 ms | + network round trip (≈ 0.3–0.5 ms) × 8–11 |
| Busy connections at peak | 3,000 × ~0.012 s ≈ **36**, bursts to ~50 | Little's law. The 60-connection web budget has little headroom: measure in step 10 and in the load test. |
| Database CPU per request | MUST average ≤ 1.5 ms over the real mix | A list with window totals costs 3–6 ms (measured); that is why AP-7 bounds aggregates. 1,000 req/s × 1.5 ms = 1.5 cores average, 4.5 at peak. |
| Node processes | 6 on an 8-vCPU app server | Benchmark one standalone process with the real wrapper in step 10 before trusting this |
| argon2 | ~31–35 ms of one core per hash (measured) | Cap 1 per process → 6 at once, ~180/s server-wide, against a need of 5/s |

### 8.2 Connection and memory budget (no PgBouncer)

| User of connections | Max |
|---|---|
| 6 web processes × `DB_POOL_MAX` 10 | 60 |
| Worker (`DB_POOL_MAX=5`; jobs hold a connection only for short transactions, DB-10) | 5 |
| Rolling restart overlap (one instance at a time) | 10 |
| Migrations, scripts, backups, monitoring, admin psql | 15 |
| **Total ≤ `max_connections` 100** (`superuser_reserved_connections` 3) | 90 |

- **SC-1** Never "fix" connection errors by raising `max_connections`. Each backend costs memory, and with many hotel schemas each one caches more catalog data (8.9).
- **SC-2** Starting PostgreSQL settings for an 8 vCPU / 32 GB database server: `shared_buffers 8GB`, `effective_cache_size 20GB`, `work_mem 16MB`, `maintenance_work_mem 1GB`, `random_page_cost 1.1`, `autovacuum_max_workers 6`. Budget backend memory as `backends × (catalog cache + work_mem peaks)`; the catalog cache is the big one (8.9). Tune from load-test numbers.
- **SC-2b** There is no growth room in this budget: a seventh process or a second app server needs PgBouncer (SC-3) or a bigger database.

### 8.3 PgBouncer (later; needs approval)

- **SC-3** Add it when (instances × pool) would pass 60, when a second app server appears, or when the load test shows pool `waiting` > 0 at p95. Settings: `pool_mode=transaction`, `default_pool_size=30`, `max_client_conn=1000`, `server_lifetime=900`, `query_wait_timeout=2`, `max_prepared_statements=0`, plus DB-16b. The SQL is already compatible (section 7.4). Migrations and session locks always use a direct connection. PgBouncer pools every hotel through the same server connections, so it raises catalog-cache pressure per backend: measure with 8.9.

### 8.4 Stateless horizontal scale

- **SC-4** Every web process is the same and keeps no state. Sessions, rate limits, idempotency, locks, codes and jobs live in PostgreSQL. Nothing lives on local disk except private uploads (one server for now; moving to object storage needs approval later).
- **SC-5** All instances of one release use the same build (built once with `DEPLOYMENT_VERSION`, NX-12). Restart one instance at a time with the nginx drain (OP-10).

### 8.5 Caching policy

| What | Rule |
|---|---|
| Next caches (`use cache`, `unstable_cache`, ISR) | Forbidden for API data (NX-5). |
| HTTP caching of `/api` | `no-store` always; nginx MUST NOT cache `/api`. |
| Authorization data (sessions, levels, blocks) | Never cached. It comes from the database on every request. |
| Static reference data (permission catalogue) | Lives in code (generated from the seeds). |
| Hotel settings | Read inside the hotel transaction when needed (one small row). |
| Global, non-tenant reference data | Per-process cache with TTL ≤ 60 s MAY be added, with Lead approval, keyed by everything that varies. |
| Dashboards, KPIs and list totals | SQL aggregates with `FILTER` on indexed columns, covering indexes, bounded windows (AP-7). If one stays over 5 ms p95 on the seeded hotel: send it only with page 1 (contract: Lead) or keep a summary table maintained **in the same transaction** as the change. |
| Static assets | Served by nginx from `/opt/hms/static` with immutable headers (OP-10). |

### 8.6 Background jobs

- **SC-6** One worker process: `server/jobs/worker.ts`, run by systemd from the same release folder as the web servers, connected as `hms_worker`.
- **SC-7** It claims jobs with the fair claim (DB-44): oldest first across hotels, at most 5 per hotel per poll, batches of 20, polling every 1 s.
- **SC-8** Failed jobs retry with backoff `min(2^attempts × 30 s, 1 h)`. After `max_attempts` they become `dead` (alert).
- **SC-9** Leases are per kind (email 2 min, PDF 10 min, backup 2 h) and renewed by a heartbeat `UPDATE … SET locked_until = …` while the job runs. A reaper re-queues only expired leases. Handlers are idempotent and key their side effects by job id, so a rare double run does no harm.
- **SC-10** Concurrency per kind: email 10, PDF 2, backup 1.
- **SC-11 Worker trust model.** Every payload is validated with the kind's zod schema; unknown kinds go `dead`. The hotel comes only from `jobs.hotel_id`, never from the payload. A job a user started (`created_by`) re-checks that user's permission when it runs. A payload never holds a secret in plain text; temporary passwords and codes are encrypted and wiped once sent; email addresses are read at send time from `platform.users`.
- **SC-12** The scheduler ticks every minute in hotel time and enqueues with `dedupe_key = '<kind>:<slot>'` (unique per hotel), so several workers are safe. It ports Pallav's schedules: backup 02:00 (only if enabled), recycle-bin purge 03:00, health every 5 min. Purges: idempotency keys after 24 h (hotel role DELETE), rate-limit rows after 1 day, expired sessions and challenges, finished jobs after 14 days.
- **SC-13** **Never** start the worker or the scheduler from `instrumentation.ts`.
- **SC-12b** The worker's pool uses `maxUses: 200` (it touches every hotel, so its backends' caches grow fastest, 8.9).

### 8.7 Hosting topology (needs approval, Q4)

- **App server** (8 vCPU / 16 GB, 100 GB disk): nginx, 6 web processes (ports 4001–4006), 1 worker.
- **Database server** (8 vCPU / 32 GB NVMe, disk sized for data + 7 days of WAL + local backups): PostgreSQL 18 only.
- **Standby server** (same size as the database): a streaming replica for failover (OP-9). Until it exists, the database server is a single point of failure and recovery is a restore.
- All in the same Mumbai data centre, on a private network; without one, PostgreSQL traffic uses TLS (SE-27).
- On one shared server, Node and PostgreSQL fight for CPU and page cache exactly at peak time.

### 8.8 Load-test targets (the gate before production)

| Scenario | Load | Pass when |
|---|---|---|
| A. Sustained | 10,000 virtual users; **at least 500 seeded hotel schemas** (the year-3 count from Q4 if larger), 50 users each on the busy ones; 1,000 req/s; 70 % reads; 30 min | p95 read < **300 ms**, p95 write < **600 ms**, p99 < 1 s, errors < 0.1 %, pool `waiting` = 0 at p95, database CPU < 60 %, catalog cache per backend (`cacheMb`) inside the 8.9 budget |
| B. Peak | 3,000 req/s for 10 min | p95 read < 500 ms, p95 write < 900 ms, errors < 0.5 %, no pool `SERVICE_UNAVAILABLE` |
| C. Sign-in burst | 300 sign-ins/min on top of A, plus a 50 req/s flood of wrong passwords | sign-in p95 < 800 ms; event-loop delay p99 < 100 ms; the flood gets 429/503, never CPU starvation |
| D. Soak | 2 h at 1,000 req/s | memory, connections, pool waiting and `cacheMb` stay flat |
| E. Isolation under load | A, with random ids from other hotels mixed in | zero cross-hotel reads (all 404) |
| F. Shared address | one hotel's 50 users all from one source IP at shift change | no 429 for legitimate users |

### 8.9 Limits of one schema per hotel (measured on 18.6 with the real template)

| Fact | Measured |
|---|---|
| Relations per hotel | ≈ 508 (68 tables, 330 indexes, the rest TOAST) |
| Catalog size | ≈ 2.6 MB per hotel (263 MB for 100 hotels) |
| Disk per empty hotel | ≈ 4.9 MB |
| Catalog cache in ONE backend | ≈ 2.4 MB per hotel when it touched every table (245 MB at 100 hotels); ≈ 0.85 MB per hotel for 20 tables |
| First touch of a hotel in a backend | ≈ 2 ms per table (135–155 ms for all 66; 11 ms warm) |
| `pg_dump -n` of one hotel, 100 hotels present | 3.5 s |

PostgreSQL does not evict a backend's catalog cache to save memory; it is freed when the backend ends. A pooled backend serves every hotel that reaches its process, so without routing, 300 hotels × 0.85 MB ≈ 255 MB per backend × ~75 backends ≈ 19 GB: too much.

- **SC-14** **Hotel affinity is REQUIRED before about 100 hotels.** At sign-in and hotel switch the server sets a routing hint: cookie `hms_aff` (web) and `affinity` in the sign-in body that the app sends back as `X-Hms-Aff` (contract: Lead). The value is the first 12 hex of `sha256(hotel_id)`, never trusted for anything. nginx hashes it consistently across the 6 processes (section 9), so each backend sees about a sixth of the hotels.
- **SC-15** Plan **≤ 300 hotels per database server** with affinity (≈ 50 hotels per backend ≈ 40–120 MB of cache per backend) until the load test (8.8 A and D) proves more. Add `platform.hotels.db_cluster` now (7.9) so moving hotels to a second database server is a lookup, not a rewrite.
- **SC-15b** Keep per-hotel objects few: no per-hotel views, functions or sequences unless needed; every new index is justified (DB-33). After the import, review the 68 `legacy_id` unique indexes and other low-use indexes as a contract migration. Watch catalog size and dead rows in `pg_class`/`pg_attribute` weekly.
- **SC-16 Load shedding.** The pool's 2 s connect timeout, the argon2 queue and nginx limits shed load today. If the load test shows event-loop delay p99 > 100 ms, add a per-process in-flight cap that answers 503 with `Retry-After`.
- `maxLifetimeSeconds: 900` frees caches of hotels a backend no longer serves; `maxUses` is the next knob if `cacheMb` keeps growing.

---

## 9. Observability and operations

| ID | Rule |
|---|---|
| OP-1 | **Logs** are JSON lines to stdout through the existing logger (which redacts). One `request` line for every error, every slow request (≥ 500 ms) and a sample of the rest (`ACCESS_LOG_SAMPLE`, production 0.05 to start): `time, level, traceId, route, method, status, ms, dbQueries, dbMs, userId, hotelId`. Health checks log at debug. Never bodies. Per-route counts and p95 come from a per-process one-minute summary line. |
| OP-2 | **Trace id:** `x-trace-id` out on every response. In production nginx always sets `X-Trace-Id: $request_id` (a client's own id is not passed on), so audit rows carry an id the server made. It appears in every error body, log line and `system_logs` row. |
| OP-3 | `onRequestError` is the safety net (section 4.2.13). It never logs headers. |
| OP-4 | **Slow queries:** the `TxClient` wrapper warns above 250 ms (route, traceId, first 200 characters of SQL, never values). PostgreSQL: `log_min_duration_statement=250ms`, `log_lock_waits=on`, `log_autovacuum_min_duration=1s`, `log_temp_files=0`, `track_io_timing=on`. `pg_stat_statements` (approval): on 18.6 the same SQL on every hotel schema is **one** entry (tested), so the default `max` (5000) is enough; watch `pg_stat_statements_info.dealloc`. |
| OP-5 | **Pool stats:** one `pg pool` line per minute per process (total, idle, waiting, `cacheMb`), plus event-loop delay p99 (`perf_hooks.monitorEventLoopDelay`). `waiting > 0` for 1 minute is an alert. |
| OP-6 | **Health:** `/api/v1/health` (liveness, no database), `/api/v1/health/ready` (database within 1 s), later `/api/v1/health/deep` (admin only: Pallav System Health). None reveals versions or hosts. Open-source nginx does not poll them; the deploy script does. |
| OP-7 | **Graceful stop:** systemd `KillSignal=SIGTERM`, `TimeoutStopSec=30`. Next closes its listener at once on SIGTERM, so nginx must stop sending first (OP-10). The worker finishes its current job or lets its lease expire. |
| OP-8 | **journald:** at 1,000 lines/s every request would be about 26 GB of raw text a day (and journald adds metadata per entry), so OP-1 samples. Each unit sets `LogRateLimitIntervalSec=0`; journald gets `SystemMaxUse=` sized from the measured volume for 14 days. Writes to journald can block the event loop when it is slow (stdout is a socket under systemd, written synchronously on Linux): another reason to sample. Keep IP-bearing logs at most 90 days. |
| OP-9 | **Backups and recovery:** `archive_mode=on`, `archive_timeout=60s`, archived WAL compressed (`zstd`); RPO ≈ 1–2 minutes plus copy lag (seconds with the standby). Nightly `pg_basebackup` (incremental in PG 17+), copied off the server and encrypted (tool: section 12); weekly per-hotel `pg_dump -Fc -n hotel_<hex>` plus that hotel's upload folder, for a single-hotel restore. RTO target 1 h by restore, minutes with the standby (promotion runbook written before go-live). A **monthly restore drill**. Backup success or failure shows in System Health. Backups are as sensitive as the database (ID numbers, PII): encrypted, access limited to the owner role on the backup host, keys kept apart (SE-36). Pallav's Google Drive backup is ported later as a job. |
| OP-10 | **Deploy** (a script, for MJ's approval): (1) in a separate checkout on Linux: `npm ci`, `NODE_ENV=production DEPLOYMENT_VERSION=<release> next build`; check `grep deploymentId "<standalone>/web-app/server.js"`. (2) Copy the standalone folder to `/opt/hms/releases/<release>`, plus `public` and `.next/static` (NX-16); copy `.next/static/*` also into `/opt/hms/static/` **without deleting** the previous release's files (prune after 3 releases); smoke-test `require('argon2')`. (3) Run expand migrations (they ran earlier when they include CIC, DB-25b). (4) For each instance: mark it `down` in the nginx upstream file, `nginx -s reload`, wait 10 s, restart it, wait for `/api/v1/health/ready` = 200, mark it up, reload. (5) Restart the worker from the same release. Contract migrations ship in a later release. Clients that hit a mismatch reload (deploymentId). |
| OP-11 | **Alerts** (when monitoring is approved): 5xx rate, p95, pool waiting, database connections above 80 %, `cacheMb` growth, disk, WAL archive failure, backup failure, dead jobs, rate-limit spikes, and any `42501 insufficient_privilege` (a cross-hotel bug). |
| OP-12 | All servers keep time with NTP (`systemd-timesyncd`): expiry windows and audit times depend on it. |
| OP-13 | **Break-glass** (SE-38): `db:unblock` as `hms_owner` on the server, audited with a reason. |

**systemd units** (sketch, for MJ's approval):

```ini
# /etc/systemd/system/hms-web@.service     (instances 1..6 -> ports 4001..4006)
[Unit]
Description=HMS web %i
After=network-online.target
StartLimitIntervalSec=0
[Service]
User=hms
WorkingDirectory=/opt/hms/current/web-app
EnvironmentFile=/etc/hms/web.env
Environment=NODE_ENV=production PORT=400%i HOSTNAME=127.0.0.1 KEEP_ALIVE_TIMEOUT=70000
ExecStart=/usr/bin/node "/opt/hms/current/web-app/server.js"
KillSignal=SIGTERM
TimeoutStopSec=30
Restart=on-failure
RestartSec=5
LogRateLimitIntervalSec=0
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target

# /etc/systemd/system/hms-worker.service: the same shape, from the SAME release:
#   WorkingDirectory=/opt/hms/current/worker   (the release's src/server + `npm ci --omit=dev`, tsx as a runtime dependency)
#   EnvironmentFile=/etc/hms/worker.env        (DB_APP_ROLE=hms_worker, DB_POOL_MAX=5, DB_QUERY_TIMEOUT_MS=90000)
#   ExecStart=/usr/bin/node node_modules/tsx/dist/cli.mjs --import ./src/server/lib/node-hooks/register.ts src/server/jobs/worker.ts
```

`StartLimitIntervalSec=0` and `RestartSec=5` keep a unit retrying when the database is briefly down at boot (production `boot()` exits on a failed role check).

**nginx** (sketch, for MJ's approval; check with `nginx -t`; Ubuntu 24.04 ships 1.24):

```nginx
# Two upstream groups over the same 6 processes: hotel-sticky when the request carries the affinity hint, least_conn otherwise.
upstream hms_any   { least_conn;                 server 127.0.0.1:4001; server 127.0.0.1:4002; server 127.0.0.1:4003;
                     server 127.0.0.1:4004; server 127.0.0.1:4005; server 127.0.0.1:4006; keepalive 64; }
upstream hms_hotel { hash $hms_aff consistent;   server 127.0.0.1:4001; server 127.0.0.1:4002; server 127.0.0.1:4003;
                     server 127.0.0.1:4004; server 127.0.0.1:4005; server 127.0.0.1:4006; keepalive 64; }
# (the deploy script edits these two lines to mark one server "down" while it restarts)
map "$cookie_hms_aff$http_x_hms_aff" $hms_aff { default "$cookie_hms_aff$http_x_hms_aff"; }
map $hms_aff $hms_pool { "" hms_any; default hms_hotel; }
# General limit per credential when there is one (NAT-friendly), else per address; plus a per-address ceiling.
map "$http_cookie$http_authorization" $hms_who { "" $binary_remote_addr; default "$http_cookie$http_authorization"; }
limit_req_zone $hms_who            zone=per_user:50m rate=10r/s;
limit_req_zone $binary_remote_addr zone=per_ip:20m   rate=60r/s;
limit_req_zone $binary_remote_addr zone=auth_ip:10m  rate=2r/s;
limit_req_status 429;

server { listen 80; server_name app.<domain>; return 301 https://$host$request_uri; }
server {
  listen 443 ssl http2;  server_name app.<domain>;               # certbot certificate
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
  client_max_body_size 25m;  client_body_timeout 15s;  client_header_timeout 15s;  keepalive_timeout 60s;
  gzip on;  gzip_types application/json text/css application/javascript text/x-component image/svg+xml;
  proxy_http_version 1.1;  proxy_set_header Connection "";  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto https;  proxy_set_header X-Trace-Id $request_id;
  # Next-internal request headers (Next 16 also filters its own list); never strip rsc, next-router-* or next-url.
  proxy_set_header x-middleware-subrequest "";  proxy_set_header x-middleware-rewrite "";  proxy_set_header x-middleware-next "";
  proxy_set_header x-now-route-matches "";  proxy_set_header x-matched-path "";  proxy_set_header x-nextjs-data "";
  proxy_read_timeout 30s;  proxy_next_upstream error timeout;  proxy_next_upstream_tries 2;

  error_page 413 = @json413;  error_page 429 = @json429;  error_page 502 503 504 = @json503;
  location @json413 { default_type application/json; add_header Cache-Control no-store always;
    return 413 '{"error":{"code":"PAYLOAD_TOO_LARGE","message":"The request is too large","traceId":"$request_id"}}'; }
  location @json429 { default_type application/json; add_header Retry-After 1 always; add_header Cache-Control no-store always;
    return 429 '{"error":{"code":"RATE_LIMITED","message":"Too many requests","traceId":"$request_id"}}'; }
  location @json503 { default_type application/json; add_header Retry-After 5 always; add_header Cache-Control no-store always;
    return 503 '{"error":{"code":"SERVICE_UNAVAILABLE","message":"Service is busy. Try again shortly.","traceId":"$request_id"}}'; }

  location /_next/static/ { alias /opt/hms/static/; access_log off;              # current + previous release (OP-10)
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always; }   # add_header does not inherit
  location /api/v1/auth/ { limit_req zone=auth_ip burst=10 nodelay; limit_req zone=per_ip burst=120 nodelay; proxy_pass http://hms_any; }
  location /api/  { limit_req zone=per_user burst=30 nodelay; limit_req zone=per_ip burst=120 nodelay; proxy_pass http://$hms_pool; }
  location /      { proxy_buffering off; proxy_pass http://$hms_pool; }          # pages stream (NX-22)
}
```

Our own app 503s pass through untouched (`proxy_intercept_errors` stays off); the JSON pages above cover only errors nginx makes itself.

---

## 10. Testing standard

### 10.1 Layers

| ID | Layer | What it proves | Where |
|---|---|---|---|
| TE-1 | Unit | Money, rounding, validators, redaction, error mapping, permissions (`levelFor`, any-of), schema names, `ipBucket`, config rules, the wrapper without a database, the SQL-text grep | `tests/server/unit` |
| TE-2 | DB integration | Repos and services on real PostgreSQL (`hms_test`, the same roles). Each test file creates its own hotels and drops them afterwards (as `hms_owner`). | `tests/server/db` |
| TE-3 | Isolation (every build) | The list in 10.5 | `tests/server/isolation` |
| TE-4 | Golden | Same inputs as Pallav's tests (60 test files) and known cases give identical outputs, messages included. Fixtures name their Pallav source (PHP fixture generators exist). | `tests/server/golden/<group>` |
| TE-5 | Contract | Each service's return type equals the ui-shared type (compile-time equality) with a runtime shape check. Route inventory = `docs/API.md`; every `route.ts` exports all five methods. Permission keys = seeds. `MAX_AMOUNT_PAISE` = contract. | `tests/server/contract` |
| TE-6 | Security | The list in 10.6 | `unit` + `db` |
| TE-7 | Concurrency | Parallel entry numbers, the idempotency race, double check-in, concurrent sign-in, the counter race (50 parallel wrong codes ⇒ the count never exceeds 5, through the real wrapper) | `db` |
| TE-8 | Load | Section 8.8 with k6 (approval) | `tests/load` |

**Rules:**
- High-risk work is written tests first (MASTER 6.3).
- Tests never touch dev data. Owner credentials for tests come from `db/.env.local` through a test helper (`process.loadEnvFile`), never from `web-app/.env.local`.
- Tests never break other sessions' builds (LESSONS 7). No existing test is dropped when files move: the gate prints the count and it never goes down.

### 10.2 Running TypeScript outside Next: the `server-only` hook (verified)

The npm `server-only` package is not installed. Next resolves the name itself. Tests, the worker and the command-line tools register this hook first.

```ts
// web-app/src/server/lib/node-hooks/register.ts   (the ONE file in src/server without import "server-only")
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Outside the Next bundler "server-only" does not resolve (Next aliases it internally; the npm copy throws).
// Tests, the worker and the db CLIs start with:  tsx --import ./src/server/lib/node-hooks/register.ts ...
const EMPTY = pathToFileURL(path.join(__dirname, "empty.cjs")).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: EMPTY, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
```

`empty.cjs` holds one comment line. `registerHooks` needs `@types/node` ^24 (bump it to match Node 24).

### 10.3 Scripts (`web-app/package.json`; a shared file, so it changes with the Lead's OK)

```json
"test": "node --test tests/*.test.ts && npm run test:server",
"test:server": "tsx --import ./src/server/lib/node-hooks/register.ts --test \"tests/server/unit/**/*.test.ts\"",
"test:db": "tsx --import ./src/server/lib/node-hooks/register.ts --test --test-concurrency=1 \"tests/server/db/**/*.test.ts\" \"tests/server/isolation/**/*.test.ts\" \"tests/server/golden/**/*.test.ts\" \"tests/server/contract/**/*.test.ts\"",
"typecheck": "tsc --noEmit",
"check": "npm run typecheck && npm run lint && npm run lint:sql && npm run seeds:check && npm test && npm run test:db",
"db:setup": "tsx --import ./src/server/lib/node-hooks/register.ts src/server/db/cli/setup.ts",
"db:migrate": "tsx --import ./src/server/lib/node-hooks/register.ts src/server/db/cli/migrate.ts",
"db:create-hotel": "tsx --import ./src/server/lib/node-hooks/register.ts src/server/db/cli/create-hotel.ts",
"db:unblock": "tsx --import ./src/server/lib/node-hooks/register.ts src/server/db/cli/unblock.ts",
"worker": "tsx --import ./src/server/lib/node-hooks/register.ts src/server/jobs/worker.ts"
```

`lint:sql`, `seeds:check` and `lint:db` stay as they are. `db:cli` goes when its commands move (DB-22).

### 10.4 Wrapper acceptance tests (verified: 14 of 14 pass, no database needed)

The 10 database tests that also passed (section 0.2) cover: list through session → permission → hotel → READ ONLY; create with Pallav columns, the system-log row and trace id, replay and reused key; Pallav's depositor and date messages; a part revoke on `revenue.hotel` that stops Hotel saves only; the same key on a different path id; `failAfterCommit` keeping a counter; rate limits counted in PostgreSQL; another hotel's custom role refused by the trigger and ignored by the session query; a backend ended mid-transaction without killing the process; a block ending the session. They move into `tests/server/db` in step 7.

<!-- verified: tests/wrapper.test.ts -->
```ts
// tests/server/unit/route-wrapper.test.ts: acceptance tests for the wrapper. No database needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { GET as notFoundGet, POST as notFoundPost } from "@/app/api/[[...path]]/route";
import { GET as live, PUT as livePut } from "@/app/api/v1/health/route";
import { DUMMY_HASH, passwordNeedsRehash, verifyPassword } from "@/server/auth/password";
import { loadConfig, resetConfigCache, scriptOnlySecretsPresent } from "@/server/config/env";
import { AppError } from "@/server/errors";
import { ipBucket } from "@/server/http/client-ip";
import { failAfterCommit, hotelRoute, publicRoute } from "@/server/http/route";

process.env.LOG_LEVEL = "silent";
delete process.env.DATABASE_URL;
resetConfigCache();

const echo = publicRoute({ name: "t.echo", body: z.strictObject({ n: z.number().int() }), handler: async ({ body }) => ({ twice: body.n * 2 }) });
const boom = publicRoute({ name: "t.boom", handler: async () => { throw new Error("db password leaked? no"); } });
const guarded = hotelRoute({ name: "t.guarded", permission: { key: "revenue", level: "view" }, handler: async () => "never" });
const create = hotelRoute({
  name: "t.create", permission: { key: "revenue", level: "create" }, idempotent: true, status: 201,
  body: z.strictObject({ amountPaise: z.number().int().min(1) }), handler: async () => "never",
});
const limited = publicRoute({ name: "t.limited", limits: (_inputs, ip) => [{ key: `t:${ip}`, max: 30, windowSeconds: 60 }], handler: async () => "never" });
const refused = publicRoute({ name: "t.refused", handler: async () => failAfterCommit(new AppError("INVALID_CODE", undefined, { attemptsLeft: 4 })) });
const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
const bearer = { authorization: "Bearer hms_m_abcdefghijklmnopqrstuvwxyz0123456789" };
const codeOf = async (res: Response): Promise<string> => ((await res.json()) as { error: { code: string } }).error.code;

test("liveness answers { data } with no-store and a trace id", async () => {
  const res = await live(new Request("http://localhost/api/v1/health"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.ok(res.headers.get("x-trace-id"));
  assert.deepEqual(await res.json(), { data: { status: "ok" } });
});

test("unknown API path (and bare /api) is a JSON 404 with a traceId", async () => {
  for (const url of ["http://localhost/api/v1/nope", "http://localhost/api"]) {
    const res = await notFoundGet(new Request(url));
    const body = (await res.json()) as { error: { code: string; traceId: string } };
    assert.equal(res.status, 404);
    assert.equal(body.error.code, "NOT_FOUND");
    assert.ok(body.error.traceId);
  }
});

test("a method the route does not serve is a JSON 405, not Next's empty one", async () => {
  const res = await livePut(new Request("http://localhost/api/v1/health", { method: "PUT" }));
  assert.equal(res.status, 405);
  assert.equal(await codeOf(res), "METHOD_NOT_ALLOWED");
});

test("a thrown bug is a JSON 500 that leaks nothing (never Next's empty 500)", async () => {
  const res = await boom(new Request("http://localhost/x"));
  const text = await res.text();
  assert.equal(res.status, 500);
  assert.ok(!text.includes("password"));
  assert.equal((JSON.parse(text) as { error: { code: string } }).error.code, "SERVER_ERROR");
});

test("JSON body: parsed, strict, capped, typed", async () => {
  assert.deepEqual(await (await echo(new Request("http://localhost/x", json({ n: 4 })))).json(), { data: { twice: 8 } });
  assert.equal((await echo(new Request("http://localhost/x", json({ n: 4, hotelId: "x" })))).status, 422);
  const form = await echo(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "n=4" }));
  assert.equal(form.status, 415);
  assert.equal((await echo(new Request("http://localhost/x", json({ n: 1, pad: "x".repeat(300_000) })))).status, 413);
  assert.equal((await echo(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }))).status, 400);
});

test("cross-site browser write is refused; a native app (no Origin, no cookie) passes the origin check", async () => {
  assert.equal(await codeOf(await notFoundPost(new Request("http://localhost/api/v1/x", { method: "POST", headers: { origin: "https://evil.example" } }))), "FORBIDDEN");
  const cookieNoOrigin = await notFoundPost(new Request("http://localhost/api/v1/x", { method: "POST", headers: { cookie: "__Host-hms_session=abcdefghijklmnopqrstuvwxyz" } }));
  assert.equal(cookieNoOrigin.status, 403);
  assert.equal((await notFoundPost(new Request("http://localhost/api/v1/x", { method: "POST" }))).status, 404);
});

test("no token: 401 SESSION_EXPIRED before any database work; a huge or malformed credential counts as no token", async () => {
  assert.equal(await codeOf(await guarded(new Request("http://localhost/x"))), "SESSION_EXPIRED");
  assert.equal((await guarded(new Request("http://localhost/x", { headers: { cookie: `__Host-hms_session=${"a".repeat(10_000)}` } }))).status, 401);
  assert.equal((await guarded(new Request("http://localhost/x", { headers: { authorization: "Basic abc" } }))).status, 401);
});

test("hotel route without a database answers 503 JSON, not a hang or an empty 500", async () => {
  const res = await guarded(new Request("http://localhost/x", { headers: bearer }));
  assert.equal(res.status, 503);
  assert.equal(await codeOf(res), "SERVICE_UNAVAILABLE");
});

test("idempotent create without an Idempotency-Key is refused before any database work", async () => {
  const res = await create(new Request("http://localhost/x", json({ amountPaise: 50_000 }, bearer)));
  assert.equal(res.status, 422);
  const body = (await res.json()) as { error: { code: string; details: { fields: Record<string, string> } } };
  assert.equal(body.error.code, "VALIDATION_FAILED");
  assert.ok(body.error.details.fields["Idempotency-Key"]);
});

test("rate limits run before the handler (no database here: 503, never the handler's answer)", async () => {
  assert.equal(await codeOf(await limited(new Request("http://localhost/x"))), "SERVICE_UNAVAILABLE");
});

test("failAfterCommit answers the error with its details", async () => {
  const res = await refused(new Request("http://localhost/x"));
  const body = (await res.json()) as { error: { code: string; details: { attemptsLeft: number } } };
  assert.equal(res.status, 401);
  assert.equal(body.error.code, "INVALID_CODE");
  assert.equal(body.error.details.attemptsLeft, 4);
});

test("rate-limit buckets: IPv4 as is, IPv6 by /64, mapped IPv4 as IPv4", () => {
  assert.equal(ipBucket("203.0.113.9"), "ip:203.0.113.9");
  assert.equal(ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "ip:2001:db8:1:2::/64");
  assert.equal(ipBucket("2001:db8:1:2::1"), "ip:2001:db8:1:2::/64");
  assert.equal(ipBucket("2001:0db8::1"), "ip:2001:db8:0:0::/64");
  assert.equal(ipBucket("::ffff:203.0.113.9"), "ip:203.0.113.9");
  assert.equal(ipBucket(null), "ip:none");
});

test("production config: https origins only; owner URLs count as script-only secrets", () => {
  const base = { NODE_ENV: "production", TRUST_PROXY: "1", DATABASE_URL: "postgres://x", HMS_DATA_KEYS: "k1:" + Buffer.alloc(32, 1).toString("base64"), HMS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"), HMS_BLIND_INDEX_KEY: Buffer.alloc(32, 3).toString("base64") };
  assert.throws(() => loadConfig({ ...base, APP_ORIGINS: "http://app.example.in" }), /APP_ORIGINS/);
  assert.equal(loadConfig({ ...base, APP_ORIGINS: "https://app.example.in" }).APP_ORIGINS, "https://app.example.in");
  assert.deepEqual(scriptOnlySecretsPresent({ TEST_DATABASE_OWNER_URL: "postgres://o", DATABASE_URL: "postgres://a", PGSUPERUSER_URL: "" }), ["TEST_DATABASE_OWNER_URL"]);
});

test("password check: dummy hash matches the options; a bcrypt hash is never a match and costs a full verify", async () => {
  assert.equal(passwordNeedsRehash(DUMMY_HASH), false);
  const t0 = performance.now();
  assert.equal(await verifyPassword("$2y$10$abcdefghijklmnopqrstuuMVvF8E4Z9H3Yt4P5cYb1o0dXxwz0yW2", "x"), false);
  assert.ok(performance.now() - t0 > 5, "a bcrypt string must still run one argon2 verify");
  assert.equal(await verifyPassword(null, "anything"), false);
});
```

### 10.5 Isolation suite (MUST run on every build)

With hotels A and B in `hms_test`:

1. Through the real handlers, A's user calls GET, PATCH and DELETE on B's object ids (copied verbatim) → 404 every time.
2. List, search, count, export and report in A never contain B's rows.
3. Inside A's transaction, a schema-qualified `hotel_B.table` → `permission denied`.
4. `hms_app` with no role switch reads no hotel table, cannot `SET ROLE hms_owner`, cannot run DDL, cannot create temp tables, and cannot UPDATE or DELETE audit rows (platform and hotel `system_logs`).
5. After COMMIT **and** after an error, the connection reports `current_user = hms_app`, `search_path = pg_catalog`, `TimeZone = UTC`.
6. A connection whose ROLLBACK failed, or whose backend was ended mid-transaction, is destroyed, not reused, and the process stays up.
7. A session for A with B's id in the URL, body or header (or a forged affinity hint) is still served as A.
8. A job created inside A carries `hotel_id = A` and cannot use a platform kind or set `hotel_id`/`dedupe_key`.
9. The drift check fails on a hotel schema changed by hand (including grants).
10. A route registry test fails if any `route.ts` exports a method not built with the wrappers or `methodsNotAllowed`, or a hotel route that has no isolation test.
11. SE-4b: a hotel admin of A cannot edit a built-in role, cannot set `users.role_id`, cannot give B's custom role in A, cannot set the password of a user who also belongs to B; another hotel's role assigned by hand is ignored by the session query.
12. Documented limit (DB-4b): `SET LOCAL ROLE hotel_<B>_rw` inside A succeeds today. The test asserts that, so any future guard shows up as a change.

### 10.6 Security tests (MUST exist before the auth routes ship)

- **Enumeration:** unknown user vs wrong password: same body and status; latency within ±20 %. With Q2(b) on: forgot password and resend give the same body for real, unknown, emailless and cooling-down users, within the same latency band.
- **Races:** 50 parallel wrong passwords or codes through the real route ⇒ the attempt count is never above 5 and every attempt is committed.
- **Brake:** 19 failures + 1 success + 1 failure from one address ⇒ 429 (the success clears nothing).
- **Shared address:** 40 successful sign-ins from one address in 15 minutes ⇒ no 429.
- **Sessions:** web replaced → `SESSION_REPLACED`; phone tokens survive a web sign-in; a second sign-in on the same device replaces its token; two parallel web sign-ins → one live session, no 409; a password change revokes everything; idle web over 120 min → `SESSION_EXPIRED`; blocked → `ACCOUNT_LOCKED` (and with Q2(f) on, an auto block keeps live sessions).
- **CSRF:** a wrong or missing Origin with a cookie → 403.
- **Mass assignment:** an extra key → 422.
- **Size:** body cap → 413; content type → 415.
- **SQL injection:** hostile input on every search, sort and filter; the SQL-text grep test.
- **Webhook:** a bad signature is neither stored as an event nor deduplicated.
- **Logs:** no token, code, password or cookie in any log line (logger test).
- **Dev safety:** the dev server starts with no `DATABASE_URL`, with a broken optional key, and with an owner URL in `web-app/.env.local` (it logs an error and keeps serving pages).
- **Build check:** in the separate-copy build, the route table shows every `/api` route as `ƒ` (dynamic).

### 10.7 Gate (run before every report; it becomes the CI job once git and CI are approved)

1. `npm run check` in `web-app`. Paste the test count (it never goes down).
2. `next build` in a **separate copy** of the HMS folder (outside the folder the dev server watches; `node_modules` installed there), with `NODE_ENV=production`. Never inside the shared `web-app`, with any distDir (NX-19).
3. Paste the output into the report.

---

## 11. Review of the current state (2026-10-05)

### What is already good (keep it)

- **Migration runner** (`db/scripts/migrate.ts`): lock, checksums, all hotels checked first, per-file transactions, rollback notes, dry run.
- **SQL lint** (`db/scripts/lint-sql.ts`): uuid primary keys, timestamps, FK indexes, money types, qualified names, grants, legacy_id, soft delete.
- **create-hotel** (`db/scripts/create-hotel.ts`): already gives every hotel its own `hotel_<hex>_rw` role that `hms_app` can only SET into; all-or-nothing with a compensating clean-up.
- **Hotel template:** all 67 Pallav tables, with documented deviations.
- **Crypto module:** AES-GCM with key ring and context, HMAC with domain labels, blind index, `maskLast4`.
- **Logger** with redaction by key and by value.
- **`money/paise.ts`** with exact PHP rounding, plus PHP-generated fixtures.
- **`entryNo.ts`:** a correct PostgreSQL port of `HasEntryNumber`.
- **Seeds:** the real Pallav permission list and roles, generated and checked.
- **Hygiene:** root `.gitignore`; the env validation pattern; about 315 unit tests.

### Problems

| # | Severity | Where | Problem | Fix |
|---|---|---|---|---|
| 1 | Critical | `MASTER.md` §3, §4.1, §4.2, §6.1 step 4, §7, §12 | Still says "one schema + RLS", "TOTP, 15-min access and 7-day refresh tokens", "sign in with mobile or email". MJ decided one schema per hotel and Pallav's login. MASTER says to stop on any conflict. | MJ approves the rewrite (Q1); the Lead edits MASTER. |
| 2 | Critical | `Mobile App/src/auth/api.ts` L4, L10 | The auth mock is imported statically: a release build would accept the demo password. | Mobile/Lead: lazy `require` behind `__DEV__`; the real client otherwise. |
| 3 | Critical | ui-shared: `cash.ts` (actor on every create, update and delete, e.g. L1096–1363), `overview.ts` (`role`), `payrollCore.ts` (`isAdmin`, `sentBy`), `corporate.ts` (`bookedBy`), `companies.ts` (`setActor`), `payrollPay.ts` (actor) | Identity and admin rights come from the client: privilege escalation and forged audit. | Lead removes them before each module ships (AP-12). The server takes identity from the session. |
| 4 | High | `0099_grants.sql` L17-23 with `0002` L11 and `0003` L15-16 | `hms_app` may write global users, roles, role grants and memberships; nothing scopes a hotel admin's writes to that hotel, and a custom role of hotel B set as `users.role_id` would apply in hotel A. | SE-4b in services, the two triggers and the session-query check (7.9, 4.2.7; tested). |
| 5 | High | `src/db/withHotel.ts` (and the first draft of `tx.ts`) | No error listener on the checked-out client: when PostgreSQL ends the backend mid-transaction (idle or transaction timeout, restart, network reset), pg emits "error" and Node kills the whole process (reproduced on pg 8.23.1). | `tx.ts` in 4.2.5 (listener, client query timeout, destroy broken clients; tested). |
| 6 | High | `db/migrations/platform/0004_auth.sql`, `docs/DATABASE.md`, `docs/SECURITY.md` | Built on the old refresh-token model (family, rotation, reuse detection, invites, `auth_codes`, `login_attempts`). `sessions_one_active_per_user_key` covers web **and** mobile, against Pallav. | Never applied: edit in place to section 7.9. Update both docs. |
| 7 | High | `platform.users` (0003) | `failed_attempts` + `locked_until` only. Pallav also blocks with no timer (`blocked_at`) and has code-send and cooldown counters. | The 7.9 columns; the 5th miss sets `blocked_at`, `blocked_kind='auto'` (until Q2). |
| 8 | High | `platform.users.password_hash` CHECK `^\$argon2id\$`; ruling Q1 (`DATABASE.md` L218-220) | Imported users get a placeholder and `status='invited'`, which Pallav's forgot-password flow does not know. | Use `status='active'` + `must_change_password` (SE-19); Q3 for keeping old passwords. |
| 9 | High | `db/scripts/create-hotel.ts` L95-101 | Default privileges grant DELETE on every hotel table (MASTER 4.4 wants no hard delete of money/booking rows); no `hms_tenant` membership, no `hms_worker` grant, no `provisioning` status or `schema_version`. | Section 7.2 and DB-7b grant sync. |
| 10 | High | `web-app/.env.example` L20-25; `db/scripts/setup-db.ts` L136-139, `cli.ts` L16, `env-store.ts` | Script-only secrets (superuser and owner URLs) are written to and read from `web-app/.env.local`, which Next loads into the web server. | DB-22: `db/.env.local`; boot refuses them in production and logs in development (tested). |
| 11 | High | `platform.user_permissions` (0003) | No `hotel_id`: a grant or revoke made in one hotel would apply in all of them. | 7.9 (tested). |
| 12 | High | `ui-shared/auth/types.ts` | Still the S02 login (TOTP, recovery codes, invites, tokens in URL paths, refresh tokens). | The Lead rewrites it to Pallav's flows (SE-7…SE-15) after MJ confirms the screens. |
| 13 | High | Hotel template (`db/migrations/hotel/*`) | 68 tables with 330 indexes ≈ 508 relations per hotel; a backend that touches all of a hotel's tables keeps ≈ 2.4 MB of catalog cache per hotel (measured). Random balancing across many hotels would exhaust database memory. | Hotel affinity before ~100 hotels, ≤ 300 hotels per database server, index review (SC-14…SC-15b). |
| 14 | High | Pallav `StayController.php` L94-98 vs L107 | "Room free" is checked outside the transaction: two guests can be checked into one room. | DB-37 partial unique index, with Pallav's message. |
| 15 | High | Pallav `RazorpayWebhookController.php` L26-49, L78 | Dedupe before signature check; float rupees; refund double count. | SE-31. |
| 16 | High | Pallav `MediaController.php`, `Media.php` | ID proofs on the public disk; `/media` checks no permission. | SE-30. |
| 17 | High | Pallav `Auth/AuthController.php` L68-96, L351-365, L460-543; `OneTimeCode.php` | Read-then-save counter races; "locked" shown before the password; success clears the per-address brake; anyone can block any username with no timer (and so sign its owner out); reset answers reveal whether a username exists; reset codes allow about 875 guesses per user per month. | SE-7, SE-11 now (defect fixes); Q2 (a)(b)(c)(f) for the visible changes. |
| 18 | High | Pallav `RequireSuperAdmin.php` L15 | The SuperAdmin-only screens (secrets, backups, keys, logs) are gated by the **grantable** `masters.view`. | Port as is; parked for MJ (section 15). |
| 19 | Medium | `web-app/next-env.d.ts` L3-4, `tsconfig.json` L41-42 | A backend build in the shared folder already rewrote them to a deleted `.next-be` folder (tsc still passes: unresolved side-effect imports are ignored). | Restore the `.next` form with the Lead's OK; separate-copy builds only (NX-19). |
| 20 | Medium | `src/server/**`, `src/db/**` | No `import "server-only"`; server tests run without the hook. | Step 1. |
| 21 | Medium | `src/app/api/v1/health/route.ts` | `export const dynamic = "force-dynamic"`; raw data, not `{data}`; reveals uptime, time and database configuration. | Section 4.2.12. |
| 22 | Medium | `src/server/http/respond.ts` | No `{data}` envelope; only `cache-control`; no wrapper yet (an uncaught throw → empty-body 500). | Sections 4.2.8–4.2.9. |
| 23 | Medium | `src/server/errors/codes.ts` + `ui-shared/dashboards/common.ts` | Two code lists. Dashboards lack `SESSION_*` and `RATE_LIMITED`. No 400/405/413/415/503 codes. `NETWORK_OFFLINE` used as a server 503. | `ui-shared/errors.ts` (Lead) + section 4.2.2; UI aliases later (4.2.1). |
| 24 | Medium | `src/server/config/env.ts` | `DB_POOL_MAX` default 20 (max 100); no production-required keys; no `APP_ORIGINS`, `TRUST_PROXY`, body cap, timeouts or argon2 caps. | Section 4.2.3. |
| 25 | Medium | `next.config.ts` | No standalone output, tracing root, `deploymentId`, page CSP, `/api` no-store or production `compress` setting; `NEXT_DIST_DIR` invites in-place builds. | Section 3.7. |
| 26 | Medium | `eslint.config.mjs` | Only `no-console`; no layer or transaction boundaries. | Section 3.8. |
| 27 | Medium | `package.json` | `pg`, `argon2`, `nodemailer` not installed (the wrapper imports the DB layer); `@types/node` ^20 on Node 24; no `engines`; no `@types/pg`; `test:server` would skip tests if its glob changed carelessly. | Steps 0–1. |
| 28 | Medium | `db/scripts/setup-db.ts` L81-83 | `statement_timeout 15s`, `lock_timeout 5s`; no `transaction_timeout`, `hms_worker`, `hms_tenant` or memory-context grant. | Section 7.1. |
| 29 | Medium | `db/scripts/migrate.ts` | No `lock_timeout` + retry, no `schema_version` mirror, no grant sync, no drift or privilege check, no timings. | DB-17…DB-22b. |
| 30 | Medium | `platform.hotels` (0001) | No `provisioning` status; no `schema_version`; no `db_cluster`. | Section 7.9. |
| 31 | Medium | Hotel audit | The first draft added a second hotel audit table next to Pallav's `system_logs`. | One channel: `system_logs` + `trace_id` (decision 29). |
| 32 | Medium | `ui-shared/index.ts` L6 | Re-exports `auth/mock` (demo passwords) from the barrel. | Lead removes it. |
| 33 | Medium | `ui-shared/dashboards/common.ts` (`ListQuery`) | `sort` is free text; `pageSize` is unbounded. | The server whitelists and caps (AP-7). The Lead types the enums later. |
| 34 | Medium | ui-shared helpers (`GUEST_TODAY`/`MOCK_TODAY` defaults, GST % and plan rates as constants, float percentages) | Production states and amounts would be wrong or forgeable. | The server computes states, totals and rates (AP-8, AP-9). The Lead removes the defaults. |
| 35 | Medium | ui-shared contracts | 13+ `toggleX(id)` commands; nullable-id upserts; unbounded arrays (`LedgerOverview.all`, `periodLines`, `listBookings()`); list totals recomputed on every page. | Lead: target state, POST + PATCH, paging or export jobs, totals with page 1 (AP-2, AP-7). |
| 36 | Medium | `ui-shared/auth/types.ts` `AUTH_ENDPOINTS` | Reset and invite tokens in URL paths. | Remove with the Pallav rewrite; secrets only in POST bodies. |
| 37 | Medium | HMS root | Not a git repository: no rollback, no diff review. | MJ approves a local `git init` (R9 still applies). |
| 38 | Low | `src/db/*`, `src/server/data/*` | Database code outside `src/server`; a `data/` folder instead of `repos/`. | The moves in section 2. |
| 39 | Low | `docs/DATABASE.md` | The whole document appears twice (the second copy starts at L253). | Remove the duplicate when rewriting it (step 10). |
| 40 | Low | `docs/API.md` | Says success bodies are "the data itself". | Update to `{ "data": T }`. |
| 41 | Low | `S04-backend-phase1-foundation.md`, `S04-backend-pallav-port.md` | Three stacked status notes; old sizes; "no subagents" for high-risk work with no review gate. | One status line at the top; this standard is the review gate (section 13). |

---

## 12. Libraries and infrastructure that need MJ's approval (R11)

| Item | Why | Without it | Recommendation |
|---|---|---|---|
| Install `pg`, `argon2`, `nodemailer` (approved) | The wrapper and the DB layer import them | Nothing can run against a database | **START** (Lead OK for `package.json`/lock) |
| `@types/pg`, `@types/nodemailer` (dev, types only) | TypeScript strict refuses `pg`/`nodemailer` without types | Hand-written stubs (error-prone) | **Approve now** |
| `@types/node` ^24 (version bump) | Node 24 APIs (`registerHooks`) | Casts in test setup | Approve |
| `tsx` as a runtime dependency | Worker and CLIs run TypeScript in production, from the release folder | A bundler for the worker (another tool) | Approve |
| A separate worker process (systemd) | Jobs, outbox, schedules (MASTER 3 forbids "any separate backend server" without MJ's OK) | Jobs inside web processes (N copies) | **Approve** |
| nginx + certbot | TLS, HSTS, limits, slow clients, trusted client IP, affinity, static files for version skew | Exposing `next start` directly: not acceptable | **Approve before production** |
| systemd units | Several web processes + worker, graceful stop, root-only secret file | PM2 (a new tool) | Approve (built into Ubuntu) |
| Second VPS for PostgreSQL, third VPS as a streaming standby | CPU/cache isolation at peak; failover | One VPS: latency spikes and a single point of failure | Approve before the load test (Q4) |
| Email provider (SMTP relay) + SPF, DKIM, DMARC on the domain | Sign-in codes must arrive in seconds at shift change | Codes land in spam or late | Decide before the login phase |
| k6 (load-test binary) | Prove the 10k-user target | `autocannon` (npm dev package) | Approve k6 |
| `pg_stat_statements` (+ `auto_explain`) | Slowest and most frequent queries (one entry per SQL across hotels on 18.6) | Slow-query log only | Approve (ships with PostgreSQL) |
| `pg_trgm` | `contains` search on big lists | Prefix search or a scan bounded by the window | Decide per module |
| Backup encryption (`age` or GnuPG, system package) | Encrypted dumps and WAL off the server | Plain backups (not acceptable) | Decide at the ops phase |
| Local `git init` (no push) | Rollback, diffs, review | None | Approve |
| `bcryptjs` (import period only) | Imported Pallav passwords keep working, then are re-saved as argon2 | Forced reset by emailed code (ruling Q1) | **Q3** |
| `expo-secure-store` (mobile) | The 90-day token and the device id must live in Keychain/Keystore | AsyncStorage: not acceptable | Approve for the mobile auth phase |
| PgBouncer | When connections pass the budget or a second app server appears | Fewer processes or a bigger database | Not now; decide from load-test numbers |
| PDF engine (`puppeteer-core` + system Chromium, or `@react-pdf/renderer`) | Pallav's PDFs (slips, letters, receipts, ledgers), attachments | Browser print (no attachments) | Decide at the payroll/billing phase |
| `sharp` | Pallav image compression, EXIF strip | Store as uploaded | Decide at the uploads phase |
| `sanitize-html` | Pallav rich text allow-list | A hand-written sanitizer (risky) | Decide at the handover/letters phase |
| Zip writer (`yazl`) or the system `zip` | Pallav backup archive | `pg_dump -Fc` + system `tar` | Decide at the backup phase |
| Captcha / bot protection | Public forms beyond Pallav's honeypot and limits | Limits only | Later (P2) |
| Monitoring stack (exporters + dashboards, or a hosted service) | Alerts in OP-11 | Logs + System Health | Later |
| OpenTelemetry | Distributed tracing | JSON logs + traceId | Later (P2) |
| **Not requested** | Redis, an ORM, the `server-only` package, cron or rate-limit libraries, the Razorpay SDK, `googleapis` | Built-ins cover them (`node:crypto`, `fetch`, `Intl`, PostgreSQL) | — |

---

## 13. Ordered build plan for Backend 1 (Phase 1)

The Backend master reviews every step against sections 3–10 and section 14 before the next one starts. Each step ends with a short report: what changed, the gate output (section 10.7, with the test count) and open questions. No commit or push (R9). No UI files.

| Step | Work | Done when |
|---|---|---|
| **0. Gates** (no code) | MJ: START + answer Q1; approve `@types/pg`. Lead: OK to install `pg`, `argon2`, `nodemailer`, `@types/pg`; add `ui-shared/errors.ts` (that file only, 4.2.1); give this standard to Backend 1; approve the shared-file changes of steps 1–2 (`package.json`, lock, `next.config.ts`, `eslint.config.mjs`, `tsconfig.json`/`next-env.d.ts` restore, `.env.example`). | A written "go" in the session file |
| **1. Align the skeleton** (no database) | Install the packages. `import "server-only"` first in every `src/server` file; add `lib/node-hooks`; scripts (10.3); `@types/node` ^24 and `engines` (`node >=24`). Move all of `tests/server/*.test.ts` to `tests/server/unit/` and `tests/db` to `tests/server/isolation/`. Moves from section 2. `env.ts`, `codes.ts`, `AppError.ts`, `respond.ts` as in section 4. Script-only names to `db/.env.example`; `env-store`/`setup-db`/`cli` write owner and superuser values to `db/.env.local`. Restore `next-env.d.ts` to `.next` and drop the `.next-be` includes. | `tsc --noEmit`, `npm run lint` and the tests green, with no fewer tests than before. A test proves the `server-only` first line. `web-app/.env.example` has no script-only name. |
| **2. Wrapper and everything it imports** (compiles and runs without a database) | `http/*`, `lib/request-context`, `db/{types,pool,tx,schemaName,schema-version,pg-errors,health}`, `auth/{policy,permissions,permission-keys (generated),session,tokens,password}`, `repos/{idempotency,rate-limit,system-log,sql,entryNo}`, the health routes, `[[...path]]`, `boot.ts`, `instrumentation.ts`, `next.config.ts` (3.7), the ESLint block (3.8) and its planted-violation test, the SQL-text grep test. | The 14 tests of section 10.4 green. A test that `onRequestError` never logs headers. The Lead confirms the shared dev server still starts with no `DATABASE_URL`, with a broken optional key and with the CSP on. |
| **3. Platform SQL to the Pallav model** (text only) | Edit `0003`/`0004`/`0005` in place (never applied) and add `0007_jobs_and_limits.sql` and the grants (section 7.9). Lint support for `-- no-standard-columns` on platform tables. | `lint:sql` and `seeds:check` green; the master has reviewed the diff |
| **4. Database setup** (needs MJ to put `PGSUPERUSER_URL` in `db/.env.local`) | `src/server/db/cli/setup.ts`: databases `hms_dev` and `hms_test`; roles and settings as in section 7.1; platform migrations and seeds. | Role-limit test green (no DDL, no TEMP, no hotel schema, no `SET ROLE hms_owner`); `boot()` role check passes |
| **5. create-hotel + hotel template guards** | `create-hotel` as section 7.2 (provisioning, `hms_tenant`, worker grant, no default DELETE); grant sync from table markers (DB-7b); the hotel additions (`forbid_change`, `system_logs.trace_id`, `idempotency_keys`, covering indexes, `version` columns). | Tests: role, search_path and TimeZone reset after COMMIT and after an error; a broken connection is destroyed; a backend ended mid-transaction does not crash the process; two hotels exist in `hms_test`. |
| **6. Isolation suite** | All of section 10.5 except the route registry. | Green inside `npm run check` |
| **7. Auth core** (no login screens yet) | `session.ts`, permissions (5 levels, part inheritance, revoke, any-of, input-based need), idempotency, `failAfterCommit`, rate limits, the 10 database tests of section 10.4 moved in. Test-only routes and sessions made by a helper. | `SESSION_*`, `ACCOUNT_LOCKED` (both `blockEndsSessions` settings), READ ONLY GET, the idempotency race (one 201, one replay) and the params-hash case all green |
| **8. Finish the runner** | DB-17…DB-22b; dry-run report with per-schema timings. | A second run does nothing; the drift test fails on a hand-altered hotel (columns or grants) |
| **9. Hotel template review** | The 67 tables exist. Add `-- hard-delete:` markers, `version` columns, covering indexes for list totals; review indexes against the relation budget (SC-15b). | SQL lint + drift + FK-index checks green; the isolation suite covers every table |
| **10. Readiness, measurements, docs** | `/health/ready`, pool stats with `cacheMb` and event-loop delay, slow-query log. Benchmark one standalone process (requests/s with the real wrapper). Seed 100 hotels in `hms_test`; measure hold time per route and `cacheMb`. Rewrite `docs/DATABASE.md` (remove the duplicate), `API.md`, `SECURITY.md`, `ENVIRONMENT.md`, `TESTING.md`, `ERROR_HANDLING.md` to this standard. Smoke load: 200 parallel requests across 20 hotels. | No cross-hotel data, no pool exhaustion, p95 < 300 ms on the dev PC; the measured numbers replace the estimates in 8.1. Report to the master and the Lead; MJ sees create-hotel + the isolation tests live. |

**Phase 2 onwards** (each needs MJ's go):
1. Pallav login, after Q2, Q3 and the Lead's contract rewrite (affinity hint and device id included).
2. Modules in MJ's order (Hotel first).
3. The worker and outbox.
4. The import.
5. Integrations.
6. Hotel affinity live before about 100 hotels; the load test (section 8.8, ≥ 500 hotels) before production.

---

## 14. Definition of done for each endpoint

- [ ] Behaviour spec written from the Pallav source (file and line cited); messages copied word for word.
- [ ] Golden tests from Pallav's tests written **first**, and green.
- [ ] `route.ts` holds only wrapper exports with a unique `name`, plus `methodsNotAllowed` for the other methods; no SQL, no try/catch.
- [ ] A hotel route declares `permission` with the right Pallav key (module or part, worked out from the input where Pallav does) and the lowest level. Finer rules re-checked in the service. Tests at all 5 levels, plus a part revoke.
- [ ] Pallav's throttle declared as `limits`; counters that must survive a refusal use `failAfterCommit` (or a committed short transaction on public routes).
- [ ] Strict zod schemas: unknown keys rejected, every string with `.max()`, every number `.int()` with bounds, enums for modes and sorts, page caps, Pallav's window.
- [ ] No identity field (actor, role, hotelId, recordedBy…) in any input.
- [ ] Repo SQL uses only `$n` parameters; ORDER BY from a whitelist; LIKE escaped; no `SELECT *`; no query per row (query count checked in a test).
- [ ] The response is the ui-shared contract type exactly, built by a DTO mapper (contract test). Money in paise as integers, dates as in AP-9, ID numbers masked.
- [ ] Money, booking and payment creates are `idempotent: true`, with a replay test, a different-body test and a different-path-id test.
- [ ] The Pallav `SystemLogger` line (or platform audit row) is written in the same transaction (MASTER 4.4).
- [ ] Known unique constraints map to Pallav's own messages (`isUniqueViolation`).
- [ ] Isolation test: another hotel's id → 404 for every method.
- [ ] Security tests: no session → 401; cross-site → 403; extra key → 422; hostile search and sort.
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` on the seeded large hotel attached: indexes used; DB-33 limits met; window aggregates ≤ 5 ms or sent only with page 1.
- [ ] No network I/O inside the transaction; slow work queued as a job.
- [ ] No caching; `no-store` present (wrapper test).
- [ ] `docs/API.md` row added; `docs/DATABASE.md` updated for any new table or index.
- [ ] The gate (section 10.7) passes; output pasted in the report.
- [ ] Web and mobile switched from mock to real by the Lead and tested together; MJ has seen it live (MASTER section 12).

---

## 15. Open questions for MJ (max 5)

**Q1. Update MASTER.** Approve rewriting MASTER sections 3, 4.1 and 4.2 to the following?
- (a) One PostgreSQL schema per hotel. Each schema can be used only through its own database role. Cross-hotel tests run on every build.
- (b) Pallav's login: username and password, an emailed code, a web session that ends after 120 idle minutes, one web session per user, a 90-day token per phone, no refresh tokens. Platform accounts (Super Admin, Platform Admin) always need the emailed code.

*Recommendation: yes.* Phase 1 cannot finish while MASTER says the opposite.

**Q2. Sign-in safety vs exact Pallav.** Pallav lets anyone who knows a username block that account with no timer (which also signs the owner out), says "locked" before checking the password, tells strangers whether a username exists in forgot-password, and allows about 875 reset-code guesses per account per month. Approve these changes?
- (a) Lock for 15 min → 30 min → 1 h → 3 h → 8 h → 24 h (Pallav's own steps) instead of forever. Admin unlock and reset by email still clear it.
- (b) Never reveal whether an account exists: "Incorrect username or password." until the password is proven; forgot-password and resend always give one answer (no masked email); reset emails go out through the queue so every answer takes the same time.
- (c) Reset codes: 5 wrong answers cancel only that code; after 10 wrong codes in 24 hours, no new reset code for that account for 24 hours (an admin can clear it).
- (d) The emailed code is mandatory for Group and Hotel admins too.
- (e) Changing your email or turning off the emailed code needs your current password.
- (f) A block caused by someone else typing wrong passwords stops new sign-ins only; it does not sign out the owner's open sessions or phones. An admin block still does.
- (g) Email the person when their password is changed or reset, when the account is blocked, and when a new phone signs in.

*Recommendation: yes to all.* Must be answered before the login phase. Until then we build Pallav exactly, behind switches.

**Q3. Passwords of imported Pallav users.** They are bcrypt hashes; our approved library (argon2) cannot check them. The current plan (ruling Q1) is (b). Choose:
- (a) Approve `bcryptjs` for the import period only. Each password is checked once, re-saved as argon2, and the library is removed after 90 days.
- (b) Every imported user resets by emailed code on first sign-in. Users without an email need an admin to set a temporary password.

*Recommendation: (a)*, so staff are not all locked out on the first morning.

**Q4. Production size.** Approve:
- nginx + certbot + systemd + a separate worker process + k6 (section 12);
- three Hostinger VPS in Mumbai: app 8 vCPU / 16 GB, database 8 vCPU / 32 GB, and a standby copy of the database for failover; a private network between them (or encrypted database traffic).

And tell us: about how many hotels in year 1 and year 3? (One database server holds about 300 hotels with our routing; more hotels means more database servers, planned early.)

*Recommendation: approve.*

**Q5. Two people editing the same record.** In Pallav the last save silently wins. Approve a "someone else changed this, reload" check, using a version number on bookings, folios, bills and cash entries?

*Recommendation: yes.* The screens already have this message.

**Parked decisions** (asked before that module starts, not now):
- The Recycle Bin hard-deletes money rows after 30 days (Pallav), but MASTER 4.4 says never. MASTER wins until MJ decides.
- How long audit and sign-in logs are kept (they are append-only; a purge is a deliberate owner action).
- Pallav has no sign-in for the Guest and Corporate portals. Their rules must come from MJ.
- The SuperAdmin-only screens are gated by the grantable `masters.view`.
- "Hotel Pallav" + "Pallav Food": one hotel with two business units (default, as in Pallav).
- A nonce-based page CSP (makes every page dynamic): Lead and UI sessions.

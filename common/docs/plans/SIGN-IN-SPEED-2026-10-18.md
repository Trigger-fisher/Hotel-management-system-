# Sign-in speed: where the time goes and what to change (B, 18 Oct 2026)

MJ: "sign-in is very slow; does it scan every user?"

**No.** The username is found through a unique index (`users_username_key`): one row, about a millisecond. The password check (Argon2id, 19 MiB, t=2) costs about 50–100 ms by design.

The time goes into **distance** and into **waiting for the database many times in a row**.

## 1. Live site, measured from India (read-only)
A non-existent username was used, so no account was touched. Times are after the connection was set up. d3 measured the same.

- **Every API answer carries `x-vercel-id: bom1::iad1::…`.** The request enters Vercel in Mumbai, but the **function runs in Washington DC (iad1)**. `vercel.json` names no region (only the cron/Pathik routes ask for `bom1`).
- **A function with no database work:** about **0.30 s** per request (d3's minimum 0.42 s). That is India ↔ US East and back, before any work.
- **A refused sign-in** (lookup, dummy password check, two limit counters): 0.37–0.48 s.
  - That is only about 0.1 s more than no work at all, so the database is about 10–50 ms from iad1: **probably in the US too**.
  - The Neon project made through Vercel on 11 Oct was "US East 1, wrong region", and nothing records that it was recreated near India.
  - **MJ, please check:** Vercel > Settings > Environment Variables > `DATABASE_URL`, look at the host only. `…us-east-1.aws.neon.tech` means US East; `ap-southeast-1` is Singapore; `ap-south-1` is Mumbai.
- **Spikes:** 2.5–3.3 s now and then (cold starts: a new function instance and a new database connection), and once a 30-second hang with no answer.

## 2. The code: what one sign-in does, before and after
Measured through the real route file on the throwaway test database, counting every statement. "50 ms each" simulates a database in another region (for example Neon in Asia with the function in iad1, or the reverse).

| | before | after |
|---|---|---|
| Database statements | 32 | 22 |
| Transactions | 5 | 2 |
| Database waits one after another | about 37 | about 15 (the two limit counters at once; the food-name read overlaps the session writes; the limit clear after the answer) |
| Time with the database next door | 52–66 ms | 51–62 ms (the password check dominates) |
| **Time at 50 ms per statement** | **1.9–2.0 s** | **1.0–1.1 s** |

What changed (no rule changed):
- The two limit counters are kept at the same time (`http/wrapper.ts`); a request the first limit refuses now also counts on the second (slightly stricter).
- The user lookup is one SELECT without a transaction around it (`PlatformUnit.read`).
- Everything after the right password is ONE transaction: the wrong-try count reset (still kept when the account is then refused) and the access read once (it was read twice).
- The hotel's food-business name is read on its own connection while the session is written, not after.
- The per-address counter is cleared after the answer has gone (`after()`).
- Unchanged: the lock rules (attempts counted under FOR UPDATE), the dummy password check for an unknown name (timing reveals nothing), and every event and audit row.

**The page.**
- Before, the sign-in form waited for `GET /auth/session` even when the browser had no session cookie at all: one more full India ↔ US request, about 0.3 s, and a few seconds on a cold start.
- Now the server render tells the app there is no session and the form shows at once.
- The dashboard code downloads while the person types, so it is ready when the sign-in answers. This costs that download on every view of the sign-in page (bandwidth on mobile data), even for someone who leaves without signing in.

## 3. Infrastructure: MJ's decisions, biggest gain first
**1. Put the function and the database in the same place, near India.**
- If the database is in **US East** (what the timings suggest), there are two ways, in order of gain:
  - **(a) Best: move both to India.** Recreate the Neon project in **AWS Mumbai `aws-ap-south-1`** (Neon lists it) or Singapore `aws-ap-southeast-1`, move the data (the hosted-SQL export and import), and set the functions to **`bom1`**: `"regions": ["bom1"]` in `web-app/vercel.json`, or Project Settings > Functions > Function Region.
    - **Expected:** about 0.25 s less on EVERY request from India. Opening the site, signing in and the first dashboard reads are 5–8 requests, so **about 1.5–2 s less** on the whole sign-in.
  - **(b) Not this:** moving only the function to `bom1` while the database stays in US East. Each of the ~15 database waits of a sign-in (and of every page) would then cross the ocean (about 0.2 s each): **3 s slower**, not faster.
- If the database is already in **Asia**, set the functions to that region now (`bom1` for Mumbai, `sin1` for Singapore).
  - **Expected:** the ~15 waits of a sign-in drop from about 0.2 s each to a few ms: **about 3 s less**.

**2. Cold starts.**
- Vercel: make sure **Fluid compute** is on (Project Settings > Functions). It reuses warm instances.
- Neon: a compute that has **scaled to zero** takes about 0.3–1 s (sometimes more) to wake on the first query. On a paid Neon plan, set the compute's "Scale to zero" off, or a longer suspend delay, for the production branch. On the free plan it always sleeps after 5 minutes.
- **Expected:** removes the 2.5–3.3 s spikes at the first sign-in after a quiet spell.

**3. Pooled connection.** Use Neon's **pooled** host (`-pooler` in the host name) for `DATABASE_URL` on Vercel. A new serverless instance then reuses PgBouncer's warm connections instead of a fresh TLS handshake and login to Postgres (several waits).

**4. The 30-second hang.** One live sign-in got no answer for 30 s. Vercel's function logs at that time will show whether it waited for a database connection (Neon waking up, or the pool) or hit the function time limit. Worth a look once; it may disappear with 1 and 2.

## 4. Not changed, and why
- The access read is still three SELECTs inside the one transaction (the user and hotel, the role's grants, the person's own grants). Merging them into one query would rewrite the access SQL that every request uses: worth it only if the numbers after the region move still call for it.
- The `login_success` / `session_replaced` events stay inside the sign-in transaction (d3: the trail is written with the session, never later).

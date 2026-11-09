// SECURITY INVENTORY of every non-platform /api/v1 route file (the platform families have their own in platform.superadmin.test.ts). Each route file is walked:
// the permission it declares is read from its source, then the route is called as a stranger, a staff user with nothing, a staff user one level too low,
// a guest and a company account (those two never reach hotel routes), and a fully permitted user of ANOTHER hotel (never a server error on ids it does not own).
// The wrapper refuses before a handler runs, so a refusal writes nothing (tests/server/wrapper.test.ts); hotel A against hotel B by record id is proven
// per family in the module tests (billing, companies, front office, payroll, website, portals), here only that foreign ids never cause a server error.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import type { VerifiedSession } from "../../src/server/auth/session";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import type { Level } from "../../src/server/auth/levels";
import { can } from "../../src/server/auth/permissions";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

type Route = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const LOWER: Record<Level, Level | null> = { view: null, create: "view", edit: "create", full: "edit" };
const ORIGIN = "https://hms.test";

const root = path.join(process.cwd(), "src", "app", "api", "v1");
const files: string[] = [];
const walk = (dir: string): void => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name));
    else if (e.name === "route.ts") files.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/"));
  }
};
walk(root);
const hotelFiles = files.filter((f) => !f.startsWith("platform/"));

interface Declared { method: Method; kind: "public" | "session" | "part"; key?: string; level?: Level }
/** What each exported handler of a route file declares, read from its source text. */
function declared(rel: string): Declared[] {
  const text = readFileSync(path.join(root, rel), "utf8");
  const out: Declared[] = [];
  const parts = text.split(/export const (?=(?:GET|POST|PUT|PATCH|DELETE) = )/).slice(1);
  for (const part of parts) {
    const method = part.slice(0, part.indexOf(" ")) as Declared["method"];
    if (/^(GET|POST|PUT|PATCH|DELETE) = publicRoute[<(]/.test(part)) {
      out.push({ method, kind: "public" });
      continue;
    }
    const part2 = /permission:\s*\{\s*key:\s*"([^"]+)"\s*,\s*level:\s*"(view|create|edit|full)"/.exec(part);
    if (part2) out.push({ method, kind: "part", key: part2[1], level: part2[2] as Level });
    else if (/permission:\s*"session"/.test(part)) out.push({ method, kind: "session" });
    else assert.fail(`${rel} ${method}: the permission is not written in a form this inventory can read`);
  }
  return out;
}

const TOKENS: Record<string, VerifiedSession> = {};
const sessionFor = (name: string, s: VerifiedSession): void => void (TOKENS[name] = s);
sessionFor("nothing", makeSession({ userId: randomUUID(), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web" }));
sessionFor("guest", makeSession({ userId: randomUUID(), accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: randomUUID() } }));
sessionFor("corporate", makeSession({ userId: randomUUID(), accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, client: "web", scope: { kind: "company", id: randomUUID() } }));

function install(): void {
  configureRoutes({
    resolveSession: async (r) => TOKENS[r.headers.get("x-test-session") ?? ""] ?? null,
    catalog,
    idempotency: createMemoryIdempotencyStore(),
    logger: createLogger({ level: "silent", write: () => undefined }),
  });
}

const call = async (handler: Route, method: string, rel: string, who: string | null, body: unknown): Promise<number> => {
  const params: Record<string, string> = {};
  for (const m of rel.matchAll(/\[(\w+)\]/g)) params[m[1]] = randomUUID();
  const urlPath = `/api/v1/${rel.replace(/\/?route\.ts$/, "").replace(/\[(\w+)\]/g, (_s, k: string) => params[k])}`;
  const headers: Record<string, string> = { host: "hms.test", origin: ORIGIN, "user-agent": "node-test/1.0" };
  if (who) headers["x-test-session"] = who;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await handler(new Request(`${ORIGIN}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve(params) });
  return res.status;
};
const bodyFor = (method: string): unknown => (method === "GET" || method === "DELETE" ? undefined : {});
const load = async (rel: string): Promise<Record<string, Route | undefined>> => (await import(pathToFileURL(path.join(root, rel)).href)) as Record<string, Route | undefined>;

// account-role routes that a guest or a company account may legitimately reach: their own sign-in/session/profile family and their own portal
const OWN_FAMILIES = [/^auth\//, /^guest\//, /^corporate\//, /^profile/, /^health/];

describe("every hotel route: who may call it (security inventory)", () => {
  test("the inventory is complete and every route's permission can be read", () => {
    assert.ok(hotelFiles.length >= 290, `found ${hotelFiles.length} hotel route files`);
    let handlers = 0;
    for (const rel of hotelFiles) handlers += declared(rel).length;
    assert.ok(handlers >= hotelFiles.length, "every file declares at least one handler");
  });

  // pathik-worker/: the Pathik worker process, no session: every handler checks its bearer token first (pathik.worker.test.ts: none = 404, wrong = 401)
  // cron/: scheduled jobs (Vercel Cron), no session: every handler checks CRON_SECRET first (cron.test.ts: none configured = 404, wrong = 401)
  // public/unsubscribe: the link in a campaign mail; the address is signed under the server key (companies.test.ts: a forged link = 404), rate-limited by IP
  // public/mail-events: the mail services' bounce and complaint reports (platform 0130); every call needs the secret key in its address (none or wrong = 404) and SES's must also be
  // signed by AWS (mail.safety.test.ts), rate-limited by IP
  // public/site-builds: the "Create hotel site" job's reports (platform 0160); every call must be signed with SITE_BUILD_SECRET over the time, the build id and the body, ten minutes at most
  // (website.siteTemplate.test.ts: none configured = 404, wrong, old or replayed at another build = 403), rate-limited by IP
  // whatsapp/webhook: Meta's calls (plan part 9, 4 Nov 2026), no session: the signature of the raw body is checked first with WHATSAPP_APP_SECRET (whatsapp.intake.test.ts: wrong or none = 403,
  // not set up = 404) and the address check needs WHATSAPP_VERIFY_TOKEN; deliberately not rate-limited by IP (Meta's bursts must not be dropped)
  test("the public routes are exactly the sign-in family, the health check, onboarding, media, the Pathik worker, the cron jobs, the hotel website, the unsubscribe link, the mail services' reports, the website build job's signed reports the product website's demo form and the security decoy and canary addresses", () => {
    const publics = hotelFiles.flatMap((rel) => declared(rel).filter((d) => d.kind === "public").map((d) => `${d.method} ${rel}`));
    for (const p of publics) assert.match(p, /^(GET|POST|PUT|PATCH|DELETE) (auth\/|health\/route\.ts|health\/ready|onboarding|website\/media\/|pathik-worker\/|cron\/|public\/hotels\/|public\/unsubscribe\/|public\/mail-inbound\/|public\/mail-events\/\[provider\]\/\[key\]\/route\.ts$|public\/demo-requests\/route\.ts$|public\/site-builds\/\[id\]\/route\.ts$|webhooks\/razorpay\/\[hotelId\]\/\[business\]\/route\.ts$|whatsapp\/webhook\/route\.ts$|public\/security\/(trap\/route\.ts$|canary\/\[token\]\/route\.ts$))/, `${p} is public but is not a sign-in, health, onboarding, media, Pathik worker, cron, hotel-website, unsubscribe, mail-inbound, mail-report, site-build report, demo-form, Razorpay webhook, WhatsApp webhook or security decoy route`);
  });

  test("anonymous: 401 on every route that is not public", async () => {
    install();
    let calls = 0;
    for (const rel of hotelFiles) {
      const mod = await load(rel);
      for (const d of declared(rel)) {
        if (d.kind === "public") continue;
        assert.equal(await call(mod[d.method]!, d.method, rel, null, bodyFor(d.method)), 401, `${d.method} ${rel} anonymous`);
        calls += 1;
      }
    }
    assert.ok(calls >= 300, `${calls} calls`);
  });

  test("a staff user with no grant, and one a level too low, is refused 403 on every part route; the refusal is answered before any input is looked at", async () => {
    install();
    for (const rel of hotelFiles) {
      const mod = await load(rel);
      for (const d of declared(rel)) {
        if (d.kind !== "part") continue;
        const label = `${d.method} ${rel} (${d.key}:${d.level})`;
        assert.equal(await call(mod[d.method]!, d.method, rel, "nothing", bodyFor(d.method)), 403, `${label} with no grant`);
        const lower = LOWER[d.level!];
        if (lower) {
          TOKENS.low = makeSession({ userId: randomUUID(), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web", grants: [grant(d.key!, lower)] });
          // a part that does not offer the asked level is satisfied by the highest level it does offer (masters offers no "full"): that is by design
          if (!can(TOKENS.low, catalog, d.key!, d.level!)) assert.equal(await call(mod[d.method]!, d.method, rel, "low", bodyFor(d.method)), 403, `${label} one level too low`);
        }
      }
    }
  });

  test("a guest and a company account never reach a hotel route: only their sign-in, profile and own portal answer them", async () => {
    install();
    const reached: string[] = [];
    for (const rel of hotelFiles) {
      const mod = await load(rel);
      for (const d of declared(rel)) {
        if (d.kind === "public") continue;
        for (const who of ["guest", "corporate"] as const) {
          const status = await call(mod[d.method]!, d.method, rel, who, bodyFor(d.method));
          const mine = rel.startsWith(who === "guest" ? "guest/" : "corporate/");
          if (d.kind === "part") assert.ok(status === 403 || (mine && status !== 401), `${who} on ${d.method} ${rel} answered ${status}`);
          // a session-only route may check the account role after it reads the input, so a bad input is answered 422 first; what must never happen is a success
          else if ((status < 400 || status >= 500) && !mine && !OWN_FAMILIES.some((re) => re.test(rel))) reached.push(`${who} ${d.method} ${rel} -> ${status}`);
        }
      }
    }
    assert.deepEqual(reached, [], "a session-only hotel route answered a guest or company account");
  });

  test("a fully permitted user of another hotel gets no server error on ids that are not theirs", async () => {
    install();
    const bad: string[] = [];
    for (const rel of hotelFiles) {
      if (/^(guest|corporate|auth|health)\//.test(rel)) continue;
      const mod = await load(rel);
      for (const d of declared(rel)) {
        if (d.kind !== "part") continue;
        TOKENS.other = makeSession({ userId: randomUUID(), hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, client: "web", grants: [grant(d.key!, "full")] });
        const status = await call(mod[d.method]!, d.method, rel, "other", bodyFor(d.method));
        if (status >= 500) bad.push(`${d.method} ${rel} -> ${status}`);
        assert.notEqual(status, 401, `${d.method} ${rel}`);
      }
    }
    assert.deepEqual(bad, []);
    void HOTEL_A;
  });
});

// Hotel website designs: the hotel picks one of the ten templates, HMS records the pick and starts the "Create hotel site" job, and the job's signed reports move the
// build to live or failed. Covers the permission, the one-build-at-a-time rule, a job that cannot be started, stale builds, the signature (wrong, old, missing, replayed),
// repeated and late reports, the audit, the API-key rule and the GitHub request. Platform migration 0160; docs: website-templates/docs/BACKEND.md.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as getRoute, PUT as putRoute } from "../../src/app/api/v1/website/site-template/route";
import { POST as reportRoute } from "../../src/app/api/v1/public/site-builds/[id]/route";
import { tokenCallVerdict } from "../../src/server/auth/apiTokens";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildWebsiteServices, configureWebsite, noGoogle, memoryOAuthStates } from "../../src/server/compose/website";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryMediaStore } from "../../src/server/media/store";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import { githubSiteBuilder } from "../../src/server/sitebuild/github";
import { signSiteBuild, verifySiteBuild } from "../../src/server/sitebuild/signature";
import { createBillService } from "../../src/server/services/billing/billService";
import { createReservationService } from "../../src/server/services/frontOffice/reservationService";
import type { SiteBuildJob, SiteBuilder } from "../../src/server/services/website/context";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SECRET = "site-build-secret-0123456789abcdef0123";
const ORIGIN = "https://hms.test";
const SLUG = "sunrise-rajkot";

const sessions = new Map<string, VerifiedSession>();
sessions.set("manager", makeSession({ userId: id(1), client: "web", roleKey: "editor", roleLevel: 2, grants: [grant("website", "full")] }));
sessions.set("viewer", makeSession({ userId: id(2), client: "web", grants: [grant("website.settings", "view")] }));
sessions.set("nobody", makeSession({ userId: id(3), client: "web" }));

let clock = new Date("2026-11-01T10:00:00Z");
let platform = createMemoryAuth();
let started: SiteBuildJob[] = [];
let startResult: { ok: true } | { ok: false; error: string } = { ok: true };
let audits: { action: string; details: Record<string, unknown> }[] = [];

const builder: SiteBuilder = { configured: true, start: async (job) => (started.push(job), startResult) };

function wire(over: { siteBuilder?: SiteBuilder | undefined; secret?: string | undefined } = {}): void {
  const hotel = createMemoryHotel();
  platform = createMemoryAuth();
  started = [];
  startResult = { ok: true };
  audits = [];
  platform.data().hotels.push({ id: HOTEL_A, name: "Hotel Sunrise, Rajkot", group: null });
  platform.data().sites.push({ hotelId: HOTEL_A, slug: SLUG, live: true, domains: ["www.sunrise.example"] });
  const people = { get: async () => new Map() };
  const base = { unit: hotel.unit, people, audit: { record: async (e: { action: string; details: Record<string, unknown> }) => void audits.push({ action: e.action, details: e.details }) }, catalog, now: () => clock };
  const reservations = createReservationService({ ...base, bills: createBillService(base) });
  const mail = { enquiryConfirmed: async () => "off" as const, enquiryDeclined: async () => "off" as const };
  configureWebsite(
    buildWebsiteServices({
      ...base, reservations, mail, google: noGoogle, oauthStates: memoryOAuthStates(), media: createMemoryMediaStore(), platform: platform.unit, publicUrl: "https://hms.test",
      ...("siteBuilder" in over ? (over.siteBuilder ? { siteBuilder: over.siteBuilder } : {}) : { siteBuilder: builder }),
      ...("secret" in over ? (over.secret ? { siteBuildSecret: over.secret } : {}) : { siteBuildSecret: SECRET }),
    }),
  );
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
}

function req(method: string, path: string, who: string | null, body?: unknown, headers: Record<string, string> = {}): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, ...headers };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.clone().json()) as any;
const PATH = "/api/v1/website/site-template";
const pick = (template: string, who = "manager") => putRoute(req("PUT", PATH, who, { template }), ctx());
const state = async (who = "manager") => (await json(await getRoute(req("GET", PATH, who), ctx()))).data;

/** A report from the job, signed as the workflow signs it (website-templates/tools/report-build.mjs). */
function report(buildId: string, body: Record<string, unknown> | string, over: { secret?: string; at?: Date; signature?: string | null; timestamp?: string | null } = {}): Promise<Response> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const ts = Math.floor((over.at ?? clock).getTime() / 1000);
  const headers: Record<string, string> = {};
  const timestamp = over.timestamp === undefined ? String(ts) : over.timestamp;
  const signature = over.signature === undefined ? signSiteBuild(over.secret ?? SECRET, ts, buildId, raw) : over.signature;
  if (timestamp !== null) headers["x-hms-timestamp"] = timestamp;
  if (signature !== null) headers["x-hms-signature"] = signature;
  return reportRoute(req("POST", `/api/v1/public/site-builds/${buildId}`, null, raw, headers), ctx({ id: buildId }));
}
const builds = () => platform.data().siteBuilds ?? [];

beforeEach(() => wire());

describe("the designs and the pick", () => {
  test("the page lists the ten templates and says whether the job is connected; nothing is current before the first pick", async () => {
    const s = await state();
    assert.equal(s.configured, true);
    assert.deepEqual(s.templates.map((t: { key: string }) => t.key), Array.from({ length: 10 }, (_, i) => `template-${i + 1}`));
    assert.equal(s.current, null);
    assert.equal(s.active, null);
    assert.deepEqual(s.history, []);
  });

  test("picking a design saves it, starts the job with the hotel's slug and a callback address, and shows it as queued", async () => {
    const res = await pick("template-3");
    assert.equal(res.status, 200, JSON.stringify(await json(res)));
    const s = (await json(res)).data;
    assert.equal(s.active.template, "template-3");
    assert.equal(s.active.status, "queued");
    assert.equal(s.active.templateName, "Template Site Three");
    assert.equal(started.length, 1);
    assert.deepEqual({ ...started[0], buildId: "x" }, { buildId: "x", hotelSlug: SLUG, templateKey: "template-3", callbackUrl: `https://hms.test/api/v1/public/site-builds/${builds()[0].id}` });
    assert.equal(builds()[0].requestedBy, id(1));
    assert.deepEqual(audits.map((a) => [a.action, a.details.template, a.details.started]), [["website.template_chosen", "template-3", true]]);
  });

  test("a template that is not in the list is refused (a path, an unknown name, an upper-case key)", async () => {
    for (const bad of ["template-11", "../etc", "Template-1", "", "template-1 "]) {
      const res = await pick(bad);
      assert.equal(res.status, 422, bad);
    }
    assert.equal(started.length, 0);
    assert.equal(builds().length, 0);
  });

  test("a second pick while one is being built is refused; after it finishes another can be picked, and the live one cannot be picked again", async () => {
    await pick("template-3");
    const second = await pick("template-5");
    assert.equal(second.status, 409);
    assert.equal(started.length, 1);
    const first = builds()[0];
    assert.equal((await report(first.id, { status: "building" })).status, 200);
    assert.equal((await report(first.id, { status: "live", siteUrl: "https://sunrise.example/", runUrl: "https://github.com/acme/hms-sites/actions/runs/1" })).status, 200);
    assert.equal((await pick("template-3")).status, 409, "already live");
    assert.equal((await pick("template-5")).status, 200);
    const s = await state();
    assert.equal(s.current.template, "template-3");
    assert.equal(s.current.siteUrl, "https://sunrise.example/");
    assert.equal(s.active.template, "template-5");
  });

  test("a job that cannot be started leaves a failed build with the reason, and the hotel can try again at once", async () => {
    startResult = { ok: false, error: "GitHub did not accept the saved access key." };
    const res = await pick("template-2");
    assert.equal(res.status, 200);
    const s = (await json(res)).data;
    assert.equal(s.active, null);
    assert.equal(s.history[0].status, "failed");
    assert.equal(s.history[0].message, "GitHub did not accept the saved access key.");
    assert.equal(audits[0].details.started, false);
    startResult = { ok: true };
    assert.equal((await pick("template-2")).status, 200);
  });

  test("a build whose job never answered is failed after 30 minutes the next time the page is read", async () => {
    await pick("template-4");
    clock = new Date(clock.getTime() + 29 * 60_000);
    assert.equal((await state()).active.status, "queued");
    clock = new Date(clock.getTime() + 2 * 60_000);
    const s = await state();
    assert.equal(s.active, null);
    assert.equal(s.history[0].status, "failed");
    assert.match(s.history[0].message, /did not finish in 30 minutes/);
    assert.equal((await pick("template-4")).status, 200);
  });

  test("only a person with the website settings part may see or pick; a viewer sees but cannot pick; nobody gets 403", async () => {
    assert.equal((await getRoute(req("GET", PATH, "viewer"), ctx())).status, 200);
    assert.equal((await pick("template-1", "viewer")).status, 403);
    assert.equal((await getRoute(req("GET", PATH, "nobody"), ctx())).status, 403);
    assert.equal((await pick("template-1", "nobody")).status, 403);
    assert.equal((await getRoute(req("GET", PATH, null), ctx())).status, 401);
    assert.equal(builds().length, 0);
  });

  test("on a server where the job is not connected the designs show, picking is refused with a plain reason and nothing is saved", async () => {
    for (const over of [{ siteBuilder: undefined }, { secret: undefined }] as const) {
      wire(over);
      const s = await state();
      assert.equal(s.configured, false);
      assert.equal(s.templates.length, 10);
      const res = await pick("template-1");
      assert.equal(res.status, 409);
      assert.match((await json(res)).error.message, /not set up/);
      assert.equal(builds().length, 0);
    }
  });

  test("each hotel has its own designs: another hotel's builds are never shown", async () => {
    await pick("template-6");
    builds().push({ ...builds()[0], id: id(900), hotelId: id(77), templateKey: "template-9", status: "live", finishedAt: clock });
    const s = await state();
    assert.deepEqual(s.history.map((b: { template: string }) => b.template), ["template-6"]);
    assert.equal(s.current, null);
  });
});

describe("the job's signed reports", () => {
  test("building then live: the build moves on, the log page and address are kept, the audit names the template", async () => {
    await pick("template-7");
    const b = builds()[0];
    const building = await report(b.id, { status: "building", runUrl: "https://github.com/acme/hms-sites/actions/runs/9" });
    assert.equal(building.status, 200);
    assert.equal(builds()[0].status, "building");
    assert.ok(builds()[0].startedAt);
    const live = await report(b.id, { status: "live", message: "Deployed.", siteUrl: "https://sunrise.example/" });
    assert.equal(live.status, 200);
    assert.equal(builds()[0].status, "live");
    assert.equal(builds()[0].runUrl, "https://github.com/acme/hms-sites/actions/runs/9", "the log page from the first report is kept");
    assert.equal(builds()[0].siteUrl, "https://sunrise.example/");
    assert.ok(builds()[0].finishedAt);
    assert.deepEqual(audits.map((a) => [a.action, a.details.status]), [["website.template_chosen", undefined], ["website.template_built", "live"]]);
  });

  test("a failed report keeps the reason; the build is final", async () => {
    await pick("template-8");
    const b = builds()[0];
    assert.equal((await report(b.id, { status: "failed", message: "git push was rejected" })).status, 200);
    const s = await state();
    assert.equal(s.history[0].status, "failed");
    assert.equal(s.history[0].message, "git push was rejected");
    assert.equal(s.active, null);
  });

  test("a repeat of a report changes nothing and answers 200; a late `building` after the end is ignored; a different report for a finished build is 409", async () => {
    await pick("template-1");
    const b = builds()[0];
    await report(b.id, { status: "live" });
    const again = await report(b.id, { status: "live", message: "second try" });
    assert.equal(again.status, 200);
    assert.equal((await json(again)).data.repeated, true);
    assert.equal(builds()[0].message, null, "the repeat did not change the message");
    assert.equal((await report(b.id, { status: "building" })).status, 200);
    assert.equal(builds()[0].status, "live");
    assert.equal((await report(b.id, { status: "failed", message: "late" })).status, 409);
    assert.equal(builds()[0].status, "live");
    assert.equal(audits.filter((a) => a.action === "website.template_built").length, 1, "audited once");
  });

  test("a wrong signature, the wrong secret, a missing header, an old report and a changed body are all refused 403 and change nothing", async () => {
    await pick("template-1");
    const b = builds()[0];
    const body = { status: "live" };
    const raw = JSON.stringify(body);
    const ts = Math.floor(clock.getTime() / 1000);
    const cases: [string, Promise<Response>][] = [
      ["wrong secret", report(b.id, body, { secret: "another-secret-0123456789abcdef012345" })],
      ["junk signature", report(b.id, body, { signature: "sha256=00" })],
      ["no signature", report(b.id, body, { signature: null })],
      ["no timestamp", report(b.id, body, { timestamp: null })],
      ["timestamp not a number", report(b.id, body, { timestamp: "now" })],
      ["old report (replay)", report(b.id, body, { at: new Date(clock.getTime() - 11 * 60_000) })],
      ["body changed after signing", report(b.id, { status: "live", message: "x" }, { signature: signSiteBuild(SECRET, ts, b.id, raw) })],
      ["signed for another build (replayed at this address)", report(b.id, body, { signature: signSiteBuild(SECRET, ts, id(556), raw) })],
    ];
    for (const [name, p] of cases) assert.equal((await p).status, 403, name);
    assert.equal(builds()[0].status, "queued");
    assert.equal(audits.filter((a) => a.action === "website.template_built").length, 0);
  });

  test("a signed report that is not in the expected shape is 422; an unknown build is 404; a server with no secret answers 404 whatever is signed", async () => {
    await pick("template-1");
    const b = builds()[0];
    for (const bad of [{ status: "done" }, { status: "live", siteUrl: "http://plain.example" }, { status: "live", extra: 1 }, { status: "live", message: "x".repeat(501) }, "not json"]) {
      assert.equal((await report(b.id, bad)).status, 422, JSON.stringify(bad).slice(0, 40));
    }
    assert.equal((await report(id(555), { status: "live" })).status, 404);
    wire({ secret: undefined });
    assert.equal((await report(id(555), { status: "live" })).status, 404);
  });

  test("the signature functions: fresh and exact pass; ten minutes and a second old fails; the same body with another time or another build fails", () => {
    const now = new Date("2026-11-01T10:00:00Z");
    const ts = Math.floor(now.getTime() / 1000);
    const B = id(5);
    const sig = signSiteBuild(SECRET, ts, B, "{}");
    assert.equal(verifySiteBuild(SECRET, B, String(ts), sig, "{}", now), true);
    assert.equal(verifySiteBuild(SECRET, B, String(ts - 600), signSiteBuild(SECRET, ts - 600, B, "{}"), "{}", now), true);
    assert.equal(verifySiteBuild(SECRET, B, String(ts - 601), signSiteBuild(SECRET, ts - 601, B, "{}"), "{}", now), false);
    assert.equal(verifySiteBuild(SECRET, B, String(ts + 601), signSiteBuild(SECRET, ts + 601, B, "{}"), "{}", now), false);
    assert.equal(verifySiteBuild(SECRET, B, String(ts + 1), sig, "{}", now), false);
    assert.equal(verifySiteBuild(SECRET, id(6), String(ts), sig, "{}", now), false, "another build's id");
  });
});

describe("the GitHub request and the API-key rule", () => {
  test("GitHub's repository_dispatch is called once with the token in the header only, and answers map to plain sentences", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answer = (status: number) => githubSiteBuilder({ token: "ghp_secret_token_0123456789", repo: "acme/hms-sites", fetch: async (url, init) => (calls.push({ url, init }), new Response(null, { status })) });
    const job: SiteBuildJob = { buildId: id(5), hotelSlug: SLUG, templateKey: "template-3", callbackUrl: "https://hms.test/api/v1/public/site-builds/x" };
    assert.deepEqual(await answer(204).start(job), { ok: true });
    assert.equal(calls[0].url, "https://api.github.com/repos/acme/hms-sites/dispatches");
    assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer ghp_secret_token_0123456789");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { event_type: "create-hotel-site", client_payload: { build_id: id(5), hotel: SLUG, template: "template-3", callback_url: "https://hms.test/api/v1/public/site-builds/x" } });
    for (const [status, words] of [[401, /did not accept/], [403, /did not accept/], [404, /could not find/], [422, /refused/], [500, /\(500\)/]] as const) {
      const r = await answer(status).start(job);
      assert.equal(r.ok, false);
      assert.match((r as { error: string }).error, words);
      assert.ok(!(r as { error: string }).error.includes("ghp_secret"), "the token is never in an error");
    }
    const down = await githubSiteBuilder({ token: "ghp_secret_token_0123456789", repo: "acme/hms-sites", fetch: async () => Promise.reject(new Error("ECONNRESET ghp_secret_token_0123456789")) }).start(job);
    assert.deepEqual(down, { ok: false, error: "Could not reach GitHub. Try again in a minute." });
  });

  test("no API key, at any level or scope, may change the design (the page is for a person in the browser)", () => {
    for (const scope of ["hotel", "platform", "all"] as const) {
      const v = tokenCallVerdict({ level: "full", scope, testMode: false }, "PUT", PATH);
      assert.equal(v.allowed, false, scope);
    }
  });
});

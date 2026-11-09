// The route wrapper, end to end, with the in-memory doubles: sessions, permissions at every level, strict input, idempotency,
// the version check, hotel isolation, the envelope, and what happens after a failure. The routes below are test-only stand-ins for
// a module's routes; they only call the wrapper and the repository interface, exactly as a real route will.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod";
import type { CashDeposit } from "@shared/dashboards/cash";
import type { VerifiedSession } from "../../src/server/auth/session";
import { AppError } from "../../src/server/errors";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { createMemoryRateLimitStore } from "../../src/server/http/limits";
import { createRouteFactory, type RouteDeps } from "../../src/server/http/wrapper";
import { createLogger } from "../../src/server/logger";
import { toPaise } from "../../src/server/money/paise";
import { CASH_DEPOSIT_SORTS, type CashDepositRecord } from "../../src/server/repos/cashDeposit";
import { createMemoryCash } from "../../src/server/repos/memory/cashDeposit";
import { unwrapVersioned } from "../../src/server/repos/unwrap";
import { idParams, listQuerySchema, versionField } from "../../src/server/validation/listQuery";
import { assertMatchesContract } from "./helpers/contract";
import { catalog, grant, HOTEL_B, makeSession } from "./helpers/session";

const ORIGIN = "https://hms.test";
const sessions = new Map<string, VerifiedSession>();
const lines: string[] = [];
const idempotency = createMemoryIdempotencyStore();
const deps: RouteDeps = {
  resolveSession: async (request) => sessions.get(request.headers.get("x-test-session") ?? "") ?? null,
  catalog,
  idempotency,
  logger: createLogger({ level: "debug", write: (line) => lines.push(line) }),
};
const { route, publicRoute } = createRouteFactory(deps);
const { unit } = createMemoryCash();

// ---- DTO: what the API sends for a deposit (the ui-shared CashDeposit plus the version the update needs) ----
const toDto = (r: CashDepositRecord) => ({
  id: r.id,
  entryNo: r.entryNo,
  at: new Date(`${r.date}T${r.time}+05:30`).toISOString(),
  recordedBy: { id: r.userId, name: r.fullName ?? "" },
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  isLatest: false,
  book: r.book,
  depositor: r.depositor,
  amountPaise: Number(r.amountPaise),
  instruction: r.reason,
  version: r.version,
});

const createBody = z.strictObject({ depositor: z.string().trim().min(1).max(100), amountPaise: z.number().int().min(1).max(100_000_000_00), reason: z.string().max(500).optional() });
const updateBody = z.strictObject({ version: versionField, depositor: z.string().trim().min(1).max(100).optional() });

const routes = {
  list: route({
    permission: { key: "revenue.hotel", level: "view" },
    query: listQuerySchema(CASH_DEPOSIT_SORTS, "entryNo"),
    handler: async ({ session, query }) => {
      const result = await unit.run(session, ({ cashDeposits }) => cashDeposits.list("hotel", query));
      return { data: { rows: result.rows.map(toDto), total: result.total } };
    },
  }),
  // T2: a list read the browser may keep and ask about again
  cachedList: route({
    permission: { key: "revenue.hotel", level: "view" },
    cache: "private, no-cache",
    query: listQuerySchema(CASH_DEPOSIT_SORTS, "entryNo"),
    handler: async ({ session, query }) => {
      const result = await unit.run(session, ({ cashDeposits }) => cashDeposits.list("hotel", query));
      return { data: { rows: result.rows.map(toDto), total: result.total } };
    },
  }),
  get: route({
    permission: { key: "revenue.hotel", level: "view" },
    params: idParams,
    handler: async ({ session, params }) => {
      const row = await unit.run(session, ({ cashDeposits }) => cashDeposits.get("hotel", params.id));
      if (!row) throw new AppError("NOT_FOUND");
      return { data: toDto(row) };
    },
  }),
  create: route({
    permission: { key: "revenue.hotel", level: "create" },
    body: createBody,
    handler: async ({ session, body }) => {
      const row = await unit.run(session, ({ cashDeposits }) =>
        cashDeposits.create("hotel", { date: "2026-10-05", time: "10:00:00", userId: session.userId, fullName: null, depositor: body.depositor, amountPaise: toPaise(body.amountPaise), amountInWords: null, reason: body.reason ?? null, createdBy: session.userId }),
      );
      return { data: toDto(row), status: 201 };
    },
  }),
  update: route({
    permission: { key: "revenue.hotel", level: "edit" },
    params: idParams,
    body: updateBody,
    handler: async ({ session, params, body }) => {
      const row = await unit.run(session, async ({ cashDeposits }) => unwrapVersioned(await cashDeposits.update("hotel", params.id, body.version, { depositor: body.depositor }, session.userId)));
      return { data: toDto(row) };
    },
  }),
  remove: route({
    permission: { key: "revenue.hotel", level: "full" },
    params: idParams,
    body: z.strictObject({ version: versionField }),
    handler: async ({ session, params, body }) => {
      const row = await unit.run(session, async ({ cashDeposits }) => unwrapVersioned(await cashDeposits.softDelete("hotel", params.id, body.version, session.userId)));
      return { data: toDto(row) };
    },
  }),
  anyone: route({ permission: "session", handler: async ({ session }) => ({ data: { userId: session.userId } }) }),
  open: publicRoute({ handler: async ({ session }) => ({ data: { session } }) }),
  boom: route({ permission: "session", handler: async () => { throw new Error("relation \"hotel_x.bills\" does not exist; password=hunter2"); } }),
  wrongCode: route({
    permission: "session",
    handler: async ({ failAfterCommit }) => {
      failAfterCommit(async () => { counters.wrong += 1; });
      throw new AppError("INVALID_CODE");
    },
  }),
  slow: route({
    permission: { key: "revenue.hotel", level: "create" },
    body: createBody,
    handler: async ({ session, body }) => {
      await gate;
      const row = await unit.run(session, ({ cashDeposits }) =>
        cashDeposits.create("hotel", { date: "2026-10-05", time: "10:00:00", userId: session.userId, fullName: null, depositor: body.depositor, amountPaise: toPaise(body.amountPaise), amountInWords: null, reason: null, createdBy: session.userId }),
      );
      return { data: toDto(row), status: 201 };
    },
  }),
};
const counters = { wrong: 0 };
let gate: Promise<void> = Promise.resolve();

// ---- request helpers ----
interface Call { session?: string; body?: unknown; rawBody?: string; headers?: Record<string, string>; origin?: string | null; contentType?: string | null }
function request(method: string, path: string, call: Call = {}): Request {
  const headers: Record<string, string> = { host: "hms.test", ...call.headers };
  if (call.session) headers["x-test-session"] = call.session;
  if (call.origin !== null && method !== "GET") headers.origin = call.origin ?? ORIGIN;
  const hasBody = call.body !== undefined || call.rawBody !== undefined;
  if (hasBody && call.contentType !== null) headers["content-type"] = call.contentType ?? "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers, body: hasBody ? (call.rawBody ?? JSON.stringify(call.body)) : undefined });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: the body is checked field by field in each test
const json = async (res: Response) => (await res.json()) as { data?: any; error?: { code: string; message: string; traceId: string; details?: any } };

function addSession(name: string, options: Parameters<typeof makeSession>[0]): void {
  sessions.set(name, makeSession({ client: "web", ...options }));
}
addSession("viewer", { grants: [grant("revenue", "view")], userId: "00000000-0000-4000-8000-000000000001" });
addSession("creator", { grants: [grant("revenue", "create")], userId: "00000000-0000-4000-8000-000000000002" });
addSession("editor", { grants: [grant("revenue", "edit")], userId: "00000000-0000-4000-8000-000000000003" });
addSession("admin", { grants: [grant("revenue", "full")], userId: "00000000-0000-4000-8000-000000000004" });
addSession("admin2", { grants: [grant("revenue", "full")], userId: "00000000-0000-4000-8000-000000000005" });
addSession("nobody", { userId: "00000000-0000-4000-8000-000000000006" });
addSession("adminB", { hotelId: HOTEL_B, grants: [grant("revenue", "full")], userId: "00000000-0000-4000-8000-000000000007" });
addSession("cookie", { client: "web", grants: [grant("revenue", "full")], userId: "00000000-0000-4000-8000-000000000008" });

const NEW = { depositor: "Front desk", amountPaise: 150000 };
const create = async (session = "admin", body: unknown = NEW, headers: Record<string, string> = {}) => routes.create(request("POST", "/api/v1/revenue/hotel", { session, body, headers }), ctx());

describe("session, then permission, then input", () => {
  test("no session: 401 SESSION_EXPIRED, with the trace id and no data", async () => {
    const res = await routes.list(request("GET", "/api/v1/revenue/hotel"), ctx());
    assert.equal(res.status, 401);
    assert.ok(res.headers.get("x-trace-id"));
    const body = await json(res);
    assert.equal(body.error?.code, "SESSION_EXPIRED");
    assert.ok(!("data" in body));
  });
  test("an unknown session token is the same 401", async () => {
    assert.equal((await routes.list(request("GET", "/x", { session: "stolen" }), ctx())).status, 401);
  });
  test("an invalid body without a session is still 401: input is never checked for a stranger", async () => {
    const res = await routes.create(request("POST", "/x", { body: { junk: true } }), ctx());
    assert.equal(res.status, 401);
  });
  test("permission at each level: view reads only; create adds; edit changes; full deletes", async () => {
    const id = (await json(await create("admin"))).data.id as string;
    const call = (fn: keyof typeof routes, method: string, session: string, body?: unknown) => routes[fn](request(method, `/api/v1/revenue/hotel/${id}`, { session, body }), ctx({ id }));
    const status = async (p: Promise<Response>) => (await p).status;
    // view
    assert.equal(await status(call("get", "GET", "viewer")), 200);
    assert.equal(await status(create("viewer")), 403);
    assert.equal(await status(call("update", "PUT", "viewer", { version: 1, depositor: "x" })), 403);
    // create
    assert.equal(await status(create("creator")), 201);
    assert.equal(await status(call("get", "GET", "creator")), 200, "create includes view");
    assert.equal(await status(call("update", "PUT", "creator", { version: 1, depositor: "x" })), 403);
    // edit
    assert.equal(await status(create("editor")), 201);
    assert.equal(await status(call("remove", "DELETE", "editor", { version: 1 })), 403);
    // full
    assert.equal(await status(call("remove", "DELETE", "admin", { version: 1 })), 200);
    // no permission
    assert.equal(await status(call("get", "GET", "nobody")), 403);
    const forbidden = await json(await call("get", "GET", "nobody"));
    assert.equal(forbidden.error?.code, "FORBIDDEN");
  });
  test("permission: 'session' lets any signed-in person in; a public route sees no session", async () => {
    assert.equal((await routes.anyone(request("GET", "/x", { session: "nobody" }), ctx())).status, 200);
    assert.equal((await routes.anyone(request("GET", "/x"), ctx())).status, 401);
    assert.deepEqual((await json(await routes.open(request("GET", "/x"), ctx()))).data, { session: null });
  });
});

describe("strict, bounded input (422)", () => {
  test("an unknown body key is refused by name, and the value is never echoed", async () => {
    const res = await create("admin", { ...NEW, isAdmin: true, secret: "do-not-echo" });
    assert.equal(res.status, 422);
    const text = await res.text();
    assert.ok(text.includes("isAdmin") && !text.includes("do-not-echo"));
  });
  test("wrong types, out-of-range numbers and missing fields", async () => {
    for (const bad of [{ depositor: "x" }, { ...NEW, amountPaise: 0 }, { ...NEW, amountPaise: 1.5 }, { ...NEW, amountPaise: "100" }, { ...NEW, depositor: "" }, { ...NEW, reason: "r".repeat(501) }, [], null, "text"]) {
      assert.equal((await create("admin", bad)).status, 422, JSON.stringify(bad));
    }
  });
  test("a body that is not JSON, has the wrong content type, or is too large", async () => {
    const send = (call: Call) => routes.create(request("POST", "/x", { session: "admin", ...call }), ctx());
    assert.equal((await send({ rawBody: "{not json" })).status, 422);
    assert.equal((await send({ body: NEW, contentType: "text/plain" })).status, 422);
    assert.equal((await send({ body: NEW, contentType: null })).status, 422);
    assert.equal((await send({ rawBody: JSON.stringify({ ...NEW, reason: "x".repeat(300_000) }) })).status, 422);
  });
  test("a path id must be a UUID", async () => {
    for (const id of ["1", "../etc/passwd", "' OR 1=1 --", "00000000-0000-0000-0000-00000000000"]) {
      assert.equal((await routes.get(request("GET", "/x", { session: "viewer" }), ctx({ id }))).status, 422, id);
    }
  });
  test("hostile search and sort: a sort outside the whitelist, a repeated name, a huge page or search are 422; a hostile search is only text", async () => {
    const list = (qs: string) => routes.list(request("GET", `/api/v1/revenue/hotel?${qs}`, { session: "viewer" }), ctx());
    for (const qs of ["sort=entryNo;DROP TABLE x", "sort=password_hash", "dir=sideways", "page=0", "page=abc", "pageSize=1000", `search=${"a".repeat(201)}`, "deleted=all", "extra=1", "page=1&page=2", "search=a%00b"]) {
      assert.equal((await list(qs)).status, 422, qs);
    }
    await create("admin", { depositor: "Front desk", amountPaise: 100 });
    for (const search of ["%27%3B%20DROP%20TABLE%20x%3B--", "%25", "_", "%5C"]) {
      const res = await list(`search=${search}`);
      assert.equal(res.status, 200, search);
      assert.ok(Array.isArray((await json(res)).data.rows));
    }
  });
});

describe("the envelope", () => {
  test("success is { data } with no-store and a trace id; the caller's good trace id is echoed", async () => {
    const res = await routes.list(request("GET", "/x", { session: "viewer", headers: { "x-trace-id": "caller-trace-123" } }), ctx());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-trace-id"), "caller-trace-123");
    const body = await json(res);
    assert.deepEqual(Object.keys(body), ["data"]);
  });
  test("a list read with `cache` carries a weak ETag and `private, no-cache`; the same If-None-Match answers 304 with no body; a change gives a new ETag; a plain read stays no-store without an ETag (T2)", async () => {
    const first = await routes.cachedList(request("GET", "/x", { session: "viewer" }), ctx());
    assert.equal(first.status, 200);
    const etag = first.headers.get("etag") ?? "";
    assert.match(etag, /^W\/"[A-Za-z0-9_-]{27}"$/);
    assert.deepEqual([first.headers.get("cache-control"), first.headers.get("content-type")], ["private, no-cache", "application/json"]);
    assert.deepEqual(Object.keys(await json(first)), ["data"]);
    const same = await routes.cachedList(request("GET", "/x", { session: "viewer", headers: { "if-none-match": `"stale", ${etag}` } }), ctx());
    assert.deepEqual([same.status, same.headers.get("etag"), same.headers.get("cache-control"), await same.text()], [304, etag, "private, no-cache", ""]);
    const star = await routes.cachedList(request("GET", "/x", { session: "viewer", headers: { "if-none-match": "*" } }), ctx());
    assert.equal(star.status, 304);
    await routes.create(request("POST", "/x", { session: "creator", body: { depositor: "Change", amountPaise: 100 } }), ctx());
    const changed = await routes.cachedList(request("GET", "/x", { session: "viewer", headers: { "if-none-match": etag } }), ctx());
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get("etag"), etag);
    const plain = await routes.list(request("GET", "/x", { session: "viewer", headers: { "if-none-match": etag } }), ctx());
    assert.deepEqual([plain.status, plain.headers.get("etag"), plain.headers.get("cache-control")], [200, null, "no-store"]);
  });
  test("a create answers 201", async () => {
    assert.equal((await create("admin")).status, 201);
  });
  test("an unexpected error is SERVER_ERROR with nothing from the cause, which only the log sees", async () => {
    const res = await routes.boom(request("GET", "/x", { session: "nobody" }), ctx());
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes("relation") && !text.includes("hunter2"));
    assert.ok(lines.some((l) => l.includes('"level":"error"')));
  });
});

describe("Idempotency-Key", () => {
  const KEY = "key-0001-abcdefgh";
  test("the same key and request replays the first answer: one record, the same entry number, a replay header", async () => {
    const before = await unit.run(sessions.get("admin") as VerifiedSession, ({ cashDeposits }) => cashDeposits.totals("hotel", {}));
    const first = await create("admin", NEW, { "idempotency-key": KEY });
    const second = await create("admin", NEW, { "idempotency-key": KEY });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.headers.get("idempotent-replayed"), "true");
    assert.equal(first.headers.get("idempotent-replayed"), null);
    assert.deepEqual(await json(second), await json(first));
    const after = await unit.run(sessions.get("admin") as VerifiedSession, ({ cashDeposits }) => cashDeposits.totals("hotel", {}));
    assert.equal(after.count, before.count + 1, "created once");
  });
  test("the same key with a different body is IDEMPOTENCY_KEY_REUSED (422), and nothing is created", async () => {
    const key = "key-0002-abcdefgh";
    assert.equal((await create("admin", NEW, { "idempotency-key": key })).status, 201);
    const res = await create("admin", { ...NEW, amountPaise: 999 }, { "idempotency-key": key });
    assert.equal(res.status, 422);
    assert.equal((await json(res)).error?.code, "IDEMPOTENCY_KEY_REUSED");
  });
  test("the same key on another endpoint counts as a different request", async () => {
    const key = "key-0003-abcdefgh";
    assert.equal((await routes.create(request("POST", "/api/v1/revenue/hotel", { session: "admin", body: NEW, headers: { "idempotency-key": key } }), ctx())).status, 201);
    const other = await routes.create(request("POST", "/api/v1/revenue/food", { session: "admin", body: NEW, headers: { "idempotency-key": key } }), ctx());
    assert.equal((await json(other)).error?.code, "IDEMPOTENCY_KEY_REUSED");
  });
  test("a request still running with that key is REQUEST_IN_PROGRESS (409)", async () => {
    const key = "key-0004-abcdefgh";
    let open!: () => void;
    gate = new Promise<void>((resolve) => { open = resolve; });
    const slowCall = () => routes.slow(request("POST", "/api/v1/revenue/hotel", { session: "admin", body: NEW, headers: { "idempotency-key": key } }), ctx());
    const running = slowCall();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const again = await slowCall();
    assert.equal(again.status, 409);
    assert.equal((await json(again)).error?.code, "REQUEST_IN_PROGRESS");
    open();
    assert.equal((await running).status, 201);
    gate = Promise.resolve();
    const replay = await slowCall();
    assert.equal(replay.headers.get("idempotent-replayed"), "true");
  });
  test("a failed request releases the key, so the client can retry with the same key", async () => {
    const key = "key-0005-abcdefgh";
    assert.equal((await create("viewer", NEW, { "idempotency-key": key })).status, 403, "forbidden is refused before the key is claimed");
    const bad = await create("admin", { ...NEW, amountPaise: -1 }, { "idempotency-key": key });
    assert.equal(bad.status, 422, "invalid input is refused before the key is claimed");
    assert.equal((await create("admin", NEW, { "idempotency-key": key })).status, 201);
  });
  test("a handler that throws leaves the key free", async () => {
    const key = "key-0006-abcdefgh";
    const failing = createRouteFactory(deps).route({ permission: "session", body: z.strictObject({}), handler: async () => { throw new AppError("CONFLICT"); } });
    const call = () => failing(request("POST", "/x", { session: "nobody", body: {}, headers: { "idempotency-key": key } }), ctx());
    assert.equal((await call()).status, 409);
    assert.equal((await call()).status, 409, "ran again instead of being stuck 'in progress'");
  });
  test("keys belong to the person and the hotel: another person with the same key creates their own", async () => {
    const key = "key-0007-abcdefgh";
    const a = await json(await create("admin", NEW, { "idempotency-key": key }));
    const b = await json(await create("admin2", NEW, { "idempotency-key": key }));
    assert.notEqual(a.data.id, b.data.id);
  });
  test("a malformed key is refused", async () => {
    for (const key of ["short", "has space in it 1", "x".repeat(129), "bad;chars-12345"]) assert.equal((await create("admin", NEW, { "idempotency-key": key })).status, 422, key);
  });
  test("required mode refuses a write without a key", async () => {
    const strict = createRouteFactory(deps).route({ permission: "session", idempotency: "required", body: z.strictObject({}), handler: async () => ({ data: {} }) });
    const res = await strict(request("POST", "/x", { session: "nobody", body: {} }), ctx());
    assert.equal(res.status, 422);
  });
});

describe("Idempotency-Key for an account with no hotel (Super Admin, platform staff, a Group Hotel Admin outside a visit)", () => {
  // the PostgreSQL store keeps keys in a HOTEL table and refuses a hotel of "": this double refuses the same way, so a call that reached it would fail as it did on the live server
  const refusing: typeof idempotency = Object.assign(createMemoryIdempotencyStore(), {
    begin: async () => { throw new AppError("FORBIDDEN", "Hotel is not available"); },
    complete: async () => { throw new AppError("FORBIDDEN", "Hotel is not available"); },
    abandon: async () => { throw new AppError("FORBIDDEN", "Hotel is not available"); },
  });
  const consoleRoutes = createRouteFactory({ ...deps, idempotency: refusing, resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null });
  const put = consoleRoutes.route({ permission: "session", body: z.strictObject({ value: z.string() }), handler: async ({ body }) => ({ data: { saved: body.value } }) });
  addSession("console", { hotelId: "", accountRole: "super_admin", userId: "00000000-0000-4000-8000-000000000020" });
  addSession("groupAdmin", { hotelId: "", accountRole: "group_hotel_admin", userId: "00000000-0000-4000-8000-000000000021" });

  test("a write with an Idempotency-Key answers 200 and never touches the hotel key table", async () => {
    for (const who of ["console", "groupAdmin"]) {
      const res = await put(request("PUT", "/api/v1/platform/settings", { session: who, body: { value: "x" }, headers: { "idempotency-key": `key-${who}-123456` } }), ctx());
      assert.equal(res.status, 200, who);
      assert.deepEqual((await json(res)).data, { saved: "x" });
    }
  });

  test("the key is still checked for its shape", async () => {
    const res = await put(request("PUT", "/api/v1/platform/settings", { session: "console", body: { value: "x" }, headers: { "idempotency-key": "bad key" } }), ctx());
    assert.equal(res.status, 422);
  });

  test("an account with a hotel still uses the key table (it is asked, and its refusal is a 403, not a 500)", async () => {
    const res = await put(request("PUT", "/api/v1/platform/settings", { session: "admin", body: { value: "x" }, headers: { "idempotency-key": "key-admin-1234567" } }), ctx());
    assert.equal(res.status, 403);
  });

  test("FORBIDDEN 'Hotel is not available' is a 403 even when the error comes from another copy of the AppError class (a module loaded twice)", async () => {
    class OtherCopy extends Error {
      readonly code = "FORBIDDEN";
      constructor() { super("Hotel is not available"); this.name = "AppError"; }
    }
    const failing = consoleRoutes.route({ permission: "session", handler: async () => { throw new OtherCopy(); } });
    const res = await failing(request("GET", "/x", { session: "admin" }), ctx());
    assert.equal(res.status, 403);
    assert.equal((await json(res)).error?.code, "FORBIDDEN");
  });
});
describe("the version check on updates", () => {
  test("a stale version is CONFLICT (409) with the current version; the right one succeeds and raises it", async () => {
    const made = (await json(await create("admin"))).data;
    const put = (version: number, session = "admin") => routes.update(request("PUT", `/x/${made.id}`, { session, body: { version, depositor: `v${version}` } }), ctx({ id: made.id }));
    const ok = await json(await put(1));
    assert.equal(ok.data.version, 2);
    const stale = await put(1);
    assert.equal(stale.status, 409);
    const body = await json(stale);
    assert.equal(body.error?.code, "CONFLICT");
    assert.equal(body.error?.details?.currentVersion, 2);
    assert.equal((await put(2)).status, 200);
  });
  test("a body without a version is refused", async () => {
    const made = (await json(await create("admin"))).data;
    const res = await routes.update(request("PUT", "/x", { session: "admin", body: { depositor: "x" } }), ctx({ id: made.id }));
    assert.equal(res.status, 422);
  });
});

describe("hotel isolation through the routes", () => {
  test("hotel B cannot read, list, change or delete hotel A's record by its id: 404, never 403, never the row", async () => {
    const made = (await json(await create("admin", { depositor: "A-only", amountPaise: 700 }))).data;
    const as = (fn: keyof typeof routes, method: string, body?: unknown) => routes[fn](request(method, `/x/${made.id}`, { session: "adminB", body }), ctx({ id: made.id }));
    assert.equal((await as("get", "GET")).status, 404);
    assert.equal((await as("update", "PUT", { version: 1, depositor: "hijack" })).status, 404);
    assert.equal((await as("remove", "DELETE", { version: 1 })).status, 404);
    const listB = await json(await routes.list(request("GET", "/x?search=A-only", { session: "adminB" }), ctx()));
    assert.equal(listB.data.total, 0);
    const listA = await json(await routes.list(request("GET", "/x?search=A-only", { session: "admin" }), ctx()));
    assert.equal(listA.data.total, 1);
    const still = await json(await routes.get(request("GET", "/x", { session: "admin" }), ctx({ id: made.id })));
    assert.equal(still.data.depositor, "A-only");
  });
});

describe("after a failure (failAfterCommit)", () => {
  test("work registered by the handler still runs when the request fails, and not when it succeeds", async () => {
    counters.wrong = 0;
    const res = await routes.wrongCode(request("GET", "/x", { session: "nobody" }), ctx());
    assert.equal(res.status, 401);
    assert.equal(counters.wrong, 1);
    const ok = createRouteFactory(deps).route({ permission: "session", handler: async ({ failAfterCommit }) => { failAfterCommit(async () => { counters.wrong += 100; }); return { data: {} }; } });
    assert.equal((await ok(request("GET", "/x", { session: "nobody" }), ctx())).status, 200);
    assert.equal(counters.wrong, 1);
  });
  test("work that itself fails is only logged: the caller still gets the original error", async () => {
    const r = createRouteFactory(deps).route({
      permission: "session",
      handler: async ({ failAfterCommit }) => {
        failAfterCommit(async () => { throw new Error("counter write failed"); });
        throw new AppError("ACCOUNT_LOCKED");
      },
    });
    const res = await r(request("GET", "/x", { session: "nobody" }), ctx());
    assert.equal(res.status, 423);
    assert.equal((await json(res)).error?.code, "ACCOUNT_LOCKED");
  });
});

describe("cookie (web) sessions: same-origin check on writes", () => {
  const post = (call: Call) => routes.create(request("POST", "/api/v1/revenue/hotel", { session: "cookie", body: NEW, ...call }), ctx());
  test("the same origin passes; a foreign origin, a malformed one, or no origin signal at all is 403", async () => {
    assert.equal((await post({})).status, 201);
    assert.equal((await post({ origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ origin: "not a url" })).status, 403);
    assert.equal((await post({ origin: null })).status, 403);
  });
  test("no Origin but Sec-Fetch-Site: same-origin is accepted (older clients); cross-site is not", async () => {
    assert.equal((await post({ origin: null, headers: { "sec-fetch-site": "same-origin" } })).status, 201);
    assert.equal((await post({ origin: null, headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  });
  test("reads are not checked, whatever the origin", async () => {
    assert.equal((await routes.list(request("GET", "/x", { session: "cookie" }), ctx())).status, 200);
    assert.equal((await routes.list(request("GET", "/x", { session: "cookie", origin: "https://evil.example" }), ctx())).status, 200);
  });
});

describe("contract: the DTO against the ui-shared type", () => {
  test("a deposit DTO has exactly the ui-shared CashDeposit keys, with the same kinds of value", async () => {
    // the typed sample proves it IS the ui-shared type
    const sample: CashDeposit = {
      id: "x", entryNo: 1, at: "2026-10-05T04:30:00.000Z", recordedBy: { id: "x", name: "x" }, createdAt: "x", updatedAt: "x", isLatest: true,
      book: "hotel", depositor: "x", amountPaise: 1, instruction: null, version: 1,
    };
    const made = (await json(await create("admin", { ...NEW, reason: "r" }))).data;
    assertMatchesContract(made, sample, "deposit");
  });
  test("the helper fails on an extra field, a missing field and a wrong kind", () => {
    const sample = { id: "x", n: 1, inner: { a: "x" }, list: [{ k: 1 }], maybe: null };
    assertMatchesContract({ id: "a", n: 2, inner: { a: "b" }, list: [{ k: 3 }], maybe: "anything" }, sample);
    assert.throws(() => assertMatchesContract({ id: "a", n: 2, inner: { a: "b" }, list: [], maybe: null, extra: 1 }, sample));
    assert.throws(() => assertMatchesContract({ id: "a", inner: { a: "b" }, list: [], maybe: null }, sample));
    assert.throws(() => assertMatchesContract({ id: "a", n: "2", inner: { a: "b" }, list: [], maybe: null }, sample));
    assert.throws(() => assertMatchesContract({ id: "a", n: 2, inner: { a: "b" }, list: [{ k: "no" }], maybe: null }, sample));
  });
});

describe("limits (Pallav's throttle:N,M, declared on the route)", () => {
  let now = 1_000_000;
  const store = createMemoryRateLimitStore(() => now);
  const limited = createRouteFactory({ ...deps, rateLimits: store, clientIp: (r) => r.headers.get("x-test-ip") ?? "unknown" });
  const ping = (headers: Record<string, string> = {}, session?: string) => request("GET", "/x", { session, headers });

  test("a public route is limited by address: the request over the max is 429 RATE_LIMITED with Retry-After, and the window then resets", async () => {
    store.clear();
    const login = limited.publicRoute({ limits: [{ name: "login", max: 3, windowSeconds: 60, by: "ip" }], handler: async () => ({ data: { ok: true } }) });
    for (let i = 0; i < 3; i++) assert.equal((await login(ping({ "x-test-ip": "1.1.1.1" }), ctx())).status, 200);
    const refused = await login(ping({ "x-test-ip": "1.1.1.1" }), ctx());
    assert.equal(refused.status, 429);
    assert.equal((await json(refused)).error?.code, "RATE_LIMITED");
    const wait = Number(refused.headers.get("retry-after"));
    assert.ok(wait >= 1 && wait <= 60);
    assert.equal((await login(ping({ "x-test-ip": "2.2.2.2" }), ctx())).status, 200, "another address has its own count");
    now += 61_000;
    assert.equal((await login(ping({ "x-test-ip": "1.1.1.1" }), ctx())).status, 200, "a new window");
  });
  test("a signed-in route is limited per person; two routes never share a counter; several limits all apply", async () => {
    store.clear();
    const a = limited.route({ permission: "session", limits: [{ name: "resend", max: 2, windowSeconds: 60, by: "user" }], handler: async () => ({ data: {} }) });
    const b = limited.route({ permission: "session", limits: [{ name: "other", max: 2, windowSeconds: 60, by: "user" }, { name: "burst", max: 1, windowSeconds: 1, by: "session" }], handler: async () => ({ data: {} }) });
    assert.equal((await a(ping({}, "nobody"), ctx())).status, 200);
    assert.equal((await a(ping({}, "nobody"), ctx())).status, 200);
    assert.equal((await a(ping({}, "nobody"), ctx())).status, 429);
    assert.equal((await a(ping({}, "viewer"), ctx())).status, 200, "another person");
    assert.equal((await b(ping({}, "nobody"), ctx())).status, 200, "route b has its own counters");
    assert.equal((await b(ping({}, "nobody"), ctx())).status, 429, "the 1-per-second burst limit");
  });
  test("a stranger cannot burn a signed-in person's limit: authentication comes first", async () => {
    store.clear();
    const r = limited.route({ permission: "session", limits: [{ name: "x", max: 1, windowSeconds: 60, by: "user" }], handler: async () => ({ data: {} }) });
    for (let i = 0; i < 5; i++) assert.equal((await r(ping(), ctx())).status, 401);
    assert.equal((await r(ping({}, "nobody"), ctx())).status, 200);
  });
  test("a counter that must survive a refusal: failAfterCommit still runs on the 429-free failure path, and a refused request does not run the handler", async () => {
    store.clear();
    let handled = 0;
    const r = limited.publicRoute({ limits: [{ name: "code", max: 1, windowSeconds: 60, by: "ip" }], handler: async () => { handled += 1; throw new AppError("INVALID_CODE"); } });
    assert.equal((await r(ping({ "x-test-ip": "3.3.3.3" }), ctx())).status, 401);
    assert.equal((await r(ping({ "x-test-ip": "3.3.3.3" }), ctx())).status, 429);
    assert.equal(handled, 1);
  });
  test("a route without limits is never throttled", async () => {
    for (let i = 0; i < 50; i++) assert.equal((await routes.anyone(request("GET", "/x", { session: "nobody" }), ctx())).status, 200);
  });
});

describe("the in-memory rate-limit store", () => {
  test("counters with different window lengths never disturb each other (a 60 s counter must not erase an hourly one)", async () => {
    let t = Date.UTC(2026, 9, 5, 4, 30);
    const s = createMemoryRateLimitStore(() => t);
    await s.hit("hourly", 3600);
    t += 31_000;
    await s.hit("minute", 60);
    await s.hit("hourly", 3600);
    assert.equal(await s.peek("hourly", 3600), 2);
    assert.equal(await s.peek("minute", 60), 1);
  });
  test("peek counts nothing, reset forgets one key only, and a finished window starts again", async () => {
    let t = Date.UTC(2026, 9, 5, 4, 30);
    const s = createMemoryRateLimitStore(() => t);
    await s.hit("a", 60);
    await s.hit("b", 60);
    assert.equal(await s.peek("a", 60), 1);
    assert.equal(await s.peek("a", 60), 1, "reading is free");
    await s.reset("a");
    assert.deepEqual([await s.peek("a", 60), await s.peek("b", 60)], [0, 1]);
    t += 61_000;
    assert.equal((await s.hit("b", 60)).count, 1);
  });
});

// The routes of problems with online payments, through the REAL route files with a stub service (the rules themselves are tested on the real database in tests/db/razorpay.disputes.service.test.ts):
// who may call, what is accepted, and what reaches the service.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as adminList } from "../../src/app/api/v1/admin/razorpay/disputes/route";
import { POST as adminRespond } from "../../src/app/api/v1/admin/razorpay/disputes/[id]/respond/route";
import { GET as corporateProblems } from "../../src/app/api/v1/corporate/razorpay/problems/route";
import { GET as guestPayments } from "../../src/app/api/v1/guest/razorpay/payments/route";
import { GET as guestProblems, POST as guestRaise } from "../../src/app/api/v1/guest/razorpay/problems/route";
import { POST as guestWithdraw } from "../../src/app/api/v1/guest/razorpay/problems/[id]/withdraw/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureRazorpayDisputes } from "../../src/server/compose/razorpayDisputes";
import { AppError } from "../../src/server/errors";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import type { RazorpayDisputeService } from "../../src/server/services/razorpay/disputeService";
import { catalog, makeSession } from "./helpers/session";

const ID = "00000000-0000-4000-8000-000000000001";
const sessions = new Map<string, VerifiedSession>([
  ["guest", makeSession({ accountRole: "guest_user", scope: { kind: "guest", id: ID } })],
  ["company", makeSession({ accountRole: "corporate_user", scope: { kind: "company", id: ID } })],
  ["super", makeSession({ roleKey: "front_desk", roleLevel: 2 })],
]);
let calls: { fn: string; args: unknown[] }[] = [];

const stub = (): RazorpayDisputeService => {
  const record = (fn: string) => async (...args: unknown[]) => {
    calls.push({ fn, args: args.slice(1).filter((a) => !(a && typeof a === "object" && "traceId" in a)) });
    // the stand-in for the real rule: only portal logins may call the portal functions, only staff the hotel ones
    const s = args[0] as VerifiedSession;
    const portal = fn === "myPayments" || fn === "mine" || fn === "raise" || fn === "withdraw";
    if (portal ? s.accountRole !== "guest_user" && s.accountRole !== "corporate_user" : s.accountRole !== "hotel_user") throw new AppError("FORBIDDEN");
    return { ok: fn };
  };
  return { myPayments: record("myPayments"), mine: record("mine"), raise: record("raise"), withdraw: record("withdraw"), list: record("list"), respond: record("respond") } as unknown as RazorpayDisputeService;
};

beforeEach(() => {
  calls = [];
  configureRazorpayDisputes(stub());
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

const get = (url: string, who?: string) => new Request(`https://hms.test${url}`, { headers: { host: "hms.test", ...(who ? { "x-test-session": who } : {}) } });
const post = (url: string, body: unknown, who?: string) => new Request(`https://hms.test${url}`, { method: "POST", headers: { host: "hms.test", origin: "https://hms.test", "content-type": "application/json", ...(who ? { "x-test-session": who } : {}) }, body: JSON.stringify(body) });
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const good = { business: "hotel", paymentId: "pay_Qx81aL02kPd9Zt", kind: "dispute", title: "Charged twice", message: "I see two debits" };

describe("payment problem routes", () => {
  test("nobody signed in is 401 on every route", async () => {
    assert.equal((await guestPayments(get("/api/v1/guest/razorpay/payments"), ctx())).status, 401);
    assert.equal((await guestProblems(get("/api/v1/guest/razorpay/problems"), ctx())).status, 401);
    assert.equal((await adminList(get("/api/v1/admin/razorpay/disputes"), ctx())).status, 401);
    assert.equal(calls.length, 0);
  });

  test("a guest and a company read their own payments and problems; the service is called with the checked query", async () => {
    assert.equal((await guestPayments(get("/api/v1/guest/razorpay/payments?status=captured&page=2", "guest"), ctx())).status, 200);
    assert.deepEqual(calls[0], { fn: "myPayments", args: [{ status: "captured", page: 2, pageSize: 25 }] });
    assert.equal((await corporateProblems(get("/api/v1/corporate/razorpay/problems?status=open", "company"), ctx())).status, 200);
    assert.deepEqual(calls[1].args, [{ status: "open", page: 1, pageSize: 25 }]);
    assert.equal((await guestProblems(get("/api/v1/guest/razorpay/problems", "guest"), ctx())).status, 200);
    assert.equal((calls[2].args[0] as { status: string }).status, "all");
  });

  test("a bad query or body is 422 and never reaches the service: a made-up status, an unknown field, a short or odd payment id, an amount under a rupee", async () => {
    assert.equal((await guestPayments(get("/api/v1/guest/razorpay/payments?status=bogus", "guest"), ctx())).status, 422);
    assert.equal((await guestPayments(get("/api/v1/guest/razorpay/payments?pageSize=1000", "guest"), ctx())).status, 422);
    assert.equal((await guestRaise(post("/api/v1/guest/razorpay/problems", { ...good, extra: 1 }, "guest"), ctx())).status, 422);
    assert.equal((await guestRaise(post("/api/v1/guest/razorpay/problems", { ...good, paymentId: "x; DROP TABLE" }, "guest"), ctx())).status, 422);
    assert.equal((await guestRaise(post("/api/v1/guest/razorpay/problems", { ...good, kind: "shout" }, "guest"), ctx())).status, 422);
    assert.equal((await guestRaise(post("/api/v1/guest/razorpay/problems", { ...good, amountPaise: 50 }, "guest"), ctx())).status, 422);
    assert.equal((await guestRaise(post("/api/v1/guest/razorpay/problems", { ...good, message: "x".repeat(2001) }, "guest"), ctx())).status, 422);
    assert.equal(calls.length, 0);
  });

  test("raising and withdrawing reach the service with what was sent", async () => {
    assert.equal((await guestRaise(post("/api/v1/guest/razorpay/problems", { ...good, amountPaise: 250000 }, "guest"), ctx())).status, 200);
    assert.deepEqual(calls[0], { fn: "raise", args: [{ ...good, amountPaise: 250000 }] });
    assert.equal((await guestWithdraw(post("/api/v1/guest/razorpay/problems/x/withdraw", {}, "guest"), ctx({ id: ID }))).status, 200);
    assert.deepEqual(calls[1], { fn: "withdraw", args: [ID, undefined] });
  });

  test("staff cannot use the portal routes (403) and a guest cannot use the hotel's answer routes (403)", async () => {
    assert.equal((await guestPayments(get("/api/v1/guest/razorpay/payments", "super"), ctx())).status, 403);
    assert.equal((await guestRaise(post("/api/v1/guest/razorpay/problems", good, "super"), ctx())).status, 403);
    assert.equal((await adminList(get("/api/v1/admin/razorpay/disputes", "guest"), ctx())).status, 403);
    assert.equal((await adminRespond(post(`/api/v1/admin/razorpay/disputes/${ID}/respond`, { status: "answered", reply: "Done" }, "company"), ctx({ id: ID }))).status, 403);
  });

  test("hotel staff list (open by default) and answers; a status that is not 'answered' or 'closed' is refused", async () => {
    assert.equal((await adminList(get("/api/v1/admin/razorpay/disputes", "super"), ctx())).status, 200);
    assert.equal((calls[0].args[0] as { status: string }).status, "open");
    assert.equal((await adminRespond(post(`/api/v1/admin/razorpay/disputes/${ID}/respond`, { status: "answered", reply: "We refunded it." }, "super"), ctx({ id: ID }))).status, 200);
    assert.deepEqual(calls[1], { fn: "respond", args: [ID, { status: "answered", reply: "We refunded it." }] });
    assert.equal((await adminRespond(post(`/api/v1/admin/razorpay/disputes/${ID}/respond`, { status: "open" }, "super"), ctx({ id: ID }))).status, 422);
    assert.equal((await adminRespond(post(`/api/v1/admin/razorpay/disputes/not-an-id/respond`, { status: "closed" }, "super"), ctx({ id: "not-an-id" }))).status, 422);
  });
});

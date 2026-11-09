// The Group Hotel Admin's payments route, through the REAL route file with a stub service (the reading itself is tested on the real database in tests/db/razorpay.group.test.ts):
// nobody signed in is 401, and the signed-in session is what reaches the service (the group console decides whose hotels are read).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as groupPayments } from "../../src/app/api/v1/group/payments/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureGroupPayments } from "../../src/server/compose/groupPayments";
import { AppError } from "../../src/server/errors";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import type { GroupPaymentsService } from "../../src/server/services/razorpay/groupPaymentsService";
import { catalog, makeSession } from "./helpers/session";

const sessions = new Map<string, VerifiedSession>([
  ["group", makeSession({ hotelId: "", accountRole: "hotel_admin", roleKey: "group_admin" })],
  ["staff", makeSession({ roleKey: "front_desk", roleLevel: 2 })],
]);
let seen: VerifiedSession[] = [];

beforeEach(() => {
  seen = [];
  configureGroupPayments({
    overview: async (s: VerifiedSession) => {
      seen.push(s);
      // the stand-in for the group console's own rule: only a group admin's session reaches a group's hotels
      if (s.roleKey !== "group_admin") throw new AppError("FORBIDDEN");
      return { hotels: [], totals: { todayPaise: 0, monthPaise: 0, failed: 0, refundedPaise: 0, openProblems: 0 }, recent: [], unavailable: [] };
    },
  } as unknown as GroupPaymentsService);
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

const get = (who?: string) => new Request("https://hms.test/api/v1/group/payments", { headers: { host: "hms.test", ...(who ? { "x-test-session": who } : {}) } });

describe("group payments route", () => {
  test("nobody signed in is 401 and the service is never asked", async () => {
    assert.equal((await groupPayments(get(), { params: Promise.resolve({}) })).status, 401);
    assert.equal(seen.length, 0);
  });

  test("a group admin gets the overview, and it is never cached; a hotel's staff member is refused (403)", async () => {
    const ok = await groupPayments(get("group"), { params: Promise.resolve({}) });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control") ?? "", /no-cache|no-store|private/);
    assert.equal(seen[0].roleKey, "group_admin");
    assert.equal((await groupPayments(get("staff"), { params: Promise.resolve({}) })).status, 403);
  });
});
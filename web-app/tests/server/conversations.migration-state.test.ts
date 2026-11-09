// Conversations before the database update (platform 0139 / hotel 0050 not run yet, decision 66): the badge's summary and the mail check answer 200 with the plain "needs
// the latest database update" state (so the poll stops by itself); every other route answers 409 with the sentence; never a server error.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { conversationsCopy } from "@shared/dashboards/conversations";
import { GET as listRoute } from "../../src/app/api/v1/conversations/route";
import { GET as summaryRoute } from "../../src/app/api/v1/conversations/summary/route";
import { POST as syncRoute } from "../../src/app/api/v1/conversations/sync/route";
import { GET as threadRoute } from "../../src/app/api/v1/conversations/[id]/route";
import { POST as noteRoute } from "../../src/app/api/v1/conversations/[id]/notes/route";
import { GET as quickRoute } from "../../src/app/api/v1/conversations/quick-replies/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureConversations } from "../../src/server/compose/conversations";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { ConversationsNotReady, type ConversationsRepos } from "../../src/server/repos/conversations";
import type { Unit } from "../../src/server/repos/types";
import { createConversationsService } from "../../src/server/services/conversations/conversationsService";
import { createFakeImap, KEY } from "./helpers/conversations";
import { catalog, makeSession } from "./helpers/session";

const sessions = new Map<string, VerifiedSession>([["admin", makeSession({ accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 })]]);
const ORIGIN = "https://hms.test";
const req = (method: string, path: string, body?: unknown) => new Request(`${ORIGIN}${path}`, { method, headers: { host: "hms.test", origin: ORIGIN, "x-test-session": "admin", ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const ID = "00000000-0000-4000-8000-000000000001";
const ctx = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  // every unit fails as PostgreSQL does when the table is missing (42P01, turned into ConversationsNotReady by the repository)
  const unit: Unit<ConversationsRepos> = { run: async () => Promise.reject(new ConversationsNotReady()) };
  configureConversations(createConversationsService({ unit, people: { get: async () => new Map() }, catalog, now: () => new Date(), smtpKey: () => KEY, imap: createFakeImap().factory, staff: async () => [] }));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

describe("before platform 0139 and hotel 0050", () => {
  test("the summary and the mail check answer 200 with the 'needs update' state", async () => {
    for (const r of [await summaryRoute(req("GET", "/api/v1/conversations/summary")), await syncRoute(req("POST", "/api/v1/conversations/sync", { background: true }))]) {
      assert.equal(r.status, 200);
      const data = (await r.json()).data;
      assert.deepEqual([data.unread, data.mailbox.state, data.mailbox.reason, data.mailbox.message], [0, "not_available", "needs_update", conversationsCopy.mailbox.needsUpdate]);
    }
  });

  test("every other route answers 409 with the sentence, never a 5xx", async () => {
    const answers = [
      await listRoute(req("GET", "/api/v1/conversations")),
      await threadRoute(req("GET", `/api/v1/conversations/${ID}`), ctx),
      await noteRoute(req("POST", `/api/v1/conversations/${ID}/notes`, { text: "x" }), ctx),
      await quickRoute(req("GET", "/api/v1/conversations/quick-replies")),
    ];
    for (const r of answers) {
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error.message, conversationsCopy.errors.needsUpdate);
    }
  });
});

// Conversations, nothing personal in plain form where it does not belong (decision 66, A6): no subject, preview, address, number, note or reply text in the server's log
// lines or in the hotel's system log after a mail check, an opened email, a reply, a note or a failed check; the six tables with personal data are left out of the hotel
// export and their rows out of the pg_dump backups; no write of Conversations leaves a copy in the idempotency store, even when the client sends an Idempotency-Key.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { pgDumpArgs } from "../../../common/db/scripts/backup";
import { EXPORT_SKIPS } from "../../../common/db/scripts/hotel-data";
import { POST as syncRoute } from "../../src/app/api/v1/conversations/sync/route";
import { POST as replyRoute } from "../../src/app/api/v1/conversations/[id]/reply/route";
import { POST as noteRoute } from "../../src/app/api/v1/conversations/[id]/notes/route";
import { PUT as linkRoute } from "../../src/app/api/v1/conversations/[id]/link/route";
import { GET as bodyRoute } from "../../src/app/api/v1/conversations/[id]/messages/[messageId]/body/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureConversations } from "../../src/server/compose/conversations";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { redact } from "../../src/server/logger/redact";
import { guestMail, hotelWorld, STAFF } from "./helpers/conversations";
import { catalog, makeSession } from "./helpers/session";

const sessions = new Map<string, VerifiedSession>([["admin", makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 })]]);
const ORIGIN = "https://hms.test";
const req = (method: string, path: string, body?: unknown, key?: string): Request =>
  new Request(`${ORIGIN}${path}`, { method, headers: { host: "hms.test", origin: ORIGIN, "x-test-session": "admin", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

let w = hotelWorld();
let lines: string[] = [];
let store = createMemoryIdempotencyStore();
const SECRETS = ["Wedding anniversary dinner", "asha@guest.in", "Asha Rao", "98250", "Surprise cake at 9", "Keep the cake hidden", "Room 204 is ready", "bounty@attacker.example"];

beforeEach(() => {
  w = hotelWorld();
  lines = [];
  store = createMemoryIdempotencyStore();
  configureConversations(w.service);
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: store, logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }) });
});

describe("logs and the system log", () => {
  test("after a check, an opened email, a reply, a note and a failed check, no subject, preview, address, name, number or text appears", async () => {
    w.imap.deliver("inbox", guestMail({ from: "asha@guest.in", fromName: "Asha Rao", subject: "Wedding anniversary dinner", text: "Surprise cake at 9, call 98250 12345" }), new Date("2026-10-24T09:59:00Z"));
    assert.equal((await syncRoute(req("POST", "/api/v1/conversations/sync", {}))).status, 200);
    const m = w.data().convMessages[0];
    assert.equal((await bodyRoute(req("GET", `/api/v1/conversations/${m.conversationId}/messages/${m.id}/body`), ctx({ id: m.conversationId, messageId: m.id }))).status, 200);
    assert.equal((await replyRoute(req("POST", `/api/v1/conversations/${m.conversationId}/reply`, { channel: "email", text: "Room 204 is ready" }), ctx({ id: m.conversationId }))).status, 201);
    assert.equal((await noteRoute(req("POST", `/api/v1/conversations/${m.conversationId}/notes`, { text: "Keep the cake hidden" }), ctx({ id: m.conversationId }))).status, 201);
    w.imap.failConnect(Object.assign(new Error("NO [AUTHENTICATIONFAILED] Invalid credentials for asha@guest.in"), { authenticationFailed: true }));
    w.clock.now = new Date(w.clock.now.getTime() + 120_000);
    await w.service.sync(sessions.get("admin")!, {});
    const everything = JSON.stringify({ lines, service: w.logs, audit: w.data().systemLogs });
    for (const s of SECRETS) assert.ok(!everything.includes(s), s);
    assert.deepEqual(w.data().systemLogs.map((l) => [l.module, l.summary, l.subjectLabel]), [["conversations", "Reply sent", "Conversation"], ["conversations", "Note added", "Conversation"]]);
  });

  test("the redaction drops an email's parts by name, wherever a log line carries them", () => {
    const out = JSON.stringify(redact({ subject: "Wedding anniversary dinner", preview: "Surprise cake at 9", from: "asha@guest.in", to: ["asha@guest.in"], cc: ["x@y.in"], replyTo: "bounty@attacker.example", html: "<p>x</p>", text: "t", references: "<a@b>", snippet: "s", count: 3 }));
    for (const s of SECRETS) assert.ok(!out.includes(s), s);
    assert.match(out, /"count":3/);
  });
});

describe("exports, backups and the idempotency store", () => {
  test("the hotel export skips the six tables with personal data and the mail positions; pg_dump leaves out every conv_* table's rows", () => {
    for (const t of ["conv_contacts", "conv_contact_handles", "conv_conversations", "conv_messages", "conv_notes", "conv_mail_positions"]) assert.ok(EXPORT_SKIPS.has(t), t);
    const args = pgDumpArgs({ host: "db", port: "5432", user: "hms_owner", database: "hms" }, "out.dump");
    assert.ok(args.includes("--exclude-table-data=*.conv_*"));
    assert.ok(args.includes("--exclude-table-data=*.pmail_*"), "the staff's personal mailboxes are left out of a backup too (and forced row security would stop pg_dump on them)");
    assert.ok(args.includes("--no-password"), "the password goes through the environment only");
  });

  test("a reply, a note and a link sent WITH an Idempotency-Key leave nothing in the idempotency store", async () => {
    w.imap.deliver("inbox", guestMail({ from: "asha@guest.in" }), new Date("2026-10-24T09:59:00Z"));
    await w.service.sync(sessions.get("admin")!, {});
    const id = w.data().convConversations[0].id;
    w.data().customers.push({ id: "00000000-0000-4000-8000-00000000c001", name: "Asha Rao", mobile: "9825012345", email: "asha@guest.in" } as never);
    assert.equal((await replyRoute(req("POST", `/api/v1/conversations/${id}/reply`, { channel: "email", text: "Room 204 is ready" }, "k-reply-000000000001"), ctx({ id }))).status, 201);
    assert.equal((await noteRoute(req("POST", `/api/v1/conversations/${id}/notes`, { text: "Keep the cake hidden" }, "k-note-0000000000001"), ctx({ id }))).status, 201);
    assert.equal((await linkRoute(req("PUT", `/api/v1/conversations/${id}/link`, { kind: "customer", targetId: "00000000-0000-4000-8000-00000000c001" }, "k-link-0000000000001"), ctx({ id }))).status, 200);
    assert.equal(store.size(), 0);
  });
});

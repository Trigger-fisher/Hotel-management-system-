// Conversations, an email's attachments (decision 66): read from the mailbox when asked, never stored; always a download (Content-Disposition: attachment, nosniff, no-store),
// served as its own type only from a short safe list (else application/octet-stream), at most 4 MB; a missing part is 404; a bill PDF HMS sent needs the Bills right.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { conversationsCopy } from "@shared/dashboards/conversations";
import { GET as attachmentRoute } from "../../src/app/api/v1/conversations/[id]/messages/[messageId]/attachments/[part]/route";
import { GET as bodyRoute } from "../../src/app/api/v1/conversations/[id]/messages/[messageId]/body/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureConversations } from "../../src/server/compose/conversations";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { guestMail, hotelWorld, STAFF } from "./helpers/conversations";
import { catalog, grant, makeSession } from "./helpers/session";

const sessions = new Map<string, VerifiedSession>([
  ["admin", makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 })],
  ["view", makeSession({ userId: STAFF.viewer, accountRole: "hotel_user", roleKey: "viewer", roleLevel: 1, grants: [grant("conversations", "view")] })],
  ["viewBills", makeSession({ userId: STAFF.viewer, accountRole: "hotel_user", roleKey: "viewer", roleLevel: 1, grants: [grant("conversations", "view"), grant("bills.bills", "view")] })],
]);
const ORIGIN = "https://hms.test";
const get = (path: string, who: string) => new Request(`${ORIGIN}${path}`, { headers: { host: "hms.test", origin: ORIGIN, "x-test-session": who } });
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
let w = hotelWorld();

beforeEach(() => {
  w = hotelWorld();
  configureConversations(w.service);
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

describe("downloading an attachment", () => {
  test("a download with nosniff and no-store; an unsafe type becomes octet-stream; over 4 MB is a plain 409; a missing part is 404", async () => {
    w.imap.deliver("inbox", guestMail({
      from: "ravi@guest.in",
      attachments: [
        { name: "Menu card.pdf", type: "application/pdf", content: Buffer.from("%PDF-1.4 menu") },
        { name: "invoice.html", type: "text/html", content: Buffer.from("<script>alert(1)</script>") },
        { name: "photos.zip", type: "application/zip", content: Buffer.alloc(5 * 1024 * 1024, 1) },
      ],
    }), new Date("2026-10-24T09:59:00Z"));
    await w.service.sync(sessions.get("admin")!, {});
    const m = w.data().convMessages[0];
    const path = (part: number) => `/api/v1/conversations/${m.conversationId}/messages/${m.id}/attachments/${part}`;
    const pdf = await attachmentRoute(get(path(0), "view"), ctx({ id: m.conversationId, messageId: m.id, part: "0" }));
    assert.equal(pdf.status, 200);
    assert.deepEqual([pdf.headers.get("content-type"), pdf.headers.get("content-disposition"), pdf.headers.get("x-content-type-options"), pdf.headers.get("cache-control")], ["application/pdf", 'attachment; filename="Menu-card.pdf"', "nosniff", "no-store"]);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).toString(), "%PDF-1.4 menu");
    const html = await attachmentRoute(get(path(1), "view"), ctx({ id: m.conversationId, messageId: m.id, part: "1" }));
    assert.deepEqual([html.status, html.headers.get("content-type"), html.headers.get("content-disposition")], [200, "application/octet-stream", 'attachment; filename="invoice.html"']);
    assert.equal((await attachmentRoute(get(path(2), "view"), ctx({ id: m.conversationId, messageId: m.id, part: "2" }))).status, 409);
    assert.equal((await attachmentRoute(get(path(9), "view"), ctx({ id: m.conversationId, messageId: m.id, part: "9" }))).status, 404);
    assert.equal((await attachmentRoute(get(path(300), "view"), ctx({ id: m.conversationId, messageId: m.id, part: "300" }))).status, 422);
    assert.ok(!JSON.stringify(w.data().convMessages).includes("%PDF"), "nothing of an attachment is stored");
  });

  test("a bill PDF HMS sent opens only with the Bills right (the list marks it locked)", async () => {
    w.imap.deliver("inbox", guestMail({ from: "asha@guest.in" }), new Date("2026-10-24T09:59:00Z"));
    await w.service.sync(sessions.get("admin")!, {});
    const conv = w.data().convConversations[0];
    const billId = "00000000-0000-4000-8000-00000000b001";
    const stayId = "00000000-0000-4000-8000-00000000d001";
    w.data().bills.push({ id: billId, billNumber: "B-1", deletedAt: null, totalHotelAmountPaise: 100000, totalFoodAmountPaise: 0 } as never);
    w.data().stays.push({ id: stayId, guestName: "Asha Rao", email: "asha@guest.in", mobile: null, status: "in_house", checkInAt: new Date("2026-10-23T08:00:00Z"), roomId: "00000000-0000-4000-8000-00000000e001", billId, expectedCheckOut: "2026-10-26", checkOutAt: null } as never);
    w.data().convContacts[0].link = { kind: "stay", id: stayId, source: "manual" };
    const sent = await w.service.reply(sessions.get("admin")!, conv.id, { channel: "email", text: "Your bill", billId }, { traceId: "t", ip: null });
    const bodyOf = async (who: string) => (await (await bodyRoute(get(`/api/v1/conversations/${conv.id}/messages/${sent.id}/body`, who), ctx({ id: conv.id, messageId: sent.id }))).json()).data;
    assert.deepEqual((await bodyOf("view")).attachments.map((a: { billLocked?: boolean }) => a.billLocked), [true]);
    assert.deepEqual((await bodyOf("viewBills")).attachments.map((a: { billLocked?: boolean }) => a.billLocked), [undefined]);
    const locked = await attachmentRoute(get(`/api/v1/conversations/${conv.id}/messages/${sent.id}/attachments/0`, "view"), ctx({ id: conv.id, messageId: sent.id, part: "0" }));
    assert.equal(locked.status, 403);
    assert.equal((await locked.json()).error.message, conversationsCopy.email.billLocked);
    const open = await attachmentRoute(get(`/api/v1/conversations/${conv.id}/messages/${sent.id}/attachments/0`, "viewBills"), ctx({ id: conv.id, messageId: sent.id, part: "0" }));
    assert.deepEqual([open.status, open.headers.get("content-type")], [200, "application/pdf"]);
  });
});

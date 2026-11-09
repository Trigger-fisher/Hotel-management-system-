// Customer support, the hotel's side (hotel migration 0042), end to end through the REAL route files and ONE in-memory store. The guest side (GET/POST /guest/support) was
// removed on 18 Oct 2026 (MJ: no Customer support in the guest portal); the messages already sent stay, and the front desk still lists, answers and closes them. The log
// keeps the subject only, never the message or the reply.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { POST as respondRoute } from "../../src/app/api/v1/front-office/support/[id]/respond/route";
import { GET as deskListRoute } from "../../src/app/api/v1/front-office/support/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureSupportDesk } from "../../src/server/compose/supportDesk";
import type { SupportRequestRecord } from "../../src/server/repos/supportRequests";
import type { Person } from "../../src/server/services/cash/ports";
import { createSupportDesk } from "../../src/server/services/support/deskService";
import { ctx, customer, json, pid, req, wirePortal } from "./helpers/portalWorld";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const CUST = pid(11);
const OTHER = pid(13);
const CLERK = pid(701);

const sessions = new Map<string, VerifiedSession>();
sessions.set("amit", makeSession({ userId: pid(900), hotelId: HOTEL_A, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: CUST } }));
const staffOf = (name: string, level: "view" | "edit", hotelId = HOTEL_A, userId = pid(700 + sessions.size)) =>
  sessions.set(name, makeSession({ userId, hotelId, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web", grants: [grant("pms", level)] }));
staffOf("viewer", "view");
staffOf("clerk", "edit", HOTEL_A, CLERK);
staffOf("clerkB", "edit", HOTEL_B);
const people = new Map<string, Person>([[CLERK, { id: CLERK, name: "Riya Desk", roleKey: "editor", roleLevel: 2, deleted: false }]]);

let clock = new Date("2026-10-05T10:00:00+05:30");
let world = wirePortal(sessions, () => clock);
const data = (hotelId = HOTEL_A) => world.hotel.store.dataFor(hotelId);
let seq = 0;
/** A message a guest sent before the guest side went away. */
const sent = (over: Partial<SupportRequestRecord> = {}): SupportRequestRecord => {
  seq += 1;
  const row: SupportRequestRecord = { id: pid(5000 + seq), number: `S-00000${seq}`, customerId: CUST, guestName: "Amit Joshi", subject: "Wrong charge on my bill", message: "The laundry was charged twice on 4 October.\nPlease check.", billRef: null, orderRef: null, status: "open", reply: null, repliedAt: null, repliedBy: null, repliedByName: null, createdBy: null, createdAt: new Date(Date.parse("2026-10-05T03:00:00Z") + seq * 60_000), ...over };
  data().supportRequests.push(row);
  return row;
};

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  world = wirePortal(sessions, () => clock);
  configureSupportDesk(createSupportDesk({ unit: world.hotel.unit, people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, catalog, now: () => clock }));
  data().customers.push(customer({ id: CUST, mobile: "9876543210" }), customer({ id: OTHER, name: "Bina Shah", mobile: "9123456780" }));
});

const ok = async (res: Response, status = 200) => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};
const respond = (id: string, body: unknown, who = "clerk") => respondRoute(req("POST", `/api/v1/front-office/support/${id}/respond`, who, body), ctx({ id }));
const fields = async (res: Response) => (await json(res)).error.details?.fields ?? {};

describe("the desk answers the messages already sent", () => {
  test("the queue is oldest first with the open count; an answer names who answered; logged without the message or reply text", async () => {
    const first = sent();
    sent({ customerId: OTHER, guestName: "Bina Shah", subject: "Late check-out", message: "Could I keep the room until 2 pm?" });
    const queue = await ok(await deskListRoute(req("GET", "/api/v1/front-office/support", "viewer"), ctx()));
    assert.deepEqual(queue.items.map((m: { subject: string; guestName: string }) => [m.subject, m.guestName]), [["Wrong charge on my bill", "Amit Joshi"], ["Late check-out", "Bina Shah"]]);
    assert.equal(queue.openCount, 2);
    const answered = await ok(await respond(first.id, { status: "answered", reply: "Sorry! We removed the second laundry charge." }));
    assert.deepEqual([answered.status, answered.repliedByName, answered.reply], ["answered", "Riya Desk", "Sorry! We removed the second laundry charge."]);
    const logs = data().systemLogs.filter((l) => l.entity === "Support request");
    assert.equal(logs.length, 1);
    assert.ok(!JSON.stringify(logs).includes("charged twice"), "the message text is not logged");
    assert.ok(!JSON.stringify(logs).includes("removed the second"), "nor the reply");
  });

  test("answer needs a reply; close does not; a closed message is final", async () => {
    const one = sent();
    assert.ok((await fields(await respond(one.id, { status: "answered", reply: " " }))).reply);
    assert.equal((await ok(await respond(one.id, { status: "closed" }))).status, "closed");
    assert.equal((await respond(one.id, { status: "answered", reply: "Late" })).status, 409);
    assert.equal((await respond(pid(999), { status: "closed" })).status, 404);
  });
});

describe("nobody reads what is not theirs", () => {
  test("another hotel's desk cannot see or answer; a guest has no desk; view cannot answer", async () => {
    const one = sent();
    assert.equal((await ok(await deskListRoute(req("GET", "/api/v1/front-office/support", "clerkB"), ctx()))).items.length, 0);
    assert.equal((await respond(one.id, { status: "closed" }, "clerkB")).status, 404);
    assert.equal((await deskListRoute(req("GET", "/api/v1/front-office/support", "amit"), ctx())).status, 403);
    assert.equal((await respond(one.id, { status: "closed" }, "viewer")).status, 403);
  });
});

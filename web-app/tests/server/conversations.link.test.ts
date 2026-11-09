// Conversations, who an address or a number belongs to (decision 66): addresses in lower case, numbers as digits with the country code (a bare 10-digit Indian mobile gets
// 91) and matched by their last 10 digits; the hotel's order is the in-house stay, then the latest stay, a coming booking, the guest record, the company. "Link guest" by
// hand replaces an automatic link and can be removed (the messages stay).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { displayPhone, last10, normaliseEmail, normalisePhone } from "../../src/server/conversations/match";
import { bindHotelMatcher, emptyConversationsHotelData } from "../../src/server/repos/memory/conversations";
import { guestMail, hotelWorld, STAFF } from "./helpers/conversations";
import { makeSession } from "./helpers/session";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function hotelData() {
  const d = emptyConversationsHotelData();
  d.rooms.push({ id: id(900), number: "204" } as never, { id: id(901), number: "105" } as never);
  d.stays.push(
    { id: id(1), guestName: "Asha Rao", email: "Asha@Guest.in", mobile: "098250-12345", status: "checked_out", checkInAt: new Date("2026-09-01T08:00:00Z"), checkOutAt: new Date("2026-09-03T05:00:00Z"), expectedCheckOut: "2026-09-03", roomId: id(901), billId: null } as never,
    { id: id(2), guestName: "Asha Rao", email: "asha@guest.in", mobile: "+91 98250 12345", status: "in_house", checkInAt: new Date("2026-08-01T08:00:00Z"), checkOutAt: null, expectedCheckOut: "2026-10-26", roomId: id(900), billId: null } as never,
  );
  d.reservations.push({ id: id(3), guestName: "Ravi Shah", reference: "R-77", email: "ravi@guest.in", mobile: "9900011122", status: "confirmed", checkIn: "2026-11-01", checkOut: "2026-11-03" } as never);
  d.customers.push({ id: id(4), name: "Mehul Patel", mobile: "9811122233", email: "mehul@guest.in" } as never);
  d.companyProfiles.push({ id: id(5), name: "Acme Travels", email: "bookings@acme.in", deletedAt: null } as never);
  return d;
}

describe("normalising and matching", () => {
  test("addresses in lower case; numbers with the country code; matched by the last 10 digits", () => {
    assert.equal(normaliseEmail("  Asha@Guest.IN "), "asha@guest.in");
    assert.equal(normaliseEmail("not an address"), null);
    assert.deepEqual(["+91 98250 12345", "098250 12345", "9825012345", "0091 9825012345"].map(normalisePhone), ["919825012345", "919825012345", "919825012345", "919825012345"]);
    assert.equal(normalisePhone("+44 20 7946 0958"), "442079460958");
    assert.equal(normalisePhone("12345"), null);
    assert.equal(last10("919825012345"), "9825012345");
    assert.equal(displayPhone("919825012345"), "+91 98250 12345");
  });

  test("the in-house stay first, then a booking, the guest record, the company; by address or by number", async () => {
    const m = bindHotelMatcher(hotelData());
    assert.deepEqual(await m.byEmail("asha@guest.in"), { kind: "stay", id: id(2), label: "Asha Rao · Room 204" });
    assert.deepEqual(await m.byPhone("919825012345"), { kind: "stay", id: id(2), label: "Asha Rao · Room 204" });
    assert.deepEqual(await m.byEmail("ravi@guest.in"), { kind: "reservation", id: id(3), label: "Ravi Shah · R-77" });
    assert.deepEqual(await m.byPhone("919811122233"), { kind: "customer", id: id(4), label: "Mehul Patel" });
    assert.deepEqual(await m.byEmail("bookings@acme.in"), { kind: "company", id: id(5), label: "Acme Travels" });
    assert.equal(await m.byEmail("stranger@nowhere.in"), null);
    assert.deepEqual((await m.search(["asha"], ["stay"])).map((c) => c.id), [id(2), id(1)]);
    assert.deepEqual(await m.search(["asha"], ["company"]), []);
  });
});

describe("Link guest by hand", () => {
  test("a manual link replaces none, shows in the thread, and can be removed; the messages stay; a missing record is 404", async () => {
    const w = hotelWorld();
    const admin = makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
    w.data().customers.push({ id: id(4), name: "Mehul Patel", mobile: "9811122233", email: "mehul@guest.in" } as never);
    w.imap.deliver("inbox", guestMail({ from: "m.patel@other.in" }), new Date("2026-10-24T09:59:00Z"));
    await w.service.sync(admin, {});
    const conv = w.data().convConversations[0];
    const meta = { traceId: "t", ip: null };
    assert.deepEqual((await w.service.linkCandidates(admin, "mehul", "customer")).map((c) => c.id), [id(4)]);
    const linked = await w.service.setLink(admin, conv.id, { kind: "customer", targetId: id(4) }, meta);
    assert.deepEqual(linked.links.map((l) => [l.kind, l.id, l.label, l.source]), [["customer", id(4), "Mehul Patel", "manual"]]);
    await assert.rejects(w.service.setLink(admin, conv.id, { kind: "customer", targetId: id(99) }, meta), (e: unknown) => (e as { code?: string }).code === "NOT_FOUND");
    const cleared = await w.service.clearLink(admin, conv.id, meta);
    assert.deepEqual([cleared.links, cleared.messages.length], [[], 1]);
    assert.deepEqual(w.data().systemLogs.map((l) => l.summary), ["Guest linked", "Link removed"]);
  });
});

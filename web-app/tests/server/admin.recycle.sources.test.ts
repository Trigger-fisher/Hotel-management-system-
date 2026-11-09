// The recycle bin over the REAL bill and advance services (compose/recycle.ts): a deleted bill and advance appear in the bin with their numbers, the module's own
// restore brings them back (its rules, its "Restored by" system-log line), the module's own removal takes them for good, and the nightly clean-up removes the old
// ones as the system. Spec: docs/specs/admin.md §9.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { VerifiedSession } from "../../src/server/auth/session";
import { billingRecycleSources } from "../../src/server/compose/recycle";
import { buildAdminServices } from "../../src/server/compose/admin";
import { createMemoryAdminPlatform } from "../../src/server/repos/memory/adminPlatform";
import { createMemoryAdminUsers } from "../../src/server/repos/memory/adminUsers";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import { createAdvanceService } from "../../src/server/services/billing/advanceService";
import { createBillService } from "../../src/server/services/billing/billService";
import type { Person } from "../../src/server/services/cash/ports";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([[id(5), { id: id(5), name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]);
const root: VerifiedSession = makeSession({ userId: id(5), client: "web", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("bills", "full")] });
const DAY = 86_400_000;
const meta = { ip: null, userAgent: null, traceId: "t" } as never;

let clock = new Date("2026-10-05T10:00:00+05:30");
let hotel = createMemoryHotel();
let recycle: ReturnType<typeof buildAdminServices>["recycle"];

const billInput = {
  billNo: "1188", billDate: "2026-10-05", grNo: "GR-77", advanceId: null, guestName: "Ravi Mehta", mobile: "9876543210", address: "Rajkot", gstin: "", companyId: null, roomNo: "204", persons: 2,
  arrivalAt: "2026-10-02T12:00:00Z", departureAt: "2026-10-05T05:30:00Z",
  hotel: { plan: "CP", roomPaise: 400000, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0, mode: "Cash" },
  food: { foodPaise: 0, planPaise: 0, laundryPaise: 0, gstPaise: 0, mode: "Cash" },
  stay: [], referenceName: "", referenceMobile: "", instruction: "",
};
const advanceInput = { receiptNo: "814", paymentDate: "2026-10-01", guestName: "Sita Shah", mobile: "", companyId: null, roomNo: "", covers: "hotel", hotelPaise: 500000, foodPaise: null, hotelMode: "Cash", foodMode: null, instruction: "" };

let bills: ReturnType<typeof createBillService>;
let advances: ReturnType<typeof createAdvanceService>;

// the in-memory repositories stamp a deletion with the real time, so the clock starts there
beforeEach(() => {
  clock = new Date();
  hotel = createMemoryHotel();
  const data = hotel.store.dataFor(HOTEL_A);
  data.years = [{ id: "y2", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" }];
  data.profile = { name: "Hotel Sunrise", foodName: "Sunrise Food", address: "Rajkot", phone: "0281", gstin: null, foodGstin: null };
  const deps = { unit: hotel.unit, people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, audit: { record: async () => undefined }, catalog, now: () => clock };
  bills = createBillService(deps as never);
  advances = createAdvanceService(deps as never);
  recycle = buildAdminServices(
    deps as never,
    createMemoryAdminPlatform().unit,
    { unit: createMemoryAdminUsers(createMemoryAuth()).unit, credentials: {} as never },
    undefined,
    billingRecycleSources({ unit: hotel.unit as never, bills: () => bills, advances: () => advances }),
  ).recycle;
});

async function makeBillAndAdvance(): Promise<{ billId: string; advanceId: string }> {
  const bill = (await bills.create(root, billInput as never, meta)) as { id: string; version: number };
  const advance = (await advances.create(root, advanceInput as never, meta)) as { id: string; version: number };
  await bills.remove(root, bill.id, bill.version, meta);
  await advances.remove(root, advance.id, advance.version, meta);
  return { billId: bill.id, advanceId: advance.id };
}

describe("the recycle bin over the real bill and advance services", () => {
  test("a deleted bill and a deleted advance are in the bin with their numbers and a line to tell them apart", async () => {
    const { billId, advanceId } = await makeBillAndAdvance();
    const page = await recycle.list(root, { page: 1, pageSize: 25 });
    assert.equal(page.total, 2);
    const bill = page.items.find((i) => i.key === "bill")!;
    const advance = page.items.find((i) => i.key === "advance")!;
    assert.deepEqual([bill.id, bill.kind, bill.label, bill.deletedBy, bill.daysLeft], [billId, "Bill", "2026 / 1188", "Sonal Super", 30]);
    assert.match(bill.detail, /^Ravi Mehta · .*4,000.* on 05-10-2026$/);
    assert.deepEqual([advance.id, advance.kind], [advanceId, "Bill advance"]);
    assert.match(advance.detail, /Sita Shah/);
  });

  test("restore goes through the module: the bill is live again and no longer in the bin", async () => {
    const { billId } = await makeBillAndAdvance();
    const r = await recycle.restore(root, "bill", billId, meta);
    assert.equal(r.message, "Bill 2026 / 1188 restored.");
    const live = await hotel.unit.run(root, (repos) => repos.bills.list({ sort: "billDate", dir: "desc", page: 1, pageSize: 10 }));
    assert.equal(live.total, 1);
    assert.equal((await recycle.list(root, { page: 1, pageSize: 25 })).total, 1);
    const log = hotel.store.dataFor(HOTEL_A).systemLogs.filter((l) => l.module === "recycle-bin");
    assert.equal(log.length, 1, "the module wrote its own line; the bin adds none");
  });

  test("remove for good goes through the module and the record is gone", async () => {
    const { advanceId } = await makeBillAndAdvance();
    const r = await recycle.purge(root, "advance", advanceId, meta);
    assert.equal(r.message, "Bill advance 2026 / 814 removed for good.");
    assert.deepEqual((await recycle.list(root, { page: 1, pageSize: 25 })).items.map((i) => i.key), ["bill"]);
  });

  test("the nightly clean-up removes what is older than the keep time, as the system", async () => {
    await makeBillAndAdvance();
    clock = new Date(clock.getTime() + 31 * DAY);
    assert.equal(await recycle.purgeExpired(HOTEL_A), 2);
    assert.equal((await recycle.list(root, { page: 1, pageSize: 25 })).total, 0);
  });

  test("the clean-up keeps what is still inside the keep time", async () => {
    await makeBillAndAdvance();
    clock = new Date(clock.getTime() + 10 * DAY);
    assert.equal(await recycle.purgeExpired(HOTEL_A), 0);
    assert.equal((await recycle.list(root, { page: 1, pageSize: 25 })).total, 2);
  });
});

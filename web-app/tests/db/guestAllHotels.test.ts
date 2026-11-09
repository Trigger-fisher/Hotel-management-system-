// "All hotels" for the GUEST portal on the REAL PostgreSQL (throwaway hms_test only): two real hotel schemas, the same guest (same mobile) with a customer record in each, the real
// guest service over the PostgreSQL portal unit. Each hotel is read in its own transaction with that hotel's customer id and the guest row-level security of 0035 (mobile match) as
// the second fence: another guest's bills never show, a hotel where the guest has no record answers nothing, and an order goes only on the guest's own stay. Run with: npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createPgPortalUnit } from "../../src/server/repos/postgres/portal";
import { createGuestService } from "../../src/server/services/guest/guestService";
import type { Memberships } from "../../src/server/services/portal/multiHotel";
import { makeSession } from "../server/helpers/session";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotelA: CreatedHotel;
let hotelB: CreatedHotel;
const USER = "00000000-0000-4000-8000-000000000b01";
const NOW = new Date("2026-10-05T10:00:00+05:30");
const MOBILE = "9825041236";
let custA = "";
let custB = "";
let stayA = "";

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  hotelA = await createTestHotel(owner, "Guest All A");
  hotelB = await createTestHotel(owner, "Guest All B");
  custA = String((await insertRow(owner, hotelA.schema, "customers", { name: "Amit Joshi", mobile: MOBILE, is_active: true })).id);
  await insertRow(owner, hotelA.schema, "customers", { name: "Deepa Iyer", mobile: "9909918273", is_active: true });
  custB = String((await insertRow(owner, hotelB.schema, "customers", { name: "Amit at B", mobile: MOBILE, is_active: true })).id);
  const billFor = (schema: string, mobile: string, number: string, date: string) =>
    insertRow(owner, schema, "bill_master_bills", { mobile_number: mobile, company_id: null, bill_number: number, bill_date: date, guest_name: "Guest", total_hotel_amount_paise: 100000, balance_hotel_amount_paise: 100000, hotel_mode_of_payment: "Debit" });
  await billFor(hotelA.schema, MOBILE, "A / 1", "2026-09-20");
  await billFor(hotelA.schema, "+91 98250 41236", "A / 2", "2026-09-25");
  await billFor(hotelA.schema, "9909918273", "A / 9", "2026-09-26");
  await billFor(hotelB.schema, MOBILE, "B / 1", "2026-09-25");
  stayA = String((await insertRow(owner, hotelA.schema, "pms_stays", { mobile: MOBILE, company_id: null, guest_name: "Amit Joshi", status: "in_house", check_in_at: "2026-10-03T08:00:00Z", expected_check_out: "2026-10-07", check_out_at: null, bill_id: null })).id);
});
after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

const links = (list: () => { hotelId: string; hotelName: string; subjectId: string }[]): Memberships => ({ list: async () => list() });
const both = () => [{ hotelId: hotelA.id, hotelName: "Hotel A", subjectId: custA }, { hotelId: hotelB.id, hotelName: "Hotel B", subjectId: custB }];
const service = (list = both) =>
  createGuestService({
    unit: createPgPortalUnit(database.withHotel),
    now: () => NOW,
    memberships: links(list),
    accounts: { lastLogins: async () => new Map() },
    credentials: { changeMyPassword: async () => ({ changed: true, otherSessionsEnded: 0 }) },
    cursorSecret: () => Buffer.alloc(32, 9),
  });
const session = () => makeSession({ userId: USER, hotelId: hotelA.id, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: custA } });
const q = { tab: "all" as const, page: 1, pageSize: 50 };

describe("guest all hotels on real hotel schemas", () => {
  test("bills over both hotels, each from its own schema with its own customer record; another guest's never shows", async () => {
    const page = await service().billsAcross(session(), { ...q, hotel: "all" });
    const numbers = page.items.map((b) => `${b.hotelName}:${b.number}`).join(" ");
    for (const want of ["Hotel A:A / 1", "Hotel A:A / 2", "Hotel B:B / 1"]) assert.ok(numbers.includes(want), `${want} in ${numbers}`);
    assert.ok(!numbers.includes("A / 9"), "Deepa's bill never shows");
    assert.deepEqual(page.unavailable, []);
    const byCursor = await service().billsAcross(session(), { ...q, hotel: "all", limit: 10 });
    assert.equal(byCursor.nextCursor, null);
    assert.equal(byCursor.items.length, page.items.length);
  });

  test("the summary: in house with the room at hotel A, not at B; a hotel where the login has no record is left out quietly", async () => {
    const sum = await service().hotelsSummary(session());
    const a = sum.hotels.find((h) => h.hotelId === hotelA.id);
    const b = sum.hotels.find((h) => h.hotelId === hotelB.id);
    assert.equal(a?.inHouse, true);
    assert.equal(b?.inHouse, false);
    assert.ok((a?.openBills ?? 0) >= 2);
    // hotel B linked with hotel A's customer id: that id has no row at B (and RLS would hide another's): B is not set up for this login, so it is left out
    const forged = await service(() => [{ hotelId: hotelA.id, hotelName: "Hotel A", subjectId: custA }, { hotelId: hotelB.id, hotelName: "Hotel B", subjectId: custA }]).hotelsSummary(session());
    assert.deepEqual(forged.hotels.map((h) => h.hotelId), [hotelA.id]);
  });

  test("an order goes on the guest's own stay at the hotel named; a login linked to both must name it; at B (no stay) it is refused", async () => {
    await owner.query(`INSERT INTO "${hotelA.schema}".menu_items (group_key, name, price_paise, is_available, sort_order) VALUES ('restaurant', 'Tea', 8000, true, 1)`).catch(() => undefined);
    const menu = await owner.query(`SELECT id FROM "${hotelA.schema}".menu_items LIMIT 1`);
    const svc = service();
    await assert.rejects(svc.forAction(session(), undefined), (e: unknown) => (e as { code?: string }).code === "VALIDATION_FAILED");
    const atB = await svc.forAction(session(), hotelB.id);
    await assert.rejects(svc.placeOrder(atB, { qty: { [String(menu.rows[0]?.id ?? "00000000-0000-4000-8000-000000000000")]: 1 }, payWith: "room_bill", note: "" } as never, { ip: null, traceId: "trace-guest-all-1" } as never), (e: unknown) => (e as { code?: string }).code === "CONFLICT");
    const info = await svc.orderInfo(await svc.forAction(session(), hotelA.id));
    assert.deepEqual([info.staying, info.hotelId], [true, hotelA.id]);
    assert.ok(!JSON.stringify(info).includes(stayA), "no stay id in the answer");
  });
});

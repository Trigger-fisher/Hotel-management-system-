// Hotel migration 0045 (security review round 2, L1 and L2) on the REAL PostgreSQL, on the throwaway hms_test only: one row-security policy per command on the portal tables.
// A guest's own transaction can still place and cancel a room-service order (the real services), but can no longer change an order's totals or lines, delete an order, remove a
// charge that is not one of its orders', or write a guest request or support request; a company can mark its own notification read but not re-point it; staff (no scope)
// keep full access. The Neon file carries the migration's statements word for word. Run with: npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import type { TxClient } from "../../src/db/types";
import { createPgPortalUnit } from "../../src/server/repos/postgres/portal";
import { createGuestService } from "../../src/server/services/guest/guestService";
import { makeSession } from "../server/helpers/session";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase, sqlStateOf } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;
const USER = "00000000-0000-4000-8000-000000000d01";
const clock = new Date("2026-10-05T10:00:00+05:30");
let cust = "";
let stay = "";
let tea = "";
let co = "";
let otherCo = "";

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotel = await createTestHotel(owner, "Per Command Hotel");
  const s = hotel.schema;
  cust = String((await insertRow(owner, s, "customers", { name: "Amit Joshi", mobile: "9825041236", is_active: true })).id);
  stay = String((await insertRow(owner, s, "pms_stays", { mobile: "9825041236", company_id: null, guest_name: "Amit Joshi", status: "in_house", check_in_at: "2026-10-03T08:00:00Z", expected_check_out: "2026-10-07", check_out_at: null, bill_id: null })).id);
  tea = String((await insertRow(owner, s, "menu_items", { menu_group: "restaurant", name: "Tea", note: null, price_paise: 8000, available: true, sort_order: 1, deleted_at: null })).id);
  co = String((await insertRow(owner, s, "company_profiles", { name: "Tata Consultancy Services" })).id);
  otherCo = String((await insertRow(owner, s, "company_profiles", { name: "Infosys" })).id);
});
after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

const meta = { ip: "127.0.0.1", traceId: "trace-rls-per-command" } as never;
const guestSession = () => makeSession({ userId: USER, hotelId: hotel.id, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: cust } });
const guests = () => createGuestService({ unit: createPgPortalUnit(database.withHotel), now: () => clock, accounts: { lastLogins: async () => new Map() }, credentials: { changeMyPassword: async () => ({ changed: true, otherSessionsEnded: 0 }) } });
const asGuest = <T>(work: (tx: TxClient) => Promise<T>) => database.withHotel({ hotelId: hotel.id, userId: USER, scope: { kind: "guest", id: cust } } as never, work);
const asCompany = <T>(id: string, work: (tx: TxClient) => Promise<T>) => database.withHotel({ hotelId: hotel.id, userId: USER, scope: { kind: "company", id } } as never, work);
const asStaff = <T>(work: (tx: TxClient) => Promise<T>) => database.withHotel({ hotelId: hotel.id, userId: USER } as never, work);
const rows = (p: Promise<{ affectedRows: number }>) => p.then((r) => r.affectedRows);
/** Refused: either no row matched for this account (0 rows) or the database said no (42501, a policy's WITH CHECK, a trigger, or no privilege at all). */
const refused = async (p: Promise<{ affectedRows: number }>, label: string) => {
  const outcome = await p.then((r) => (r.affectedRows === 0 ? "none" : `changed ${r.affectedRows}`)).catch((e: unknown) => (e as { code?: string }).code ?? String(e));
  assert.ok(outcome === "none" || outcome === "42501", `${label}: ${outcome}`);
};
const order = () => ({ qty: { [tea]: 1 }, payWith: "room_bill", note: "", scheduledFor: undefined }) as never;

describe("hotel 0045: portal row security per command", () => {
  test("a guest still places and cancels its own order (order, line, charge; the charge removed on cancel)", async () => {
    const placed = await guests().placeOrder(guestSession(), order(), meta);
    const cancelled = await guests().cancelRoomOrder(guestSession(), placed.orderId, meta);
    assert.deepEqual([cancelled.status, cancelled.cancelledBy], ["cancelled", "guest"]);
    assert.equal(Number((await owner.query(`SELECT count(*) AS n FROM "${hotel.schema}".room_service_order_lines WHERE order_id = $1 AND charge_id IS NULL`, [placed.orderId])).rows[0].n), 1);
  });

  test("a guest cannot change an order's totals or another status, its lines, or delete it; staff can", async () => {
    const placed = await guests().placeOrder(guestSession(), order(), meta);
    assert.equal(await sqlStateOf(asGuest((tx) => tx.query("UPDATE room_service_orders SET total_paise = 1 WHERE id = $1", [placed.orderId]))), "42501", "totals");
    assert.equal(await sqlStateOf(asGuest((tx) => tx.query("UPDATE room_service_orders SET status = 'delivered' WHERE id = $1", [placed.orderId]))), "42501", "another status");
    assert.equal(await sqlStateOf(asGuest((tx) => tx.query("UPDATE room_service_orders SET status = 'cancelled', cancelled_by_kind = 'guest', total_paise = 0 WHERE id = $1", [placed.orderId]))), "42501", "a cancel that also changes the total");
    await refused(asGuest((tx) => tx.query("UPDATE room_service_order_lines SET qty = 50 WHERE order_id = $1", [placed.orderId])), "change a line");
    await refused(asGuest((tx) => tx.query("DELETE FROM room_service_order_lines WHERE order_id = $1", [placed.orderId])), "delete a line");
    await refused(asGuest((tx) => tx.query("DELETE FROM room_service_orders WHERE id = $1", [placed.orderId])), "delete the order");
    await refused(asGuest((tx) => tx.query("UPDATE pms_charges SET amount_paise = 0 WHERE stay_id = $1", [stay])), "change a charge");
    assert.equal(await rows(asStaff((tx) => tx.query("UPDATE room_service_orders SET status = 'accepted' WHERE id = $1", [placed.orderId]))), 1, "staff are not limited");
    // once accepted the guest can no longer cancel (the service says so first; the trigger holds it too)
    assert.equal(await sqlStateOf(asGuest((tx) => tx.query("UPDATE room_service_orders SET status = 'cancelled', cancelled_by_kind = 'guest' WHERE id = $1", [placed.orderId]))), "42501");
  });

  test("a guest can remove only the charges of its own orders, never a room or extra charge of its stay", async () => {
    const extra = await insertRow(owner, hotel.schema, "pms_charges", { stay_id: stay, charge_date: "2026-10-04", category: "extra_bed", side: "hotel", description: "Extra bed", quantity: "1.00", unit_price_paise: 50000, amount_paise: 50000 });
    await refused(asGuest((tx) => tx.query("DELETE FROM pms_charges WHERE id = $1", [extra.id])), "delete an extra-bed charge");
    assert.equal(Number((await owner.query(`SELECT count(*) AS n FROM "${hotel.schema}".pms_charges WHERE id = $1`, [extra.id])).rows[0].n), 1);
    assert.equal(await sqlStateOf(asCompany(co, (tx) => tx.query("INSERT INTO pms_charges (stay_id, charge_date, category, description) VALUES ($1, '2026-10-05', 'other', 'x')", [stay]))), "42501", "a company never adds a charge");
  });

  test("guest requests and support requests are read-only for a guest (their guest side was removed)", async () => {
    assert.equal(await sqlStateOf(asGuest((tx) => tx.query("INSERT INTO guest_requests (stay_id, kind) VALUES ($1, 'towels')", [stay]))), "42501");
    assert.equal(await sqlStateOf(asGuest((tx) => tx.query("INSERT INTO support_requests (number, customer_id, guest_name, subject, message) VALUES ('S-1', $1, 'Amit', 'Hi', 'Hello')", [cust]))), "42501");
    const req = await insertRow(owner, hotel.schema, "guest_requests", { stay_id: stay, kind: "water" });
    assert.equal(await asGuest((tx) => tx.query("SELECT count(*) AS n FROM guest_requests").then((r) => Number(r.rows[0].n))), 1, "it still reads its own");
    await refused(asGuest((tx) => tx.query("UPDATE guest_requests SET note = 'changed' WHERE id = $1", [req.id])), "change a request");
  });

  test("L1: a company marks its own notification read, but cannot re-point a target at another notification or company", async () => {
    const s = hotel.schema;
    const mine = await insertRow(owner, s, "notifications", { audience_kind: "one", title: "For TCS", body: "Hello", target_count: 1 });
    const theirs = await insertRow(owner, s, "notifications", { audience_kind: "one", title: "For Infosys", body: "Private", target_count: 1 });
    const target = await insertRow(owner, s, "notification_targets", { notification_id: mine.id, company_id: co });
    await insertRow(owner, s, "notification_targets", { notification_id: theirs.id, company_id: otherCo });
    assert.equal(await rows(asCompany(co, (tx) => tx.query("UPDATE notification_targets SET read_at = now() WHERE id = $1", [target.id]))), 1, "the read mark");
    assert.equal(await sqlStateOf(asCompany(co, (tx) => tx.query("UPDATE notification_targets SET notification_id = $2 WHERE id = $1", [target.id, theirs.id]))), "42501", "re-point at another company's notice");
    assert.equal(await sqlStateOf(asCompany(co, (tx) => tx.query("UPDATE notification_targets SET email_status = 'queued' WHERE id = $1", [target.id]))), "42501", "its mail status");
    assert.equal(await asCompany(co, (tx) => tx.query("SELECT count(*) AS n FROM notifications WHERE id = $1", [theirs.id]).then((r) => Number(r.rows[0].n))), 0, "still cannot see the other notice");
    assert.equal(await rows(asStaff((tx) => tx.query("UPDATE notification_targets SET email_status = 'queued' WHERE id = $1", [target.id]))), 1, "workers and staff are not limited");
  });

});

// Room-service orders (hotel migration 0041) on the REAL PostgreSQL, on the throwaway hms_test only: the repository's SQL, the table rules, the row-level security (a guest sees
// and changes only its own stays' orders; a company none) and the real services over the PostgreSQL portal unit: a guest places and cancels (the charges come off inside the
// guest's own scoped transaction), the desk moves and cancels with a reason. Run with: npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import type { TxClient } from "../../src/db/types";
import { createPgPortalUnit } from "../../src/server/repos/postgres/portal";
import { pgRoomServiceRepo } from "../../src/server/repos/postgres/roomService";
import { createGuestService } from "../../src/server/services/guest/guestService";
import { createRoomServiceDesk } from "../../src/server/services/roomService/deskService";
import { catalog, grant, makeSession } from "../server/helpers/session";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase, sqlStateOf } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;
const USER = "00000000-0000-4000-8000-000000000c01";
let clock = new Date("2026-10-05T10:00:00+05:30");
let custA = "";
let custB = "";
let stayA = "";
let stayB = "";
let tea = "";

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotel = await createTestHotel(owner, "Room Service Hotel");
  const s = hotel.schema;
  custA = String((await insertRow(owner, s, "customers", { name: "Amit Joshi", mobile: "9825041236", is_active: true })).id);
  custB = String((await insertRow(owner, s, "customers", { name: "Deepa Iyer", mobile: "9909918273", is_active: true })).id);
  stayA = String((await insertRow(owner, s, "pms_stays", { mobile: "9825041236", company_id: null, guest_name: "Amit Joshi", status: "in_house", check_in_at: "2026-10-03T08:00:00Z", expected_check_out: "2026-10-07", check_out_at: null, bill_id: null })).id);
  stayB = String((await insertRow(owner, s, "pms_stays", { mobile: "9909918273", company_id: null, guest_name: "Deepa Iyer", status: "in_house", check_in_at: "2026-10-03T08:00:00Z", expected_check_out: "2026-10-07", check_out_at: null, bill_id: null })).id);
  tea = String((await insertRow(owner, s, "menu_items", { menu_group: "restaurant", name: "Tea", note: null, price_paise: 8000, available: true, sort_order: 1, deleted_at: null })).id);
});
after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

const guestSession = (customerId: string, userId = USER) => makeSession({ userId, hotelId: hotel.id, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: customerId } });
const staffSession = () => makeSession({ userId: "00000000-0000-4000-8000-000000000c09", hotelId: hotel.id, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web", grants: [grant("pms", "full")] });
const meta = { ip: "127.0.0.1", traceId: "trace-room-service-1" } as never;
const guests = () => createGuestService({ unit: createPgPortalUnit(database.withHotel), now: () => clock, accounts: { lastLogins: async () => new Map() }, credentials: { changeMyPassword: async () => ({ changed: true, otherSessionsEnded: 0 }) } });
const desk = () => createRoomServiceDesk({ unit: createPgPortalUnit(database.withHotel), people: { get: async () => new Map() }, catalog, now: () => clock });
const order = () => ({ qty: { [tea]: 2 }, payWith: "room_bill", note: "", scheduledFor: undefined }) as never;
const count = (sql: string, params: unknown[] = []) => owner.query(sql, params).then((r) => Number(r.rows[0].n));

describe("room-service orders on the real database", () => {
  test("a guest places an order: the row, its line pointing at the stay charge; then cancels inside the window: the charge is removed in the guest's own transaction", async () => {
    clock = new Date("2026-10-05T10:00:00+05:30");
    const placed = await guests().placeOrder(guestSession(custA), order(), meta);
    assert.equal(placed.status, "placed");
    const s = hotel.schema;
    assert.equal(await count(`SELECT count(*) AS n FROM "${s}".room_service_orders WHERE id = $1 AND stay_id = $2`, [placed.orderId, stayA]), 1);
    assert.equal(await count(`SELECT count(*) AS n FROM "${s}".room_service_order_lines l JOIN "${s}".pms_charges c ON c.id = l.charge_id WHERE l.order_id = $1`, [placed.orderId]), 1);
    clock = new Date(clock.getTime() + 2 * 60_000);
    const cancelled = await guests().cancelRoomOrder(guestSession(custA), placed.orderId, meta);
    assert.deepEqual([cancelled.status, cancelled.cancelledBy], ["cancelled", "guest"]);
    assert.equal(await count(`SELECT count(*) AS n FROM "${s}".pms_charges WHERE stay_id = $1`, [stayA]), 0, "the charge is gone");
    assert.equal(await count(`SELECT count(*) AS n FROM "${s}".room_service_order_lines WHERE order_id = $1 AND charge_id IS NULL`, [placed.orderId]), 1, "the line stays, without its charge");
  });

  test("row-level security: a guest's transaction sees only its own stays' orders and cannot touch another's; a company sees none", async () => {
    clock = new Date("2026-10-05T11:00:00+05:30");
    const mine = await guests().placeOrder(guestSession(custA), order(), meta);
    const theirs = await guests().placeOrder(guestSession(custB, "00000000-0000-4000-8000-000000000c02"), order(), meta);
    const asGuest = <T>(customerId: string, work: (tx: TxClient) => Promise<T>) => database.withHotel({ hotelId: hotel.id, userId: USER, scope: { kind: "guest", id: customerId } } as never, work);
    const ids = (tx: TxClient) => tx.query("SELECT id FROM room_service_orders WHERE id = ANY($1::uuid[])", [[mine.orderId, theirs.orderId]]).then((r) => r.rows.map((x) => String(x.id)));
    assert.deepEqual(await asGuest(custA, ids), [mine.orderId]);
    assert.deepEqual(await asGuest(custB, ids), [theirs.orderId]);
    assert.equal(await asGuest(custA, (tx) => tx.query("UPDATE room_service_orders SET status = 'delivered' WHERE id = $1", [theirs.orderId]).then((r) => r.affectedRows)), 0);
    assert.equal(await asGuest(custA, (tx) => tx.query("SELECT count(*) AS n FROM room_service_order_lines WHERE order_id = $1", [theirs.orderId]).then((r) => Number(r.rows[0].n))), 0, "not even its lines");
    assert.deepEqual(await database.withHotel({ hotelId: hotel.id, userId: USER, scope: { kind: "company", id: custA } } as never, ids), []);
    await assert.rejects(guests().cancelRoomOrder(guestSession(custA), theirs.orderId, meta), (e: unknown) => (e as { code?: string }).code === "NOT_FOUND");
  });

  test("the desk: the queue with room and guest, forward moves, a cancel with a reason that reverses the charge; the window setting is kept in app_settings", async () => {
    clock = new Date("2026-10-05T12:00:00+05:30");
    const placed = await guests().placeOrder(guestSession(custB, "00000000-0000-4000-8000-000000000c02"), order(), meta);
    const queue = await desk().list(staffSession(), { status: "open", page: 1, pageSize: 25 });
    assert.ok(queue.items.some((o) => o.id === placed.orderId && o.guestName === "Deepa Iyer"));
    assert.equal((await desk().setStatus(staffSession(), placed.orderId, "preparing", meta)).status, "preparing");
    await assert.rejects(desk().setStatus(staffSession(), placed.orderId, "accepted", meta), (e: unknown) => (e as { code?: string }).code === "CONFLICT");
    const done = await desk().cancel(staffSession(), placed.orderId, "Kitchen closed", meta);
    assert.deepEqual([done.status, done.cancelledBy, done.cancelReason], ["cancelled", "hotel", "Kitchen closed"]);
    assert.equal(await count(`SELECT count(*) AS n FROM "${hotel.schema}".pms_charges c JOIN "${hotel.schema}".room_service_order_lines l ON l.order_id = $1 WHERE c.stay_id = $2 AND c.id = l.charge_id`, [placed.orderId, stayB]), 0);
    await desk().saveSettings(staffSession(), { guestCancelMinutes: 12 }, meta);
    assert.equal((await desk().settings(staffSession())).guestCancelMinutes, 12);
    await desk().saveSettings(staffSession(), { guestCancelMinutes: 0 }, meta);
    assert.equal((await desk().settings(staffSession())).guestCancelMinutes, 0);
  });

  test("the table rules: a cancelled order says who cancelled; a hotel cancel has a reason; statuses and order numbers are checked", async () => {
    const s = hotel.schema;
    const repo = <T>(work: (r: ReturnType<typeof pgRoomServiceRepo>) => Promise<T>) => database.withHotel({ hotelId: hotel.id, userId: USER } as never, (tx) => work(pgRoomServiceRepo(tx)));
    const o = await repo((r) => r.create({ orderNo: "O-TEST01", stayId: stayA, scheduledFor: null, note: null, totalPaise: BigInt(100), placedBy: USER, placedAt: clock, lines: [] }));
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".room_service_orders SET status = 'cancelled' WHERE id = $1`, [o.id])), "23514", "cancelled without who");
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".room_service_orders SET status = 'cancelled', cancelled_by_kind = 'hotel', cancel_reason = '  ' WHERE id = $1`, [o.id])), "23514", "a hotel cancel needs a reason");
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".room_service_orders SET status = 'lost' WHERE id = $1`, [o.id])), "23514");
    assert.equal(await sqlStateOf(owner.query(`INSERT INTO "${s}".room_service_orders (order_no, stay_id, total_paise) VALUES ('O-TEST01', $1, 1)`, [stayA])), "23505");
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".menu_items SET veg = 'maybe' WHERE id = $1`, [tea])), "23514");
  });
});

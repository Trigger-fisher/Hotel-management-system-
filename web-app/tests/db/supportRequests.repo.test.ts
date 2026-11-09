// Customer support requests (hotel migration 0042) on the REAL PostgreSQL, throwaway hms_test only: the repository's SQL, the table rules, and the row-level security (a guest
// sees and writes only its own customer's requests; a company none; staff all), then the real services over the PostgreSQL portal unit. Run with: npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import type { TxClient } from "../../src/db/types";
import { createPgPortalUnit } from "../../src/server/repos/postgres/portal";
import { createSupportDesk } from "../../src/server/services/support/deskService";
import { catalog, grant, makeSession } from "../server/helpers/session";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase, sqlStateOf } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;
let custA = "";
let custB = "";
const clock = new Date("2026-10-05T10:00:00+05:30");
const meta = { ip: "127.0.0.1", traceId: "trace-support-1" } as never;

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotel = await createTestHotel(owner, "Support Hotel");
  custA = String((await insertRow(owner, hotel.schema, "customers", { name: "Amit Joshi", mobile: "9825041236", is_active: true })).id);
  custB = String((await insertRow(owner, hotel.schema, "customers", { name: "Deepa Iyer", mobile: "9909918273", is_active: true })).id);
});
after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

const desk = () => createSupportDesk({ unit: createPgPortalUnit(database.withHotel), people: { get: async () => new Map() }, catalog, now: () => clock });
const staff = () => makeSession({ userId: "00000000-0000-4000-8000-0000000d0099", hotelId: hotel.id, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web", grants: [grant("pms", "edit")] });

describe("support requests on the real database", () => {
  test("the desk lists and answers the messages already sent (the guest side was removed, 18 Oct 2026); row-level security keeps every guest to their own", async () => {
    // messages written before the guest side went away (the desk still reads and answers them)
    const sent = async (customerId: string, number: string, subject: string, at: string) =>
      String((await owner.query(`INSERT INTO "${hotel.schema}".support_requests (number, customer_id, guest_name, subject, message, created_at) VALUES ($1, $2, 'Guest', $3, 'A message from before', $4) RETURNING id`, [number, customerId, subject, at])).rows[0].id);
    const mine = { id: await sent(custA, "S-DB0001", "Wrong charge", "2026-10-05T03:00:00Z") };
    const theirs = { id: await sent(custB, "S-DB0002", "Late check-out", "2026-10-05T03:05:00Z") };
    const queue = await desk().list(staff(), { status: "open", page: 1, pageSize: 25 });
    assert.deepEqual(queue.items.map((m) => m.subject), ["Wrong charge", "Late check-out"]);
    const answered = await desk().respond(staff(), mine.id, { status: "answered", reply: "Fixed, sorry." }, meta);
    assert.deepEqual([answered.status, answered.reply], ["answered", "Fixed, sorry."]);
    const asGuest = <T>(customerId: string, work: (tx: TxClient) => Promise<T>) => database.withHotel({ hotelId: hotel.id, userId: "00000000-0000-4000-8000-0000000d0001", scope: { kind: "guest", id: customerId } } as never, work);
    assert.deepEqual(await asGuest(custA, (tx) => tx.query("SELECT id FROM support_requests").then((r) => r.rows.map((x) => String(x.id)))), [mine.id]);
    assert.equal(await asGuest(custA, (tx) => tx.query("UPDATE support_requests SET status = 'closed' WHERE id = $1", [theirs.id]).then((r) => r.affectedRows)), 0);
    const forged = await database.withHotel({ hotelId: hotel.id, userId: "00000000-0000-4000-8000-0000000d0001", scope: { kind: "guest", id: custA } } as never, (tx) => sqlStateOf(tx.query("INSERT INTO support_requests (number, customer_id, guest_name, subject, message) VALUES ('S-FORGED', $1, 'x', 'x', 'x')", [custB])));
    assert.equal(forged, "42501", "cannot write in another guest's name");
    assert.deepEqual(await database.withHotel({ hotelId: hotel.id, userId: "00000000-0000-4000-8000-0000000d0001", scope: { kind: "company", id: custA } } as never, (tx) => tx.query("SELECT id FROM support_requests").then((r) => r.rows)), []);
  });

  test("the table rules: an answered request has a reply; numbers are unique; statuses are checked", async () => {
    const s = hotel.schema;
    const row = await insertRow(owner, s, "support_requests", { number: "S-RULE01", customer_id: custA, guest_name: "Amit", subject: "s", message: "m" });
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".support_requests SET status = 'answered' WHERE id = $1`, [row.id])), "23514");
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".support_requests SET status = 'lost' WHERE id = $1`, [row.id])), "23514");
    assert.equal(await sqlStateOf(owner.query(`INSERT INTO "${s}".support_requests (number, guest_name, subject, message) VALUES ('S-RULE01', 'x', 'x', 'x')`)), "23505");
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${s}".support_requests SET subject = '  ' WHERE id = $1`, [row.id])), "23514");
  });
});

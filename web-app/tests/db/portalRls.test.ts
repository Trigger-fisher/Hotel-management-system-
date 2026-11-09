// Row-level security for the portals (hotel migration 0035, MJ's plan T8) on the REAL PostgreSQL: with the session's record scope set by withHotel, a
// guest account's transaction sees only its own customer row and the bills, advances, stays, reservations, charges and requests that belong to it
// (by the customer's mobile, as repos/portal.ts mobileForms matches), a company's only its own profile and company rows, and a transaction without a
// scope (hotel staff) sees everything as before. The fence holds for a plain SELECT too, not only through the repositories. Run with: npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import type { TxClient } from "../../src/db/types";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 3 });
  hotel = await createTestHotel(owner, "Portal RLS Hotel");
});
after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

const count = (tx: TxClient, sql: string, params: unknown[] = []): Promise<number> => tx.query(sql, params).then((r) => Number(r.rows[0]?.n ?? 0));
const ids = (tx: TxClient, sql: string, params: unknown[] = []): Promise<string[]> => tx.query(sql, params).then((r) => r.rows.map((x) => String(x.id)).sort());

describe("portal row-level security (0035)", () => {
  test("a guest sees only its own rows, a company only its own, staff everything; the policies read the transaction-local scope", async () => {
    const s = hotel.schema;
    const amit = await insertRow(owner, s, "customers", { name: "Amit Joshi", mobile: "98250 41236" });
    const deepa = await insertRow(owner, s, "customers", { name: "Deepa Iyer", mobile: "+91 99099 18273" });
    const tcs = await insertRow(owner, s, "company_profiles", { company_name: "TCS" });
    const infy = await insertRow(owner, s, "company_profiles", { company_name: "Infosys" });
    // bills: two of Amit's (with and without 91), one of Deepa's, one of TCS, one of Infosys
    const b1 = await insertRow(owner, s, "bill_master_bills", { mobile_number: "9825041236", company_id: null });
    const b2 = await insertRow(owner, s, "bill_master_bills", { mobile_number: "+91-98250-41236", company_id: null });
    const b3 = await insertRow(owner, s, "bill_master_bills", { mobile_number: "9909918273", company_id: null });
    const b4 = await insertRow(owner, s, "bill_master_bills", { mobile_number: null, company_id: tcs.id });
    const b5 = await insertRow(owner, s, "bill_master_bills", { mobile_number: null, company_id: infy.id });
    // stays: Amit's own (by mobile), the stay of Amit's bill b2 under another mobile (the booker's), Deepa's, and a TCS stay reached through its bill
    const stayAmit = await insertRow(owner, s, "pms_stays", { mobile: "98250 41236", company_id: null, guest_name: "Amit Joshi" });
    const stayViaBill = await insertRow(owner, s, "pms_stays", { mobile: "9000000001", company_id: null, bill_id: b2.id, guest_name: "Booked for Amit" });
    const stayDeepa = await insertRow(owner, s, "pms_stays", { mobile: "99099 18273", company_id: null, guest_name: "Deepa Iyer" });
    const stayTcs = await insertRow(owner, s, "pms_stays", { mobile: "9000000002", company_id: null, bill_id: b4.id, guest_name: "TCS traveller" });
    const stayTcsOwn = await insertRow(owner, s, "pms_stays", { mobile: "9000000003", company_id: tcs.id, guest_name: "TCS traveller 2" });
    const chargeAmit = await insertRow(owner, s, "pms_charges", { stay_id: stayAmit.id });
    const chargeDeepa = await insertRow(owner, s, "pms_charges", { stay_id: stayDeepa.id });
    const reqAmit = await insertRow(owner, s, "guest_requests", { stay_id: stayAmit.id });
    const reqDeepa = await insertRow(owner, s, "guest_requests", { stay_id: stayDeepa.id });
    const resAmit = await insertRow(owner, s, "pms_reservations", { mobile: "98250 41236", company_id: null });
    await owner.query(`UPDATE "${s}".pms_stays SET reservation_id = $1, version = version + 1 WHERE id = $2`, [resAmit.id, stayAmit.id]);
    const resTcs = await insertRow(owner, s, "pms_reservations", { mobile: null, company_id: tcs.id });
    const resInfy = await insertRow(owner, s, "pms_reservations", { mobile: null, company_id: infy.id });
    const advAmit = await insertRow(owner, s, "bill_master_advances", { mobile_number: "9825041236", company_id: null });
    const advViaRes = await insertRow(owner, s, "bill_master_advances", { mobile_number: "9000000001", company_id: null, reservation_id: resAmit.id });
    const advDeepa = await insertRow(owner, s, "bill_master_advances", { mobile_number: "9909918273", company_id: null });
    const advTcs = await insertRow(owner, s, "bill_master_advances", { mobile_number: null, company_id: tcs.id });

    const staff = (work: (tx: TxClient) => Promise<unknown>) => database.withHotel({ hotelId: hotel.id }, work);
    const guest = (customerId: string, work: (tx: TxClient) => Promise<unknown>) => database.withHotel({ hotelId: hotel.id, scope: { kind: "guest", id: customerId } }, work);
    const company = (companyId: string, work: (tx: TxClient) => Promise<unknown>) => database.withHotel({ hotelId: hotel.id, scope: { kind: "company", id: companyId } }, work);

    // staff: every row
    assert.equal(await staff((tx) => count(tx, "SELECT count(*) AS n FROM bill_master_bills WHERE id = ANY($1::uuid[])", [[b1.id, b2.id, b3.id, b4.id, b5.id]])), 5);
    assert.equal(await staff((tx) => count(tx, "SELECT count(*) AS n FROM customers WHERE id = ANY($1::uuid[])", [[amit.id, deepa.id]])), 2);

    // Amit (guest): his customer row only; bills by his mobile in any written form; stays by mobile and the stay of his bill; the reservation and
    // advances of his stays; charges and requests of his stays; no company profile
    await guest(String(amit.id), async (tx) => {
      assert.deepEqual(await ids(tx, "SELECT id FROM customers"), [String(amit.id)]);
      assert.deepEqual(await ids(tx, "SELECT id FROM company_profiles"), []);
      assert.deepEqual(await ids(tx, "SELECT id FROM bill_master_bills WHERE id = ANY($1::uuid[])", [[b1.id, b2.id, b3.id, b4.id, b5.id]]), [String(b1.id), String(b2.id)].sort());
      assert.deepEqual(await ids(tx, "SELECT id FROM pms_stays"), [String(stayAmit.id), String(stayViaBill.id)].sort());
      assert.deepEqual(await ids(tx, "SELECT id FROM pms_reservations"), [String(resAmit.id)]);
      assert.deepEqual(await ids(tx, "SELECT id FROM bill_master_advances"), [String(advAmit.id), String(advViaRes.id)].sort());
      assert.deepEqual(await ids(tx, "SELECT id FROM pms_charges"), [String(chargeAmit.id)]);
      assert.deepEqual(await ids(tx, "SELECT id FROM guest_requests"), [String(reqAmit.id)]);
      // a write to another guest's row touches nothing; a write to his own works
      assert.equal((await tx.query("UPDATE customers SET name = 'X' WHERE id = $1", [deepa.id])).affectedRows, 0);
      assert.equal((await tx.query("UPDATE customers SET name = 'Amit J.' WHERE id = $1", [amit.id])).affectedRows, 1);
      // a request for someone else's stay is refused by the policy (42501), one for his own is kept
      await assert.rejects(tx.query("INSERT INTO guest_requests (stay_id, kind, status, created_by) VALUES ($1, 'towels', 'open', $2)", [stayDeepa.id, amit.id]), (e: unknown) => (e as { code?: string }).code === "42501");
    });
    // Deepa (guest): her side only
    await guest(String(deepa.id), async (tx) => {
      assert.deepEqual(await ids(tx, "SELECT id FROM bill_master_bills WHERE id = ANY($1::uuid[])", [[b1.id, b2.id, b3.id, b4.id, b5.id]]), [String(b3.id)]);
      assert.deepEqual(await ids(tx, "SELECT id FROM pms_stays"), [String(stayDeepa.id)]);
      assert.deepEqual(await ids(tx, "SELECT id FROM pms_charges"), [String(chargeDeepa.id)]);
      assert.deepEqual(await ids(tx, "SELECT id FROM guest_requests"), [String(reqDeepa.id)]);
      assert.deepEqual(await ids(tx, "SELECT id FROM bill_master_advances"), [String(advDeepa.id)]);
    });
    // TCS (company): its profile, its bills, reservations and advances, its stays and the stay of its bill; nothing of Infosys or of a guest
    await company(String(tcs.id), async (tx) => {
      assert.deepEqual(await ids(tx, "SELECT id FROM company_profiles"), [String(tcs.id)]);
      assert.deepEqual(await ids(tx, "SELECT id FROM customers"), []);
      assert.deepEqual(await ids(tx, "SELECT id FROM bill_master_bills WHERE id = ANY($1::uuid[])", [[b1.id, b2.id, b3.id, b4.id, b5.id]]), [String(b4.id)]);
      assert.deepEqual(await ids(tx, "SELECT id FROM pms_reservations"), [String(resTcs.id)]);
      assert.deepEqual(await ids(tx, "SELECT id FROM bill_master_advances"), [String(advTcs.id)]);
      assert.deepEqual(await ids(tx, "SELECT id FROM pms_stays"), [String(stayTcs.id), String(stayTcsOwn.id)].sort());
      assert.deepEqual(await ids(tx, "SELECT id FROM guest_requests"), []);
    });
    void resInfy;
    // the scope ends with the transaction: the next staff transaction on a pooled connection sees everything again
    assert.equal(await staff((tx) => count(tx, "SELECT count(*) AS n FROM customers WHERE id = ANY($1::uuid[])", [[amit.id, deepa.id]])), 2);
    assert.equal(await staff((tx) => count(tx, "SELECT count(*) AS n FROM pms_stays")), 5);
  });
});

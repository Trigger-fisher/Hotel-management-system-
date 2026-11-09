// "All hotels" in the company portal on the REAL PostgreSQL (throwaway hms_test only): two real hotel schemas, one company in each, the real corporate service over the PostgreSQL
// portal unit. Each hotel is read in its own transaction with its own company record and the row-level security of 0035 and 0039 as the second fence: hotel A's company id read
// inside hotel B finds nothing, and one company never sees another's bills or notices. Cursor paging runs on the real SQL (notifications `through`), and a hotel that is not
// there answers as unavailable. Run with: npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { pgNotificationRepo } from "../../src/server/repos/postgres/notifications";
import { createPgPortalUnit } from "../../src/server/repos/postgres/portal";
import { createCorporateService } from "../../src/server/services/corporate/corporateService";
import type { Memberships } from "../../src/server/services/portal/multiHotel";
import { makeSession } from "../server/helpers/session";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotelA: CreatedHotel;
let hotelB: CreatedHotel;
const USER = "00000000-0000-4000-8000-000000000a01";
const NOW = new Date("2026-10-05T10:00:00+05:30");
const GHOST_HOTEL = "44444444-4444-4444-8444-444444444444";

let coA = "";
let coB = "";
let coOtherA = "";

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  hotelA = await createTestHotel(owner, "All Hotels A");
  hotelB = await createTestHotel(owner, "All Hotels B");
  coA = String((await insertRow(owner, hotelA.schema, "company_profiles", { name: "Tata Consultancy Services" })).id);
  coOtherA = String((await insertRow(owner, hotelA.schema, "company_profiles", { name: "Infosys" })).id);
  coB = String((await insertRow(owner, hotelB.schema, "company_profiles", { name: "TCS at B" })).id);
  const owing = (schema: string, company: string, number: string, date: string) =>
    insertRow(owner, schema, "bill_master_bills", { company_id: company, bill_number: number, bill_date: date, hotel_mode_of_payment: "Debit", total_hotel_amount_paise: 100000, balance_hotel_amount_paise: 100000, guest_name: `Guest ${number}` });
  await owing(hotelA.schema, coA, "A / 1", "2026-09-20");
  await owing(hotelA.schema, coA, "A / 2", "2026-09-25");
  await owing(hotelA.schema, coOtherA, "A / 9", "2026-09-26");
  await owing(hotelB.schema, coB, "B / 1", "2026-09-25");
  await owing(hotelB.schema, coB, "B / 2", "2026-09-10");
});
after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

const memberships = (links: () => { hotelId: string; hotelName: string; subjectId: string }[]): Memberships => ({ list: async () => links() });
const both = () => [{ hotelId: hotelA.id, hotelName: "Hotel A", subjectId: coA }, { hotelId: hotelB.id, hotelName: "Hotel B", subjectId: coB }];
const service = (links = both) => createCorporateService({ unit: createPgPortalUnit(database.withHotel), now: () => NOW, people: { get: async () => new Map() }, memberships: memberships(links), cursorSecret: () => Buffer.alloc(32, 7) });
const session = (userId = USER) => makeSession({ userId, hotelId: hotelA.id, accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, client: "web", scope: { kind: "company", id: coA } });
const query = { page: 1, pageSize: 25 };

describe("all hotels on real hotel schemas", () => {
  test("due bills over both hotels: each from its own schema with its own company record, newest first, nothing of another company", async () => {
    const page = await service().dueBills(session(), { ...query, hotel: "all" });
    // by page: newest bill date first, the bill number breaking the tie (25 Sep: B / 1 before A / 2)
    assert.deepEqual(page.items.map((i) => [i.hotelName, i.billNumber]), [["Hotel B", "B / 1"], ["Hotel A", "A / 2"], ["Hotel A", "A / 1"], ["Hotel B", "B / 2"]]);
    assert.deepEqual([page.total, page.unavailable, page.summary.openBills, page.summary.totalDuePaise], [4, [], 4, 400000]);
    assert.ok(!JSON.stringify(page).includes("A / 9"), "Infosys's bill at hotel A never shows");
  });

  test("cursor pages on the real SQL cover every row once and match the one big page", async () => {
    for (let i = 0; i < 24; i++) {
      const hotel = i % 2 === 0 ? hotelA : hotelB;
      await insertRow(owner, hotel.schema, "bill_master_bills", { company_id: i % 2 === 0 ? coA : coB, bill_number: `M / ${i}`, bill_date: `2026-08-0${1 + (i % 5)}`, hotel_mode_of_payment: "Debit", total_hotel_amount_paise: 100000, balance_hotel_amount_paise: 100000 });
    }
    const svc = service();
    const big = await svc.dueBills(session(), { ...query, hotel: "all", limit: 100 });
    assert.equal(big.items.length, 28);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await svc.dueBills(session(), { ...query, hotel: "all", limit: 10, cursor: cursor ?? undefined });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(seen, big.items.map((i) => i.id));
    await assert.rejects(svc.dueBills(session("00000000-0000-4000-8000-000000000a02"), { ...query, hotel: "all", limit: 10, cursor: (await svc.dueBills(session(), { ...query, hotel: "all", limit: 10 })).nextCursor ?? "" }), (e: unknown) => (e as { code?: string }).code === "VALIDATION_FAILED");
  });

  test("a hotel that is not there is named as unavailable and the other hotel still answers; hotel B's company id read at hotel A finds nothing", async () => {
    const svc = service(() => [...both(), { hotelId: GHOST_HOTEL, hotelName: "Ghost Hotel", subjectId: coA }]);
    const page = await svc.dueBills(session(), { ...query, hotel: "all", limit: 100 });
    assert.equal(page.items.length, 28);
    assert.deepEqual(page.unavailable, [{ hotelId: GHOST_HOTEL, hotelName: "Ghost Hotel" }]);
    // the forged link: hotel A named with hotel B's company id: row-level security shows nothing of A's rows (the company is not there)
    const forged = service(() => [{ hotelId: hotelA.id, hotelName: "Hotel A", subjectId: coB }]);
    await assert.rejects(forged.dueBills(session(), { ...query, hotel: "all" }), (e: unknown) => ["PORTAL_NOT_LINKED", "NETWORK_OFFLINE"].includes((e as { code?: string }).code ?? ""));
  });

  test("the selector summary and the notifications over the real tables", async () => {
    const note = (schema: string, id: string, company: string, title: string, at: string) =>
      owner
        .query(`INSERT INTO "${schema}".notifications (id, audience_kind, title, body, target_count, created_at) VALUES ($1, 'all', $2, 'x', 1, $3)`, [id, title, at])
        .then(() => owner.query(`INSERT INTO "${schema}".notification_targets (notification_id, company_id) VALUES ($1, $2)`, [id, company]));
    const at = "2026-10-01T10:00:00Z"; // the same moment in both hotels
    for (let i = 0; i < 6; i++) {
      await note(hotelA.schema, `00000000-0000-4000-8000-00000000b0${i}1`, coA, `A ${i}`, at);
      await note(hotelB.schema, `00000000-0000-4000-8000-00000000b0${i}2`, coB, `B ${i}`, at);
    }
    await note(hotelA.schema, "00000000-0000-4000-8000-00000000b099", coOtherA, "For Infosys", at);
    const svc = service();
    const sum = await svc.hotelsSummary(session());
    assert.deepEqual(sum.hotels.map((h) => [h.name, h.openBills, h.unreadNotifications]), [["Hotel A", 14, 6], ["Hotel B", 14, 6]]);
    assert.equal(sum.totals.unreadNotifications, 12);
    assert.deepEqual(sum.unavailable, []);

    const big = await svc.notifications(session(), { page: 1, pageSize: 25, hotel: "all", limit: 100 });
    assert.deepEqual([big.total, big.unread, big.items.length], [12, 12, 12]);
    assert.ok(!big.items.some((i) => i.title === "For Infosys"), "another company's notice never shows");
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await svc.notifications(session(), { page: 1, pageSize: 25, hotel: "all", limit: 10, cursor: cursor ?? undefined });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    assert.deepEqual(seen, big.items.map((i) => i.id), "twelve notices sharing one moment across two hotels: none lost, none twice");
    // the repository's `through` bound on the real SQL
    const rows = await database.withHotel({ hotelId: hotelA.id, userId: USER, scope: { kind: "company", id: coA } } as never, (tx) => pgNotificationRepo(tx).forCompany(coA, { today: "2026-10-05", through: new Date("2026-09-30T00:00:00Z"), page: 1, pageSize: 25 }));
    assert.deepEqual([rows.rows.length, rows.total], [0, 6], "nothing at or before then; the total ignores the bound");
  });
});

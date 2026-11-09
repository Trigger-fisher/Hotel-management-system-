// Problems with online payments, through the REAL service on the REAL PostgreSQL: a guest raises a problem with their own payment (linked by phone number), cannot see or raise
// one about anybody else's, the Super Admin answers it, and every rule is kept (state changes, limits, plain text).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import { createPgRazorpayUnit } from "../../src/server/repos/postgres/razorpay";
import { renderMail } from "../../src/server/services/auth/mail";
import { createRazorpayDisputeService } from "../../src/server/services/razorpay/disputeService";
import { catalog, grant, makeSession } from "../server/helpers/session";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotel: CreatedHotel;
let otherHotel: CreatedHotel;
let database: Database;
let ravi: string;
let meera: string;
let twin1: string;
let acme: string;
const staffId = newId();
const PAY_RAVI = "pay_RaviPaid00001";
const PAY_MEERA = "pay_MeeraPaid0001";
const PAY_TWIN = "pay_TwinPaid00001";
const PAY_STRANGER = "pay_Stranger00001";
const PAY_NEW = "pay_RaviCreated001";
const PAY_ACME = "pay_AcmePaid00001";

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Razorpay Dispute Service Hotel");
  otherHotel = await createTestHotel(owner, "Razorpay Other Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  const s = `"${hotel.schema}"`;
  ravi = newId();
  meera = newId();
  twin1 = newId();
  await owner.query(`INSERT INTO ${s}.customers (id, name, mobile) VALUES ($1, 'Ravi', '98200 11452'), ($2, 'Meera', '9820022333'), ($3, 'Twin One', '9820033444'), ($4, 'Twin Two', '+91 98200 33444')`, [ravi, meera, twin1, newId()]);
  acme = String((await owner.query(`INSERT INTO ${s}.company_profiles (name) VALUES ('Acme Textiles') RETURNING id`)).rows[0].id);
  const pay = (ref: string, status: string, contact: string | null, amount: number, company: string | null = null) =>
    owner.query(`INSERT INTO ${s}.razorpay_records (kind, business, ref, status, amount_paise, contact, company_id) VALUES ('payment', 'hotel', $1, $2, $3, $4, $5)`, [ref, status, amount, contact, company]);
  await pay(PAY_RAVI, "captured", "+919820011452", 500000); // Ravi's phone in another spelling
  await pay(PAY_MEERA, "captured", "9820022333", 300000);
  await pay(PAY_TWIN, "captured", "9820033444", 100000); // two customers share this number: linked to nobody
  await pay(PAY_STRANGER, "captured", "9000000000", 100000);
  await pay(PAY_NEW, "created", "+919820011452", 100000);
  await pay(PAY_ACME, "captured", null, 900000, acme);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
  await releaseTestLock?.();
});

const META = { ip: "1.2.3.4", traceId: "trace-dispute-0001" };
const queued: { kind: string; hotelId: string | null; toEmail: string; payload: Record<string, unknown> }[] = [];
const real = () => createRazorpayDisputeService({ mail: { queue: async (m: (typeof queued)[number]) => { queued.push(m); } } as never, unit: createPgRazorpayUnit(database.withHotel), people: { get: async () => new Map([[staffId, { id: staffId, name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]) }, now: () => new Date("2026-11-02T10:00:00+05:30"), catalog });
type Real = ReturnType<typeof real>;
/** The service as the routes call it, with the request meta filled in. */
const service = () => {
  const s = real();
  return {
    myPayments: s.myPayments,
    mine: s.mine,
    list: s.list,
    raise: (session: Parameters<Real["raise"]>[0], input: Parameters<Real["raise"]>[2]) => s.raise(session, META, input),
    withdraw: (session: Parameters<Real["withdraw"]>[0], id: string, hotel?: string) => s.withdraw(session, META, id, hotel),
    respond: (session: Parameters<Real["respond"]>[0], id: string, input: Parameters<Real["respond"]>[3]) => s.respond(session, META, id, input),
  };
};
const guest = (id: string) => makeSession({ hotelId: hotel.id, userId: newId(), accountRole: "guest_user", scope: { kind: "guest", id } });
const company = (id: string) => makeSession({ hotelId: hotel.id, userId: newId(), accountRole: "corporate_user", scope: { kind: "company", id } });
const superAdmin = () => makeSession({ hotelId: hotel.id, userId: staffId, roleKey: "super_admin", roleLevel: 4, grants: [grant("bills.bills", "full")] });
const staff = (level: "view" | "edit" | "none", hotelId = hotel.id) => makeSession({ hotelId, userId: newId(), roleKey: "front_desk", roleLevel: 2, grants: level === "none" ? [] : [grant("bills.bills", level)] });
const page = { page: 1, pageSize: 25 };
const raise = (s: ReturnType<typeof guest>, paymentId: string, over: Record<string, unknown> = {}) =>
  service().raise(s, { business: "hotel", paymentId, kind: "dispute", title: "Charged twice", message: "I see two debits for one stay", ...over } as never);
const code = (e: unknown) => (e as { code?: string }).code;

describe("problems with online payments", () => {
  test("a guest sees their own payments only; a phone number in another spelling still matches; a number shared by two customers matches nobody", async () => {
    const mine = await service().myPayments(guest(ravi), page);
    assert.deepEqual(mine.items.map((p) => p.paymentId).sort(), [PAY_NEW, PAY_RAVI].sort());
    assert.deepEqual((await service().myPayments(guest(meera), page)).items.map((p) => p.paymentId), [PAY_MEERA]);
    assert.deepEqual((await service().myPayments(guest(twin1), page)).items, [], "a shared number is linked to nobody");
    assert.deepEqual((await service().myPayments(company(acme), page)).items.map((p) => p.paymentId), [PAY_ACME]);
    assert.equal("payload" in mine.items[0], false, "the raw Razorpay body never goes to a guest");
  });

  test("a guest raises a problem with their own payment; a refund request with no amount asks for what is left; it is theirs alone", async () => {
    const d = await raise(guest(ravi), PAY_RAVI);
    assert.match(d.number, /^RD-[0-9A-F]{8}$/);
    assert.deepEqual([d.status, d.kind, d.paymentId, d.amountPaise], ["open", "dispute", PAY_RAVI, null]);
    const r = await raise(guest(ravi), PAY_RAVI, { kind: "refund_request", title: "Please refund", message: "The stay was cancelled" });
    assert.equal(r.amountPaise, 500000);
    assert.deepEqual((await service().mine(guest(ravi), { ...page, status: "all" })).items.map((x) => x.number).sort(), [d.number, r.number].sort());
    assert.equal((await service().mine(guest(meera), { ...page, status: "all" })).total, 0, "another guest sees none of it");
  });

  test("another guest's payment, an unknown payment and a payment not yet taken are refused; so is a company raising on a guest's payment", async () => {
    await assert.rejects(raise(guest(meera), PAY_RAVI), (e) => code(e) === "NOT_FOUND");
    await assert.rejects(raise(guest(ravi), PAY_STRANGER), (e) => code(e) === "NOT_FOUND");
    await assert.rejects(raise(guest(ravi), "pay_DoesNotExist01"), (e) => code(e) === "NOT_FOUND");
    await assert.rejects(raise(company(acme), PAY_RAVI), (e) => code(e) === "NOT_FOUND");
    await assert.rejects(raise(guest(ravi), PAY_NEW), (e) => code(e) === "CONFLICT");
    const desk = staff("edit");
    await assert.rejects(service().raise(desk, { business: "hotel", paymentId: PAY_RAVI, kind: "dispute", title: "abc", message: "hello there" }), (e) => code(e) === "FORBIDDEN", "staff are not a guest or a company");
  });

  test("a company raises a problem with its own payment", async () => {
    const d = await raise(company(acme), PAY_ACME, { kind: "question", title: "Which invoice?", message: "Which invoice does this settle?" });
    assert.equal(d.kind, "question");
    assert.equal((await service().mine(company(acme), { ...page, status: "all" })).total, 1);
    assert.equal((await service().mine(guest(ravi), { ...page, status: "all" })).items.some((x) => x.number === d.number), false);
  });

  test("the text and the amount are checked: plain text, a real amount, no more than is left, no amount on a question", async () => {
    await assert.rejects(raise(guest(meera), PAY_MEERA, { title: "ab" }), (e) => code(e) === "VALIDATION_FAILED");
    await assert.rejects(raise(guest(meera), PAY_MEERA, { message: "<script>alert(1)</script>" }), (e) => code(e) === "VALIDATION_FAILED");
    await assert.rejects(raise(guest(meera), PAY_MEERA, { message: "x".repeat(2001) }), (e) => code(e) === "VALIDATION_FAILED");
    await assert.rejects(raise(guest(meera), PAY_MEERA, { amountPaise: 50 }), (e) => code(e) === "VALIDATION_FAILED");
    await assert.rejects(raise(guest(meera), PAY_MEERA, { amountPaise: 300001 }), (e) => code(e) === "VALIDATION_FAILED");
    await assert.rejects(raise(guest(meera), PAY_MEERA, { kind: "question", amountPaise: 100000 }), (e) => code(e) === "VALIDATION_FAILED");
    const ok = await raise(guest(meera), PAY_MEERA, { amountPaise: 100000 });
    assert.equal(ok.amountPaise, 100000);
  });

  test("at most three open problems on one payment", async () => {
    for (let i = 0; i < 2; i++) await raise(guest(meera), PAY_MEERA, { title: `Another ${i}` });
    await assert.rejects(raise(guest(meera), PAY_MEERA, { title: "One too many" }), (e) => code(e) === "CONFLICT");
  });

  test("a guest cannot answer; the Super Admin sees all, answers (a reply is needed), the guest sees the answer, and a closed one is not changed again", async () => {
    const d = await raise(guest(ravi), PAY_RAVI, { title: "Third problem", message: "Please look into this one" });
    await assert.rejects(service().respond(guest(ravi), d.id, { status: "answered", reply: "I answer myself" }), (e) => code(e) === "FORBIDDEN");
    await assert.rejects(service().list(guest(ravi), { ...page, status: "all" }), (e) => code(e) === "FORBIDDEN");
    const all = await service().list(superAdmin(), { ...page, status: "all" });
    assert.ok(all.total >= 5 && all.openCount >= 5);
    await assert.rejects(service().respond(superAdmin(), d.id, { status: "answered", reply: "" }), (e) => code(e) === "VALIDATION_FAILED");
    const answered = await service().respond(superAdmin(), d.id, { status: "answered", reply: "We found the second debit and will refund it in 5 days." });
    assert.deepEqual([answered.status, answered.repliedByName, answered.reply], ["answered", "Sonal Super", "We found the second debit and will refund it in 5 days."]);
    assert.equal((await service().mine(guest(ravi), { ...page, status: "answered" })).items[0].reply, answered.reply);
    await assert.rejects(service().withdraw(guest(ravi), d.id), (e) => code(e) === "CONFLICT", "an answered one cannot be taken back");
    const closed = await service().respond(superAdmin(), d.id, { status: "closed" });
    assert.deepEqual([closed.status, closed.reply], ["closed", answered.reply], "closing keeps the answer");
    await assert.rejects(service().respond(superAdmin(), d.id, { status: "answered", reply: "Changing my mind" }), (e) => code(e) === "CONFLICT");
  });

  test("a guest takes back an open problem, and cannot take back another guest's", async () => {
    const mineOpen = (await service().mine(guest(ravi), { ...page, status: "open" })).items[0];
    await assert.rejects(service().withdraw(guest(meera), mineOpen.id), (e) => code(e) === "NOT_FOUND");
    assert.equal((await service().withdraw(guest(ravi), mineOpen.id)).status, "withdrawn");
    await assert.rejects(service().withdraw(guest(ravi), mineOpen.id), (e) => code(e) === "CONFLICT");
    await assert.rejects(service().respond(superAdmin(), mineOpen.id, { status: "answered", reply: "Too late" }), (e) => code(e) === "CONFLICT");
  });

  test("the hotel it was raised at answers it: any of its staff with Bills access, not only the Super Admin; staff without it, or from another hotel, cannot", async () => {
    const d = await raise(guest(ravi), PAY_RAVI, { title: "Wrong amount", message: "The amount is not what I paid" });
    await assert.rejects(service().list(staff("none"), { ...page, status: "all" }), (e) => code(e) === "FORBIDDEN");
    assert.ok((await service().list(staff("view"), { ...page, status: "all" })).items.some((x) => x.id === d.id), "a reader can see it");
    await assert.rejects(service().respond(staff("view"), d.id, { status: "answered", reply: "Looking" }), (e) => code(e) === "FORBIDDEN", "reading is not answering");
    const answered = await service().respond(staff("edit"), d.id, { status: "answered", reply: "The extra 18% is GST, shown on your bill." });
    assert.equal(answered.status, "answered");
    assert.equal((await service().mine(guest(ravi), { ...page, status: "answered" })).items.some((x) => x.id === d.id && x.reply === answered.reply), true, "the guest reads the hotel's answer");
  });

  test("each hotel has its own database space: a problem raised at one hotel is not visible to, and cannot be answered by, another hotel's staff", async () => {
    const d = (await service().list(superAdmin(), { ...page, status: "all" })).items[0];
    const other = await service().list(staff("edit", otherHotel.id), { ...page, status: "all" });
    assert.equal(other.total, 0);
    await assert.rejects(service().respond(staff("edit", otherHotel.id), d.id, { status: "closed" }), (e) => code(e) === "NOT_FOUND");
  });

  test("raising, answering and taking back are written to the system log: who, what and the status, never the words", async () => {
    const logs = await owner.query(`SELECT user_name, action, entity, summary, details::text AS details FROM "${hotel.schema}".system_logs WHERE module = 'payments' AND entity = 'Payment problem' ORDER BY created_at, id`);
    assert.ok(logs.rows.length >= 8, "every raise, answer and take-back left a line");
    assert.ok(logs.rows.some((l) => l.user_name === "Guest" && l.action === "created"), "a guest raising is named Guest");
    assert.ok(logs.rows.some((l) => l.user_name === "Company" && l.action === "created"), "a company raising is named Company");
    assert.ok(logs.rows.some((l) => l.user_name === "Sonal Super" && /Answered/.test(String(l.summary))), "an answer names the staff member");
    const text = JSON.stringify(logs.rows);
    assert.equal(/second debit|extra 18%|I see two debits|Looking/.test(text), false, "the words of a message or an answer are never copied into the log");
  });

  test("an answer is emailed to the person (the guest's email; a company's email and its contacts), after the commit; closing without an answer sends nothing; the words are the hotel's", async () => {
    const s = `"${hotel.schema}"`;
    await owner.query(`UPDATE ${s}.customers SET email = 'Ravi@Example.com' WHERE id = $1`, [ravi]);
    await owner.query(`UPDATE ${s}.company_profiles SET email = 'accounts@acme.example', contacts = '[{"name":"Meena Shah","email":"meena@acme.example"},{"name":"No Mail"},{"name":"Dup","email":"ACCOUNTS@acme.example"}]'::jsonb WHERE id = $1`, [acme]);
    queued.length = 0;
    const g = await service().raise(guest(ravi), "hotel" === "hotel" ? { business: "hotel", paymentId: PAY_RAVI, kind: "question", title: "Which stay is this?", message: "Which stay does this advance belong to?" } : (null as never));
    const gDone = await service().respond(staff("edit"), g.id, { status: "answered", reply: "It is the advance for your 12 Nov booking." });
    assert.equal(queued.length, 1);
    assert.deepEqual([queued[0].kind, queued[0].hotelId, queued[0].toEmail], ["notification", hotel.id, "ravi@example.com"]);
    assert.deepEqual([queued[0].payload.reference, queued[0].payload.subject, queued[0].payload.message], [gDone.number, "Which stay is this?", "It is the advance for your 12 Nov booking."]);
    assert.ok(String(queued[0].payload.hotelName).length > 0);
    const mail = renderMail("notification", queued[0].payload as never);
    assert.ok(mail.text.includes("answered the problem you raised with an online payment") && mail.text.includes(`Problem number: ${gDone.number}`));
    assert.match(mail.text, /It is the advance for your 12 Nov booking\./);
    assert.doesNotMatch(mail.text, /company portal/, "it does not talk about a company notice");

    queued.length = 0;
    const c1 = await service().raise(company(acme), { business: "hotel", paymentId: PAY_ACME, kind: "dispute", title: "Wrong amount", message: "The amount does not match our invoice" });
    await service().respond(staff("edit"), c1.id, { status: "answered", reply: "Checked: it matches invoice 88." });
    assert.deepEqual(queued.map((m) => m.toEmail).sort(), ["accounts@acme.example", "meena@acme.example"], "the company's address and its contact, once each");

    queued.length = 0;
    const c2 = await service().raise(company(acme), { business: "hotel", paymentId: PAY_ACME, kind: "question", title: "Another question", message: "Where do we find the receipt?" });
    await service().respond(staff("edit"), c2.id, { status: "closed" });
    assert.equal(queued.length, 0, "closing without an answer sends no email");
  });
});
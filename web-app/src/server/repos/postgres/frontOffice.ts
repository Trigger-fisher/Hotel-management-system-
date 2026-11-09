import "server-only";
// The Front Office repositories on PostgreSQL (Pallav "Pms"): rooms, reservations, stays, charges, and the read-only neighbours (room types with
// their plans, website enquiries, ID proof types, settings). A front-office unit also carries billing's repositories: check-out writes the bill in
// the same transaction. The in-memory double (repos/memory/frontOffice.ts) is the reference for every rule.
import { toBigInt } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type {
  GuestRequestRecord,
  ChargeRecord, EnquiryRecord, FrontOfficeRepos, ReservationFields, ReservationRecord, ReservationView, RoomFields, RoomRecord, RoomTypeRecord, StayFields, StayRecord, StayView,
} from "../frontOffice";
import type { Unit } from "../types";
import { pgBillingRepos } from "./billing";
import { asDate, asText, countTotal, guard, moneyIn, read, versionedUpdate, write, type Kind } from "./shared";
import { cleanForIndex } from "../../crypto/fieldSeal";
import { numberSealer, sealedWrite, type NumberSealer } from "./sealedNumbers";
import { createPgUnit } from "./unit";

type Row = Record<string, unknown>;

const ROOM_SPEC: Record<string, Kind> = { number: "text", floor: "text", roomTypeId: "text", hkStatus: "text", outOfOrder: "text", outOfOrderReason: "text", notes: "text", sortOrder: "int" };
const RESERVATION_SPEC: Record<string, Kind> = {
  guestName: "text", mobile: "text", email: "text", companyId: "text", roomTypeId: "text", rooms: "int", plan: "text", ratePaise: "money", adults: "int", children: "int", checkIn: "date",
  checkOut: "date", source: "text", status: "text", siteEnquiryId: "text", notes: "text", cancelReason: "text",
};
const STAY_SPEC: Record<string, Kind> = {
  reservationId: "text", roomId: "text", grNumber: "text", guestName: "text", mobile: "text", email: "text", address: "text", city: "text", nationality: "text", idProofType: "text",
  idProofNumber: "text", idProofPath: "text", companyId: "text", guestGstin: "text", adults: "int", children: "int", plan: "text", ratePaise: "money", checkInAt: "ts", expectedCheckOut: "date",
  checkOutAt: "ts", status: "text", billId: "text", hotelGstPercent: "pct", foodGstPercent: "pct", notes: "text", guestDetails: "json",
};

const audit = (r: Row) => ({ createdBy: asText(r.created_by), updatedBy: asText(r.updated_by), createdAt: asDate(r.created_at) as Date, updatedAt: asDate(r.updated_at) as Date });
const roomOf = (r: Row): RoomRecord => ({ id: String(r.id), ...(read(ROOM_SPEC, r) as unknown as RoomFields), outOfOrder: r.out_of_order === true, sortOrder: Number(r.sort_order), ...audit(r) });
/** Row mappers, also used by the portals' own reads (repos/postgres/portal.ts). */
export const reservationOf = (r: Row): ReservationRecord => ({ id: String(r.id), reference: String(r.reference), ...(read(RESERVATION_SPEC, r) as unknown as ReservationFields), ...audit(r), version: Number(r.version) });
/** `sealer` (decision 74): the ID number is opened from its sealed column; without one the plain column is read as it is. */
export const stayOf = (r: Row, sealer?: NumberSealer): StayRecord => {
  const fields = read(STAY_SPEC, r, sealer?.membersCodec()) as unknown as StayFields;
  return { id: String(r.id), ...fields, ...(sealer ? { idProofNumber: sealer.plainOf("stays", r) } : {}), ...audit(r), version: Number(r.version) };
};
const chargeOf = (r: Row): ChargeRecord => ({
  id: String(r.id), stayId: String(r.stay_id), chargeDate: String(r.charge_date), category: r.category as ChargeRecord["category"], side: r.side as ChargeRecord["side"], description: String(r.description),
  quantity: String(r.quantity), unitPricePaise: toBigInt(r.unit_price_paise), amountPaise: toBigInt(r.amount_paise), createdBy: asText(r.created_by), createdAt: asDate(r.created_at) as Date,
});

/** Room fields written as columns (a boolean is passed as a boolean, not as text). */
const writeRoom = (values: object) => write({ ...ROOM_SPEC, outOfOrder: "int" }, values);

const wordsOver = (columns: string[], words: readonly string[] | undefined, params: unknown[]): string => {
  if (!words || words.length === 0) return "true";
  return words
    .map((w) => {
      params.push(w.toLowerCase());
      return `position($${params.length}::text in lower(concat_ws(' ', ${columns.join(", ")}))) > 0`;
    })
    .join(" AND ");
};

// the expression of pms_stays_mobile_last10_idx and pms_reservations_mobile_last10_idx (migration 0050): ten digits hit the index, fewer compare the tail of it
const MOBILE_LAST10 = "right(regexp_replace(mobile, '[^0-9]', '', 'g'), 10)";
const mobileSuffixWhere = (digits: string, params: unknown[]): string => {
  params.push(digits);
  if (digits.length >= 10) return `mobile IS NOT NULL AND ${MOBILE_LAST10} = $${params.length}`;
  params.push(digits.length);
  return `mobile IS NOT NULL AND right(${MOBILE_LAST10}, $${params.length}::int) = $${params.length - 1}`;
};

const RESERVATION_VIEW: Record<ReservationView, string> = {
  upcoming: "status = 'confirmed'",
  today: "status = 'confirmed' AND check_in <= $TODAY",
  in_house: "status = 'checked_in'",
  past: "status = 'checked_out'",
  cancelled: "status IN ('cancelled', 'no_show')",
  all: "true",
};
const RESERVATION_ORDER: Record<ReservationView, string> = {
  // decision 52: every list shows the latest first
  upcoming: "check_in DESC",
  today: "check_in DESC",
  in_house: "check_out DESC",
  past: "check_out DESC",
  cancelled: "updated_at DESC",
  all: "check_in DESC",
};

const requestOf = (r: Record<string, unknown>): GuestRequestRecord => ({
  id: String(r.id), stayId: String(r.stay_id), kind: r.kind as GuestRequestRecord["kind"], note: asText(r.note), status: r.status as GuestRequestRecord["status"], reply: asText(r.reply),
  createdBy: asText(r.created_by), doneBy: asText(r.done_by), doneAt: asDate(r.done_at), createdAt: asDate(r.created_at) as Date,
});

export function pgFrontOfficeRepos(tx: TxClient, hotelId: string): FrontOfficeRepos {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  const sealer = numberSealer(hotelId);
  const stay = (r: Row): StayRecord => stayOf(r, sealer);
  const billing = pgBillingRepos(tx);

  const reservationList = (view: ReservationView, today: string, words: readonly string[] | undefined, params: unknown[]): string => {
    // only the "today" view mentions the day: an unused parameter would be refused by the server
    let filter = RESERVATION_VIEW[view];
    if (filter.includes("$TODAY")) {
      params.push(today);
      filter = filter.replace("$TODAY", `$${params.length}`);
    }
    return `${filter} AND ${wordsOver(["guest_name", "mobile", "reference"], words, params)}`;
  };

  const stayView = (view: StayView): string => (view === "past" ? "s.status = 'checked_out'" : "s.status = 'in_house'");
  const stayWhere = (view: StayView, words: readonly string[] | undefined, params: unknown[]): string => `${stayView(view)} AND ${wordsOver(["s.guest_name", "s.mobile", "s.gr_number", "r.number"], words, params)}`;

  return {
    ...billing,

    rooms: {
      async all() {
        return (await q('SELECT * FROM pms_rooms ORDER BY sort_order, number COLLATE "C", id')).rows.map(roomOf);
      },
      async get(id, options) {
        const r = await q(`SELECT * FROM pms_rooms WHERE id = $1${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return r.rows[0] ? roomOf(r.rows[0]) : null;
      },
      async existingNumbers(numbers) {
        if (numbers.length === 0) return [];
        const r = await q("SELECT number FROM pms_rooms WHERE lower(number) = ANY($1::text[])", [numbers.map((n) => n.toLowerCase())]);
        return r.rows.map((x) => String(x.number));
      },
      async maxSortOrder() {
        return Number((await q("SELECT COALESCE(MAX(sort_order), 0) AS n FROM pms_rooms")).rows[0].n);
      },
      async create(input) {
        const { createdBy, ...fields } = input;
        const w = writeRoom(fields);
        const columns = [...w.columns, "created_by"];
        const params = [...w.params, createdBy];
        const r = await guard(q(`INSERT INTO pms_rooms (${columns.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params));
        return roomOf(r.rows[0]);
      },
      async update(id, patch, actorId) {
        const w = writeRoom(patch);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 2}`), `updated_by = $${w.columns.length + 2}`].join(", ");
        const r = await guard(q(`UPDATE pms_rooms SET ${set} WHERE id = $1 RETURNING *`, [id, ...w.params, actorId]));
        return r.rows[0] ? roomOf(r.rows[0]) : null;
      },
      async delete(id) {
        const r = await guard(q("DELETE FROM pms_rooms WHERE id = $1", [id]));
        return r.affectedRows > 0;
      },
      async hasStays(roomId) {
        return (await q("SELECT 1 AS x FROM pms_stays WHERE room_id = $1 LIMIT 1", [roomId])).rows.length > 0;
      },
      async withStays(roomIds) {
        if (roomIds.length === 0) return new Set();
        return new Set((await q("SELECT DISTINCT room_id FROM pms_stays WHERE room_id = ANY($1::uuid[])", [roomIds])).rows.map((r) => String(r.room_id)));
      },
    },

    reservations: {
      async get(id, options) {
        const r = await q(`SELECT * FROM pms_reservations WHERE id = $1${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return r.rows[0] ? reservationOf(r.rows[0]) : null;
      },
      async getMany(ids) {
        if (ids.length === 0) return new Map();
        return new Map((await q("SELECT * FROM pms_reservations WHERE id = ANY($1::uuid[])", [ids])).rows.map((r) => [String(r.id), reservationOf(r)]));
      },
      async list(query) {
        const params: unknown[] = [];
        const where = reservationList(query.view, query.today, query.words, params);
        const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM pms_reservations WHERE ${where}`, params);
        params.push(query.pageSize, (query.page - 1) * query.pageSize);
        // then newest first (orderByDesc('id'): the id is made in order of time)
        const r = await q(`SELECT * FROM pms_reservations WHERE ${where} ORDER BY ${RESERVATION_ORDER[query.view]}, created_at DESC, reference DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: r.rows.map(reservationOf), total };
      },
      async countByView(today, words) {
        const params: unknown[] = [today];
        const todayWhere = (view: ReservationView) => RESERVATION_VIEW[view].replace("$TODAY", "$1");
        const wordWhere = wordsOver(["guest_name", "mobile", "reference"], words, params);
        const views = Object.keys(RESERVATION_VIEW) as ReservationView[];
        const r = await q(`SELECT ${views.map((v) => `COUNT(*) FILTER (WHERE ${todayWhere(v)}) AS ${v}`).join(", ")} FROM pms_reservations WHERE ${wordWhere}`, params);
        return Object.fromEntries(views.map((v) => [v, Number(r.rows[0][v])])) as Record<ReservationView, number>;
      },
      async arrivals(today) {
        return (await q("SELECT * FROM pms_reservations WHERE status = 'confirmed' AND check_in <= $1 ORDER BY check_in, guest_name COLLATE \"C\", id", [today])).rows.map(reservationOf);
      },
      async arrivalsToday(date) {
        return Number((await q("SELECT COUNT(*) AS n FROM pms_reservations WHERE status = 'confirmed' AND check_in = $1::date", [date])).rows[0].n);
      },
      async holding(roomTypeId, firstNight, lastNight, options) {
        const params: unknown[] = [roomTypeId, firstNight, lastNight];
        let extra = "";
        if (options?.ignoreId) {
          params.push(options.ignoreId);
          extra += ` AND id <> $${params.length}`;
        }
        if (options?.countWebsite === false) extra += " AND site_enquiry_id IS NULL";
        const r = await q(`SELECT check_in, check_out, rooms FROM pms_reservations WHERE room_type_id = $1 AND status IN ('confirmed', 'checked_in') AND check_in <= $3 AND check_out > $2${extra}`, params);
        return r.rows.map((x) => ({ checkIn: String(x.check_in), checkOut: String(x.check_out), rooms: Number(x.rooms) }));
      },
      async byEnquiry(siteEnquiryId) {
        const r = await q("SELECT * FROM pms_reservations WHERE site_enquiry_id = $1", [siteEnquiryId]);
        return r.rows[0] ? reservationOf(r.rows[0]) : null;
      },
      async openForCheckIn(limit) {
        return (await q("SELECT * FROM pms_reservations WHERE status IN ('confirmed', 'checked_in') ORDER BY check_in, id LIMIT $1", [limit])).rows.map(reservationOf);
      },
      async byMobileSuffix(digits, limit) {
        const params: unknown[] = [];
        const where = mobileSuffixWhere(digits, params);
        params.push(limit);
        return (await q(`SELECT * FROM pms_reservations WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`, params)).rows.map(reservationOf);
      },
      async create(input) {
        const { createdBy, year2, ...fields } = input;
        // one past the highest number of ANY reference (Pallav: the auto-increment id), taken under a lock so two creates never read the same maximum
        await q("SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || '.reservation_reference', 0))");
        const next = Number((await q("SELECT COALESCE(MAX(NULLIF(substring(reference from '([0-9]+)$'), '')::bigint), 0) + 1 AS n FROM pms_reservations")).rows[0].n);
        const reference = `RES-${year2}-${String(next).padStart(5, "0")}`;
        const w = write(RESERVATION_SPEC, fields);
        const columns = [...w.columns, "reference", "created_by"];
        const params = [...w.params, reference, createdBy];
        const r = await guard(q(`INSERT INTO pms_reservations (${columns.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params));
        return reservationOf(r.rows[0]);
      },
      async update(id, expectedVersion, patch, actorId) {
        const w = write(RESERVATION_SPEC, patch);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 3}`), `updated_by = $${w.columns.length + 3}`].join(", ");
        const res = await versionedUpdate(tx, "pms_reservations", id, expectedVersion, set, [...w.params, actorId], false, { softDelete: false });
        return res.ok ? { ok: true, record: reservationOf(res.row) } : res;
      },
    },

    stays: {
      async get(id, options) {
        const r = await q(`SELECT * FROM pms_stays WHERE id = $1${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return r.rows[0] ? stay(r.rows[0]) : null;
      },
      async list(query) {
        const params: unknown[] = [];
        const where = stayWhere(query.view, query.words, params);
        const from = "pms_stays s JOIN pms_rooms r ON r.id = s.room_id";
        const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM ${from} WHERE ${where}`, params);
        params.push(query.pageSize, (query.page - 1) * query.pageSize);
        const order = query.view === "past" ? "s.check_out_at DESC NULLS LAST, s.created_at ASC, s.id" : "s.check_in_at DESC, s.created_at DESC, s.id DESC";
        const r = await q(`SELECT s.* FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: r.rows.map(stay), total };
      },
      async countByView(words) {
        const params: unknown[] = [];
        const wordWhere = wordsOver(["s.guest_name", "s.mobile", "s.gr_number", "r.number"], words, params);
        const r = await q(`SELECT COUNT(*) FILTER (WHERE s.status = 'in_house') AS in_house, COUNT(*) FILTER (WHERE s.status = 'checked_out') AS past FROM pms_stays s JOIN pms_rooms r ON r.id = s.room_id WHERE ${wordWhere}`, params);
        return { in_house: Number(r.rows[0].in_house), past: Number(r.rows[0].past) };
      },
      async currentByRoom(roomIds) {
        const out = new Map<string, StayRecord>();
        if (roomIds.length === 0) return out;
        for (const row of (await q("SELECT * FROM pms_stays WHERE status = 'in_house' AND room_id = ANY($1::uuid[])", [roomIds])).rows) out.set(String(row.room_id), stay(row));
        return out;
      },
      async departures(today) {
        return (await q("SELECT * FROM pms_stays WHERE status = 'in_house' AND expected_check_out <= $1 ORDER BY expected_check_out, created_at, id", [today])).rows.map(stay);
      },
      async inHouseCount() {
        return Number((await q("SELECT COUNT(*) AS n FROM pms_stays WHERE status = 'in_house'")).rows[0].n);
      },
      async byReservation(reservationIds) {
        const out = new Map<string, StayRecord[]>(reservationIds.map((id) => [id, []]));
        if (reservationIds.length === 0) return out;
        for (const row of (await q("SELECT * FROM pms_stays WHERE reservation_id = ANY($1::uuid[]) ORDER BY created_at, id", [reservationIds])).rows) out.get(String(row.reservation_id))?.push(stay(row));
        return out;
      },
      async sameIdInHouse(idNumber, exceptId) {
        const clean = cleanForIndex(idNumber);
        if (clean === "") return [];
        // by the search index (the sealed rows) or, for a row not sealed yet, by the plain column cleaned the same way. RELEASE B (the plain column is dropped): keep only the index condition.
        const r = await q(
          `SELECT * FROM pms_stays WHERE status = 'in_house' AND id <> $1 AND (($2::text IS NOT NULL AND id_proof_number_idx = $2::text) OR upper(regexp_replace(coalesce(id_proof_number, ''), '[\\s\\-._/]+', '', 'g')) = $3) ORDER BY check_in_at DESC, id DESC LIMIT 5`,
          [exceptId, sealer.indexOf("stays", idNumber), clean],
        );
        return r.rows.map(stay);
      },
      async walkInsOfType(roomTypeId) {
        return (
          await q("SELECT s.* FROM pms_stays s JOIN pms_rooms r ON r.id = s.room_id WHERE s.reservation_id IS NULL AND s.status = 'in_house' AND r.room_type_id = $1 ORDER BY s.created_at, s.id", [roomTypeId])
        ).rows.map(stay);
      },
      async byMobileSuffix(digits, limit) {
        const params: unknown[] = [];
        const where = mobileSuffixWhere(digits, params);
        params.push(limit);
        return (await q(`SELECT * FROM pms_stays WHERE ${where} ORDER BY check_in_at DESC, created_at DESC, id DESC LIMIT $${params.length}`, params)).rows.map((r) => stayOf(r));
      },
      async highestGrNumber() {
        return Number((await q("SELECT COALESCE(MAX(NULLIF(regexp_replace(gr_number, '[^0-9]', '', 'g'), '')::numeric), 0) AS n FROM pms_stays WHERE gr_number IS NOT NULL")).rows[0].n);
      },
      async create(input) {
        const { createdBy, ...fields } = input;
        const w = sealedWrite(sealer, "stays", write(STAY_SPEC, fields, sealer.membersCodec()), fields.idProofNumber);
        const columns = [...w.columns, "created_by"];
        const params = [...w.params, createdBy];
        const r = await guard(q(`INSERT INTO pms_stays (${columns.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params));
        return stay(r.rows[0]);
      },
      async update(id, expectedVersion, patch, actorId) {
        const w = sealedWrite(sealer, "stays", write(STAY_SPEC, patch, sealer.membersCodec()), patch.idProofNumber);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 3}`), `updated_by = $${w.columns.length + 3}`].join(", ");
        const res = await versionedUpdate(tx, "pms_stays", id, expectedVersion, set, [...w.params, actorId], false, { softDelete: false });
        return res.ok ? { ok: true, record: stay(res.row) } : res;
      },
    },

    charges: {
      async forStays(stayIds) {
        const out = new Map<string, ChargeRecord[]>(stayIds.map((id) => [id, []]));
        if (stayIds.length === 0) return out;
        for (const row of (await q("SELECT * FROM pms_charges WHERE stay_id = ANY($1::uuid[]) ORDER BY charge_date, created_at, id", [stayIds])).rows) out.get(String(row.stay_id))?.push(chargeOf(row));
        return out;
      },
      async get(id) {
        const r = await q("SELECT * FROM pms_charges WHERE id = $1", [id]);
        return r.rows[0] ? chargeOf(r.rows[0]) : null;
      },
      async create(input) {
        const r = await guard(
          q("INSERT INTO pms_charges (stay_id, charge_date, category, side, description, quantity, unit_price_paise, amount_paise, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *", [
            input.stayId, input.chargeDate, input.category, input.side, input.description, input.quantity, moneyIn(input.unitPricePaise), moneyIn(input.amountPaise), input.createdBy,
          ]),
        );
        return chargeOf(r.rows[0]);
      },
      async delete(id) {
        return (await q("DELETE FROM pms_charges WHERE id = $1", [id])).affectedRows > 0;
      },
    },

    roomTypes: {
      async all() {
        const types = await q("SELECT id, name, total_count, sort_order FROM site_rooms ORDER BY sort_order, name COLLATE \"C\", id");
        const plans = await q("SELECT room_id, code, name, price_single_paise, price_double_paise, active, sort_order FROM site_rate_plans ORDER BY sort_order, name, id");
        return types.rows.map(
          (t): RoomTypeRecord => ({
            id: String(t.id), name: String(t.name), totalCount: Number(t.total_count), sortOrder: Number(t.sort_order),
            plans: plans.rows.filter((p) => String(p.room_id) === String(t.id)).map((p) => ({ code: String(p.code), name: String(p.name), singlePaise: p.price_single_paise === null ? null : toBigInt(p.price_single_paise), doublePaise: toBigInt(p.price_double_paise), active: p.active === true, sortOrder: Number(p.sort_order) })),
          }),
        );
      },
      async get(id) {
        return (await this.all()).find((t) => t.id === id) ?? null;
      },
    },

    enquiries: {
      async get(id) {
        const r = await q("SELECT * FROM site_enquiries WHERE id = $1", [id]);
        return r.rows[0] ? enquiryOf(r.rows[0]) : null;
      },
      async getMany(ids) {
        if (ids.length === 0) return new Map();
        return new Map((await q("SELECT * FROM site_enquiries WHERE id = ANY($1::uuid[])", [ids])).rows.map((r) => [String(r.id), enquiryOf(r)]));
      },
    },

    guestRequests: {
      async get(id) {
        const r = await q("SELECT * FROM guest_requests WHERE id = $1", [id]);
        return r.rows[0] ? requestOf(r.rows[0]) : null;
      },
      async byStay(stayId) {
        return (await q("SELECT * FROM guest_requests WHERE stay_id = $1 ORDER BY created_at DESC, id DESC", [stayId])).rows.map(requestOf);
      },
      async list(query) {
        const open = query.view === "open";
        const where = open ? "status = 'open'" : "status <> 'open'";
        const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM guest_requests WHERE ${where}`, []);
        const order = open ? "created_at ASC, id ASC" : "done_at DESC NULLS LAST, id DESC";
        const r = await q(`SELECT * FROM guest_requests WHERE ${where} ORDER BY ${order} LIMIT $1 OFFSET $2`, [query.pageSize, (query.page - 1) * query.pageSize]);
        return { rows: r.rows.map(requestOf), total };
      },
      async countOpen() {
        return Number((await q("SELECT COUNT(*) AS n FROM guest_requests WHERE status = 'open'")).rows[0]?.n ?? 0);
      },
      async create(input) {
        const r = await guard(q("INSERT INTO guest_requests (stay_id, kind, note, created_by) VALUES ($1, $2, $3, $4) RETURNING *", [input.stayId, input.kind, input.note, input.createdBy]));
        return requestOf(r.rows[0]);
      },
      async close(id, next) {
        const r = await guard(q("UPDATE guest_requests SET status = $2, reply = $3, done_by = $4, done_at = $5 WHERE id = $1 AND status = 'open' RETURNING *", [id, next.status, next.reply, next.doneBy, next.doneAt]));
        return r.rows[0] ? requestOf(r.rows[0]) : null;
      },
    },
    idProofTypes: {
      async activeNames() {
        return (await q('SELECT name FROM id_proof_types WHERE is_active ORDER BY name COLLATE "C"')).rows.map((r) => String(r.name));
      },
    },

    settings: {
      async values(keys) {
        const out = new Map<string, string | null>(keys.map((k) => [k, null]));
        if (keys.length === 0) return out;
        for (const row of (await q("SELECT key, value FROM app_settings WHERE key = ANY($1::text[])", [keys])).rows) out.set(String(row.key), row.value === null ? null : String(row.value));
        return out;
      },
    },
  };
}

const enquiryOf = (r: Row): EnquiryRecord => ({
  id: String(r.id), reference: String(r.reference), name: String(r.name), phone: asText(r.phone), email: asText(r.email), message: asText(r.message), roomId: asText(r.room_id),
  checkIn: asText(r.check_in), checkOut: asText(r.check_out), guests: r.guests === null ? null : Number(r.guests), children: r.children === null ? null : Number(r.children),
});

export function createPgFrontOfficeUnit(withHotel: WithHotel): Unit<FrontOfficeRepos> {
  return createPgUnit(withHotel, pgFrontOfficeRepos);
}

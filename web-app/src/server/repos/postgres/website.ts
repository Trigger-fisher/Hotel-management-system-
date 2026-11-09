import "server-only";
// The Website repositories on PostgreSQL: enquiries and their reference counter, room categories, tariff plans, the rate and inventory calendar,
// the page wording, the card lists (gallery, services, house rules, nearby places), the settings and the module's change log. Hard delete everywhere,
// as Pallav does. The in-memory double (repos/memory/website.ts) is the reference for every rule.
import { toBigInt } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type {
  DateRateRecord, GalleryPhotoRecord, InventoryRecord, NearbyRecord, OrderedRepo, PageContentFields, PolicyRecord, PriceTier, RoomPhoto, ServiceRecord, SiteEnquiryRecord, SitePlanRecord, SiteRoomRecord,
  SiteSecrets, SiteSettingsFields, WebsiteRepos,
} from "../website";
import { RepoError, type Unit } from "../types";
import { asDate, asText, countTotal, guard, moneyIn, read, write, type Kind } from "./shared";
import { createPgUnit } from "./unit";

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const paise = (v: unknown): bigint | null => (v === null || v === undefined ? null : toBigInt(v));

/* ---- enquiries ---- */
const ENQUIRY_SPEC: Record<string, Kind> = { name: "text", phone: "text", email: "text", message: "text", roomId: "text", checkIn: "date", checkOut: "date", guests: "int", children: "int" };
const enquiryOf = (r: Row): SiteEnquiryRecord => ({
  id: String(r.id), reference: String(r.reference), ...(read(ENQUIRY_SPEC, r) as unknown as Pick<SiteEnquiryRecord, "name" | "phone" | "email" | "message" | "roomId" | "checkIn" | "checkOut" | "guests" | "children">),
  status: r.status as SiteEnquiryRecord["status"], decisionNote: asText(r.decision_note), decidedBy: asText(r.decided_by), decidedByName: asText(r.decided_by_name), decidedAt: asDate(r.decided_at),
  ipAddress: asText(r.ip_address), createdAt: asDate(r.created_at) as Date, updatedAt: asDate(r.updated_at) as Date,
});
const withRoom = (r: Row): SiteEnquiryRecord & { roomName: string | null } => ({ ...enquiryOf(r), roomName: asText(r.room_name) });

/* ---- rooms and plans ---- */
const ROOM_SPEC: Record<string, Kind> = { name: "text", size: "text", bedType: "text", maxGuests: "int", totalCount: "int", note: "text", badgeLabel: "text", showPrice: "text", available: "text", photos: "json" };
const roomOf = (r: Row): SiteRoomRecord => ({
  id: String(r.id), slug: String(r.slug), sortOrder: Number(r.sort_order), name: String(r.name), size: asText(r.size), bedType: asText(r.bed_type), maxGuests: Number(r.max_guests), totalCount: Number(r.total_count),
  note: asText(r.note), badgeLabel: asText(r.badge_label), showPrice: r.show_price === true, available: r.available === true, photos: ((r.photos as RoomPhoto[] | null) ?? []).map((p) => ({ path: p.path, name: p.name ?? null, alt: p.alt ?? null })), plans: [],
});
const tiersOut = (raw: unknown): PriceTier[] => ((raw as { guests: number; pricePaise: string }[] | null) ?? []).map((t) => ({ guests: Number(t.guests), pricePaise: BigInt(String(t.pricePaise)) }));
const tiersIn = (tiers: readonly PriceTier[]): string => JSON.stringify(tiers.map((t) => ({ guests: t.guests, pricePaise: t.pricePaise.toString() })));
const planOf = (r: Row): SitePlanRecord => ({
  id: String(r.id), roomId: String(r.room_id), sortOrder: Number(r.sort_order), active: r.active === true, name: String(r.name), code: String(r.code), tiers: tiersOut(r.occupancy_prices), doublePaise: toBigInt(r.price_double_paise),
  singlePaise: paise(r.price_single_paise), extraPersonPaise: paise(r.extra_person_price_paise),
});

/* ---- the wording and the settings ---- */
const CONTENT_FIELDS: Record<string, Kind> = {
  heroTitleLine1: "text", heroTitleEmphasis: "text", heroLead: "text", quickCheckTitle: "text", qcMsgPickDates: "text", qcMsgAvailable: "text", qcMsgUnavailable: "text", qcMsgError: "text", aboutKicker: "text",
  aboutHeading: "text", aboutP1: "text", aboutP2: "text", aboutP3: "text", enquireHeading: "text", enquireLead: "text", enquirePoints: "json", bookingTermsText: "text", fmMsgName: "text", fmMsgPhone: "text",
  fmMsgEmail: "text", fmMsgCheckin: "text", fmMsgCheckout: "text", fmMsgRoom: "text", fmMsgAdults: "text", fmMsgChildren: "text", fmMsgMessage: "text", fmMsgTerms: "text", fmMsgSuccess: "text",
  policiesFooterNote: "text", footerTagline: "text",
};
const CONTENT_NAMES = { aboutP1: "about_p1", aboutP2: "about_p2", aboutP3: "about_p3" };
const contentOf = (r: Row): PageContentFields => {
  const f = read(CONTENT_FIELDS, r, undefined, CONTENT_NAMES) as Record<string, unknown>;
  f.enquirePoints = (r.enquire_points as string[] | null) ?? [];
  return f as unknown as PageContentFields;
};

const SETTINGS_SPEC: Record<string, Kind> = {
  openedYear: "int", gmPhone: "text", receptionPhone: "text", email: "text", address: "text", checkinTime: "text", checkoutTime: "text", metaTitle: "text",
  metaDescription: "text", metaKeywords: "text", logoPath: "text", faviconPath: "text", gbpLink: "text", facebookLink: "text", instagramLink: "text", mapLat: "text", mapLng: "text", googlePlaceId: "text",
  googleMinReviewRating: "int", recipients: "json", smtpHost: "text", smtpPort: "int", smtpFromEmail: "text", smtpFromName: "text", gbpAccountId: "text", gbpLocationId: "text", googleLastFetchedAt: "ts",
  googleReviewCount: "int",
};
const SETTINGS_NAMES = { recipients: "notify_recipients" };
const SECRET_COLUMNS: Record<keyof SiteSecrets, string> = {
  googleMapsApiKey: "google_maps_api_key", gbpOauthClientId: "gbp_oauth_client_id", gbpOauthClientSecret: "gbp_oauth_client_secret", gbpRefreshToken: "gbp_oauth_refresh_token", gbpAccessToken: "gbp_oauth_access_token",
  smtpUsername: "smtp_username", smtpPassword: "smtp_password",
};
const settingsOf = (r: Row): { fields: SiteSettingsFields; secrets: SiteSecrets } => {
  const f = read(SETTINGS_SPEC, r, undefined, SETTINGS_NAMES) as Record<string, unknown>;
  f.mapLat = num(r.map_lat);
  f.mapLng = num(r.map_lng);
  f.address = f.address ?? "";
  f.recipients = (r.notify_recipients as { name: string; email: string }[] | null) ?? [];
  const secrets = Object.fromEntries(Object.entries(SECRET_COLUMNS).map(([field, column]) => [field, asText(r[column])])) as unknown as SiteSecrets;
  return { fields: f as unknown as SiteSettingsFields, secrets };
};

/* ---- the ordered card lists ---- */
interface OrderedKind<T, F> {
  table: string;
  columns: Record<string, string>;
  out(r: Row): T;
  /** Converts a field value on its way in (a policy's lines, a map coordinate). */
  in?(field: string, value: unknown): unknown;
  defaults?: Partial<F>;
}

export function pgWebsiteRepos(tx: TxClient): WebsiteRepos {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);

  async function setOrderOf(table: string, ids: readonly string[], where = "true", whereParams: unknown[] = []): Promise<boolean> {
    if (ids.length === 0) return false;
    const found = await q(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ANY($1::uuid[]) AND ${where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)}`, [ids, ...whereParams]);
    if (Number(found.rows[0].n) !== new Set(ids).size) return false;
    await q(`UPDATE ${table} t SET sort_order = v.pos FROM unnest($1::uuid[], $2::int[]) AS v(id, pos) WHERE t.id = v.id`, [ids, ids.map((_, i) => i)]);
    return true;
  }

  function ordered<T extends { id: string }, F extends object>(kind: OrderedKind<T, F>): OrderedRepo<T, F> {
    const names = (patch: object) => {
      const columns: string[] = [];
      const params: unknown[] = [];
      for (const [field, value] of Object.entries(patch)) {
        const column = kind.columns[field];
        if (value === undefined || !column) continue;
        columns.push(column);
        params.push(kind.in ? kind.in(field, value) : value);
      }
      return { columns, params };
    };
    return {
      async list() {
        return (await q(`SELECT * FROM ${kind.table} ORDER BY sort_order, id`)).rows.map(kind.out);
      },
      async get(id) {
        const r = await q(`SELECT * FROM ${kind.table} WHERE id = $1`, [id]);
        return r.rows[0] ? kind.out(r.rows[0]) : null;
      },
      async count() {
        return Number((await q(`SELECT COUNT(*) AS n FROM ${kind.table}`)).rows[0].n);
      },
      async create(fields, by) {
        const w = names({ ...fields });
        const columns = [...w.columns, "created_by", "updated_by", "sort_order"];
        const params = [...w.params, by, by];
        const r = await guard(
          q(`INSERT INTO ${kind.table} (${columns.join(", ")}) VALUES (${w.columns.map((_, i) => `$${i + 1}`).join(", ")}${w.columns.length ? ", " : ""}$${w.columns.length + 1}, $${w.columns.length + 2}, COALESCE((SELECT MAX(sort_order) FROM ${kind.table}), 0) + 1) RETURNING *`, params),
        );
        return kind.out(r.rows[0]);
      },
      async update(id, patch, by) {
        const w = names(patch);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 2}`), `updated_by = $${w.columns.length + 2}`].join(", ");
        const r = await guard(q(`UPDATE ${kind.table} SET ${set} WHERE id = $1 RETURNING *`, [id, ...w.params, by]));
        if (!r.rows[0]) throw new RepoError("check", "row not found");
        return kind.out(r.rows[0]);
      },
      async remove(id) {
        return (await q(`DELETE FROM ${kind.table} WHERE id = $1`, [id])).affectedRows > 0;
      },
      async setOrder(ids) {
        return setOrderOf(kind.table, ids);
      },
    };
  }

  const enquiryWhere = (tab: string, words: readonly string[] | undefined, params: unknown[]): string => {
    const parts = [tab === "all" ? "true" : tab === "pending" ? "e.status IN ('new', 'pending')" : `e.status = '${tab === "confirmed" ? "confirmed" : "declined"}'`];
    for (const w of words ?? []) {
      params.push(w.toLowerCase());
      parts.push(`position($${params.length}::text in lower(concat_ws(' ', e.name, e.phone, e.email, e.reference))) > 0`);
    }
    return parts.join(" AND ");
  };

  return {
    siteEnquiries: {
      async get(id, options) {
        const r = await q(`SELECT * FROM site_enquiries WHERE id = $1${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return r.rows[0] ? enquiryOf(r.rows[0]) : null;
      },
      async getMany(ids) {
        if (ids.length === 0) return [];
        return (await q("SELECT * FROM site_enquiries WHERE id = ANY($1::uuid[]) ORDER BY created_at, id", [ids])).rows.map(enquiryOf);
      },
      async list(query) {
        const params: unknown[] = [];
        const where = enquiryWhere(query.tab, query.words, params);
        const decided = query.tab === "confirmed" || query.tab === "declined";
        const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM site_enquiries e WHERE ${where}`, params);
        params.push(query.pageSize, (query.page - 1) * query.pageSize);
        const order = decided ? "COALESCE(e.decided_at, e.created_at) DESC, e.id DESC" : "e.created_at DESC, e.id DESC";
        const r = await q(`SELECT e.* FROM site_enquiries e WHERE ${where} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: r.rows.map(enquiryOf), total };
      },
      async promoteNew(before) {
        return (await q("UPDATE site_enquiries SET status = 'pending' WHERE status = 'new' AND created_at < $1", [before.toISOString()])).affectedRows;
      },
      async counts(range) {
        const params: unknown[] = [];
        let where = "true";
        if (range) {
          params.push(range.from.toISOString(), range.to.toISOString());
          where = "created_at >= $1 AND created_at <= $2";
        }
        const r = await q(
          `SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE status IN ('new', 'pending')) AS pending, COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed, COUNT(*) FILTER (WHERE status = 'declined') AS declined FROM site_enquiries WHERE ${where}`,
          params,
        );
        const x = r.rows[0];
        return { all: Number(x.n), pending: Number(x.pending), confirmed: Number(x.confirmed), declined: Number(x.declined) };
      },
      async confirmedStays(roomId, from, to, ignoreId) {
        const r = await q(
          "SELECT check_in, check_out FROM site_enquiries WHERE room_id = $1 AND status = 'confirmed' AND ($4::uuid IS NULL OR id <> $4::uuid) AND check_in IS NOT NULL AND check_out IS NOT NULL AND check_in <= $3 AND check_out > $2 ORDER BY check_in, id",
          [roomId, from, to, ignoreId ?? null],
        );
        return r.rows.map((x) => ({ checkIn: String(x.check_in), checkOut: String(x.check_out) }));
      },
      async arrivals(from, to) {
        const r = await q(
          "SELECT e.*, s.name AS room_name FROM site_enquiries e LEFT JOIN site_rooms s ON s.id = e.room_id WHERE e.status = 'confirmed' AND e.check_in >= $1 AND e.check_in <= $2 ORDER BY e.check_in, lower(e.name) COLLATE \"C\", e.name COLLATE \"C\", e.id",
          [from, to],
        );
        return r.rows.map(withRoom);
      },
      async recent(range, limit) {
        const r = await q("SELECT e.*, s.name AS room_name FROM site_enquiries e LEFT JOIN site_rooms s ON s.id = e.room_id WHERE e.created_at >= $1 AND e.created_at <= $2 ORDER BY e.created_at DESC, e.id DESC LIMIT $3", [range.from.toISOString(), range.to.toISOString(), limit]);
        return r.rows.map(withRoom);
      },
      async hasForRoom(roomId) {
        return (await q("SELECT 1 AS x FROM site_enquiries WHERE room_id = $1 LIMIT 1", [roomId])).rows.length > 0;
      },
      async create(row) {
        const { ipAddress, createdAt, reference, ...fields } = row;
        const w = write(ENQUIRY_SPEC, fields);
        const columns = [...w.columns, "reference", "ip_address", "created_at"];
        const params = [...w.params, reference, ipAddress, createdAt.toISOString()];
        const r = await guard(q(`INSERT INTO site_enquiries (${columns.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params));
        return enquiryOf(r.rows[0]);
      },
      async update(id, patch, by) {
        const w = write(ENQUIRY_SPEC, patch);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 2}`), `updated_by = $${w.columns.length + 2}`].join(", ");
        const r = await guard(q(`UPDATE site_enquiries SET ${set} WHERE id = $1 RETURNING *`, [id, ...w.params, by]));
        if (!r.rows[0]) throw new RepoError("check", "enquiry not found");
        return enquiryOf(r.rows[0]);
      },
      async decide(id, d) {
        const r = await q("UPDATE site_enquiries SET status = $2, decided_by = $3, decided_by_name = $4, decided_at = $5, decision_note = $6, updated_by = $3 WHERE id = $1 RETURNING *", [id, d.status, d.by, d.byName, d.at.toISOString(), d.note]);
        if (!r.rows[0]) throw new RepoError("check", "enquiry not found");
        return enquiryOf(r.rows[0]);
      },
      async remove(id) {
        return (await q("DELETE FROM site_enquiries WHERE id = $1", [id])).affectedRows > 0;
      },
    },

    references: {
      async next(fiscalYear) {
        // one upsert: the row is locked by the statement itself, so two enquiries at once never take the same number
        const r = await guard(q("INSERT INTO site_reference_counters (fiscal_year, counter) VALUES ($1, 1) ON CONFLICT (fiscal_year) DO UPDATE SET counter = site_reference_counters.counter + 1 RETURNING counter", [fiscalYear]));
        return Number(r.rows[0].counter);
      },
    },

    siteRooms: {
      async list() {
        const r = await q("SELECT s.*, COALESCE(n.plans, 0) AS plans_count FROM site_rooms s LEFT JOIN (SELECT room_id, COUNT(*) AS plans FROM site_rate_plans GROUP BY room_id) n ON n.room_id = s.id ORDER BY s.sort_order, s.id");
        return r.rows.map((x) => ({ ...roomOf(x), plansCount: Number(x.plans_count) }));
      },
      async get(id, options) {
        const r = await q(`SELECT * FROM site_rooms WHERE id = $1${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return r.rows[0] ? roomOf(r.rows[0]) : null;
      },
      async getMany(ids) {
        if (ids.length === 0) return [];
        return (await q("SELECT * FROM site_rooms WHERE id = ANY($1::uuid[]) ORDER BY sort_order, id", [ids])).rows.map(roomOf);
      },
      async slugTaken(slug, except) {
        return (await q("SELECT 1 AS x FROM site_rooms WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1", [slug, except ?? null])).rows.length > 0;
      },
      async create(fields, by) {
        const { slug, ...rest } = fields;
        const w = write(ROOM_SPEC, rest);
        const columns = [...w.columns, "slug", "created_by", "updated_by"];
        const params = [...w.params, slug, by, by];
        const r = await guard(
          q(`INSERT INTO site_rooms (${columns.join(", ")}, sort_order) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}, COALESCE((SELECT MAX(sort_order) FROM site_rooms), 0) + 1) RETURNING *`, params),
        );
        return roomOf(r.rows[0]);
      },
      async update(id, patch, by) {
        const w = write(ROOM_SPEC, patch);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 2}`), `updated_by = $${w.columns.length + 2}`].join(", ");
        const r = await guard(q(`UPDATE site_rooms SET ${set} WHERE id = $1 RETURNING *`, [id, ...w.params, by]));
        if (!r.rows[0]) throw new RepoError("check", "room not found");
        return roomOf(r.rows[0]);
      },
      async remove(id) {
        return (await q("DELETE FROM site_rooms WHERE id = $1", [id])).affectedRows > 0;
      },
      async setOrder(ids) {
        return setOrderOf("site_rooms", ids);
      },
    },

    sitePlans: {
      async forRooms(roomIds, options) {
        if (roomIds.length === 0) return [];
        return (await q(`SELECT * FROM site_rate_plans WHERE room_id = ANY($1::uuid[])${options?.activeOnly ? " AND active" : ""} ORDER BY sort_order, id`, [roomIds])).rows.map(planOf);
      },
      async get(id, options) {
        const r = await q(`SELECT * FROM site_rate_plans WHERE id = $1${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return r.rows[0] ? planOf(r.rows[0]) : null;
      },
      async names() {
        return (await q('SELECT name FROM (SELECT DISTINCT name FROM site_rate_plans) n ORDER BY name COLLATE "C"')).rows.map((r) => String(r.name));
      },
      async create(roomId, fields, by) {
        const r = await guard(
          q(
            `INSERT INTO site_rate_plans (room_id, name, code, price_double_paise, price_single_paise, occupancy_prices, extra_person_price_paise, created_by, updated_by, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $8, COALESCE((SELECT MAX(sort_order) FROM site_rate_plans WHERE room_id = $1), 0) + 1) RETURNING *`,
            [roomId, fields.name, fields.code, moneyIn(fields.doublePaise), moneyIn(fields.singlePaise), tiersIn(fields.tiers), moneyIn(fields.extraPersonPaise), by],
          ),
        );
        return planOf(r.rows[0]);
      },
      async update(id, patch, by) {
        const sets: string[] = [];
        const params: unknown[] = [id];
        const add = (column: string, value: unknown, cast = ""): void => {
          params.push(value);
          sets.push(`${column} = $${params.length}${cast}`);
        };
        if (patch.name !== undefined) add("name", patch.name);
        if (patch.code !== undefined) add("code", patch.code);
        if (patch.doublePaise !== undefined) add("price_double_paise", moneyIn(patch.doublePaise));
        if (patch.singlePaise !== undefined) add("price_single_paise", moneyIn(patch.singlePaise));
        if (patch.extraPersonPaise !== undefined) add("extra_person_price_paise", moneyIn(patch.extraPersonPaise));
        if (patch.tiers !== undefined) add("occupancy_prices", tiersIn(patch.tiers), "::jsonb");
        if (patch.active !== undefined) add("active", patch.active);
        add("updated_by", by);
        const r = await guard(q(`UPDATE site_rate_plans SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params));
        if (!r.rows[0]) throw new RepoError("check", "plan not found");
        return planOf(r.rows[0]);
      },
      async remove(id) {
        return (await q("DELETE FROM site_rate_plans WHERE id = $1", [id])).affectedRows > 0;
      },
      async setOrder(ids) {
        return setOrderOf("site_rate_plans", ids);
      },
    },

    calendar: {
      async rates(planIds, from, to) {
        if (planIds.length === 0) return [];
        const r = await q("SELECT rate_plan_id, date, price_double_paise, price_single_paise FROM site_plan_date_rates WHERE rate_plan_id = ANY($1::uuid[]) AND date >= $2 AND date <= $3 ORDER BY rate_plan_id, date", [planIds, from, to]);
        return r.rows.map((x): DateRateRecord => ({ planId: String(x.rate_plan_id), date: String(x.date), doublePaise: toBigInt(x.price_double_paise), singlePaise: paise(x.price_single_paise) }));
      },
      async inventory(roomIds, from, to) {
        if (roomIds.length === 0) return [];
        const r = await q("SELECT room_id, date, rooms_left, blocked FROM site_room_date_inventory WHERE room_id = ANY($1::uuid[]) AND date >= $2 AND date <= $3 ORDER BY room_id, date", [roomIds, from, to]);
        return r.rows.map((x): InventoryRecord => ({ roomId: String(x.room_id), date: String(x.date), roomsLeft: Number(x.rooms_left), blocked: x.blocked === true }));
      },
      async upsertRates(rows) {
        if (rows.length === 0) return;
        const params = [
          rows.map((r) => r.planId), rows.map((r) => r.date), rows.map((r) => moneyIn(r.doublePaise)), rows.map((r) => r.doublePaise !== undefined), rows.map((r) => moneyIn(r.planDouble)),
          rows.map((r) => (r.singlePaise === undefined ? null : moneyIn(r.singlePaise))), rows.map((r) => r.singlePaise !== undefined), rows.map((r) => moneyIn(r.planSingle)),
        ];
        const source = "unnest($1::uuid[], $2::date[], $3::bigint[], $4::boolean[], $5::bigint[], $6::bigint[], $7::boolean[], $8::bigint[]) AS v(plan, d, dbl, dbl_given, plan_dbl, sgl, sgl_given, plan_sgl)";
        // an existing row changes only the field given; a new row takes the rest from the plan (Pallav saveRate)
        await guard(
          q(
            `UPDATE site_plan_date_rates r SET price_double_paise = CASE WHEN v.dbl_given THEN v.dbl ELSE r.price_double_paise END, price_single_paise = CASE WHEN v.sgl_given THEN v.sgl ELSE r.price_single_paise END
               FROM ${source} WHERE r.rate_plan_id = v.plan AND r.date = v.d`,
            params,
          ),
        );
        await guard(
          q(
            `INSERT INTO site_plan_date_rates (rate_plan_id, date, price_double_paise, price_single_paise)
             SELECT DISTINCT ON (v.plan, v.d) v.plan, v.d, CASE WHEN v.dbl_given THEN v.dbl ELSE v.plan_dbl END, CASE WHEN v.sgl_given THEN v.sgl ELSE v.plan_sgl END FROM ${source}
              WHERE NOT EXISTS (SELECT 1 FROM site_plan_date_rates r WHERE r.rate_plan_id = v.plan AND r.date = v.d)`,
            params,
          ),
        );
      },
      async upsertInventory(rows) {
        if (rows.length === 0) return;
        await guard(
          q(
            `INSERT INTO site_room_date_inventory (room_id, date, rooms_left, blocked) SELECT * FROM unnest($1::uuid[], $2::date[], $3::int[], $4::boolean[])
             ON CONFLICT (room_id, date) DO UPDATE SET rooms_left = EXCLUDED.rooms_left, blocked = EXCLUDED.blocked`,
            [rows.map((r) => r.roomId), rows.map((r) => r.date), rows.map((r) => r.roomsLeft), rows.map((r) => r.blocked)],
          ),
        );
      },
      async setBlocked(rows) {
        if (rows.length === 0) return;
        await guard(
          q(
            `INSERT INTO site_room_date_inventory (room_id, date, rooms_left, blocked) SELECT * FROM unnest($1::uuid[], $2::date[], $3::int[], $4::boolean[])
             ON CONFLICT (room_id, date) DO UPDATE SET blocked = EXCLUDED.blocked`,
            [rows.map((r) => r.roomId), rows.map((r) => r.date), rows.map((r) => r.totalCount), rows.map((r) => r.blocked)],
          ),
        );
      },
      async blockedFrom(from) {
        const r = await q("SELECT i.room_id, COALESCE(s.name, '') AS room_name, i.date FROM site_room_date_inventory i LEFT JOIN site_rooms s ON s.id = i.room_id WHERE i.blocked AND i.date >= $1 ORDER BY i.room_id, i.date", [from]);
        return r.rows.map((x) => ({ roomId: String(x.room_id), roomName: String(x.room_name), date: String(x.date) }));
      },
    },

    content: {
      async get() {
        await q("INSERT INTO site_page_content DEFAULT VALUES ON CONFLICT DO NOTHING");
        return contentOf((await q("SELECT * FROM site_page_content")).rows[0]);
      },
      async update(patch, by) {
        await q("INSERT INTO site_page_content DEFAULT VALUES ON CONFLICT DO NOTHING");
        const w = write(CONTENT_FIELDS, patch, undefined, CONTENT_NAMES);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 1}`), `updated_by = $${w.columns.length + 1}`].join(", ");
        const r = await guard(q(`UPDATE site_page_content SET ${set} RETURNING *`, [...w.params, by]));
        return contentOf(r.rows[0]);
      },
    },

    gallery: ordered<GalleryPhotoRecord, { path: string; caption: string | null; altText: string | null }>({
      table: "site_gallery_photos", columns: { path: "path", caption: "caption", altText: "alt_text" },
      out: (r) => ({ id: String(r.id), path: String(r.path), caption: asText(r.caption), altText: asText(r.alt_text), sortOrder: Number(r.sort_order) }),
    }),
    services: ordered<ServiceRecord, { title: string; description: string | null; iconPath?: string | null }>({
      table: "site_services", columns: { title: "title", description: "description", iconPath: "icon_path" },
      out: (r) => ({ id: String(r.id), title: String(r.title), description: asText(r.description), iconPath: asText(r.icon_path), sortOrder: Number(r.sort_order) }),
    }),
    policies: ordered<PolicyRecord, { title: string; lines: string[]; iconPath?: string | null }>({
      table: "site_policy_cards", columns: { title: "title", lines: "policy_lines", iconPath: "icon_path" }, in: (field, value) => (field === "lines" ? JSON.stringify(value) : value),
      out: (r) => ({ id: String(r.id), title: String(r.title), lines: (r.policy_lines as string[] | null) ?? [], iconPath: asText(r.icon_path), sortOrder: Number(r.sort_order) }),
    }),
    nearby: ordered<NearbyRecord, { title: string; distanceLabel: string; mapQuery: string | null; mapUrl: string | null; originLat: number | null; originLng: number | null }>({
      table: "site_nearby_places", columns: { title: "title", distanceLabel: "distance_label", mapQuery: "map_query", mapUrl: "map_url", originLat: "origin_lat", originLng: "origin_lng" },
      out: (r) => ({ id: String(r.id), title: String(r.title), distanceLabel: String(r.distance_label), mapQuery: asText(r.map_query), mapUrl: asText(r.map_url), originLat: num(r.origin_lat), originLng: num(r.origin_lng), sortOrder: Number(r.sort_order) }),
    }),

    siteSettings: {
      async get(options) {
        await q("INSERT INTO site_settings DEFAULT VALUES ON CONFLICT DO NOTHING");
        return settingsOf((await q(`SELECT * FROM site_settings${options?.forUpdate ? " FOR UPDATE" : ""}`)).rows[0]);
      },
      async update(patch, by) {
        await q("INSERT INTO site_settings DEFAULT VALUES ON CONFLICT DO NOTHING");
        const { secrets, ...fields } = patch;
        const w = write(SETTINGS_SPEC, fields, undefined, SETTINGS_NAMES);
        const columns = [...w.columns];
        const params = [...w.params];
        for (const [field, value] of Object.entries(secrets ?? {})) {
          const column = SECRET_COLUMNS[field as keyof SiteSecrets];
          if (value === undefined || !column) continue;
          columns.push(column);
          params.push(value);
        }
        const set = [...columns.map((c, i) => `${c} = $${i + 1}`), `updated_by = $${columns.length + 1}`].join(", ");
        const r = await guard(q(`UPDATE site_settings SET ${set} RETURNING *`, [...params, by]));
        return settingsOf(r.rows[0]);
      },
    },

    websiteChanges: {
      async recent(limit) {
        const r = await q("SELECT id, summary, user_name, created_at FROM system_logs WHERE module = 'website' ORDER BY created_at DESC, id DESC LIMIT $1", [limit]);
        return r.rows.map((x) => ({ id: String(x.id), summary: String(x.summary), userName: asText(x.user_name), at: asDate(x.created_at) as Date }));
      },
    },
  };
}

export function createPgWebsiteUnit(withHotel: WithHotel): Unit<WebsiteRepos> {
  return createPgUnit(withHotel, pgWebsiteRepos);
}

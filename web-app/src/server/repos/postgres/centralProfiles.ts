import "server-only";
// The PostgreSQL implementation of the one common guest and company profile (repos/centralProfiles.ts; platform migration 0132). Platform schema only, as hms_app: a hotel's own
// records are never read or changed here. Every read follows merged_into to the live profile (a merge chain is short; ten steps is far more than a real one).
import type { SqlClient } from "../../../db/types";
import type { ClientPool } from "../../../db/withHotel";
import type { CentralCompany, CentralCompanyFields, CentralContact, CentralGuest, CentralGuestFields, CentralProfilesRepos, CentralProfilesUnit, ProfileKind, ProfileReviewUnit } from "../centralProfiles";
import { pgPlatformConsoleRepos } from "./platformConsole";
import { RepoError } from "../types";
import { guard } from "./shared";
import { createPlatformUnit } from "./platformUnit";

type Row = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

const guestOf = (r: Row): CentralGuest => ({
  id: String(r.id), displayName: String(r.display_name), mobile: text(r.mobile), email: text(r.email), address: text(r.address), city: text(r.city), userId: text(r.user_id),
  createdAt: date(r.created_at), updatedAt: date(r.updated_at),
});

const contactsOf = (v: unknown): CentralContact[] =>
  Array.isArray(v) ? v.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null).map((c) => ({ name: String(c.name ?? ""), role: String(c.role ?? ""), email: String(c.email ?? ""), mobile: String(c.mobile ?? "") })) : [];

const companyOf = (r: Row): CentralCompany => ({
  id: String(r.id), name: String(r.name), mainContactName: text(r.main_contact_name), gstin: text(r.gstin), email: text(r.email), mobile: text(r.mobile), landline: text(r.landline),
  address: text(r.address), pincode: text(r.pincode), country: text(r.country), contacts: contactsOf(r.contacts), userId: text(r.user_id), createdAt: date(r.created_at), updatedAt: date(r.updated_at),
});

const GUEST_COLUMNS: Record<keyof CentralGuestFields, string> = { displayName: "display_name", mobile: "mobile", email: "email", address: "address", city: "city", userId: "user_id" };
const COMPANY_COLUMNS: Record<keyof CentralCompanyFields, string> = {
  name: "name", mainContactName: "main_contact_name", gstin: "gstin", email: "email", mobile: "mobile", landline: "landline", address: "address", pincode: "pincode", country: "country", contacts: "contacts", userId: "user_id",
};
const valueOf = (key: string, v: unknown): unknown => (key === "contacts" ? JSON.stringify(v ?? []) : v);

function pgCentralProfilesRepos(db: SqlClient): CentralProfilesRepos {
  const q = (sql: string, params?: readonly unknown[]) => db.query(sql, params);

  /** The live row of a table, following merged_into. */
  async function live(table: "guests" | "companies", id: string | null): Promise<Row | null> {
    for (let step = 0, at = id; at !== null && step < 10; step += 1) {
      const r = (await q(`SELECT * FROM platform.${table} WHERE id = $1`, [at])).rows[0];
      if (!r) return null;
      if (r.deleted_at !== null && r.deleted_at !== undefined) return null;
      if (r.merged_into === null || r.merged_into === undefined) return r;
      at = String(r.merged_into);
    }
    return null;
  }

  async function insert(table: "guests" | "companies", columns: Record<string, string>, fields: Record<string, unknown>): Promise<Row> {
    const keys = Object.keys(columns);
    const r = await guard(q(`INSERT INTO platform.${table} (${keys.map((k) => columns[k]).join(", ")}) VALUES (${keys.map((k, i) => `$${i + 1}${k === "contacts" ? "::jsonb" : ""}`).join(", ")}) RETURNING *`, keys.map((k) => valueOf(k, fields[k]))));
    return r.rows[0];
  }

  async function patch(table: "guests" | "companies", columns: Record<string, string>, id: string, fields: Record<string, unknown>): Promise<Row | null> {
    const keys = Object.keys(fields).filter((k) => k in columns && fields[k] !== undefined);
    if (keys.length > 0) {
      await guard(q(`UPDATE platform.${table} SET ${keys.map((k, i) => `${columns[k]} = $${i + 2}${k === "contacts" ? "::jsonb" : ""}`).join(", ")} WHERE id = $1 AND merged_into IS NULL AND deleted_at IS NULL`, [id, ...keys.map((k) => valueOf(k, fields[k]))]));
    }
    const r = (await q(`SELECT * FROM platform.${table} WHERE id = $1 AND merged_into IS NULL AND deleted_at IS NULL`, [id])).rows[0];
    return r ?? null;
  }

  const tables = (kind: ProfileKind) =>
    kind === "guest"
      ? { profiles: "platform.guests", links: "platform.guest_hotels", ref: "guest_id", record: "customer_id", name: "display_name" }
      : { profiles: "platform.companies", links: "platform.company_hotels", ref: "company_id", record: "company_profile_id", name: "name" };

  const review: CentralProfilesRepos["review"] = {
    async duplicates(kind) {
      const t = tables(kind);
      const keys = kind === "guest" ? ["mobile", "email"] : ["gstin", "email"];
      const parts = keys.map(
        (k) => `SELECT '${k}' AS by, ${k} AS value, array_agg(id::text ORDER BY created_at, id) AS ids FROM ${t.profiles} WHERE merged_into IS NULL AND deleted_at IS NULL AND ${k} IS NOT NULL GROUP BY ${k} HAVING count(*) > 1`,
      );
      const r = await q(`${parts.join(" UNION ALL ")} ORDER BY 1, 2 LIMIT 5000`);
      return r.rows.map((x) => ({ by: String(x.by) as "mobile" | "email" | "gstin", value: String(x.value), ids: (x.ids as unknown[]).map(String) }));
    },
    async summaries(kind, ids) {
      if (ids.length === 0) return [];
      const t = tables(kind);
      const r = await q(
        `SELECT p.id, p.${t.name} AS name, p.mobile, p.email, ${kind === "company" ? "p.gstin" : "NULL::text AS gstin"}, ${kind === "guest" ? "p.city" : "NULL::text AS city"}, p.user_id, p.created_at, p.merged_into,
                coalesce(json_agg(json_build_object('hotelId', h.id, 'hotelName', h.name, 'recordId', l.${t.record}) ORDER BY h.name) FILTER (WHERE h.id IS NOT NULL), '[]') AS hotels
           FROM ${t.profiles} p LEFT JOIN ${t.links} l ON l.${t.ref} = p.id LEFT JOIN platform.hotels h ON h.id = l.hotel_id
          WHERE p.id = ANY($1::uuid[]) GROUP BY p.id`,
        [ids],
      );
      return r.rows.map((x) => ({
        id: String(x.id), name: String(x.name), mobile: text(x.mobile), email: text(x.email), gstin: text(x.gstin), city: text(x.city), userId: text(x.user_id), createdAt: date(x.created_at), mergedInto: text(x.merged_into),
        hotels: (Array.isArray(x.hotels) ? x.hotels : JSON.parse(String(x.hotels ?? "[]"))).map((h: Record<string, unknown>) => ({ hotelId: String(h.hotelId), hotelName: String(h.hotelName), recordId: String(h.recordId) })),
      }));
    },
    async keptApart(kind) {
      const r = await q("SELECT left_id, right_id FROM platform.profile_kept_apart WHERE kind = $1", [kind]);
      return r.rows.map((x) => [String(x.left_id), String(x.right_id)] as [string, string]);
    },
    async keepApart(kind, a, b, by, at) {
      const [l, rr] = a < b ? [a, b] : [b, a];
      const r = await q("INSERT INTO platform.profile_kept_apart (kind, left_id, right_id, decided_by, decided_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING", [kind, l, rr, by, at]);
      return r.affectedRows > 0;
    },
    async undoKeepApart(kind, a, b) {
      const [l, rr] = a < b ? [a, b] : [b, a];
      return (await q("DELETE FROM platform.profile_kept_apart WHERE kind = $1 AND left_id = $2 AND right_id = $3", [kind, l, rr])).affectedRows > 0;
    },
    async merge(kind, keepId, goneId, by, at) {
      const t = tables(kind);
      const rows = await q(`SELECT id, user_id FROM ${t.profiles} WHERE id = ANY($1::uuid[]) AND merged_into IS NULL ORDER BY id FOR UPDATE`, [[keepId, goneId]]);
      const keep = rows.rows.find((x) => String(x.id) === keepId);
      const gone = rows.rows.find((x) => String(x.id) === goneId);
      if (!keep || !gone) throw new RepoError("check", `${kind}_merge_not_live`);
      const relinked = (await q(`UPDATE ${t.links} SET ${t.ref} = $1 WHERE ${t.ref} = $2`, [keepId, goneId])).affectedRows;
      // the one that goes is kept as history first, so its login no longer counts as a live profile's and can move to the kept one
      await q(`UPDATE ${t.profiles} SET merged_into = $1, merged_at = $3, merged_by = $4 WHERE id = $2`, [keepId, goneId, at, by]);
      const loginMoved = keep.user_id === null && gone.user_id !== null;
      if (loginMoved) await q(`UPDATE ${t.profiles} SET user_id = $2 WHERE id = $1`, [keepId, gone.user_id]);
      return { relinked, loginMoved };
    },
  };

  // the change history (M1(a)): rows of platform.audit_log, scope 'hotel' (the Super Admin's platform lists show scope 'platform' only), found by (entity, entity_id)
  const ENTITY = { guest: "guest_profile", company: "company_profile" } as const;
  const history: CentralProfilesRepos["history"] = {
    async record(c) {
      await guard(
        q(
          `INSERT INTO platform.audit_log (actor_user_id, hotel_id, action, entity, entity_id, after, trace_id, at, scope, actor_name)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'hotel', $9)`,
          [c.byUserId, c.hotelId, c.fields.length === 0 ? "profile_created" : "profile_updated", ENTITY[c.kind], c.profileId, JSON.stringify({ fields: c.fields, via: c.via, ...(c.gstin ? { gstin: c.gstin } : {}) }), c.traceId, c.at.toISOString(), c.byName],
        ),
      );
    },
    async last(kind, profileId) {
      const r = await q(
        `SELECT a.at, a.actor_name, a.after, h.name AS hotel_name FROM platform.audit_log a LEFT JOIN platform.hotels h ON h.id = a.hotel_id
          WHERE a.entity = $1 AND a.entity_id = $2 AND a.action IN ('profile_created', 'profile_updated') ORDER BY a.at DESC, a.id DESC LIMIT 1`,
        [ENTITY[kind], profileId],
      );
      const x = r.rows[0];
      if (!x) return null;
      const after = (x.after ?? {}) as { fields?: unknown; via?: unknown; gstin?: { from?: unknown; to?: unknown } | null };
      const gstin = after.gstin && typeof after.gstin === "object" ? { gstin: { from: text(after.gstin.from), to: text(after.gstin.to) } } : {};
      return { at: date(x.at), hotelName: text(x.hotel_name), by: text(x.actor_name), via: after.via === "portal" ? "portal" : "desk", fields: Array.isArray(after.fields) ? after.fields.map(String) : [], ...gstin };
    },
  };

  return {
    review,
    history,
    async ready() {
      const r = await q("SELECT to_regclass('platform.guests') IS NOT NULL AND to_regclass('platform.company_hotels') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'guests' AND column_name = 'deleted_at') AS ready");
      return r.rows[0]?.ready === true;
    },
    guests: {
      async byUser(userId) {
        const r = (await q("SELECT * FROM platform.guests WHERE user_id = $1 AND merged_into IS NULL AND deleted_at IS NULL", [userId])).rows[0];
        return r ? guestOf(r) : null;
      },
      async byMobile(mobile) {
        const r = (await q("SELECT * FROM platform.guests WHERE mobile = $1 AND merged_into IS NULL AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1", [mobile])).rows[0];
        return r ? guestOf(r) : null;
      },
      async ofRecord(hotelId, customerId) {
        const link = (await q("SELECT guest_id FROM platform.guest_hotels WHERE hotel_id = $1 AND customer_id = $2", [hotelId, customerId])).rows[0];
        const r = link ? await live("guests", String(link.guest_id)) : null;
        return r ? guestOf(r) : null;
      },
      async create(fields) {
        return guestOf(await insert("guests", GUEST_COLUMNS, fields));
      },
      async update(id, fields) {
        const r = await patch("guests", GUEST_COLUMNS, id, fields);
        return r ? guestOf(r) : null;
      },
      async link(hotelId, customerId, guestId) {
        const r = await q("INSERT INTO platform.guest_hotels (hotel_id, customer_id, guest_id) VALUES ($1, $2, $3) ON CONFLICT (hotel_id, customer_id) DO NOTHING", [hotelId, customerId, guestId]);
        return r.affectedRows > 0;
      },
      async hotelCount(guestId) {
        return Number((await q("SELECT count(DISTINCT hotel_id) AS n FROM platform.guest_hotels WHERE guest_id = $1", [guestId])).rows[0]?.n ?? 0);
      },
    },
    companies: {
      async byUser(userId) {
        const r = (await q("SELECT * FROM platform.companies WHERE user_id = $1 AND merged_into IS NULL AND deleted_at IS NULL", [userId])).rows[0];
        return r ? companyOf(r) : null;
      },
      async byGstin(gstin) {
        const r = (await q("SELECT * FROM platform.companies WHERE gstin = $1 AND merged_into IS NULL AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1", [gstin])).rows[0];
        return r ? companyOf(r) : null;
      },
      async ofRecord(hotelId, companyProfileId) {
        const link = (await q("SELECT company_id FROM platform.company_hotels WHERE hotel_id = $1 AND company_profile_id = $2", [hotelId, companyProfileId])).rows[0];
        const r = link ? await live("companies", String(link.company_id)) : null;
        return r ? companyOf(r) : null;
      },
      async create(fields) {
        return companyOf(await insert("companies", COMPANY_COLUMNS, fields));
      },
      async update(id, fields) {
        const r = await patch("companies", COMPANY_COLUMNS, id, fields);
        return r ? companyOf(r) : null;
      },
      async link(hotelId, companyProfileId, companyId) {
        const r = await q("INSERT INTO platform.company_hotels (hotel_id, company_profile_id, company_id) VALUES ($1, $2, $3) ON CONFLICT (hotel_id, company_profile_id) DO NOTHING", [hotelId, companyProfileId, companyId]);
        return r.affectedRows > 0;
      },
      async hotelCount(companyId) {
        return Number((await q("SELECT count(DISTINCT hotel_id) AS n FROM platform.company_hotels WHERE company_id = $1", [companyId])).rows[0]?.n ?? 0);
      },
    },
  };
}

export function createPgCentralProfilesUnit(pool: ClientPool): CentralProfilesUnit {
  return createPlatformUnit(pool, pgCentralProfilesRepos);
}

/** The Super Admin's review: the central profiles and the console's accounts and audit log on ONE connection, ONE transaction. */
export function createPgProfileReviewUnit(pool: ClientPool): ProfileReviewUnit {
  return createPlatformUnit(pool, (db) => ({ central: pgCentralProfilesRepos(db), console: pgPlatformConsoleRepos(db) }));
}

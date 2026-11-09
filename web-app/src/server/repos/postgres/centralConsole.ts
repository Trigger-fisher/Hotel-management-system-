import "server-only";
// The PostgreSQL implementation of the Central tabs (repos/centralConsole.ts), as hms_app, platform schema only. READ ONLY: every statement is a SELECT, and every SELECT names its
// columns, so a password hash, a token, a session id or an auth code is never read. A hotel's own schema is never opened.
import type { CentralGstStatus, LoginRoleType, LoginStatus } from "@shared/dashboards/central";
import type { SqlClient } from "../../../db/types";
import type { ClientPool } from "../../../db/withHotel";
import type {
  CentralConsoleRepos, CentralConsoleUnit, CentralQueryArgs, CompanyDetailRecord, CompanyListRecord, GstDetailRecord, GstListRecord, GuestDetailRecord, GuestListRecord, LoginDetailRecord,
  LoginListRecord, LookupRecord, MergeHistoryRecord,
} from "../centralConsole";
import { centralMobile } from "../centralProfiles";
import { pgPlatformConsoleRepos } from "./platformConsole";
import { createPlatformUnit } from "./platformUnit";

type Row = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const dateOrNull = (v: unknown): Date | null => (v === null || v === undefined ? null : date(v));
const day = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : text(v));
const num = (v: unknown): number => Number(v ?? 0);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A plain "contains" pattern: the typed text with the pattern characters made literal. */
export const likeOf = (s: string): string => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

const STATUSES: readonly CentralGstStatus[] = ["active", "cancelled", "suspended", "inactive", "unknown"];

function pgCentralConsoleRepos(db: SqlClient): CentralConsoleRepos {
  const q = (sql: string, params?: readonly unknown[]) => db.query(sql, params);
  const count = (r: { rows: Row[] }): number => num(r.rows[0]?.n);

  const loginList = (r: Row): LoginListRecord => ({
    id: String(r.id), username: String(r.username), displayName: text(r.display_name), roleType: r.role_type as LoginRoleType, status: r.status as LoginStatus, hotels: strings(r.hotels),
    lastLoginAt: dateOrNull(r.last_login_at), locked: r.locked === true, closed: r.closed === true, createdAt: date(r.created_at),
  });
  const LOGIN_FROM = "platform.logins l LEFT JOIN platform.login_profiles p ON p.login_id = l.id";
  const LOGIN_COLUMNS = `l.id, l.username, l.role_type, l.status, p.display_name, l.last_login_at, l.created_at, (l.deleted_at IS NOT NULL) AS closed,
    (l.blocked_at IS NOT NULL OR (l.locked_until IS NOT NULL AND l.locked_until > now())) AS locked,
    coalesce((SELECT array_agg(h.name ORDER BY h.name) FROM platform.user_hotels uh JOIN platform.hotels h ON h.id = uh.hotel_id AND h.deleted_at IS NULL WHERE uh.user_id = l.id), '{}') AS hotels`;

  const mergeHistory = async (table: "guests" | "companies", nameColumn: string, id: string, mergedInto: unknown, mergedAt: unknown, mergedBy: unknown): Promise<MergeHistoryRecord> => {
    const into = mergedInto ? (await q(`SELECT id, ${nameColumn} AS name FROM platform.${table} WHERE id = $1`, [String(mergedInto)])).rows[0] : undefined;
    const by = mergedBy ? (await q("SELECT coalesce(p.display_name, l.username) AS name FROM platform.logins l LEFT JOIN platform.login_profiles p ON p.login_id = l.id WHERE l.id = $1", [String(mergedBy)])).rows[0] : undefined;
    const from = await q(`SELECT id, ${nameColumn} AS name, merged_at FROM platform.${table} WHERE merged_into = $1 ORDER BY merged_at, id LIMIT 100`, [id]);
    return {
      mergedInto: into ? { id: String(into.id), name: String(into.name) } : null,
      mergedAt: dateOrNull(mergedAt),
      mergedByName: by ? text(by.name) : null,
      mergedFrom: from.rows.map((x) => ({ id: String(x.id), name: String(x.name), mergedAt: date(x.merged_at) })),
    };
  };

  /** UPDATE of the given columns of a LIVE row (an undefined value is not touched, null clears). */
  async function patchRow(table: "guests" | "companies", cols: Record<string, string | null | undefined>, id: string): Promise<number> {
    const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
    if (keys.length === 0) return (await q(`SELECT 1 FROM platform.${table} WHERE id = $1 AND deleted_at IS NULL`, [id])).rows.length;
    return (await q(`UPDATE platform.${table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 AND deleted_at IS NULL AND merged_into IS NULL`, [id, ...keys.map((k) => cols[k] ?? null)])).affectedRows;
  }

  const loginName = async (userId: unknown): Promise<string | null> =>
    userId ? text((await q("SELECT username FROM platform.logins WHERE id = $1", [String(userId)])).rows[0]?.username) : null;

  return {
    async available() {
      const r = await q("SELECT to_regclass('platform.guests') IS NOT NULL AND to_regclass('platform.company_hotels') IS NOT NULL AS profiles, to_regclass('platform.gst_registry') IS NOT NULL AND to_regclass('platform.gst_lookups') IS NOT NULL AS gst");
      return { profiles: r.rows[0]?.profiles === true, gst: r.rows[0]?.gst === true };
    },

    logins: {
      async list(a: CentralQueryArgs) {
        const where = a.search === "" ? "true" : "(l.username ILIKE $1 OR p.display_name ILIKE $1 OR l.role_type ILIKE $1)";
        const params = a.search === "" ? [] : [likeOf(a.search)];
        const total = count(await q(`SELECT count(*) AS n FROM ${LOGIN_FROM} WHERE ${where}`, params));
        const r = await q(`SELECT ${LOGIN_COLUMNS} FROM ${LOGIN_FROM} WHERE ${where} ORDER BY l.created_at DESC, l.id LIMIT ${Number(a.limit)} OFFSET ${Number(a.offset)}`, params);
        return { rows: r.rows.map(loginList), total };
      },
      async get(id) {
        const r = (
          await q(
            `SELECT ${LOGIN_COLUMNS}, l.blocked_kind, l.blocked_at, l.locked_until, l.failed_attempts, l.lock_level, l.must_change_password, l.code_required, l.password_changed_at,
                    (SELECT count(*) FROM platform.sessions s WHERE s.user_id = l.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions
               FROM ${LOGIN_FROM} WHERE l.id = $1`,
            [id],
          )
        ).rows[0];
        if (!r) return null;
        const links = await q(
          "SELECT h.id AS hotel_id, h.name AS hotel_name, uh.status FROM platform.user_hotels uh JOIN platform.hotels h ON h.id = uh.hotel_id AND h.deleted_at IS NULL WHERE uh.user_id = $1 ORDER BY h.name",
          [id],
        );
        let profile: LoginDetailRecord["profile"] = null;
        if ((await hasProfiles()).profiles) {
          const g = (await q("SELECT id, display_name AS name FROM platform.guests WHERE user_id = $1 AND merged_into IS NULL", [id])).rows[0];
          const c = g ? undefined : (await q("SELECT id, name FROM platform.companies WHERE user_id = $1 AND merged_into IS NULL", [id])).rows[0];
          profile = g ? { kind: "guest", id: String(g.id), name: String(g.name) } : c ? { kind: "company", id: String(c.id), name: String(c.name) } : null;
        }
        return {
          ...loginList(r),
          hotelLinks: links.rows.map((x) => ({ hotelId: String(x.hotel_id), hotelName: String(x.hotel_name), status: String(x.status) })),
          blockedKind: r.blocked_kind === "admin" || r.blocked_kind === "auto" ? r.blocked_kind : null,
          blockedAt: dateOrNull(r.blocked_at), lockedUntil: dateOrNull(r.locked_until), failedAttempts: num(r.failed_attempts), lockLevel: num(r.lock_level),
          mustChangePassword: r.must_change_password === true, codeRequired: r.code_required === true, passwordChangedAt: dateOrNull(r.password_changed_at), activeSessions: num(r.active_sessions), profile,
        } satisfies LoginDetailRecord;
      },
    },

    guests: {
      async list(a) {
        // a mobile or an email is found only by its FULL value (never by a part): the masked list must not be a way to read them
        const mobile = centralMobile(a.search);
        const gone = a.deleted === true ? "g.deleted_at IS NOT NULL" : "g.deleted_at IS NULL";
        const where = a.search === "" ? gone : `${gone} AND (g.display_name ILIKE $1 OR g.city ILIKE $1 OR g.email = $2 OR g.mobile = $3)`;
        const params = a.search === "" ? [] : [likeOf(a.search), a.search.toLowerCase(), mobile];
        const total = count(await q(`SELECT count(*) AS n FROM platform.guests g WHERE ${where}`, params));
        const r = await q(
          `SELECT g.id, g.display_name, g.mobile, g.email, g.city, (g.user_id IS NOT NULL) AS has_login, g.merged_into, g.deleted_at, g.created_at,
                  (SELECT count(DISTINCT gh.hotel_id) FROM platform.guest_hotels gh WHERE gh.guest_id = g.id) AS hotel_count
             FROM platform.guests g WHERE ${where} ORDER BY g.created_at DESC, g.id LIMIT ${Number(a.limit)} OFFSET ${Number(a.offset)}`,
          params,
        );
        return {
          rows: r.rows.map((x): GuestListRecord => ({
            id: String(x.id), name: String(x.display_name), mobile: text(x.mobile), email: text(x.email), city: text(x.city), hotelCount: num(x.hotel_count), hasLogin: x.has_login === true,
            mergedInto: text(x.merged_into), deletedAt: dateOrNull(x.deleted_at), createdAt: date(x.created_at),
          })),
          total,
        };
      },
      async create(f, at) {
        const r = await q("INSERT INTO platform.guests (display_name, mobile, email, address, city, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", [f.displayName, f.mobile ?? null, f.email ?? null, f.address ?? null, f.city ?? null, at]);
        return String(r.rows[0].id);
      },
      async update(id, p) {
        return (await patchRow("guests", { display_name: p.displayName, mobile: p.mobile, email: p.email, address: p.address, city: p.city }, id)) > 0;
      },
      async markDeleted(id, by, reason, at) {
        return (await q("UPDATE platform.guests SET deleted_at = $2, deleted_by = $3, deleted_reason = $4 WHERE id = $1 AND deleted_at IS NULL AND user_id IS NULL", [id, at, by, reason])).affectedRows > 0;
      },
      async restore(id) {
        return (await q("UPDATE platform.guests SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL WHERE id = $1 AND deleted_at IS NOT NULL", [id])).affectedRows > 0;
      },
      async get(id) {
        const x = (
          await q(
            `SELECT g.id, g.display_name, g.mobile, g.email, g.city, g.address, g.user_id, g.merged_into, g.merged_at, g.merged_by, g.created_at, g.updated_at, g.deleted_at, g.deleted_reason,
                    (SELECT count(DISTINCT gh.hotel_id) FROM platform.guest_hotels gh WHERE gh.guest_id = g.id) AS hotel_count
               FROM platform.guests g WHERE g.id = $1`,
            [id],
          )
        ).rows[0];
        if (!x) return null;
        const hotels = await q("SELECT DISTINCT h.id, h.name FROM platform.guest_hotels gh JOIN platform.hotels h ON h.id = gh.hotel_id WHERE gh.guest_id = $1 ORDER BY h.name", [id]);
        return {
          id: String(x.id), name: String(x.display_name), mobile: text(x.mobile), email: text(x.email), city: text(x.city), hotelCount: num(x.hotel_count), hasLogin: x.user_id !== null,
          mergedInto: text(x.merged_into), deletedAt: dateOrNull(x.deleted_at), deletedReason: text(x.deleted_reason), createdAt: date(x.created_at), address: text(x.address), hotels: hotels.rows.map((h) => ({ hotelId: String(h.id), hotelName: String(h.name) })),
          loginUsername: await loginName(x.user_id), updatedAt: date(x.updated_at), history: await mergeHistory("guests", "display_name", id, x.merged_into, x.merged_at, x.merged_by),
        } satisfies GuestDetailRecord;
      },
    },

    companies: {
      async list(a) {
        const mobile = a.search.replace(/\s+/g, "");
        const gone = a.deleted === true ? "c.deleted_at IS NOT NULL" : "c.deleted_at IS NULL";
        const where = a.search === "" ? gone : `${gone} AND (c.name ILIKE $1 OR c.gstin ILIKE $1 OR c.email = $2 OR c.mobile = $3 OR c.mobile = $4)`;
        const params = a.search === "" ? [] : [likeOf(a.search), a.search.toLowerCase(), mobile, centralMobile(a.search)];
        const total = count(await q(`SELECT count(*) AS n FROM platform.companies c WHERE ${where}`, params));
        const r = await q(
          `SELECT c.id, c.name, c.gstin, c.main_contact_name, c.email, c.mobile, (c.user_id IS NOT NULL) AS has_login, c.merged_into, c.deleted_at, c.created_at,
                  (SELECT count(DISTINCT ch.hotel_id) FROM platform.company_hotels ch WHERE ch.company_id = c.id) AS hotel_count
             FROM platform.companies c WHERE ${where} ORDER BY c.created_at DESC, c.id LIMIT ${Number(a.limit)} OFFSET ${Number(a.offset)}`,
          params,
        );
        return {
          rows: r.rows.map((x): CompanyListRecord => ({
            id: String(x.id), name: String(x.name), gstin: text(x.gstin), mainContactName: text(x.main_contact_name), email: text(x.email), mobile: text(x.mobile), hotelCount: num(x.hotel_count),
            hasLogin: x.has_login === true, mergedInto: text(x.merged_into), deletedAt: dateOrNull(x.deleted_at), createdAt: date(x.created_at),
          })),
          total,
        };
      },
      async create(f, at) {
        const r = await q("INSERT INTO platform.companies (name, gstin, main_contact_name, email, mobile, landline, address, pincode, country, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id", [f.name, f.gstin ?? null, f.mainContactName ?? null, f.email ?? null, f.mobile ?? null, f.landline ?? null, f.address ?? null, f.pincode ?? null, f.country ?? null, at]);
        return String(r.rows[0].id);
      },
      async update(id, p) {
        return (await patchRow("companies", { name: p.name, gstin: p.gstin, main_contact_name: p.mainContactName, email: p.email, mobile: p.mobile, landline: p.landline, address: p.address, pincode: p.pincode, country: p.country }, id)) > 0;
      },
      async markDeleted(id, by, reason, at) {
        return (await q("UPDATE platform.companies SET deleted_at = $2, deleted_by = $3, deleted_reason = $4 WHERE id = $1 AND deleted_at IS NULL AND user_id IS NULL", [id, at, by, reason])).affectedRows > 0;
      },
      async restore(id) {
        return (await q("UPDATE platform.companies SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL WHERE id = $1 AND deleted_at IS NOT NULL", [id])).affectedRows > 0;
      },
      async get(id) {
        const x = (
          await q(
            `SELECT c.id, c.name, c.gstin, c.main_contact_name, c.email, c.mobile, c.landline, c.address, c.pincode, c.country, c.contacts, c.user_id, c.merged_into, c.merged_at, c.merged_by, c.created_at, c.updated_at, c.deleted_at, c.deleted_reason,
                    (SELECT count(DISTINCT ch.hotel_id) FROM platform.company_hotels ch WHERE ch.company_id = c.id) AS hotel_count
               FROM platform.companies c WHERE c.id = $1`,
            [id],
          )
        ).rows[0];
        if (!x) return null;
        const hotels = await q("SELECT DISTINCT h.id, h.name FROM platform.company_hotels ch JOIN platform.hotels h ON h.id = ch.hotel_id WHERE ch.company_id = $1 ORDER BY h.name", [id]);
        const contacts = (Array.isArray(x.contacts) ? x.contacts : []).filter((c: unknown): c is Row => typeof c === "object" && c !== null).map((c: Row) => ({ name: String(c.name ?? ""), role: String(c.role ?? ""), email: String(c.email ?? ""), mobile: String(c.mobile ?? "") }));
        return {
          id: String(x.id), name: String(x.name), gstin: text(x.gstin), mainContactName: text(x.main_contact_name), email: text(x.email), mobile: text(x.mobile), hotelCount: num(x.hotel_count),
          hasLogin: x.user_id !== null, mergedInto: text(x.merged_into), deletedAt: dateOrNull(x.deleted_at), deletedReason: text(x.deleted_reason), createdAt: date(x.created_at), landline: text(x.landline), address: text(x.address), pincode: text(x.pincode), country: text(x.country),
          contacts, hotels: hotels.rows.map((h) => ({ hotelId: String(h.id), hotelName: String(h.name) })), loginUsername: await loginName(x.user_id), updatedAt: date(x.updated_at),
          history: await mergeHistory("companies", "name", id, x.merged_into, x.merged_at, x.merged_by),
        } satisfies CompanyDetailRecord;
      },
    },

    gst: {
      async list(a) {
        const gone = a.deleted === true ? "r.deleted_at IS NOT NULL" : "r.deleted_at IS NULL";
        const where = a.search === "" ? gone : `${gone} AND (r.gstin ILIKE $1 OR r.legal_name ILIKE $1 OR r.trade_name ILIKE $1 OR r.state ILIKE $1)`;
        const params = a.search === "" ? [] : [likeOf(a.search)];
        const total = count(await q(`SELECT count(*) AS n FROM platform.gst_registry r WHERE ${where}`, params));
        const r = await q(
          `SELECT r.id, r.gstin, r.legal_name, r.trade_name, r.status, r.state, r.source, r.fetched_at, r.refresh_after, r.times_used, r.deleted_at
             FROM platform.gst_registry r WHERE ${where} ORDER BY r.fetched_at DESC, r.id LIMIT ${Number(a.limit)} OFFSET ${Number(a.offset)}`,
          params,
        );
        return { rows: r.rows.map(gstList), total };
      },
      async get(id) {
        const x = (
          await q(
            `SELECT r.id, r.gstin, r.pan, r.state_code, r.legal_name, r.trade_name, r.status, r.taxpayer_type, r.constitution, r.registered_on, r.cancelled_on, r.address, r.city, r.district, r.state, r.pincode,
                    r.nature_of_business, r.block_status, r.state_jurisdiction, r.street, r.locality, r.building_name, r.building_number, r.floor, r.landmark, r.source, r.raw, r.fetched_at, r.refresh_after, r.times_used, r.last_used_at, r.created_at, r.updated_at, r.deleted_at, r.deleted_reason
               FROM platform.gst_registry r WHERE r.id = $1`,
            [id],
          )
        ).rows[0];
        if (!x) return null;
        return {
          ...gstList(x), pan: String(x.pan), stateCode: String(x.state_code), taxpayerType: text(x.taxpayer_type), constitution: text(x.constitution), registeredOn: day(x.registered_on), cancelledOn: day(x.cancelled_on),
          address: text(x.address), city: text(x.city), district: text(x.district), pincode: text(x.pincode), natureOfBusiness: strings(x.nature_of_business),
          blockStatus: text(x.block_status), stateJurisdiction: text(x.state_jurisdiction), street: text(x.street), locality: text(x.locality), buildingName: text(x.building_name), buildingNumber: text(x.building_number),
          floor: text(x.floor), landmark: text(x.landmark),
          raw: x.raw && typeof x.raw === "object" ? (x.raw as Record<string, unknown>) : null, lastUsedAt: dateOrNull(x.last_used_at), createdAt: date(x.created_at), updatedAt: date(x.updated_at), deletedReason: text(x.deleted_reason),
        } satisfies GstDetailRecord;
      },
      async idOf(gstin) {
        const r = await q("SELECT id FROM platform.gst_registry WHERE gstin = $1", [gstin]);
        return r.rows[0] ? String(r.rows[0].id) : null;
      },
      async markDeleted(id, by, reason, at) {
        return (await q("UPDATE platform.gst_registry SET deleted_at = $2, deleted_by = $3, deleted_reason = $4 WHERE id = $1 AND deleted_at IS NULL", [id, at, by, reason])).affectedRows > 0;
      },
      async restore(id) {
        return (await q("UPDATE platform.gst_registry SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL WHERE id = $1 AND deleted_at IS NOT NULL", [id])).affectedRows > 0;
      },
    },

    lookups: {
      async list(a) {
        const where = a.search === "" ? "true" : "(w.gstin ILIKE $1 OR w.provider ILIKE $1 OR w.outcome ILIKE $1 OR h.name ILIKE $1)";
        const params = a.search === "" ? [] : [likeOf(a.search)];
        const from = "platform.gst_lookups w LEFT JOIN platform.hotels h ON h.id = w.hotel_id LEFT JOIN platform.logins l ON l.id = w.requested_by";
        const total = count(await q(`SELECT count(*) AS n FROM ${from} WHERE ${where}`, params));
        const r = await q(
          `SELECT w.id, w.gstin, w.provider, w.outcome, w.error_code, w.took_ms, h.name AS hotel_name, l.username, w.created_at
             FROM ${from} WHERE ${where} ORDER BY w.created_at DESC, w.id LIMIT ${Number(a.limit)} OFFSET ${Number(a.offset)}`,
          params,
        );
        return { rows: r.rows.map(lookupOf), total };
      },
      async get(id) {
        const r = await q(
          `SELECT w.id, w.gstin, w.provider, w.outcome, w.error_code, w.took_ms, h.name AS hotel_name, l.username, w.created_at
             FROM platform.gst_lookups w LEFT JOIN platform.hotels h ON h.id = w.hotel_id LEFT JOIN platform.logins l ON l.id = w.requested_by WHERE w.id = $1`,
          [id],
        );
        return r.rows[0] ? lookupOf(r.rows[0]) : null;
      },
    },

    async reveal(kind, id, field, index) {
      if (kind === "guest") {
        const x = (await q("SELECT display_name, mobile, email FROM platform.guests WHERE id = $1", [id])).rows[0];
        if (!x) return null;
        const value = field === "mobile" ? x.mobile : field === "email" ? x.email : null;
        return { label: `Guest profile: ${String(x.display_name)}`, value: text(value) };
      }
      const x = (await q("SELECT name, mobile, email, landline, contacts FROM platform.companies WHERE id = $1", [id])).rows[0];
      if (!x) return null;
      const contact = Array.isArray(x.contacts) && Number.isInteger(index) && index >= 0 ? (x.contacts as unknown[])[index] : undefined;
      const c = typeof contact === "object" && contact !== null ? (contact as Row) : {};
      const value = field === "mobile" ? x.mobile : field === "email" ? x.email : field === "landline" ? x.landline : field === "contactMobile" ? c.mobile : c.email;
      return { label: `Company profile: ${String(x.name)}`, value: text(value) };
    },
  };

  /** (hoisted helper used by logins.get; the answer is cheap and not kept) */
  async function hasProfiles() {
    const r = await q("SELECT to_regclass('platform.guests') IS NOT NULL AND to_regclass('platform.company_hotels') IS NOT NULL AS profiles");
    return { profiles: r.rows[0]?.profiles === true };
  }
}

function gstList(x: Row): GstListRecord {
  return {
    deletedAt: dateOrNull(x.deleted_at),
    id: String(x.id), gstin: String(x.gstin), legalName: text(x.legal_name), tradeName: text(x.trade_name), status: STATUSES.includes(x.status as CentralGstStatus) ? (x.status as CentralGstStatus) : "unknown",
    state: text(x.state), source: String(x.source), fetchedAt: date(x.fetched_at), refreshAfter: date(x.refresh_after), timesUsed: num(x.times_used),
  };
}

function lookupOf(x: Row): LookupRecord {
  return {
    id: String(x.id), gstin: String(x.gstin), provider: String(x.provider), outcome: x.outcome as LookupRecord["outcome"], errorCode: text(x.error_code), tookMs: x.took_ms === null || x.took_ms === undefined ? null : num(x.took_ms),
    hotelName: text(x.hotel_name), requestedBy: text(x.username), createdAt: date(x.created_at),
  };
}

/** The Central tabs and the console's accounts and audit log on ONE connection, ONE transaction. */
export function createPgCentralConsoleUnit(pool: ClientPool): CentralConsoleUnit {
  return createPlatformUnit(pool, (db) => ({ central: pgCentralConsoleRepos(db), console: pgPlatformConsoleRepos(db) }));
}


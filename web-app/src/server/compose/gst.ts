import "server-only";
import type { GstRegistryEntry, GstStatus } from "@shared/dashboards/gst";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { getLogger } from "../logger";
import { createGstService, type GstPorts, type GstProvider, type GstService } from "../services/gst/gstService";
import { getCompanies } from "./companies";

// The composition of the GST lookup (platform 0167): the saved records and the call log in platform.gst_registry / gst_lookups (an in-memory store without a database), and the lookup
// service chosen on the server:
//   GST_LOOKUP_PROVIDER  the service's id: gstinapi (gstinapi.in); another service gets its adapter in providerFor below
//   GST_LOOKUP_API_KEY   its key (a server secret: never sent to the browser, never logged)
// Without both, a valid GSTIN still answers with its state and PAN, and a saved record still answers.

const statusOf = (v: unknown): GstStatus => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "active" ? "active" : s.startsWith("cancel") ? "cancelled" : s.startsWith("suspend") ? "suspended" : s === "inactive" ? "inactive" : "unknown";
};
const fail = (code: string) => Object.assign(new Error(`gst lookup ${code.toLowerCase()}`), { code });

/** gstinapi.in (MJ, 2 Nov 2026): GET https://www.gstinapi.in/v1/gstin/<GSTIN> with the key in x-api-key; 200 {success, data: {...}}, 404 when the GSTIN is not on the GST record. */
export function gstinApiProvider(key: string, fetcher: typeof fetch = fetch): GstProvider {
  return {
    id: "gstinapi",
    async lookup(gstin) {
      const res = await fetcher(`https://www.gstinapi.in/v1/gstin/${encodeURIComponent(gstin)}`, { headers: { "x-api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(10_000) }).catch((e: unknown) => {
        throw fail((e as { name?: string }).name === "TimeoutError" ? "TIMEOUT" : "NETWORK");
      });
      if (res.status === 404) return { found: false };
      if (res.status === 401 || res.status === 403) throw fail("KEY_REFUSED");
      if (res.status === 402) throw fail("NO_CREDITS");
      if (res.status === 429) throw fail("RATE_LIMITED");
      if (!res.ok) throw fail(res.status >= 500 ? "SERVICE_DOWN" : "BAD_ANSWER");
      const body = (await res.json().catch(() => null)) as { success?: unknown; data?: Record<string, unknown> | null } | null;
      const d = body?.data;
      if (!body || body.success !== true || !d || typeof d !== "object") return { found: false };
      const place = (d.address_details ?? {}) as Record<string, unknown>;
      return {
        found: true,
        record: {
          legalName: t(d.legal_name),
          tradeName: t(d.trade_name),
          status: statusOf(d.status),
          taxpayerType: t(d.taxpayer_type),
          constitution: t(d.business_constitution),
          registeredOn: day(d.registration_date),
          cancelledOn: day(d.cancellation_date),
          address: t(d.address),
          // the service's own city only: it is never worked out from the locality or anything else
          city: t(d.city) ?? t(place.city),
          district: t(place.district),
          state: t(place.state),
          pincode: t(d.pincode) ?? t(place.pincode),
          natureOfBusiness: Array.isArray(d.nature_of_business) ? d.nature_of_business.filter((x): x is string => typeof x === "string") : [],
          blockStatus: t(d.block_status),
          stateJurisdiction: t(d.state_jurisdiction),
          street: t(place.street),
          locality: t(place.locality),
          buildingName: t(place.building_name),
          buildingNumber: t(place.building_number),
          floor: t(place.floor),
          landmark: t(place.landmark),
          // the company part of the answer as it came (the billing fields beside it are left out, and never the key)
          raw: cleanRaw(d, key),
        },
      };
    },
  };
}

/** The lookup service of this server, or null while none is set up. */
export function providerFor(env: { provider?: string; key?: string }): GstProvider | null {
  const id = (env.provider ?? "").trim().toLowerCase();
  const key = (env.key ?? "").trim();
  if (!id || !key) return null;
  if (id === "gstinapi") return gstinApiProvider(key);
  getLogger().info("gst lookup: no adapter for this provider", { provider: id });
  return null;
}

async function defaultQuery(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const client = await getDatabase().pool.connect();
  try {
    return (await client.query(text, params)).rows as Record<string, unknown>[];
  } finally {
    client.release();
  }
}

const t = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const day = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : t(v));
/** Names that can hold a secret: a field with one of these words in its name is not kept in the saved answer. */
const SECRETISH = /(^|_)(api_?key|key|token|secret|authorization|password|credentials?)($|_)/i;

/** The provider's answer about the company as it came, but never a secret: a field named like one is dropped, and so is any text that contains our key. */
export function cleanRaw(answer: Record<string, unknown>, key: string): Record<string, unknown> {
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") return key !== "" && v.includes(key) ? undefined : v;
    if (Array.isArray(v)) return depth > 6 ? [] : v.map((x) => walk(x, depth + 1)).filter((x) => x !== undefined);
    if (v !== null && typeof v === "object") {
      if (depth > 6) return {};
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (SECRETISH.test(k)) continue;
        const w = walk(x, depth + 1);
        if (w !== undefined) out[k] = w;
      }
      return out;
    }
    return v;
  };
  return (walk(answer, 0) as Record<string, unknown>) ?? {};
}

const STATUSES: readonly GstStatus[] = ["active", "cancelled", "suspended", "inactive", "unknown"];

const COLUMNS = "gstin, pan, state_code, legal_name, trade_name, status, taxpayer_type, constitution, registered_on, cancelled_on, address, city, district, state, pincode, nature_of_business, block_status, state_jurisdiction, street, locality, building_name, building_number, floor, landmark, source, fetched_at, refresh_after";
function entryOf(r: Record<string, unknown>): GstRegistryEntry & { refreshAfter: string } {
  return {
    gstin: String(r.gstin),
    pan: String(r.pan),
    stateCode: String(r.state_code),
    legalName: t(r.legal_name),
    tradeName: t(r.trade_name),
    status: STATUSES.includes(r.status as GstStatus) ? (r.status as GstStatus) : "unknown",
    taxpayerType: t(r.taxpayer_type),
    constitution: t(r.constitution),
    registeredOn: day(r.registered_on),
    cancelledOn: day(r.cancelled_on),
    address: t(r.address),
    city: t(r.city),
    district: t(r.district),
    state: t(r.state),
    pincode: t(r.pincode),
    natureOfBusiness: Array.isArray(r.nature_of_business) ? r.nature_of_business.filter((x): x is string => typeof x === "string") : [],
    blockStatus: t(r.block_status),
    stateJurisdiction: t(r.state_jurisdiction),
    street: t(r.street),
    locality: t(r.locality),
    buildingName: t(r.building_name),
    buildingNumber: t(r.building_number),
    floor: t(r.floor),
    landmark: t(r.landmark),
    source: String(r.source),
    fetchedAt: new Date(r.fetched_at as string).toISOString(),
    refreshAfter: new Date(r.refresh_after as string).toISOString(),
  };
}

/** The saved records and the call log in PostgreSQL (exported for the database check). */
export function pgPorts(query: (text: string, params: unknown[]) => Promise<Record<string, unknown>[]> = defaultQuery): GstPorts {
  return {
    async get(gstin) {
      const rows = await query(`SELECT ${COLUMNS} FROM platform.gst_registry WHERE gstin = $1 AND deleted_at IS NULL`, [gstin]);
      return rows[0] ? entryOf(rows[0]) : null;
    },
    async save(gstin, r, source, fetchedAt, refreshAfter) {
      // a re-check replaces the fields with the service's newest answer; the use count stays
      const rows = await query(
        `INSERT INTO platform.gst_registry (gstin, legal_name, trade_name, status, taxpayer_type, constitution, registered_on, cancelled_on, address, city, district, state, pincode, nature_of_business, source, raw, fetched_at, refresh_after, block_status, state_jurisdiction, street, locality, building_name, building_number, floor, landmark, times_used, last_used_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12, $13, $14::text[], $15, $16::jsonb, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, 1, $17)
         ON CONFLICT (gstin) DO UPDATE SET legal_name = EXCLUDED.legal_name, trade_name = EXCLUDED.trade_name, status = EXCLUDED.status, taxpayer_type = EXCLUDED.taxpayer_type,
           constitution = EXCLUDED.constitution, registered_on = EXCLUDED.registered_on, cancelled_on = EXCLUDED.cancelled_on, address = EXCLUDED.address, city = EXCLUDED.city,
           district = EXCLUDED.district, state = EXCLUDED.state, pincode = EXCLUDED.pincode, nature_of_business = EXCLUDED.nature_of_business, source = EXCLUDED.source, raw = EXCLUDED.raw,
           fetched_at = EXCLUDED.fetched_at, refresh_after = EXCLUDED.refresh_after, block_status = EXCLUDED.block_status, state_jurisdiction = EXCLUDED.state_jurisdiction, street = EXCLUDED.street,
           locality = EXCLUDED.locality, building_name = EXCLUDED.building_name, building_number = EXCLUDED.building_number, floor = EXCLUDED.floor, landmark = EXCLUDED.landmark, deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL, times_used = platform.gst_registry.times_used + 1, last_used_at = EXCLUDED.last_used_at
         RETURNING ${COLUMNS}`,
        [gstin, r.legalName?.slice(0, 200) ?? null, r.tradeName?.slice(0, 200) ?? null, r.status, r.taxpayerType?.slice(0, 60) ?? null, r.constitution?.slice(0, 100) ?? null, r.registeredOn, r.cancelledOn,
          r.address?.slice(0, 500) ?? null, r.city?.slice(0, 100) ?? null, r.district?.slice(0, 100) ?? null, r.state?.slice(0, 60) ?? null, r.pincode && /^[1-9]\d{5}$/.test(r.pincode) ? r.pincode : null,
          r.natureOfBusiness.slice(0, 20), source, JSON.stringify(r.raw), fetchedAt, refreshAfter, r.blockStatus?.slice(0, 60) ?? null, r.stateJurisdiction?.slice(0, 200) ?? null, r.street?.slice(0, 200) ?? null,
          r.locality?.slice(0, 200) ?? null, r.buildingName?.slice(0, 200) ?? null, r.buildingNumber?.slice(0, 200) ?? null, r.floor?.slice(0, 60) ?? null, r.landmark?.slice(0, 200) ?? null],
      );
      const row = rows[0];
      if (!row) throw new Error("gst_registry not saved");
      const { refreshAfter: _r, ...entry } = entryOf(row);
      void _r;
      return entry;
    },
    async touch(gstin, at) {
      await query("UPDATE platform.gst_registry SET times_used = times_used + 1, last_used_at = $2 WHERE gstin = $1 AND deleted_at IS NULL", [gstin, at]);
    },
    async log(row) {
      await query("INSERT INTO platform.gst_lookups (gstin, provider, outcome, error_code, took_ms, requested_by, hotel_id) VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::uuid)", [
        row.gstin, row.provider, row.outcome, row.errorCode, row.tookMs, row.requestedBy && /^[0-9a-f-]{36}$/i.test(row.requestedBy) ? row.requestedBy : null, row.hotelId && /^[0-9a-f-]{36}$/i.test(row.hotelId) ? row.hotelId : null,
      ]);
    },
  };
}

/** The in-memory store (no database): the same rules, kept for this process only. */
export function memoryGstPorts(): GstPorts & { rows: Map<string, GstRegistryEntry & { refreshAfter: string; timesUsed: number }>; calls: Parameters<GstPorts["log"]>[0][] } {
  const rows = new Map<string, GstRegistryEntry & { refreshAfter: string; timesUsed: number }>();
  const calls: Parameters<GstPorts["log"]>[0][] = [];
  return {
    rows,
    calls,
    async get(gstin) {
      const r = rows.get(gstin);
      return r ? { ...r } : null;
    },
    async save(gstin, r, source, fetchedAt, refreshAfter) {
      const before = rows.get(gstin);
      const entry: GstRegistryEntry = { gstin, pan: gstin.slice(2, 12), stateCode: gstin.slice(0, 2), legalName: r.legalName, tradeName: r.tradeName, status: r.status, taxpayerType: r.taxpayerType, constitution: r.constitution, registeredOn: r.registeredOn, cancelledOn: r.cancelledOn, address: r.address, city: r.city, district: r.district, state: r.state, pincode: r.pincode, natureOfBusiness: r.natureOfBusiness, blockStatus: r.blockStatus, stateJurisdiction: r.stateJurisdiction, street: r.street, locality: r.locality, buildingName: r.buildingName, buildingNumber: r.buildingNumber, floor: r.floor, landmark: r.landmark, source, fetchedAt: fetchedAt.toISOString() };
      rows.set(gstin, { ...entry, refreshAfter: refreshAfter.toISOString(), timesUsed: (before?.timesUsed ?? 0) + 1 });
      return entry;
    },
    async touch(gstin) {
      const r = rows.get(gstin);
      if (r) r.timesUsed += 1;
    },
    async log(row) {
      calls.push(row);
    },
  };
}

let service: GstService | null = null;

export function getGst(): GstService {
  if (service) return service;
  const config = getConfig();
  const provider = providerFor({ provider: process.env.GST_LOOKUP_PROVIDER, key: process.env.GST_LOOKUP_API_KEY });
  service = createGstService({
    ports: config.DATABASE_URL ? pgPorts() : memoryGstPorts(),
    provider,
    now: () => new Date(),
    // the hotel's own companies are asked first (the order: hotel, then the saved central record, then the lookup service)
    hotelCompany: (session, gstin, except) => getCompanies().byGstin(session, gstin, except),
    log: (m, f) => getLogger().warn(m, f),
  });
  return service;
}

/** Replaces the service (tests). */
export function configureGst(next: GstService | null): void {
  service = next;
}

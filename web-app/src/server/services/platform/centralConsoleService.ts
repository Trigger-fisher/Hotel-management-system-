import "server-only";
import type {
  CentralCompanyDetail, CentralCompanyRow, CentralGstDetail, CentralGstRow, CentralGuestDetail, CentralGuestRow, CentralLoginDetail, CentralLoginRow, CentralLookupDetail, CentralLookupRow,
  CentralMergeHistory, CentralPage, CentralTab, RevealInput,
} from "@shared/dashboards/central";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type {
  CentralConsoleUnit, CentralQueryArgs, CompanyDetailRecord, CompanyListRecord, GstDetailRecord, GstListRecord, GuestDetailRecord, GuestListRecord, LoginDetailRecord, LoginListRecord,
  LookupRecord, MergeHistoryRecord,
} from "../../repos/centralConsole";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";
import { createGate, type PlatformMeta } from "./access";

// The "Central" tabs of the Platform console (MJ, 3 Nov 2026; contract ui-shared/dashboards/central.ts): READ ONLY lists and details of the logins, the common guest and company
// profiles, the GST records and the GST lookup log. Who: Super Admin and Platform Admin, as themselves in the console. Never an API key, never a platform visit inside a hotel (the
// hotel's own screens do not read these tables either). A mobile and an email are MASKED in every answer; "Reveal" returns ONE full value and writes ONE audit line first (who, which
// profile, which field, when; never the value) in the same transaction, so a value that cannot be audited is not shown.

const REVEAL_FIELDS = new Set(["mobile", "email", "landline", "contactMobile", "contactEmail"]);

/** "+91 ••••• ••236": the country code and the last three digits. */
export function maskMobile(v: string | null | undefined): string | null {
  const digits = (v ?? "").replace(/\D+/g, "");
  if (digits === "") return null;
  const tail = digits.slice(-3);
  return `${(v ?? "").trim().startsWith("+91") ? "+91 " : ""}••••• ••${tail}`;
}

/** "a•••@gmail.com": the first letter of the name and the whole domain. */
export function maskEmail(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (s === "") return null;
  const at = s.lastIndexOf("@");
  if (at < 1) return `${s.slice(0, 1)}•••`;
  return `${s.slice(0, 1)}•••${s.slice(at)}`;
}

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

const loginRow = (r: LoginListRecord): CentralLoginRow => ({
  id: r.id, username: r.username, displayName: r.displayName, roleType: r.roleType, status: r.status, hotels: [...r.hotels], lastLoginAt: isoOrNull(r.lastLoginAt), locked: r.locked, closed: r.closed, createdAt: iso(r.createdAt),
});
const loginDetail = (r: LoginDetailRecord): CentralLoginDetail => ({
  ...loginRow(r), hotelLinks: r.hotelLinks.map((h) => ({ ...h })), blockedKind: r.blockedKind, blockedAt: isoOrNull(r.blockedAt), lockedUntil: isoOrNull(r.lockedUntil), failedAttempts: r.failedAttempts,
  lockLevel: r.lockLevel, mustChangePassword: r.mustChangePassword, codeRequired: r.codeRequired, passwordChangedAt: isoOrNull(r.passwordChangedAt), activeSessions: r.activeSessions,
  profile: r.profile ? { ...r.profile } : null,
});
const history = (h: MergeHistoryRecord): CentralMergeHistory => ({
  mergedInto: h.mergedInto ? { ...h.mergedInto } : null, mergedAt: isoOrNull(h.mergedAt), mergedByName: h.mergedByName, mergedFrom: h.mergedFrom.map((m) => ({ id: m.id, name: m.name, mergedAt: iso(m.mergedAt) })),
});
const guestRow = (r: GuestListRecord): CentralGuestRow => ({
  id: r.id, name: r.name, mobile: maskMobile(r.mobile), email: maskEmail(r.email), city: r.city, hotelCount: r.hotelCount, hasLogin: r.hasLogin, mergedInto: r.mergedInto, deletedAt: isoOrNull(r.deletedAt), createdAt: iso(r.createdAt),
});
const guestDetail = (r: GuestDetailRecord): CentralGuestDetail => ({
  ...guestRow(r), address: r.address, hotels: r.hotels.map((h) => ({ ...h })), loginUsername: r.loginUsername, updatedAt: iso(r.updatedAt), deletedReason: r.deletedReason, history: history(r.history),
});
const companyRow = (r: CompanyListRecord): CentralCompanyRow => ({
  id: r.id, name: r.name, gstin: r.gstin, mainContactName: r.mainContactName, email: maskEmail(r.email), mobile: maskMobile(r.mobile), hotelCount: r.hotelCount, hasLogin: r.hasLogin, mergedInto: r.mergedInto, deletedAt: isoOrNull(r.deletedAt),
  createdAt: iso(r.createdAt),
});
const companyDetail = (r: CompanyDetailRecord): CentralCompanyDetail => ({
  ...companyRow(r), landline: maskMobile(r.landline), address: r.address, pincode: r.pincode, country: r.country,
  contacts: r.contacts.map((c) => ({ name: c.name, role: c.role, email: maskEmail(c.email) ?? "", mobile: maskMobile(c.mobile) ?? "" })), hotels: r.hotels.map((h) => ({ ...h })), loginUsername: r.loginUsername,
  updatedAt: iso(r.updatedAt), deletedReason: r.deletedReason, history: history(r.history),
});
const gstRow = (r: GstListRecord): CentralGstRow => ({
  id: r.id, gstin: r.gstin, legalName: r.legalName, tradeName: r.tradeName, status: r.status, state: r.state, source: r.source, fetchedAt: iso(r.fetchedAt), refreshAfter: iso(r.refreshAfter), timesUsed: r.timesUsed, deletedAt: isoOrNull(r.deletedAt),
});
const gstDetail = (r: GstDetailRecord): CentralGstDetail => ({
  ...gstRow(r), pan: r.pan, stateCode: r.stateCode, taxpayerType: r.taxpayerType, constitution: r.constitution, registeredOn: r.registeredOn, cancelledOn: r.cancelledOn, address: r.address, city: r.city,
  district: r.district, pincode: r.pincode, natureOfBusiness: [...r.natureOfBusiness], blockStatus: r.blockStatus, stateJurisdiction: r.stateJurisdiction, street: r.street, locality: r.locality, buildingName: r.buildingName,
  buildingNumber: r.buildingNumber, floor: r.floor, landmark: r.landmark, raw: r.raw ? structuredClone(r.raw) : null, lastUsedAt: isoOrNull(r.lastUsedAt), createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt), deletedReason: r.deletedReason,
});
const lookupRow = (r: LookupRecord): CentralLookupRow => ({
  id: r.id, gstin: r.gstin, provider: r.provider, outcome: r.outcome, errorCode: r.errorCode, tookMs: r.tookMs, hotelName: r.hotelName, requestedBy: r.requestedBy, createdAt: iso(r.createdAt),
});

export interface CentralConsoleDeps {
  unit: CentralConsoleUnit;
  now: () => Date;
}

export function createCentralConsoleService(deps: CentralConsoleDeps) {
  const { unit, now } = deps;
  const consoleUnit: PlatformConsoleUnit = { run: (work) => unit.run((r) => work(r.console)) };
  const gate = createGate(consoleUnit, now);

  /** Platform and Super Admin as themselves: never an API key, never a visit inside a hotel. */
  function allow(session: VerifiedSession): void {
    if (session.client === "token" || session.token !== undefined || session.visit !== undefined) throw new AppError("FORBIDDEN");
    gate.read(session);
  }

  const args = (q: { search?: string; deleted?: boolean; page: number; pageSize: number }): CentralQueryArgs => ({ search: (q.search ?? "").trim(), deleted: q.deleted === true, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  const pageOf = <R, T>(rows: R[], total: number, q: { page: number; pageSize: number }, map: (r: R) => T): CentralPage<T> => ({ items: rows.map(map), total, page: q.page, pageSize: q.pageSize });
  const empty = <T>(q: { page: number; pageSize: number }): CentralPage<T> => ({ items: [], total: 0, page: q.page, pageSize: q.pageSize });

  return {
    /** One tab's page. A table this database does not have yet answers an empty page. */
    async list(session: VerifiedSession, tab: CentralTab, q: { search?: string; deleted?: boolean; page: number; pageSize: number }): Promise<CentralPage<unknown>> {
      allow(session);
      return unit.run(async (r) => {
        await gate.actor(r.console, session);
        const a = args(q);
        if (tab === "logins") {
          const x = await r.central.logins.list(a);
          return pageOf(x.rows, x.total, q, loginRow);
        }
        const have = await r.central.available();
        if (tab === "guests") {
          if (!have.profiles) return empty(q);
          const x = await r.central.guests.list(a);
          return pageOf(x.rows, x.total, q, guestRow);
        }
        if (tab === "companies") {
          if (!have.profiles) return empty(q);
          const x = await r.central.companies.list(a);
          return pageOf(x.rows, x.total, q, companyRow);
        }
        if (!have.gst) return empty(q);
        if (tab === "gst") {
          const x = await r.central.gst.list(a);
          return pageOf(x.rows, x.total, q, gstRow);
        }
        const x = await r.central.lookups.list(a);
        return pageOf(x.rows, x.total, q, lookupRow);
      });
    },

    /** One record with every field its tab holds (a mobile and an email masked). */
    async detail(session: VerifiedSession, tab: CentralTab, id: string): Promise<unknown> {
      allow(session);
      const found = await unit.run(async (r): Promise<unknown> => {
        await gate.actor(r.console, session);
        const have = await r.central.available();
        if (tab === "logins") {
          const x = await r.central.logins.get(id);
          return x ? loginDetail(x) : null;
        }
        if (tab === "guests" || tab === "companies") {
          if (!have.profiles) return null;
          if (tab === "guests") {
            const x = await r.central.guests.get(id);
            return x ? guestDetail(x) : null;
          }
          const x = await r.central.companies.get(id);
          return x ? companyDetail(x) : null;
        }
        if (!have.gst) return null;
        if (tab === "gst") {
          const x = await r.central.gst.get(id);
          return x ? gstDetail(x) : null;
        }
        const x = await r.central.lookups.get(id);
        return x ? (lookupRow(x) satisfies CentralLookupDetail) : null;
      });
      if (found === null) throw new AppError("NOT_FOUND");
      return found;
    },

    /** One full mobile, email or landline of a guest or company profile. The audit line is written in the same transaction, before the value is returned. */
    async reveal(session: VerifiedSession, input: RevealInput, meta: PlatformMeta): Promise<{ value: string }> {
      allow(session);
      if (!REVEAL_FIELDS.has(input.field) || (input.kind === "guest" && input.field !== "mobile" && input.field !== "email")) {
        throw new AppError("VALIDATION_FAILED", "Choose a field to show.", { fields: { field: "Choose a field to show." } });
      }
      return unit.run(async (r) => {
        const actor = await gate.actor(r.console, session);
        const have = await r.central.available();
        const found = have.profiles ? await r.central.reveal(input.kind, input.id, input.field, input.index ?? 0) : null;
        if (!found || found.value === null) throw new AppError("NOT_FOUND");
        await gate.audit(r.console, actor, meta, {
          action: "central_revealed", entity: "platform", entityId: input.id, targetLabel: found.label, reason: `Showed the full ${input.field.replace("contact", "contact ").toLowerCase()}`,
          after: { kind: input.kind, field: input.field },
        });
        return { value: found.value };
      });
    },
  };
}

export type CentralConsoleService = ReturnType<typeof createCentralConsoleService>;

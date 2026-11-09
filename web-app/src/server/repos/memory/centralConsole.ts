import "server-only";
import { randomUUID } from "node:crypto";
import type { CentralAvailability, CentralConsoleRepos, CentralConsoleUnit, CentralQueryArgs, CompanyDetailRecord, GstDetailRecord, GuestDetailRecord, LoginDetailRecord, LookupRecord } from "../centralConsole";
import { centralMobile } from "../centralProfiles";
import type { PlatformConsoleRepos } from "../platformConsole";

// The in-memory double of the Central tabs (repos/centralConsole.ts): the same rules as PostgreSQL (newest first, "contains" search on the names, a mobile or an email found only by its
// FULL value). Read only: tests fill `data` directly. It holds plain records, never a hash, token or session id (the real tables' secrets are not even modelled here).
export interface CentralConsoleData {
  available: CentralAvailability;
  logins: LoginDetailRecord[];
  guests: GuestDetailRecord[];
  companies: CompanyDetailRecord[];
  gst: GstDetailRecord[];
  lookups: LookupRecord[];
}

export const emptyCentralConsoleData = (): CentralConsoleData => ({ available: { profiles: true, gst: true }, logins: [], guests: [], companies: [], gst: [], lookups: [] });

const contains = (hay: (string | null | undefined)[], search: string): boolean => {
  const s = search.toLowerCase();
  return hay.some((v) => (v ?? "").toLowerCase().includes(s));
};

function page<T extends { createdAt: Date; id: string }>(all: T[], a: CentralQueryArgs, match: (row: T, search: string) => boolean, order: (row: T) => number = (r) => r.createdAt.getTime()) {
  const isDeleted = (r: T): boolean => Boolean((r as { deletedAt?: Date | null }).deletedAt);
  const kept = all.filter((r) => isDeleted(r) === (a.deleted === true));
  const rows = (a.search === "" ? kept : kept.filter((r) => match(r, a.search))).sort((x, y) => order(y) - order(x) || x.id.localeCompare(y.id));
  return { rows: structuredClone(rows.slice(a.offset, a.offset + a.limit)), total: rows.length };
}

export function createMemoryCentralConsole(): { repos: CentralConsoleRepos; data: CentralConsoleData; unit: (console: { run<T>(work: (r: PlatformConsoleRepos) => Promise<T>): Promise<T> }) => CentralConsoleUnit } {
  const data = emptyCentralConsoleData();
  const repos: CentralConsoleRepos = {
    available: async () => ({ ...data.available }),
    logins: {
      list: async (a) => page(data.logins, a, (r, s) => contains([r.username, r.displayName, r.roleType], s)),
      get: async (id) => structuredClone(data.logins.find((r) => r.id === id) ?? null),
    },
    guests: {
      list: async (a) => page(data.guests, a, (r, s) => contains([r.name, r.city], s) || r.email === s.toLowerCase() || (r.mobile !== null && r.mobile === centralMobile(s))),
      get: async (id) => structuredClone(data.guests.find((r) => r.id === id) ?? null),
      create: async (f, at) => {
        const id = randomUUID();
        data.guests.push({ id, name: f.displayName, mobile: f.mobile ?? null, email: f.email ?? null, city: f.city ?? null, hotelCount: 0, hasLogin: false, mergedInto: null, deletedAt: null, createdAt: at, address: f.address ?? null, hotels: [], loginUsername: null, updatedAt: at, deletedReason: null, history: { mergedInto: null, mergedAt: null, mergedByName: null, mergedFrom: [] } });
        return id;
      },
      update: async (id, p) => {
        const g = data.guests.find((r) => r.id === id && !r.deletedAt);
        if (!g) return false;
        if (p.displayName !== undefined) g.name = p.displayName;
        for (const k of ["mobile", "email", "address", "city"] as const) if (p[k] !== undefined) g[k] = p[k];
        return true;
      },
      markDeleted: async (id, _by, reason, at) => {
        const g = data.guests.find((r) => r.id === id && !r.deletedAt);
        if (!g) return false;
        Object.assign(g, { deletedAt: at, deletedReason: reason });
        return true;
      },
      restore: async (id) => {
        const g = data.guests.find((r) => r.id === id && r.deletedAt);
        if (!g) return false;
        Object.assign(g, { deletedAt: null, deletedReason: null });
        return true;
      },
    },
    companies: {
      list: async (a) => page(data.companies, a, (r, s) => contains([r.name, r.gstin], s) || r.email === s.toLowerCase() || (r.mobile !== null && (r.mobile === s.replace(/\s+/g, "") || r.mobile === centralMobile(s)))),
      get: async (id) => structuredClone(data.companies.find((r) => r.id === id) ?? null),
      create: async (f, at) => {
        const id = randomUUID();
        data.companies.push({ id, name: f.name, gstin: f.gstin ?? null, mainContactName: f.mainContactName ?? null, email: f.email ?? null, mobile: f.mobile ?? null, hotelCount: 0, hasLogin: false, mergedInto: null, deletedAt: null, createdAt: at, landline: f.landline ?? null, address: f.address ?? null, pincode: f.pincode ?? null, country: f.country ?? null, contacts: [], hotels: [], loginUsername: null, updatedAt: at, deletedReason: null, history: { mergedInto: null, mergedAt: null, mergedByName: null, mergedFrom: [] } });
        return id;
      },
      update: async (id, p) => {
        const c = data.companies.find((r) => r.id === id && !r.deletedAt);
        if (!c) return false;
        if (p.name !== undefined) c.name = p.name;
        for (const k of ["gstin", "mainContactName", "email", "mobile", "landline", "address", "pincode", "country"] as const) if (p[k] !== undefined) c[k] = p[k];
        return true;
      },
      markDeleted: async (id, _by, reason, at) => {
        const c = data.companies.find((r) => r.id === id && !r.deletedAt);
        if (!c) return false;
        Object.assign(c, { deletedAt: at, deletedReason: reason });
        return true;
      },
      restore: async (id) => {
        const c = data.companies.find((r) => r.id === id && r.deletedAt);
        if (!c) return false;
        Object.assign(c, { deletedAt: null, deletedReason: null });
        return true;
      },
    },
    gst: {
      list: async (a) => page(data.gst, a, (r, s) => contains([r.gstin, r.legalName, r.tradeName, r.state], s), (r) => r.fetchedAt.getTime()),
      get: async (id) => structuredClone(data.gst.find((r) => r.id === id) ?? null),
      idOf: async (gstin) => data.gst.find((r) => r.gstin === gstin)?.id ?? null,
      markDeleted: async (id, _by, reason, at) => {
        const g = data.gst.find((r) => r.id === id && !r.deletedAt);
        if (!g) return false;
        Object.assign(g, { deletedAt: at, deletedReason: reason });
        return true;
      },
      restore: async (id) => {
        const g = data.gst.find((r) => r.id === id && r.deletedAt);
        if (!g) return false;
        Object.assign(g, { deletedAt: null, deletedReason: null });
        return true;
      },
    },
    lookups: {
      list: async (a) => page(data.lookups, a, (r, s) => contains([r.gstin, r.provider, r.outcome, r.hotelName], s)),
      get: async (id) => structuredClone(data.lookups.find((r) => r.id === id) ?? null),
    },
    async reveal(kind, id, field, index) {
      if (kind === "guest") {
        const g = data.guests.find((r) => r.id === id);
        if (!g) return null;
        return { label: `Guest profile: ${g.name}`, value: (field === "mobile" ? g.mobile : field === "email" ? g.email : null) || null };
      }
      const c = data.companies.find((r) => r.id === id);
      if (!c) return null;
      const contact = c.contacts[index];
      const value = field === "mobile" ? c.mobile : field === "email" ? c.email : field === "landline" ? c.landline : field === "contactMobile" ? contact?.mobile : contact?.email;
      return { label: `Company profile: ${c.name}`, value: value || null };
    },
  };
  return { repos, data, unit: (console) => ({ run: (work) => console.run((k) => work({ central: repos, console: k })) }) };
}

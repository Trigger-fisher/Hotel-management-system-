import "server-only";
import { randomUUID } from "node:crypto";
import type { CentralCompany, CentralCompanyFields, CentralGuest, CentralGuestFields, CentralProfilesRepos, CentralProfilesUnit, ProfileChange, ProfileKind } from "../centralProfiles";

// The in-memory double of the one common guest and company profile (repos/centralProfiles.ts): the same rules as PostgreSQL (one live profile per login, one profile per hotel
// record, a link is never replaced, reads follow merged_into). Transactions run one at a time and a failed one leaves nothing behind.
export interface CentralProfilesData {
  /** false = the database does not have migration 0132 yet (the callers fall back to each hotel's own record). */
  ready: boolean;
  guests: (CentralGuest & { mergedInto: string | null; deletedAt?: Date | null })[];
  companies: (CentralCompany & { mergedInto: string | null; deletedAt?: Date | null })[];
  guestLinks: { hotelId: string; customerId: string; guestId: string }[];
  companyLinks: { hotelId: string; companyProfileId: string; companyId: string }[];
  keptApart?: { kind: ProfileKind; left: string; right: string }[];
  /** The hotels' names, for the review's summaries (PostgreSQL reads platform.hotels). */
  hotelNames?: Map<string, string>;
  /** The change history (PostgreSQL: platform.audit_log rows), oldest first. */
  changes?: ProfileChange[];
}

export const emptyCentralProfilesData = (): CentralProfilesData => ({ ready: true, guests: [], companies: [], guestLinks: [], companyLinks: [], keptApart: [], hotelNames: new Map(), changes: [] });

function bind(data: CentralProfilesData, now: () => Date): CentralProfilesRepos {
  function live<T extends { id: string; mergedInto: string | null }>(rows: T[], id: string | null): T | null {
    for (let step = 0, at = id; at !== null && step < 10; step += 1) {
      const row = rows.find((r) => r.id === at);
      if (!row) return null;
      if ((row as { deletedAt?: Date | null }).deletedAt) return null;
      if (row.mergedInto === null) return row;
      at = row.mergedInto;
    }
    return null;
  }
  const out = <T extends { mergedInto: string | null }>(row: T): Omit<T, "mergedInto"> => {
    const { mergedInto, ...rest } = row;
    void mergedInto;
    return structuredClone(rest);
  };
  const assertOneLogin = (rows: { id: string; userId: string | null; mergedInto: string | null }[], userId: string | null, self: string | null): void => {
    if (userId !== null && rows.some((r) => r.userId === userId && r.mergedInto === null && r.id !== self)) throw Object.assign(new Error("duplicate login"), { code: "23505" });
  };
  const rowsOf = (kind: ProfileKind) => (kind === "guest" ? data.guests : data.companies) as ((CentralGuest | CentralCompany) & { mergedInto: string | null; mergedAt?: Date | null; mergedBy?: string | null })[];
  const linksOf = (kind: ProfileKind) => (kind === "guest" ? data.guestLinks.map((l) => ({ link: l, hotelId: l.hotelId, recordId: l.customerId, profileId: l.guestId })) : data.companyLinks.map((l) => ({ link: l, hotelId: l.hotelId, recordId: l.companyProfileId, profileId: l.companyId })));
  const review: CentralProfilesRepos["review"] = {
    duplicates: async (kind) => {
      const keys = (kind === "guest" ? ["mobile", "email"] : ["gstin", "email"]) as ("mobile" | "email" | "gstin")[];
      const live = rowsOf(kind).filter((r) => r.mergedInto === null && !(r as { deletedAt?: Date | null }).deletedAt).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      const out: { by: "mobile" | "email" | "gstin"; value: string; ids: string[] }[] = [];
      for (const by of keys) {
        const groups = new Map<string, string[]>();
        for (const r of live) {
          const v = (r as unknown as Record<string, string | null>)[by];
          if (v) groups.set(v, [...(groups.get(v) ?? []), r.id]);
        }
        for (const [value, ids] of groups) if (ids.length > 1) out.push({ by, value, ids });
      }
      return out.sort((a, b) => a.by.localeCompare(b.by) || a.value.localeCompare(b.value));
    },
    summaries: async (kind, ids) =>
      rowsOf(kind)
        .filter((r) => ids.includes(r.id))
        .map((r) => ({
          id: r.id, name: "displayName" in r ? r.displayName : r.name, mobile: r.mobile, email: r.email, gstin: "gstin" in r ? r.gstin : null, city: "city" in r ? r.city : null, userId: r.userId, createdAt: r.createdAt, mergedInto: r.mergedInto,
          hotels: linksOf(kind).filter((l) => l.profileId === r.id).map((l) => ({ hotelId: l.hotelId, hotelName: data.hotelNames?.get(l.hotelId) ?? "", recordId: l.recordId })),
        })),
    keptApart: async (kind) => (data.keptApart ?? []).filter((k) => k.kind === kind).map((k) => [k.left, k.right] as [string, string]),
    keepApart: async (kind, a, b) => {
      const [left, right] = a < b ? [a, b] : [b, a];
      data.keptApart ??= [];
      if (data.keptApart.some((k) => k.kind === kind && k.left === left && k.right === right)) return false;
      data.keptApart.push({ kind, left, right });
      return true;
    },
    undoKeepApart: async (kind, a, b) => {
      const [left, right] = a < b ? [a, b] : [b, a];
      const before = (data.keptApart ?? []).length;
      data.keptApart = (data.keptApart ?? []).filter((k) => !(k.kind === kind && k.left === left && k.right === right));
      return data.keptApart.length < before;
    },
    merge: async (kind, keepId, goneId, by, at) => {
      const rows = rowsOf(kind);
      const keep = rows.find((r) => r.id === keepId && r.mergedInto === null);
      const gone = rows.find((r) => r.id === goneId && r.mergedInto === null);
      if (!keep || !gone) throw Object.assign(new Error(`${kind}_merge_not_live`), { kind: "check" });
      let relinked = 0;
      for (const l of linksOf(kind)) {
        if (l.profileId !== goneId) continue;
        if ("guestId" in l.link) l.link.guestId = keepId;
        else l.link.companyId = keepId;
        relinked += 1;
      }
      Object.assign(gone, { mergedInto: keepId, mergedAt: at, mergedBy: by });
      const loginMoved = keep.userId === null && gone.userId !== null;
      if (loginMoved) keep.userId = gone.userId;
      return { relinked, loginMoved };
    },
  };
  const history: CentralProfilesRepos["history"] = {
    record: async (c) => {
      (data.changes ??= []).push(structuredClone(c));
    },
    last: async (kind, profileId) => {
      const all = (data.changes ?? []).filter((c) => c.kind === kind && c.profileId === profileId);
      const c = all.reduce<ProfileChange | null>((best, x) => (best === null || x.at.getTime() >= best.at.getTime() ? x : best), null);
      return c ? { at: c.at, hotelName: data.hotelNames?.get(c.hotelId) ?? null, by: c.byName, via: c.via, fields: [...c.fields], ...(c.gstin ? { gstin: { ...c.gstin } } : {}) } : null;
    },
  };
  return {
    review,
    history,
    ready: async () => data.ready,
    guests: {
      byUser: async (userId) => {
        const row = data.guests.find((g) => g.userId === userId && g.mergedInto === null && !g.deletedAt);
        return row ? (out(row) as CentralGuest) : null;
      },
      byMobile: async (mobile) => {
        const row = data.guests.filter((g) => g.mobile === mobile && g.mergedInto === null && !g.deletedAt).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
        return row ? (out(row) as CentralGuest) : null;
      },
      ofRecord: async (hotelId, customerId) => {
        const link = data.guestLinks.find((l) => l.hotelId === hotelId && l.customerId === customerId);
        const row = link ? live(data.guests, link.guestId) : null;
        return row ? (out(row) as CentralGuest) : null;
      },
      create: async (fields: CentralGuestFields) => {
        assertOneLogin(data.guests, fields.userId, null);
        const at = now();
        const row = { id: randomUUID(), ...fields, createdAt: at, updatedAt: at, mergedInto: null };
        data.guests.push(row);
        return out(row) as CentralGuest;
      },
      update: async (id, patch) => {
        const row = data.guests.find((g) => g.id === id && g.mergedInto === null);
        if (!row) return null;
        if (patch.userId !== undefined) assertOneLogin(data.guests, patch.userId, id);
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) (row as unknown as Record<string, unknown>)[k] = v;
        row.updatedAt = now();
        return out(row) as CentralGuest;
      },
      link: async (hotelId, customerId, guestId) => {
        if (data.guestLinks.some((l) => l.hotelId === hotelId && l.customerId === customerId)) return false;
        data.guestLinks.push({ hotelId, customerId, guestId });
        return true;
      },
      hotelCount: async (guestId) => new Set(data.guestLinks.filter((l) => l.guestId === guestId).map((l) => l.hotelId)).size,
    },
    companies: {
      byUser: async (userId) => {
        const row = data.companies.find((c) => c.userId === userId && c.mergedInto === null && !c.deletedAt);
        return row ? (out(row) as CentralCompany) : null;
      },
      byGstin: async (gstin) => {
        const row = data.companies.filter((c) => c.gstin === gstin && c.mergedInto === null && !c.deletedAt).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
        return row ? (out(row) as CentralCompany) : null;
      },
      ofRecord: async (hotelId, companyProfileId) => {
        const link = data.companyLinks.find((l) => l.hotelId === hotelId && l.companyProfileId === companyProfileId);
        const row = link ? live(data.companies, link.companyId) : null;
        return row ? (out(row) as CentralCompany) : null;
      },
      create: async (fields: CentralCompanyFields) => {
        assertOneLogin(data.companies, fields.userId, null);
        const at = now();
        const row = { id: randomUUID(), ...structuredClone(fields), createdAt: at, updatedAt: at, mergedInto: null };
        data.companies.push(row);
        return out(row) as CentralCompany;
      },
      update: async (id, patch) => {
        const row = data.companies.find((c) => c.id === id && c.mergedInto === null);
        if (!row) return null;
        if (patch.userId !== undefined) assertOneLogin(data.companies, patch.userId, id);
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) (row as unknown as Record<string, unknown>)[k] = structuredClone(v);
        row.updatedAt = now();
        return out(row) as CentralCompany;
      },
      link: async (hotelId, companyProfileId, companyId) => {
        if (data.companyLinks.some((l) => l.hotelId === hotelId && l.companyProfileId === companyProfileId)) return false;
        data.companyLinks.push({ hotelId, companyProfileId, companyId });
        return true;
      },
      hotelCount: async (companyId) => new Set(data.companyLinks.filter((l) => l.companyId === companyId).map((l) => l.hotelId)).size,
    },
  };
}

export function createMemoryCentralProfiles(now: () => Date = () => new Date()): { unit: CentralProfilesUnit; data: CentralProfilesData } {
  const holder = { data: emptyCentralProfilesData() };
  let tail: Promise<unknown> = Promise.resolve();
  return {
    get data() {
      return holder.data;
    },
    unit: {
      run: <T>(work: (repos: CentralProfilesRepos) => Promise<T>): Promise<T> => {
        const next = tail.then(async () => {
          const before = structuredClone(holder.data);
          try {
            return await work(bind(holder.data, now));
          } catch (error) {
            holder.data = before;
            throw error;
          }
        });
        tail = next.catch(() => undefined);
        return next;
      },
    },
  };
}

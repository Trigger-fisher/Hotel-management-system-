import "server-only";
import { randomUUID } from "node:crypto";
import type { AdvanceRecord, BillRecord } from "../billing";
import type { Addressee, CampaignAudience, CampaignRecord, CompaniesRepos, CompanyRecord, CustomerRecord, LedgerSummaryRow } from "../companies";
import { RepoError, type ListResult } from "../types";
import type { BillingData } from "./billing";
import type { StayRecord } from "../frontOffice";

// The in-memory double of the companies repositories (company profiles, customers, email marketing, the ledger's source), in the SAME per-hotel
// data as billing and the front office. It keeps the table rules of repos/companies.ts: live-unique company names (any case), a unique customer
// mobile, soft delete for companies only, a campaign's recipients going with it, one opt-out per address, and billing's company-name index kept in
// step with the profiles.
// `summaryByCompany` aggregates on its own (it does NOT call the ledger builder), so the property test against buildLedger means something.

export interface CompaniesData {
  companyProfiles: CompanyRecord[];
  customers: CustomerRecord[];
  campaigns: CampaignRecord[];
  campaignRecipients: { id: string; campaignId: string; email: string; name: string; at: Date; queuedAt: Date | null; skipped: "opted_out" | "suppressed" | "cancelled" | null }[];
  /** Lower-case addresses that unsubscribed. */
  optOuts: Set<string>;
}
export const emptyCompaniesData = (): CompaniesData => ({ companyProfiles: [], customers: [], campaigns: [], campaignRecipients: [], optOuts: new Set() });

const ZERO = BigInt(0);
const copy = <T>(r: T): T => structuredClone(r);
const lower = (s: string | null | undefined): string => (s ?? "").toLowerCase();
const hasEvery = (hay: string, words: readonly string[] | undefined): boolean => !words || words.every((w) => hay.includes(w));
const paged = <T>(rows: T[], p: { page: number; pageSize: number }): ListResult<T> => ({ rows: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize).map(copy), total: rows.length });
const newestFirst = (a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }): number => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);
const sumOf = (values: (bigint | null)[]): bigint => values.reduce<bigint>((t, v) => t + (v ?? ZERO), ZERO);
const isDebit = (m: string | null): boolean => lower(m) === "debit";

export function bindCompanies(data: BillingData & CompaniesData & { stays: StayRecord[] }): Pick<CompaniesRepos, "companyProfiles" | "customers" | "marketing" | "ledgerSource"> {
  const live = () => data.companyProfiles.filter((c) => c.deletedAt === null);
  const companyText = (c: CompanyRecord): string =>
    lower([c.name, c.email, c.mobileNumber, c.phoneNumber, c.country, c.nationality, c.pincode, c.gstNumber, c.address, c.discountPercentage, c.gstPercentage, c.tcsPercentage, c.tdsPercentage, c.instruction, JSON.stringify(c.contacts)].join(" "));
  const nameTaken = (name: string, except?: string): boolean => live().some((c) => c.id !== except && c.name.toLowerCase() === name.toLowerCase());
  // billing reads company names from its own index: keep it in step (a deleted company keeps its name, as Laravel's `exists` sees it)
  const syncName = (c: CompanyRecord): void => void data.companies.set(c.id, c.name);

  const customerText = (c: CustomerRecord): string => lower([c.name, c.mobile, c.email, c.address, c.city, c.idProofType, c.notes].join(" "));

  /** The audience rule of repos/companies.ts: valid lower-case addresses, each once (first name seen wins), opt-outs left out. */
  const audienceOf = (kind: CampaignAudience): Addressee[] => {
    const raw: { email: string | null; name: string }[] = [];
    if (kind === "customers" || kind === "all") for (const c of data.customers) if (c.isActive) raw.push({ email: c.email, name: c.name });
    if (kind === "companies" || kind === "all")
      for (const c of live()) {
        raw.push({ email: c.email, name: c.name });
        for (const p of c.contacts) raw.push({ email: p.email, name: p.name || c.name });
      }
    if (kind === "guests" || kind === "all") for (const st of data.stays) raw.push({ email: st.email, name: st.guestName });
    const seen = new Map<string, Addressee>();
    for (const r of raw) {
      const email = (r.email ?? "").trim().toLowerCase();
      if (!email || !email.includes("@") || data.optOuts.has(email) || seen.has(email)) continue;
      seen.set(email, { email, name: r.name.trim() });
    }
    return [...seen.values()].sort((a, b) => a.email.localeCompare(b.email));
  };

  const withAdvanceCompany = (bills: BillRecord[]) => {
    const companyOf = new Map(data.advances.map((a) => [a.id, a.companyId]));
    return bills.map((b) => ({ ...copy(b), advanceCompanyId: b.advanceId ? (companyOf.get(b.advanceId) ?? null) : null }));
  };

  return {
    companyProfiles: {
      get: async (id, options) => {
        const c = data.companyProfiles.find((x) => x.id === id);
        return c && (c.deletedAt !== null) === (options?.deleted === true) ? copy(c) : null;
      },
      list: async (q) => paged(data.companyProfiles.filter((c) => (q.deleted === "only") === (c.deletedAt !== null) && hasEvery(companyText(c), q.words)).sort(newestFirst), q),
      byName: async (q) => live().filter((c) => hasEvery(lower([c.name, c.gstNumber, c.email, c.mobileNumber].join(" ")), q.words)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, q.limit).map(copy),
      stats: async (monthFrom) => {
        const all = live();
        return { total: all.length, withGst: all.filter((c) => (c.gstNumber ?? "") !== "").length, contacts: all.reduce((n, c) => n + c.contacts.length, 0), month: all.filter((c) => c.createdAt >= monthFrom).length };
      },
      withGstNumber: async (gst, except) => {
        const c = live().find((x) => x.id !== except && x.gstNumber === gst);
        return c ? copy(c) : null;
      },
      nameTaken: async (name, except) => nameTaken(name, except),
      lookup: async (prefix, limit) =>
        live().filter((c) => c.name.toLowerCase().startsWith(prefix.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit).map((c) => ({ id: c.id, name: c.name, gstNumber: c.gstNumber })),
      create: async (input) => {
        if (nameTaken(input.name)) throw new RepoError("unique", "company_profiles_name");
        const now = new Date();
        const { createdBy, ...fields } = input;
        const row: CompanyRecord = { ...copy(fields), id: randomUUID(), createdBy, updatedBy: null, deletedAt: null, deletedBy: null, createdAt: now, updatedAt: now };
        data.companyProfiles.push(row);
        syncName(row);
        return copy(row);
      },
      update: async (id, patch, actorId) => {
        const row = data.companyProfiles.find((c) => c.id === id && c.deletedAt === null);
        if (!row) return null;
        if (patch.name !== undefined && nameTaken(patch.name, id)) throw new RepoError("unique", "company_profiles_name");
        Object.assign(row, copy(patch), { updatedBy: actorId, updatedAt: new Date() });
        syncName(row);
        return copy(row);
      },
      softDelete: async (id, actorId) => {
        const row = data.companyProfiles.find((c) => c.id === id && c.deletedAt === null);
        if (!row) return false;
        Object.assign(row, { deletedAt: new Date(), deletedBy: actorId });
        return true;
      },
      restore: async (id, actorId) => {
        const row = data.companyProfiles.find((c) => c.id === id && c.deletedAt !== null);
        if (!row) return null;
        if (nameTaken(row.name, id)) throw new RepoError("unique", "company_profiles_name");
        Object.assign(row, { deletedAt: null, deletedBy: null, updatedBy: actorId, updatedAt: new Date() });
        return copy(row);
      },
      purge: async (id) => {
        const i = data.companyProfiles.findIndex((c) => c.id === id && c.deletedAt !== null);
        if (i < 0) return false;
        // bills and advances keep pointing at it until they are changed: company_profiles is ON DELETE RESTRICT for them
        if (data.bills.some((b) => b.companyId === id) || data.advances.some((a) => a.companyId === id)) throw new RepoError("check", "company_profiles in use");
        data.companyProfiles.splice(i, 1);
        data.companies.delete(id);
        return true;
      },
    },

    customers: {
      get: async (id) => {
        const c = data.customers.find((x) => x.id === id);
        return c ? copy(c) : null;
      },
      getMany: async (ids) => new Map(data.customers.filter((c) => ids.includes(c.id)).map((c) => [c.id, copy(c)])),
      list: async (q) => paged(data.customers.filter((c) => (q.active === undefined || c.isActive === q.active) && hasEvery(customerText(c), q.words)).sort(newestFirst), q),
      counts: async (words) => {
        const rows = data.customers.filter((c) => hasEvery(customerText(c), words));
        return { all: rows.length, active: rows.filter((c) => c.isActive).length, off: rows.filter((c) => !c.isActive).length };
      },
      stats: async (monthFrom) => ({
        total: data.customers.length,
        selfSignup: data.customers.filter((c) => c.source === "self").length,
        withEmail: data.customers.filter((c) => (c.email ?? "") !== "").length,
        month: data.customers.filter((c) => c.createdAt >= monthFrom).length,
      }),
      byMobile: async (mobile) => {
        const c = data.customers.find((x) => x.mobile === mobile);
        return c ? copy(c) : null;
      },
      lookup: async (prefix, limit) =>
        data.customers.filter((c) => c.name.toLowerCase().startsWith(prefix.toLowerCase()) || c.mobile.startsWith(prefix)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit).map((c) => ({ id: c.id, name: c.name, mobile: c.mobile })),
      create: async (input) => {
        if (data.customers.some((c) => c.mobile === input.mobile)) throw new RepoError("unique", "customers_mobile");
        const now = new Date();
        const { createdBy, ...fields } = input;
        const row: CustomerRecord = { ...fields, id: randomUUID(), createdBy, updatedBy: null, createdAt: now, updatedAt: now };
        data.customers.push(row);
        return copy(row);
      },
      update: async (id, patch, actorId) => {
        const row = data.customers.find((c) => c.id === id);
        if (!row) return null;
        if (patch.mobile !== undefined && data.customers.some((c) => c.id !== id && c.mobile === patch.mobile)) throw new RepoError("unique", "customers_mobile");
        Object.assign(row, patch, { updatedBy: actorId, updatedAt: new Date() });
        return copy(row);
      },
      delete: async (id) => {
        const i = data.customers.findIndex((c) => c.id === id);
        if (i < 0) return false;
        data.customers.splice(i, 1);
        return true;
      },
    },

    marketing: {
      get: async (id) => {
        const c = data.campaigns.find((x) => x.id === id);
        return c ? copy(c) : null;
      },
      list: async (limit) => [...data.campaigns].sort(newestFirst).slice(0, limit).map(copy),
      create: async (input) => {
        const now = new Date();
        const { createdBy, ...fields } = input;
        const row: CampaignRecord = { ...fields, id: randomUUID(), status: "draft", recipients: 0, queued: 0, leftOut: 0, sentAt: null, pausedAt: null, finishedAt: null, createdBy, updatedBy: null, createdAt: now, updatedAt: now };
        data.campaigns.push(row);
        return copy(row);
      },
      update: async (id, patch, actorId) => {
        const row = data.campaigns.find((c) => c.id === id);
        if (!row) return null;
        Object.assign(row, patch, { updatedBy: actorId, updatedAt: new Date() });
        return copy(row);
      },
      delete: async (id) => {
        const i = data.campaigns.findIndex((c) => c.id === id);
        if (i < 0) return false;
        data.campaigns.splice(i, 1);
        data.campaignRecipients = data.campaignRecipients.filter((r) => r.campaignId !== id);
        return true;
      },
      begin: async (id, recipients, leftOut, at, actorId) => {
        const row = data.campaigns.find((c) => c.id === id);
        if (!row) return null;
        Object.assign(row, { status: "sending", recipients: recipients.length, leftOut, queued: 0, sentAt: at, updatedBy: actorId, updatedAt: at });
        for (const r of recipients) data.campaignRecipients.push({ id: randomUUID(), campaignId: id, email: r.email, name: r.name, at, queuedAt: null, skipped: null });
        return copy(row);
      },
      setStatus: async (id, status, at, actorId) => {
        const row = data.campaigns.find((c) => c.id === id);
        if (!row) return null;
        const patch: Partial<CampaignRecord> = status === "paused" ? { status, pausedAt: at } : status === "sending" ? { status, pausedAt: null } : { status, pausedAt: null, finishedAt: at };
        Object.assign(row, patch, actorId ? { updatedBy: actorId } : {}, { updatedAt: at });
        // the database's CHECKs (hotel 0044)
        if ((row.status === "draft") !== (row.sentAt === null) || (row.status === "paused") !== (row.pausedAt !== null) || row.queued > row.recipients) throw new RepoError("check", "mail_campaigns_state");
        return copy(row);
      },
      nextRecipients: async (campaignId, limit) =>
        data.campaignRecipients.filter((r) => r.campaignId === campaignId && r.queuedAt === null && r.skipped === null).slice(0, limit).map((r) => ({ id: r.id, email: r.email, name: r.name.trim() })),
      markQueued: async (campaignId, recipientIds, at) => {
        const ids = new Set(recipientIds);
        let n = 0;
        for (const r of data.campaignRecipients) {
          if (r.campaignId !== campaignId || !ids.has(r.id) || r.queuedAt !== null || r.skipped !== null) continue;
          r.queuedAt = at;
          n += 1;
        }
        const row = data.campaigns.find((c) => c.id === campaignId);
        if (row && n > 0) {
          row.queued += n;
          if (row.queued > row.recipients) throw new RepoError("check", "mail_campaigns_queued_max");
        }
      },
      markSkipped: async (campaignId, recipientIds, why) => {
        const ids = new Set(recipientIds);
        let n = 0;
        for (const r of data.campaignRecipients) {
          if (r.campaignId !== campaignId || !ids.has(r.id) || r.queuedAt !== null || r.skipped !== null) continue;
          r.skipped = why;
          n += 1;
        }
        const row = data.campaigns.find((c) => c.id === campaignId);
        if (row && n > 0 && why !== "cancelled") row.leftOut += n;
      },
      optedOutAmong: async (emails) => new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => data.optOuts.has(e))),
      recipients: async (campaignId) => data.campaignRecipients.filter((r) => r.campaignId === campaignId).map((r) => ({ email: r.email, name: r.name })),
      audience: async (kind) => audienceOf(kind),
      audienceCounts: async () => ({ customers: audienceOf("customers").length, companies: audienceOf("companies").length, guests: audienceOf("guests").length, all: audienceOf("all").length }),
      optOut: async (email) => void data.optOuts.add(email.trim().toLowerCase()),
      optOuts: async () => data.optOuts.size,
    },

    ledgerSource: {
      forCompany: async (companyId) => ({
        bills: withAdvanceCompany(data.bills.filter((b) => b.deletedAt === null && b.companyId === companyId)),
        advances: data.advances.filter((a) => a.deletedAt === null && a.companyId === companyId).map(copy),
      }),
      openBills: async () =>
        data.bills
          .filter((b) => b.deletedAt === null && b.companyId !== null && b.billDate && b.balanceHotelAmountPaise + b.balanceFoodAmountPaise > ZERO)
          .map((b) => ({ companyId: b.companyId as string, billDate: b.billDate, balancePaise: b.balanceHotelAmountPaise + b.balanceFoodAmountPaise })),
      // GROUP BY company_id, the way the PostgreSQL repository sums it: no ledger lines are built
      summaryByCompany: async (monthFrom) => {
        const companyOf = new Map(data.advances.map((a) => [a.id, a.companyId]));
        const out = new Map<string, LedgerSummaryRow & { dates: string[] }>();
        const row = (id: string) => {
          let r = out.get(id);
          if (!r) {
            r = { companyId: id, billedPaise: ZERO, receivedPaise: ZERO, refundedPaise: ZERO, balancePaise: ZERO, monthBilledPaise: ZERO, monthReceivedPaise: ZERO, lines: 0, lastDate: null, bills: 0, openBills: 0, dates: [] };
            out.set(id, r);
          }
          return r;
        };
        const credit = (r: ReturnType<typeof row>, date: string, amount: bigint) => {
          r.receivedPaise += amount;
          if (date >= monthFrom) r.monthReceivedPaise += amount;
          r.lines += 1;
          r.dates.push(date);
        };
        for (const a of data.advances as AdvanceRecord[]) {
          if (a.deletedAt !== null || !a.companyId) continue;
          const r = row(a.companyId);
          const paidIn = a.hotelAmountPaise + a.foodAmountPaise;
          if (!a.receiptNumber.startsWith("Excessive / ") && paidIn > ZERO && a.paymentDate) credit(r, a.paymentDate, paidIn);
          const refund = sumOf([a.hotelRefundAmountPaise, a.foodRefundAmountPaise]);
          if (a.refundPaymentDate && refund > ZERO) {
            r.refundedPaise += refund;
            r.lines += 1;
            r.dates.push(a.refundPaymentDate);
          }
        }
        for (const b of data.bills) {
          if (b.deletedAt !== null || !b.companyId) continue;
          const r = row(b.companyId);
          r.bills += 1;
          if (b.balanceHotelAmountPaise + b.balanceFoodAmountPaise > ZERO) r.openBills += 1;
          if (!b.billDate) continue;
          const total = b.totalHotelAmountPaise + b.totalFoodAmountPaise;
          r.billedPaise += total;
          if (b.billDate >= monthFrom) r.monthBilledPaise += total;
          r.lines += 1;
          r.dates.push(b.billDate);
          const fromAdvance = b.advanceHotelAmountPaise + b.advanceFoodAmountPaise;
          if (fromAdvance > ZERO && !(b.advanceId !== null && companyOf.get(b.advanceId) === b.companyId)) credit(r, b.billDate, fromAdvance);
          const due = (mode: string | null, side: bigint, taken: bigint) => (isDebit(mode) || side - taken <= ZERO ? ZERO : side - taken);
          const paid = due(b.hotelModeOfPayment, b.totalHotelAmountPaise, b.advanceHotelAmountPaise) + due(b.foodModeOfPayment, b.totalFoodAmountPaise, b.advanceFoodAmountPaise);
          if (paid > ZERO) credit(r, b.billDate, paid);
          for (const s of b.debit) {
            const amount = sumOf([s.hotelPaise, s.foodPaise]);
            if (amount > ZERO && s.date) credit(r, s.date, amount);
          }
        }
        return [...out.values()].map(({ dates, ...r }) => ({ ...r, balancePaise: r.billedPaise + r.refundedPaise - r.receivedPaise, lastDate: dates.length ? dates.reduce((m, d) => (d > m ? d : m)) : null }));
      },
    },
  };
}

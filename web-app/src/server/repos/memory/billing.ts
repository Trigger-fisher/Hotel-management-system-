import "server-only";
import { randomUUID } from "node:crypto";
import type { AccountingYear, ForceLogEntry, SystemLogEntry } from "../cashSupport";
import type {
  AdvanceFilter,
  AdvanceRecord,
  AdvanceRepo,
  AdvanceState,
  BillFilter,
  BillingRepos,
  BillRecord,
  BillRepo,
  BillState,
} from "../billing";
import { RepoError, type ListResult, type VersionedResult } from "../types";
import { activeOptionItems, type AdminData } from "./admin";
import { createMemoryUnit, MemoryStore } from "./store";

// The in-memory double of the billing repositories (test and dev). It keeps the table rules of repos/billing.ts: entry numbers (MAX+1,
// soft-deleted rows included), soft delete, the version step, unique receipt and bill numbers among live rows, no negative balance, and one
// data set per hotel (MemoryStore). It runs one unit at a time per hotel, so `forUpdate` needs nothing here. It may be stricter than the
// database, never looser.

export interface BillingData {
  advances: AdvanceRecord[];
  bills: BillRecord[];
  /** company_profiles: id -> name (soft-deleted companies included; Laravel `exists` ignores deleted_at). */
  companies: Map<string, string>;
  /** The admin's plan rates are these rows (id, note and creator are filled by Admin; a seeded row without them is given them on first touch). */
  mealPlanRates: { plan: string; effectiveFrom: string; ratePaise: bigint; id?: string; note?: string | null; createdBy?: string | null; createdAt?: Date }[];
  /** app_settings general.* and the food business unit (Pallav's defaults: site name "Hotel Pallav", food unit "Pallav Food"). */
  profile: { name: string; foodName: string; address: string | null; phone: string | null; gstin: string | null; foodGstin: string | null };
  /** Master Data lists by set key: the ACTIVE items in order. */
  options: Record<string, { value: string; label: string; isDefault: boolean }[]>;
  years: AccountingYear[];
  systemLogs: SystemLogEntry[];
  forceLogs: ForceLogEntry[];
}

export const emptyBillingData = (): BillingData => ({ advances: [], bills: [], companies: new Map(), mealPlanRates: [], profile: { name: "Hotel Pallav", foodName: "Pallav Food", address: null, phone: null, gstin: null, foodGstin: null }, options: {}, years: [], systemLogs: [], forceLogs: [] });

const ZERO = BigInt(0);
const copy = <T>(r: T): T => structuredClone(r);
const rupees = (paise: bigint): string => {
  const sign = paise < ZERO ? "-" : "";
  const abs = paise < ZERO ? -paise : paise;
  return `${sign}${abs / BigInt(100)}.${String(abs % BigInt(100)).padStart(2, "0")}`;
};
const live = (row: { deletedAt: Date | null }, deleted?: "no" | "only"): boolean => (deleted === "only") === (row.deletedAt !== null);
const lower = (s: string | null | undefined): string => (s ?? "").toLowerCase();
const hasEvery = (hay: string, words: readonly string[] | undefined): boolean => !words || words.every((w) => hay.includes(w));

interface Versioned {
  id: string;
  version: number;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

function versioned<R extends Versioned>(rows: R[], id: string, expected: number, deleted: boolean, change: (row: R) => void): VersionedResult<R> {
  const row = rows.find((r) => r.id === id);
  if (!row || (row.deletedAt !== null) !== deleted) return { ok: false, reason: "not_found" };
  if (row.version !== expected) return { ok: false, reason: "conflict", currentVersion: row.version };
  const before = copy(row);
  try {
    change(row);
  } catch (error) {
    // a CHECK refused the change: the row stays as it was (the database statement would fail as a whole)
    Object.assign(row, before);
    throw error;
  }
  row.version += 1;
  row.updatedAt = new Date();
  return { ok: true, record: copy(row) };
}

function sortValue(row: Record<string, unknown>, field: string): string | number | bigint {
  const v = row[field];
  return typeof v === "string" || typeof v === "number" || typeof v === "bigint" ? v : "";
}

function page<R extends { entryNo: number }>(rows: R[], sort: (r: R) => string | number | bigint, dir: "asc" | "desc", p: { page: number; pageSize: number }): ListResult<R> {
  const sorted = [...rows].sort((a, b) => {
    const x = sort(a);
    const y = sort(b);
    return x < y ? -1 : x > y ? 1 : a.entryNo - b.entryNo;
  });
  if (dir === "desc") sorted.reverse();
  const start = (p.page - 1) * p.pageSize;
  return { rows: sorted.slice(start, start + p.pageSize).map(copy), total: sorted.length };
}

const highestTyped = (values: readonly string[], prefix: string): number =>
  values.filter((v) => v.startsWith(prefix)).reduce((m, v) => Math.max(m, Number(v.slice(prefix.length).replace(/\D/g, "") || 0)), 0);

/* ---------------------------------------------------------------- advances */

const advanceStateOf = (a: AdvanceRecord): AdvanceState => {
  if (a.refundPaymentDate !== null) return "refunded";
  if (a.hotelAmountPaise === a.hotelBalancePaise && a.foodAmountPaise === a.foodBalancePaise) return "unused";
  return a.hotelBalancePaise + a.foodBalancePaise > ZERO ? "partly" : "used";
};

function checkAdvance(v: Partial<AdvanceRecord>): void {
  for (const key of ["hotelAmountPaise", "foodAmountPaise", "hotelBalancePaise", "foodBalancePaise", "totalPaise", "hotelRefundAmountPaise", "foodRefundAmountPaise"] as const) {
    const value = v[key];
    if (value !== undefined && value !== null && value < ZERO) throw new RepoError("check", `${key} >= 0`);
  }
  if (v.receiptNumber !== undefined && v.receiptNumber.trim() === "") throw new RepoError("check", "receipt_number not empty");
}

function memoryAdvances(data: BillingData): AdvanceRepo {
  const rows = data.advances;
  const nextNo = (): number => rows.reduce((max, r) => Math.max(max, r.entryNo), 0) + 1;
  const uniqueReceipt = (receipt: string, except: string | null): void => {
    if (rows.some((r) => r.deletedAt === null && r.id !== except && r.receiptNumber === receipt)) throw new RepoError("unique", "receipt_number");
  };
  const haystack = (a: AdvanceRecord): string =>
    lower([a.receiptNumber, a.guestName, a.mobileNumber, a.roomNumber, a.companyId ? (data.companies.get(a.companyId) ?? "") : "walk-in", a.hotelMode, a.foodMode, rupees(a.hotelAmountPaise + a.foodAmountPaise)].join(" "));
  const inFilter = (a: AdvanceRecord, f: AdvanceFilter): boolean => {
    if (!live(a, f.deleted)) return false;
    if (f.from || f.to) {
      const inWindow = (!f.from || a.paymentDate >= f.from) && (!f.to || a.paymentDate <= f.to);
      // older advances still holding money are carried forward into the years on screen (BillMasterController.php:105-123)
      const carried = !!f.from && a.paymentDate < f.from && a.refundPaymentDate === null && a.hotelBalancePaise + a.foodBalancePaise > ZERO;
      if (!inWindow && !carried) return false;
    }
    if (f.month && !a.paymentDate.startsWith(f.month)) return false;
    if (f.mode && lower(a.hotelMode) !== lower(f.mode) && lower(a.foodMode) !== lower(f.mode)) return false;
    if (f.company === "walkin" ? a.companyId !== null : f.company !== undefined && a.companyId !== f.company) return false;
    if (f.side === "hotel" && !(a.hotelAmountPaise > ZERO)) return false;
    if (f.side === "food" && !(a.foodAmountPaise > ZERO)) return false;
    return hasEvery(haystack(a), f.words);
  };
  const sortOf = (field: string) => (a: AdvanceRecord): string | number | bigint => {
    if (field === "totalAmountPaise") return a.hotelAmountPaise + a.foodAmountPaise;
    if (field === "balancePaise") return a.hotelBalancePaise + a.foodBalancePaise;
    return sortValue(a as unknown as Record<string, unknown>, field);
  };

  return {
    async get(id, options) {
      const row = rows.find((r) => r.id === id);
      return row && (row.deletedAt !== null) === (options?.deleted === true) ? copy(row) : null;
    },
    async byReceipt(receiptNumber) {
      const row = rows.find((r) => r.deletedAt === null && r.receiptNumber === receiptNumber);
      return row ? copy(row) : null;
    },
    async allByReceipt(receiptNumber) {
      return rows.filter((r) => r.deletedAt === null && r.receiptNumber === receiptNumber).map(copy);
    },
    async list(query) {
      return page(rows.filter((a) => inFilter(a, query) && (!query.state || advanceStateOf(a) === query.state)), sortOf(query.sort), query.dir, query);
    },
    async countByState(filter) {
      const counts: Record<AdvanceState, number> = { unused: 0, partly: 0, used: 0, refunded: 0 };
      for (const a of rows) if (inFilter(a, filter)) counts[advanceStateOf(a)] += 1;
      return counts;
    },
    async figures(monthFrom, monthTo) {
      const all = rows.filter((r) => r.deletedAt === null);
      const sum = (list: AdvanceRecord[], f: (a: AdvanceRecord) => bigint): bigint => list.reduce((n, a) => n + f(a), ZERO);
      return {
        monthTakenPaise: sum(all.filter((a) => a.paymentDate >= monthFrom && a.paymentDate <= monthTo), (a) => a.hotelAmountPaise + a.foodAmountPaise),
        heldPaise: sum(all.filter((a) => a.refundPaymentDate === null), (a) => a.hotelBalancePaise + a.foodBalancePaise),
        unusedCount: all.filter((a) => advanceStateOf(a) === "unused").length,
        refundedPaise: sum(all.filter((a) => a.refundPaymentDate !== null), (a) => (a.hotelRefundAmountPaise ?? ZERO) + (a.foodRefundAmountPaise ?? ZERO)),
        all: all.length,
      };
    },
    async options() {
      const all = rows.filter((r) => r.deletedAt === null);
      const modes = new Set<string>();
      for (const a of all) for (const m of [a.hotelMode, a.foodMode]) if (m) modes.add(m);
      return {
        modes: [...modes].sort(),
        companyIds: [...new Set(all.flatMap((a) => (a.companyId ? [a.companyId] : [])))],
        months: [...new Set(all.map((a) => a.paymentDate.slice(0, 7)))].sort().reverse(),
      };
    },
    // the model uses SoftDeletes, so recycle-binned numbers are left out of the suggestion
    async highestTyped(prefix) {
      return highestTyped(rows.filter((r) => r.deletedAt === null).map((r) => r.receiptNumber), prefix);
    },
    async byReservation(reservationIds) {
      const out = new Map<string, AdvanceRecord[]>();
      for (const id of reservationIds) out.set(id, []);
      for (const a of [...rows].sort((x, y) => (x.paymentDate < y.paymentDate ? -1 : x.paymentDate > y.paymentDate ? 1 : x.entryNo - y.entryNo))) {
        if (a.deletedAt === null && a.reservationId && out.has(a.reservationId)) out.get(a.reservationId)?.push(copy(a));
      }
      return out;
    },
    async open(limit) {
      return rows
        .filter((r) => r.deletedAt === null && r.hotelBalancePaise + r.foodBalancePaise > ZERO)
        .sort((a, b) => a.guestName.localeCompare(b.guestName) || a.entryNo - b.entryNo)
        .slice(0, limit)
        .map(copy);
    },
    async create(input) {
      checkAdvance(input);
      uniqueReceipt(input.receiptNumber, null);
      const now = new Date();
      const { createdBy, ...fields } = input;
      const row: AdvanceRecord = { ...fields, id: randomUUID(), entryNo: nextNo(), createdBy, updatedBy: null, deletedAt: null, deletedBy: null, createdAt: now, updatedAt: now, version: 1 };
      rows.push(row);
      return copy(row);
    },
    async update(id, expectedVersion, patch, actorId) {
      checkAdvance(patch);
      if (patch.receiptNumber !== undefined) uniqueReceipt(patch.receiptNumber, id);
      return versioned(rows, id, expectedVersion, false, (row) => {
        Object.assign(row, patch, { updatedBy: actorId });
        checkAdvance(row);
      });
    },
    async softDelete(id, expectedVersion, actorId) {
      return versioned(rows, id, expectedVersion, false, (row) => Object.assign(row, { deletedAt: new Date(), deletedBy: actorId }));
    },
    async restore(id, expectedVersion, actorId) {
      const row = rows.find((r) => r.id === id);
      if (row && row.deletedAt !== null) uniqueReceipt(row.receiptNumber, id);
      return versioned(rows, id, expectedVersion, true, (r) => Object.assign(r, { deletedAt: null, deletedBy: null, updatedBy: actorId }));
    },
    async purge(id) {
      const index = rows.findIndex((r) => r.id === id && r.deletedAt !== null);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  };
}

/* ---------------------------------------------------------------- bills */

const isDebitMode = (mode: string | null): boolean => lower(mode) === "debit";
const billStateOf = (b: Pick<BillRecord, "hotelModeOfPayment" | "foodModeOfPayment" | "debit" | "balanceHotelAmountPaise" | "balanceFoodAmountPaise">): BillState => {
  if (!isDebitMode(b.hotelModeOfPayment) && !isDebitMode(b.foodModeOfPayment)) return "paid";
  // H6 part payments: a bill with a settlement that still owes is "due" until it is cleared
  return b.debit[0].date !== null && b.balanceHotelAmountPaise + b.balanceFoodAmountPaise <= ZERO ? "settled" : "due";
};

function checkBill(v: Partial<BillRecord>): void {
  for (const key of ["balanceHotelAmountPaise", "balanceFoodAmountPaise", "advanceHotelAmountPaise", "advanceFoodAmountPaise", "advanceDeleteHotelAmountPaise", "advanceDeleteFoodAmountPaise", "planFoodAmountPaise"] as const) {
    const value = v[key];
    if (value !== undefined && value < ZERO) throw new RepoError("check", `${key} >= 0`);
  }
  if (v.billNumber !== undefined && v.billNumber.trim() === "") throw new RepoError("check", "bill_number not empty");
  if (v.arrivalAt && v.departureAt && v.departureAt < v.arrivalAt) throw new RepoError("check", "departure_at >= arrival_at");
  for (const key of ["hotelSac", "foodSac"] as const) {
    const value = v[key];
    if (value !== undefined && !/^[0-9]{4,8}$/.test(value)) throw new RepoError("check", `${key} is 4-8 digits`);
  }
}

function memoryBills(data: BillingData): BillRepo {
  const rows = data.bills;
  const nextNo = (): number => rows.reduce((max, r) => Math.max(max, r.entryNo), 0) + 1;
  const uniqueNumber = (n: string, except: string | null): void => {
    if (rows.some((r) => r.deletedAt === null && r.id !== except && r.billNumber === n)) throw new RepoError("unique", "bill_number");
  };
  const haystack = (b: BillRecord): string =>
    lower([b.billNumber, b.grNumber, b.guestName, b.mobileNumber, b.roomNumber, b.companyId ? (data.companies.get(b.companyId) ?? "") : "walk-in", b.hotelModeOfPayment, b.foodModeOfPayment, rupees(b.totalHotelAmountPaise + b.totalFoodAmountPaise)].join(" "));
  const inFilter = (b: BillRecord, f: BillFilter): boolean => {
    if (!live(b, f.deleted)) return false;
    if (f.from || f.to) {
      const inWindow = (!f.from || b.billDate >= f.from) && (!f.to || b.billDate <= f.to);
      // older debit bills still owed are carried forward (BillMasterController.php:306-309)
      const carried = !!f.from && b.billDate < f.from && (b.debit[0].date === null || b.balanceHotelAmountPaise + b.balanceFoodAmountPaise > ZERO) && (isDebitMode(b.hotelModeOfPayment) || isDebitMode(b.foodModeOfPayment));
      if (!inWindow && !carried) return false;
    }
    if (f.month && !b.billDate.startsWith(f.month)) return false;
    if (f.mode && lower(b.hotelModeOfPayment) !== lower(f.mode) && lower(b.foodModeOfPayment) !== lower(f.mode)) return false;
    if (f.company === "walkin" ? b.companyId !== null : f.company !== undefined && b.companyId !== f.company) return false;
    if (f.side === "hotel" && !(b.totalHotelAmountPaise > ZERO || b.balanceHotelAmountPaise > ZERO)) return false;
    if (f.side === "food" && !(b.totalFoodAmountPaise > ZERO || b.balanceFoodAmountPaise > ZERO)) return false;
    return hasEvery(haystack(b), f.words);
  };
  const sortOf = (field: string) => (b: BillRecord): string | number | bigint => {
    if (field === "totalPaise") return b.totalHotelAmountPaise + b.totalFoodAmountPaise;
    if (field === "balancePaise") return b.balanceHotelAmountPaise + b.balanceFoodAmountPaise;
    return sortValue(b as unknown as Record<string, unknown>, field);
  };

  return {
    async get(id, options) {
      const row = rows.find((r) => r.id === id);
      return row && (row.deletedAt !== null) === (options?.deleted === true) ? copy(row) : null;
    },
    async guestsOf() {
      return new Map();
    },
    async getMany(ids) {
      return new Map(rows.filter((r) => r.deletedAt === null && ids.includes(r.id)).map((r) => [r.id, copy(r)]));
    },
    async byNumber(billNumber) {
      const row = rows.find((r) => r.deletedAt === null && r.billNumber === billNumber);
      return row ? copy(row) : null;
    },
    async list(query) {
      return page(rows.filter((b) => inFilter(b, query) && (!query.state || billStateOf(b) === query.state)), sortOf(query.sort), query.dir, query);
    },
    async countByState(filter) {
      const counts: Record<BillState, number> = { paid: 0, due: 0, settled: 0 };
      for (const b of rows) if (inFilter(b, filter)) counts[billStateOf(b)] += 1;
      return counts;
    },
    async figures(monthFrom, monthTo) {
      const all = rows.filter((r) => r.deletedAt === null);
      const sum = (list: BillRecord[], f: (b: BillRecord) => bigint): bigint => list.reduce((n, b) => n + f(b), ZERO);
      const received = (b: BillRecord): bigint => b.debit.reduce((n, s) => n + (s.hotelPaise ?? ZERO) + (s.foodPaise ?? ZERO), ZERO);
      const month = all.filter((b) => b.billDate >= monthFrom && b.billDate <= monthTo);
      return {
        monthCount: month.length,
        monthBilledPaise: sum(month, (b) => b.totalHotelAmountPaise + b.totalFoodAmountPaise),
        owedPaise: sum(all, (b) => b.balanceHotelAmountPaise + b.balanceFoodAmountPaise),
        dueCount: all.filter((b) => billStateOf(b) === "due").length,
        settledPaise: sum(all.filter((b) => billStateOf(b) === "settled"), received),
        all: all.length,
      };
    },
    async options() {
      const all = rows.filter((r) => r.deletedAt === null);
      const modes = new Set<string>();
      for (const b of all) for (const m of [b.hotelModeOfPayment, b.foodModeOfPayment]) if (m) modes.add(m);
      return {
        modes: [...modes].sort(),
        companyIds: [...new Set(all.flatMap((b) => (b.companyId ? [b.companyId] : [])))],
        months: [...new Set(all.map((b) => b.billDate.slice(0, 7)))].sort().reverse(),
      };
    },
    async numbersByAdvance(advanceIds) {
      const out = new Map<string, string[]>();
      for (const id of advanceIds) out.set(id, []);
      for (const b of rows) if (b.deletedAt === null && b.advanceId && out.has(b.advanceId)) out.get(b.advanceId)?.push(b.billNumber);
      return out;
    },
    async highestTyped(prefix) {
      return highestTyped(rows.filter((r) => r.deletedAt === null).map((r) => r.billNumber), prefix);
    },
    async takenFromAdvance(advanceId) {
      const claim = rows.filter((b) => b.deletedAt === null && b.advanceId === advanceId);
      return { hotelPaise: claim.reduce((n, b) => n + b.advanceHotelAmountPaise, ZERO), foodPaise: claim.reduce((n, b) => n + b.advanceFoodAmountPaise, ZERO) };
    },
    async create(input) {
      checkBill(input);
      uniqueNumber(input.billNumber, null);
      const now = new Date();
      const { createdBy, ...fields } = input;
      const row: BillRecord = { ...copy(fields), id: randomUUID(), entryNo: nextNo(), createdBy, updatedBy: null, deletedAt: null, deletedBy: null, createdAt: now, updatedAt: now, version: 1 };
      rows.push(row);
      return copy(row);
    },
    async update(id, expectedVersion, patch, actorId) {
      checkBill(patch);
      if (patch.billNumber !== undefined) uniqueNumber(patch.billNumber, id);
      return versioned(rows, id, expectedVersion, false, (row) => {
        Object.assign(row, copy(patch), { updatedBy: actorId });
        checkBill(row);
      });
    },
    async softDelete(id, expectedVersion, actorId) {
      return versioned(rows, id, expectedVersion, false, (row) => Object.assign(row, { deletedAt: new Date(), deletedBy: actorId }));
    },
    async restore(id, expectedVersion, actorId) {
      const row = rows.find((r) => r.id === id);
      if (row && row.deletedAt !== null) uniqueNumber(row.billNumber, id);
      return versioned(rows, id, expectedVersion, true, (r) => Object.assign(r, { deletedAt: null, deletedBy: null, updatedBy: actorId }));
    },
    async purge(id) {
      const index = rows.findIndex((r) => r.id === id && r.deletedAt !== null);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  };
}

/* ---------------------------------------------------------------- the unit */

export function bindBillingRepos(data: BillingData): BillingRepos {
  return {
    advances: memoryAdvances(data),
    bills: memoryBills(data),
    companies: {
      exists: async (id) => data.companies.has(id),
      names: async (ids) => new Map(ids.flatMap((id) => (data.companies.has(id) ? [[id, data.companies.get(id) as string] as const] : []))),
      list: async (limit) => [...data.companies].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit),
    },
    mealPlanRates: { table: async () => [...data.mealPlanRates].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0)).map(copy) },
    hotelProfile: {
      header: async () => copy(data.profile),
      gstDefaults: async () => {
        const settings = (data as BillingData & { settings?: Map<string, string | null> }).settings;
        return { hotelPercent: settings?.get("checkout.hotel_gst_percent") ?? null, foodPercent: settings?.get("checkout.food_gst_percent") ?? null };
      },
    },
    optionLists: { items: async (setKey) => activeOptionItems(data as BillingData & Partial<AdminData>, setKey) },
    accountingYears: { list: async () => data.years.map(copy) },
    // `at` is when the line was written (the website overview shows the latest changes); not part of the entry the services build
    systemLogs: { write: async (entry) => void data.systemLogs.push({ ...copy(entry), at: new Date() } as typeof entry) },
    forceLogs: { write: async (entry) => void data.forceLogs.push(copy(entry)) },
  };
}

/** The in-memory billing unit and its store (tests look inside a hotel's data through `store.dataFor`). */
export function createMemoryBilling() {
  const store = new MemoryStore<BillingData>(emptyBillingData);
  return { store, unit: createMemoryUnit(store, bindBillingRepos) };
}

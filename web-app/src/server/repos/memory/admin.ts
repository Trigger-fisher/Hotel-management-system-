import "server-only";
import { randomUUID } from "node:crypto";
import type { RazorpayOrderInput, RazorpayRefundInput, AdminRepos, CatalogCategoryRecord, CatalogItemRecord, OptionItemFields, OptionItemRecord, OptionSetRecord, PlanRateRecord, RazorpayBook, RazorpayListQuery, RazorpayPaymentRecord, SettingRow } from "../admin";
import type { MenuItemRecord } from "../menu";
import { RepoError } from "../types";
import type { BillingData } from "./billing";

// The in-memory double of the admin repositories, in the SAME per-hotel data as billing: plan rates ARE billing's `mealPlanRates` (a bill is priced
// from them), the option lists feed billing's `optionLists`, and the general settings that print on a bill (site name, address, phone, GSTINs) are
// mirrored into billing's `profile`, which is what a bill's header reads. Spec: docs/specs/admin.md.

export interface AdminData {
  appSettings: Map<string, SettingRow>;
  optionSetRows: OptionSetRecord[];
  optionItemRows: OptionItemRecord[];
  /** The expense catalogue (expense_categories with their expense_items). */
  catalogRows: (CatalogCategoryRecord & { sortOrder: number })[];
  /** The room-service menu (menu_items). */
  menuRows: MenuItemRecord[];
  /** Online payments received through Razorpay and the webhook calls behind them. */
  razorpayPayments: RazorpayPaymentRecord[];
  razorpayEvents: { business: RazorpayBook; eventId: string | null; event: string; signatureOk: boolean; payload: unknown; ip: string | null; receivedAt: Date }[];
  /** Refunds and orders (kinds of the one razorpay_records table). */
  razorpayRefunds: (RazorpayRefundInput & { id: string; createdAt: Date })[];
  razorpayOrders: (RazorpayOrderInput & { id: string; createdAt: Date })[];
}

/** Where a payment status sits on the way from asked to refunded; a late, older event (a lower rank) never moves a payment backwards. The same order as the SQL in postgres/admin.ts. */
const PAY_RANK = (status: string): number => ["created", "authorized", "failed", "captured", "refunded"].indexOf(status) + 1;
export const emptyAdminData =(): AdminData => ({ appSettings: new Map(), optionSetRows: [], optionItemRows: [], catalogRows: [], menuRows: [], razorpayPayments: [], razorpayEvents: [], razorpayRefunds: [], razorpayOrders: [] });

const copy = <T>(r: T): T => structuredClone(r);
const byOrder = (a: { sortOrder: number; label?: string; name?: string }, b: { sortOrder: number; label?: string; name?: string }): number =>
  a.sortOrder - b.sortOrder || (a.label ?? a.name ?? "").localeCompare(b.label ?? b.name ?? "");

/** The settings that print on a bill, kept in step with billing's header (the SQL double reads app_settings for both). */
const PROFILE_KEYS: Record<string, keyof BillingData["profile"]> = {
  "general.site_name": "name",
  "general.address": "address",
  "general.support_phone": "phone",
  "billing.hotel_gstin": "gstin",
  "billing.food_gstin": "foodGstin",
  "general.food_name": "foodName",
};

type Data = BillingData & AdminData;

export function bindAdmin(data: Data): AdminRepos {
  const sorted = (setId: string): OptionItemRecord[] => data.optionItemRows.filter((i) => i.setId === setId).sort(byOrder);
  const cats = (): (CatalogCategoryRecord & { sortOrder: number })[] => (data.catalogRows ??= []);
  const view = (c: CatalogCategoryRecord): CatalogCategoryRecord => copy({ id: c.id, business: c.business, name: c.name, items: c.items });
  const menu = (): MenuItemRecord[] => (data.menuRows ??= []);
  const inGroup = (group: string): MenuItemRecord[] => menu().filter((x) => x.group === group).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const checkMenu = (name: string, price: bigint): void => {
    if (name.trim().length === 0 || name.length > 120 || price < BigInt(0)) throw new RepoError("check", "menu_items_check");
  };
  const pays = (): RazorpayPaymentRecord[] => (data.razorpayPayments ??= []);
  const events = () => (data.razorpayEvents ??= []);
  const matches = (p: RazorpayPaymentRecord, q: Omit<RazorpayListQuery, "page" | "pageSize">): boolean => {
    if (q.business && p.business !== q.business) return false;
    if (q.status === "attention" ? !["failed", "authorized"].includes(p.status) : q.status && p.status !== q.status) return false;
    if (q.method && p.method !== q.method) return false;
    const words = (q.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const hay = [p.paymentId, p.orderId, p.email, p.contact, p.description, (p.amountPaise / 100).toString(), ...Object.values(p.notes)].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const newest = (a: RazorpayPaymentRecord, b: RazorpayPaymentRecord): number => (b.paidAt ?? b.createdAt).getTime() - (a.paidAt ?? a.createdAt).getTime();
  return {
    razorpay: {
      upsertPayment: async (i) => {
        const at = pays().findIndex((p) => p.business === i.business && p.paymentId === i.paymentId);
        const before = at >= 0 ? pays()[at] : null;
        const now = new Date();
        const next: RazorpayPaymentRecord = {
          id: before?.id ?? randomUUID(), business: i.business, paymentId: i.paymentId, orderId: i.orderId ?? before?.orderId ?? null, status: PAY_RANK(i.status) >= PAY_RANK(before?.status ?? "") ? i.status : (before?.status ?? i.status), lastEvent: i.lastEvent, method: i.method ?? before?.method ?? null,
          amountPaise: i.amountPaise, amountRefundedPaise: Math.max(i.amountRefundedPaise, before?.amountRefundedPaise ?? 0), feePaise: i.feePaise ?? before?.feePaise ?? null, taxPaise: i.taxPaise ?? before?.taxPaise ?? null,
          email: i.email ?? before?.email ?? null, contact: i.contact ?? before?.contact ?? null, description: i.description ?? before?.description ?? null, errorDescription: i.errorDescription, notes: { ...(before?.notes ?? {}), ...i.notes },
          payload: i.payload, paidAt: i.paidAt ?? before?.paidAt ?? null, createdAt: before?.createdAt ?? i.createdAt ?? now, updatedAt: now,
        };
        if (at >= 0) pays()[at] = next;
        else pays().push(next);
        return copy(next);
      },
      recordEvent: async (e) => {
        if (e.eventId !== null && events().some((x) => x.eventId === e.eventId)) return false;
        events().push({ ...copy(e), receivedAt: new Date() });
        return true;
      },
      list: async (q) => {
        const all = pays().filter((p) => matches(p, q)).sort(newest);
        return { items: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(copy), total: all.length };
      },
      get: async (business, paymentId) => copy(pays().find((p) => p.business === business && p.paymentId === paymentId) ?? null),
      getMany: async (business, paymentIds) => pays().filter((p) => p.business === business && paymentIds.includes(p.paymentId)).map(copy),
      stats: async (todayFrom, monthFrom) => {
        const paid = pays().filter((p) => p.paidAt !== null && ["captured", "refunded"].includes(p.status));
        const sum = (from: Date) => paid.filter((p) => p.paidAt! >= from).reduce((n, p) => n + p.amountPaise, 0);
        return {
          todayPaise: sum(todayFrom), monthPaise: sum(monthFrom), failed: pays().filter((p) => p.status === "failed").length,
          refundedPaise: pays().filter((p) => p.updatedAt >= monthFrom).reduce((n, p) => n + p.amountRefundedPaise, 0), rejected: events().filter((e) => !e.signatureOk).length,
        };
      },
      counts: async () => ({ hotel: pays().filter((p) => p.business === "hotel").length, food: pays().filter((p) => p.business === "food").length }),
      recordRefund: async (i) => {
        if (!pays().some((p) => p.business === i.business && p.paymentId === i.paymentId)) return false;
        const rows = (data.razorpayRefunds ??= []);
        const at = rows.findIndex((r) => r.business === i.business && r.refundId === i.refundId);
        if (at >= 0) rows[at] = { ...rows[at], ...copy(i) };
        else rows.push({ ...copy(i), id: randomUUID(), createdAt: new Date() });
        return true;
      },
      recordOrder: async (i) => {
        const rows = (data.razorpayOrders ??= []);
        const at = rows.findIndex((r) => r.business === i.business && r.ref === i.ref);
        if (at >= 0) rows[at] = { ...rows[at], ...copy(i) };
        else rows.push({ ...copy(i), id: randomUUID(), createdAt: new Date() });
      },
      // the in-memory hotel keeps no company or customer list here: a named party is taken as it is (the Postgres repo is the one that checks)
      partyNames: async (i) => ({ company: i.companyId ? "Company" : null, customer: i.customerId ? "Customer" : null }),
      markOrderPaid: async (business, ref) => {
        const o = (data.razorpayOrders ??= []).find((r) => r.business === business && r.ref === ref);
        if (o) o.status = "paid";
      },
      lastEvent: async () => {
        const last = (b: RazorpayBook): Date | null => events().filter((e) => e.business === b && e.signatureOk).reduce<Date | null>((m, e) => (m === null || e.receivedAt > m ? e.receivedAt : m), null);
        return { hotel: last("hotel"), food: last("food") };
      },
    },
    menuItems: {
      list: async () => menu().map(copy).sort((a, b) => a.group.localeCompare(b.group) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      get: async (id) => {
        const x = menu().find((i) => i.id === id);
        return x ? copy(x) : null;
      },
      create: async (group, f) => {
        checkMenu(f.name, f.pricePaise);
        if (menu().some((i) => i.group === group && i.name.toLowerCase() === f.name.toLowerCase())) throw new RepoError("unique", "menu_items_group_name_key");
        const x: MenuItemRecord = { id: randomUUID(), group, name: f.name, note: f.note, pricePaise: f.pricePaise, available: f.available, sortOrder: menu().filter((i) => i.group === group).reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1, category: f.category ?? null, veg: f.veg ?? "unknown", imageFile: null };
        menu().push(x);
        return copy(x);
      },
      update: async (id, f) => {
        const x = menu().find((i) => i.id === id);
        if (!x) return null;
        checkMenu(f.name, f.pricePaise);
        if (menu().some((i) => i.id !== id && i.group === x.group && i.name.toLowerCase() === f.name.toLowerCase())) throw new RepoError("unique", "menu_items_group_name_key");
        Object.assign(x, { name: f.name, note: f.note, pricePaise: f.pricePaise, available: f.available, ...(f.category !== undefined ? { category: f.category } : {}), ...(f.veg !== undefined ? { veg: f.veg } : {}) });
        return copy(x);
      },
      setImage: async (id, imageFile) => {
        const x = menu().find((i) => i.id === id);
        if (!x) return null;
        const before = copy(x);
        x.imageFile = imageFile;
        return before;
      },
      remove: async (id) => {
        const at = menu().findIndex((i) => i.id === id);
        if (at < 0) return false;
        menu().splice(at, 1);
        return true;
      },
      swap: async (id, direction) => {
        const x = menu().find((i) => i.id === id);
        if (!x) return false;
        const list = inGroup(x.group);
        list.forEach((i, n) => (i.sortOrder = n + 1));
        const at = list.indexOf(x);
        const other = list[direction === "up" ? at - 1 : at + 1];
        if (!other) return false;
        [x.sortOrder, other.sortOrder] = [other.sortOrder, x.sortOrder];
        return true;
      },
    },
    expenseCatalog: {
      categories: async (business) => cats().filter((c) => c.business === business).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(view),
      category: async (id) => {
        const c = cats().find((x) => x.id === id);
        return c ? view(c) : null;
      },
      createCategory: async (business, name) => {
        // the database's UNIQUE (business, name) and the 80-character column
        if (name.length === 0 || name.length > 80) throw new RepoError("check", "expense_categories_name_check");
        if (cats().some((c) => c.business === business && c.name === name)) throw new RepoError("unique", "expense_categories_business_name_key");
        const c = { id: randomUUID(), business, name, items: [], sortOrder: cats().filter((x) => x.business === business).reduce((m, x) => Math.max(m, x.sortOrder), 0) + 1 };
        cats().push(c);
        return view(c);
      },
      renameCategory: async (id, name) => {
        const c = cats().find((x) => x.id === id);
        if (!c) return null;
        if (name.length === 0 || name.length > 80) throw new RepoError("check", "expense_categories_name_check");
        if (cats().some((x) => x.id !== id && x.business === c.business && x.name === name)) throw new RepoError("unique", "expense_categories_business_name_key");
        c.name = name;
        return view(c);
      },
      removeCategory: async (id) => {
        const at = cats().findIndex((x) => x.id === id);
        if (at < 0) return false;
        cats().splice(at, 1);
        return true;
      },
      item: async (id) => {
        for (const c of cats()) {
          const item = c.items.find((i) => i.id === id);
          if (item) return { item: copy(item), category: view(c) };
        }
        return null;
      },
      createItem: async (categoryId, name, pricePaise) => {
        const c = cats().find((x) => x.id === categoryId);
        if (!c) throw new RepoError("check", "expense_items_expense_category_id_fkey");
        if (name.length === 0 || name.length > 80 || pricePaise < BigInt(0)) throw new RepoError("check", "expense_items_check");
        if (c.items.some((i) => i.name === name)) throw new RepoError("unique", "expense_items_expense_category_id_name_key");
        const item: CatalogItemRecord = { id: randomUUID(), categoryId, name, pricePaise };
        c.items.push(item);
        return copy(item);
      },
      updateItem: async (id, fields) => {
        for (const c of cats()) {
          const item = c.items.find((i) => i.id === id);
          if (!item) continue;
          if (fields.name.length === 0 || fields.name.length > 80 || fields.pricePaise < BigInt(0)) throw new RepoError("check", "expense_items_check");
          if (c.items.some((i) => i.id !== id && i.name === fields.name)) throw new RepoError("unique", "expense_items_expense_category_id_name_key");
          item.name = fields.name;
          item.pricePaise = fields.pricePaise;
          return copy(item);
        }
        return null;
      },
      removeItem: async (id) => {
        for (const c of cats()) {
          const at = c.items.findIndex((i) => i.id === id);
          if (at >= 0) {
            c.items.splice(at, 1);
            return true;
          }
        }
        return false;
      },
    },
    adminSettings: {
      get: async (keys) => keys.flatMap((k) => (data.appSettings.has(k) ? [copy(data.appSettings.get(k)!)] : [])),
      set: async (rows) => {
        for (const row of rows) {
          data.appSettings.set(row.key, copy({ ...row, updatedAt: new Date() }));
          const profileKey = PROFILE_KEYS[row.key];
          if (profileKey && !row.secret) {
            const v = row.value === null || row.value === "" ? null : row.value;
            (data.profile as Record<string, string | null>)[profileKey] = profileKey === "name" || profileKey === "foodName" ? (v ?? (profileKey === "name" ? "Hotel Pallav" : "Pallav Food")) : v;
          }
        }
      },
    },

    planRates: {
      list: async () => planRows(data).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0)).map(copy),
      get: async (id) => copy(planRows(data).find((r) => r.id === id) ?? null),
      upsert: async (rate, by) => {
        const rows = data.mealPlanRates;
        const at = rows.findIndex((r) => r.plan.toLowerCase() === rate.plan.toLowerCase() && r.effectiveFrom === rate.effectiveFrom);
        const before = at >= 0 ? copy(planRows(data)[at]) : null;
        const next = { id: before?.id ?? randomUUID(), plan: before?.plan ?? rate.plan, effectiveFrom: rate.effectiveFrom, ratePaise: rate.ratePaise, note: rate.note, createdBy: by, createdAt: before?.createdAt ?? new Date() };
        if (at >= 0) rows[at] = next;
        else rows.push(next);
        return { record: copy(next as PlanRateRecord), created: at < 0, before };
      },
      remove: async (id) => {
        const at = data.mealPlanRates.findIndex((r) => r.id === id);
        if (at < 0) return false;
        data.mealPlanRates.splice(at, 1);
        return true;
      },
      planFoodOwed: async (from, to) => data.bills.filter((b) => b.billDate >= from && b.billDate < to).reduce((t, b) => t + b.planFoodAmountPaise, BigInt(0)),
    },

    optionSets: {
      sets: async () => data.optionSetRows.slice().sort(byOrder).map(copy),
      setByKey: async (key) => copy(data.optionSetRows.find((s) => s.key === key) ?? null),
      items: async (setId) => sorted(setId).map(copy),
      item: async (id) => copy(data.optionItemRows.find((i) => i.id === id) ?? null),
      valueTaken: async (setId, value, except) => data.optionItemRows.some((i) => i.setId === setId && i.id !== except && i.value.toLowerCase() === value.toLowerCase()),
      createItem: async (setId, fields: OptionItemFields) => {
        const sortOrder = data.optionItemRows.filter((i) => i.setId === setId).reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1;
        const row: OptionItemRecord = { id: randomUUID(), setId, sortOrder, ...fields };
        data.optionItemRows.push(row);
        return copy(row);
      },
      updateItem: async (id, patch) => {
        const row = data.optionItemRows.find((i) => i.id === id);
        if (!row) throw new Error("no such option");
        Object.assign(row, patch);
        return copy(row);
      },
      clearDefaultsExcept: async (setId, itemId) => {
        for (const i of data.optionItemRows) if (i.setId === setId && i.id !== itemId) i.isDefault = false;
      },
      swap: async (itemId, direction) => {
        const item = data.optionItemRows.find((i) => i.id === itemId);
        if (!item) return false;
        const list = sorted(item.setId);
        const at = list.findIndex((i) => i.id === itemId);
        const other = list[direction === "up" ? at - 1 : at + 1];
        if (!other) return false;
        const a = data.optionItemRows.find((i) => i.id === item.id)!;
        const b = data.optionItemRows.find((i) => i.id === other.id)!;
        [a.sortOrder, b.sortOrder] = [b.sortOrder, a.sortOrder];
        return true;
      },
      removeItem: async (id) => {
        const at = data.optionItemRows.findIndex((i) => i.id === id);
        if (at < 0) return false;
        data.optionItemRows.splice(at, 1);
        return true;
      },
      removeSet: async (id) => {
        const at = data.optionSetRows.findIndex((s) => s.id === id);
        if (at < 0) return false;
        data.optionSetRows.splice(at, 1);
        data.optionItemRows = data.optionItemRows.filter((i) => i.setId !== id);
        return true;
      },
    },
  };
}

/** The plan rates as full records: a rate seeded by a test without an id is given one on first touch. */
function planRows(data: BillingData): PlanRateRecord[] {
  for (const r of data.mealPlanRates) {
    r.id ??= randomUUID();
    r.note ??= null;
    r.createdBy ??= null;
    r.createdAt ??= new Date(0);
  }
  return data.mealPlanRates as PlanRateRecord[];
}

/** What billing's forms read: the ACTIVE items of a list in order, from the admin lists when there is one, else the seeded `options`. */
export function activeOptionItems(data: BillingData & Partial<AdminData>, setKey: string): { value: string; label: string; isDefault: boolean }[] {
  const set = data.optionSetRows?.find((s) => s.key === setKey);
  if (!set) return (data.options[setKey] ?? []).map(copy);
  return (data.optionItemRows ?? []).filter((i) => i.setId === set.id && i.isActive).sort(byOrder).map((i) => ({ value: i.value, label: i.label, isDefault: i.isDefault }));
}

import "server-only";
import type { MenuRepo } from "./menu";

// The business side of Admin (Pallav MasterDataController, MealPlanRateController, SettingsController, then users and roles): option lists,
// plan rates and settings. Plain records in and out, no SQL. Rules every implementation keeps: an option's value is unique within its list;
// one price per plan per date; a setting key is unique (app_settings) and a secret setting is stored as typed and never returned by any API (the apps get a "set" flag).
// The in-memory double is repos/memory/admin.ts. Spec: docs/specs/admin.md.

/* ---------------------------------------------------------------- settings (app_settings) */

export interface SettingRow {
  key: string;
  /** Plain text as typed (a secret is never returned by any API). null = not set. */
  value: string | null;
  secret: boolean;
  /** When the row was last written (read side only; a write ignores it). */
  updatedAt?: Date | null;
}

interface SettingRepo {
  /** The rows for these keys that exist. */
  get(keys: readonly string[]): Promise<SettingRow[]>;
  /** Writes each row (insert or replace by key). A key given with value null clears it. */
  set(rows: readonly SettingRow[], by: string): Promise<void>;
}

/* ---------------------------------------------------------------- plan rates */

export interface PlanRateRecord {
  id: string;
  /** The plan's value from the hotel_plan list ("CP"). */
  plan: string;
  effectiveFrom: string;
  /** Per person per night, in paise. */
  ratePaise: bigint;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface PlanRateRepo {
  /** Every rate, newest effective date first. */
  list(): Promise<PlanRateRecord[]>;
  get(id: string): Promise<PlanRateRecord | null>;
  /** One price per plan per date (the unique key): a second one for the same date replaces it; the caller learns which it did. */
  upsert(rate: { plan: string; effectiveFrom: string; ratePaise: bigint; note: string | null }, by: string): Promise<{ record: PlanRateRecord; created: boolean; before: PlanRateRecord | null }>;
  remove(id: string): Promise<boolean>;
  /** This month's plan-food owed: sum of the bills' plan-food amount over bills dated in [from, to) (Pallav panelData `owedThisMonth`). */
  planFoodOwed(from: string, to: string): Promise<bigint>;
}

/* ---------------------------------------------------------------- option lists (Master Data) */

export interface OptionSetRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  input: "select" | "radio" | "checkbox";
  /** Used by the app itself: it cannot be removed (its items can still change). */
  isSystem: boolean;
  sortOrder: number;
}

export interface OptionItemRecord {
  id: string;
  setId: string;
  label: string;
  value: string;
  color: string | null;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
}

export interface OptionItemFields {
  label: string;
  value: string;
  color: string | null;
  isActive: boolean;
  isDefault: boolean;
}

interface OptionSetRepo {
  /** Every list in its order (sort_order, then name). */
  sets(): Promise<OptionSetRecord[]>;
  setByKey(key: string): Promise<OptionSetRecord | null>;
  /** A list's items in order (sort_order, then label). */
  items(setId: string): Promise<OptionItemRecord[]>;
  item(id: string): Promise<OptionItemRecord | null>;
  /** An item with this value already on the list (case-insensitive, as Pallav's collation and the unique key), other than `except`. */
  valueTaken(setId: string, value: string, except?: string): Promise<boolean>;
  /** Added last (sort_order = max + 1). */
  createItem(setId: string, fields: OptionItemFields): Promise<OptionItemRecord>;
  updateItem(id: string, patch: Partial<OptionItemFields>): Promise<OptionItemRecord>;
  /** Only one option of a list is pre-selected: clears every other default of the set. */
  clearDefaultsExcept(setId: string, itemId: string): Promise<void>;
  /** Swaps the sort order of two items (up or down one place); false when there is nowhere to go. */
  swap(itemId: string, direction: "up" | "down"): Promise<boolean>;
  removeItem(id: string): Promise<boolean>;
  removeSet(id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- the unit */

/* ---------------------------------------------------------------- expense catalogue (expense_categories, expense_items) */

export interface CatalogItemRecord {
  id: string;
  categoryId: string;
  name: string;
  /** Paise, 0 and up. */
  pricePaise: bigint;
}

export interface CatalogCategoryRecord {
  id: string;
  business: "hotel" | "food";
  name: string;
  /** In the list's order (sort_order, then name). */
  items: CatalogItemRecord[];
}

/**
 * The expense catalogue of both businesses (Pallav ExpenseCatalogController): categories (no price) with priced items. Hard delete (marked in the
 * template): removing a category removes its items; expenses already recorded keep what they were saved with. Names are unique per business (category)
 * and per category (item) in the database; the service also compares them case-insensitively.
 */
export interface ExpenseCatalogRepo {
  /** Every category of a business with its items. */
  categories(business: "hotel" | "food"): Promise<CatalogCategoryRecord[]>;
  category(id: string): Promise<CatalogCategoryRecord | null>;
  createCategory(business: "hotel" | "food", name: string): Promise<CatalogCategoryRecord>;
  renameCategory(id: string, name: string): Promise<CatalogCategoryRecord | null>;
  /** false when there was no such category. Its items go with it. */
  removeCategory(id: string): Promise<boolean>;
  /** The item and the category it sits in. */
  item(id: string): Promise<{ item: CatalogItemRecord; category: CatalogCategoryRecord } | null>;
  createItem(categoryId: string, name: string, pricePaise: bigint): Promise<CatalogItemRecord>;
  updateItem(id: string, fields: { name: string; pricePaise: bigint }): Promise<CatalogItemRecord | null>;
  removeItem(id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- online payments (razorpay_records: payments, events, refunds, orders) */

export type RazorpayBook = "hotel" | "food";

export interface RazorpayPaymentRecord {
  id: string;
  business: RazorpayBook;
  paymentId: string;
  orderId: string | null;
  /** Razorpay's own word: created, authorized, captured, failed, refunded. */
  status: string;
  lastEvent: string;
  method: string | null;
  amountPaise: number;
  amountRefundedPaise: number;
  feePaise: number | null;
  taxPaise: number | null;
  email: string | null;
  contact: string | null;
  description: string | null;
  errorDescription: string | null;
  notes: Record<string, string>;
  payload: unknown;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RazorpayPaymentInput {
  business: RazorpayBook;
  paymentId: string;
  orderId: string | null;
  status: string;
  lastEvent: string;
  method: string | null;
  amountPaise: number;
  amountRefundedPaise: number;
  currency: string;
  feePaise: number | null;
  taxPaise: number | null;
  email: string | null;
  contact: string | null;
  description: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  notes: Record<string, string>;
  payload: unknown;
  paidAt: Date | null;
  createdAt: Date | null;
}

export interface RazorpayListQuery {
  business?: RazorpayBook;
  /** Razorpay's status word, or "attention" for failed and authorized-but-not-captured payments. */
  status?: string;
  method?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface RazorpayRepo {
  /** Insert, or update the payment with this (business, payment id). A later event never lowers the refunded amount. */
  upsertPayment(input: RazorpayPaymentInput): Promise<RazorpayPaymentRecord>;
  /** Keep one webhook call. false when this event id was already kept (Razorpay sends an event more than once). */
  recordEvent(e: { business: RazorpayBook; eventId: string | null; event: string; signatureOk: boolean; payload: unknown; ip: string | null }): Promise<boolean>;
  list(q: RazorpayListQuery): Promise<{ items: RazorpayPaymentRecord[]; total: number }>;
  get(business: RazorpayBook, paymentId: string): Promise<RazorpayPaymentRecord | null>;
  /** The stored payments among these ids, ONE read; unknown ids are simply absent. */
  getMany(business: RazorpayBook, paymentIds: readonly string[]): Promise<RazorpayPaymentRecord[]>;
  /** Paise captured since `todayFrom` and `monthFrom`, payments failed, paise refunded this month, and webhook calls whose signature was wrong. */
  stats(todayFrom: Date, monthFrom: Date): Promise<{ todayPaise: number; monthPaise: number; failed: number; refundedPaise: number; rejected: number }>;
  counts(): Promise<Record<RazorpayBook, number>>;
  /** When the last webhook call of each business arrived. */
  lastEvent(): Promise<Record<RazorpayBook, Date | null>>;
  /** Keep a refund (kind refund of the one razorpay_records table), made from HMS or seen in a refund webhook. false when the payment is not known here. A repeat of the same refund id updates it. */
  recordRefund(i: RazorpayRefundInput): Promise<boolean>;
  /** Keep what a guest or company was asked to pay (kind order): a payment link, or a Razorpay order. */
  recordOrder(i: RazorpayOrderInput): Promise<void>;
  /** The order (or payment link) was paid. */
  markOrderPaid(business: RazorpayBook, ref: string): Promise<void>;
  /** The names of the company / customer a payment link is for, or null for one that does not exist in this hotel. */
  partyNames(i: { companyId?: string; customerId?: string }): Promise<{ company: string | null; customer: string | null }>;
}

export interface RazorpayRefundInput {
  business: RazorpayBook;
  paymentId: string;
  refundId: string;
  amountPaise: number;
  /** Razorpay's word: created, pending, processed, failed. */
  status: string;
  speed: string | null;
  reason: string | null;
  note: string | null;
  byUserId: string | null;
}

export interface RazorpayOrderInput {
  business: RazorpayBook;
  /** Who it is for (a company or a customer of this hotel) and the bill it settles. */
  companyId?: string | null;
  customerId?: string | null;
  /** Razorpay's order id (order_...) or payment link id (plink_...). */
  ref: string;
  amountPaise: number;
  status: string;
  description: string | null;
  url: string | null;
  billRef: string | null;
  byUserId: string | null;
}

export interface AdminRepos {
  razorpay: RazorpayRepo;
  menuItems: MenuRepo;
  adminSettings: SettingRepo;
  planRates: PlanRateRepo;
  optionSets: OptionSetRepo;
  expenseCatalog: ExpenseCatalogRepo;
}

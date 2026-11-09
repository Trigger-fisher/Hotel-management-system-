import "server-only";
// The business side of Admin on PostgreSQL: settings (app_settings), plan rates (meal_plan_rates) and the Master Data option lists. The in-memory
// double (repos/memory/admin.ts) is the reference for every rule.
import { toBigInt } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type { AdminRepos, CatalogCategoryRecord, CatalogItemRecord, OptionItemRecord, OptionSetRecord, PlanRateRecord, RazorpayListQuery, RazorpayPaymentRecord } from "../admin";
import { RepoError, type Unit } from "../types";
import { asDate, asText, guard } from "./shared";
import { pgMenuRepo } from "./menu";
import { createPgUnit } from "./unit";

type Row = Record<string, unknown>;

const rateOf = (r: Row): PlanRateRecord => ({
  id: String(r.id), plan: String(r.plan), effectiveFrom: String(r.effective_from), ratePaise: toBigInt(r.rate_per_person_paise), note: asText(r.note), createdBy: asText(r.created_by), createdAt: asDate(r.created_at) as Date,
});
const setOf = (r: Row): OptionSetRecord => ({
  id: String(r.id), key: String(r.key), name: String(r.name), description: asText(r.description), icon: asText(r.icon), input: r.input as OptionSetRecord["input"], isSystem: r.is_system === true, sortOrder: Number(r.sort_order),
});
const itemOf = (r: Row): OptionItemRecord => ({
  id: String(r.id), setId: String(r.option_set_id), label: String(r.label), value: String(r.value), color: asText(r.color), isActive: r.is_active === true, isDefault: r.is_default === true, sortOrder: Number(r.sort_order),
});

const catalogItemOf = (r: Row): CatalogItemRecord => ({ id: String(r.id), categoryId: String(r.expense_category_id), name: String(r.name), pricePaise: toBigInt(r.price_paise) });
const categoryOf = (r: Row, items: CatalogItemRecord[]): CatalogCategoryRecord => ({ id: String(r.id), business: r.business === "food" ? "food" : "hotel", name: String(r.name), items });

export function pgAdminRepos(tx: TxClient): AdminRepos {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  const ordered = async (setId: string): Promise<OptionItemRecord[]> => (await q('SELECT * FROM option_items WHERE option_set_id = $1 ORDER BY sort_order, label COLLATE "C", id', [setId])).rows.map(itemOf);

  const categoryById = async (id: string): Promise<CatalogCategoryRecord | null> => {
    const c = await q("SELECT * FROM expense_categories WHERE id = $1", [id]);
    if (!c.rows[0]) return null;
    const items = await q('SELECT * FROM expense_items WHERE expense_category_id = $1 ORDER BY sort_order, name COLLATE "C", id', [id]);
    return categoryOf(c.rows[0], items.rows.map(catalogItemOf));
  };

  const payOf = (r: Row): RazorpayPaymentRecord => ({
    id: String(r.id), business: r.business === "food" ? "food" : "hotel", paymentId: String(r.ref), orderId: asText(r.parent_ref), status: asText(r.status) ?? "created", lastEvent: asText(r.event) ?? "",
    method: asText(r.method), amountPaise: Number(r.amount_paise), amountRefundedPaise: Number(r.amount_refunded_paise), feePaise: r.fee_paise === null ? null : Number(r.fee_paise), taxPaise: r.tax_paise === null ? null : Number(r.tax_paise),
    email: asText(r.email), contact: asText(r.contact), description: asText(r.description), errorDescription: asText(r.error_description),
    notes: r.notes && typeof r.notes === "object" ? Object.fromEntries(Object.entries(r.notes as Row).map(([k, v]) => [k, String(v)])) : {}, payload: r.payload ?? null,
    paidAt: asDate(r.occurred_at), createdAt: asDate(r.created_at) as Date, updatedAt: asDate(r.updated_at) as Date,
  });
  // the filters of the payments list, as one WHERE and its values
  const payWhere = (f: Omit<RazorpayListQuery, "page" | "pageSize">): { sql: string; args: unknown[] } => {
    const args: unknown[] = [];
    const where: string[] = ["kind = 'payment'"];
    const arg = (v: unknown): string => `$${args.push(v)}`;
    if (f.business) where.push(`business = ${arg(f.business)}`);
    if (f.status === "attention") where.push("status IN ('failed', 'authorized')");
    else if (f.status) where.push(`status = ${arg(f.status)}`);
    if (f.method) where.push(`method = ${arg(f.method)}`);
    for (const w of (f.search ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
      const like = arg(`%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(ref ILIKE ${like} OR parent_ref ILIKE ${like} OR email ILIKE ${like} OR contact ILIKE ${like} OR description ILIKE ${like} OR (amount_paise / 100)::text = ${arg(w)} OR notes::text ILIKE ${like})`);
    }
    return { sql: `WHERE ${where.join(" AND ")}`, args };
  };
  return {
    razorpay: {
      async upsertPayment(i) {
        const r = await q(
          `INSERT INTO razorpay_records (kind, business, ref, parent_ref, status, event, method, amount_paise, amount_refunded_paise, currency, fee_paise, tax_paise, email, contact, description, error_code, error_description, notes, payload, occurred_at, created_at)
           VALUES ('payment', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19, COALESCE($20, now()))
           ON CONFLICT (kind, business, ref) WHERE ref IS NOT NULL DO UPDATE SET
             parent_ref = COALESCE(EXCLUDED.parent_ref, razorpay_records.parent_ref), status = CASE WHEN COALESCE(array_position(ARRAY['created','authorized','failed','captured','refunded'], EXCLUDED.status), 0) >= COALESCE(array_position(ARRAY['created','authorized','failed','captured','refunded'], razorpay_records.status), 0) THEN EXCLUDED.status ELSE razorpay_records.status END, event = EXCLUDED.event, method = COALESCE(EXCLUDED.method, razorpay_records.method),
             amount_paise = EXCLUDED.amount_paise, amount_refunded_paise = GREATEST(EXCLUDED.amount_refunded_paise, razorpay_records.amount_refunded_paise),
             fee_paise = COALESCE(EXCLUDED.fee_paise, razorpay_records.fee_paise), tax_paise = COALESCE(EXCLUDED.tax_paise, razorpay_records.tax_paise),
             email = COALESCE(EXCLUDED.email, razorpay_records.email), contact = COALESCE(EXCLUDED.contact, razorpay_records.contact), description = COALESCE(EXCLUDED.description, razorpay_records.description),
             error_code = EXCLUDED.error_code, error_description = EXCLUDED.error_description, notes = COALESCE(razorpay_records.notes, '{}'::jsonb) || COALESCE(EXCLUDED.notes, '{}'::jsonb),
             payload = EXCLUDED.payload, occurred_at = COALESCE(EXCLUDED.occurred_at, razorpay_records.occurred_at)
           RETURNING *`,
          [i.business, i.paymentId, i.orderId, i.status, i.lastEvent, i.method, i.amountPaise, i.amountRefundedPaise, i.currency, i.feePaise, i.taxPaise, i.email, i.contact, i.description, i.errorCode, i.errorDescription, JSON.stringify(i.notes), JSON.stringify(i.payload ?? null), i.paidAt, i.createdAt],
        );
        return payOf(r.rows[0] as Row);
      },
      async recordEvent(e) {
        const r = await q(
          "INSERT INTO razorpay_records (kind, business, ref, event, signature_ok, payload, ip_address, occurred_at) VALUES ('event', $1, $2, $3, $4, $5::jsonb, $6, now()) ON CONFLICT (kind, business, ref) WHERE ref IS NOT NULL DO NOTHING RETURNING id",
          [e.business, e.eventId, e.event.slice(0, 60), e.signatureOk, JSON.stringify(e.payload ?? null), e.ip],
        );
        return r.rows.length > 0;
      },
      async list(f) {
        const { sql, args } = payWhere(f);
        const total = await q(`SELECT count(*)::int AS n FROM razorpay_records ${sql}`, args);
        const rows = await q(`SELECT * FROM razorpay_records ${sql} ORDER BY COALESCE(occurred_at, created_at) DESC, id DESC LIMIT ${Number(f.pageSize)} OFFSET ${(Number(f.page) - 1) * Number(f.pageSize)}`, args);
        return { items: rows.rows.map((r) => payOf(r as Row)), total: Number((total.rows[0] as Row).n) };
      },
      async get(business, paymentId) {
        const r = await q("SELECT * FROM razorpay_records WHERE kind = 'payment' AND business = $1 AND ref = $2", [business, paymentId]);
        return r.rows[0] ? payOf(r.rows[0] as Row) : null;
      },
      async getMany(business, paymentIds) {
        if (paymentIds.length === 0) return [];
        const r = await q("SELECT * FROM razorpay_records WHERE kind = 'payment' AND business = $1 AND ref = ANY($2::text[])", [business, paymentIds]);
        return r.rows.map((x) => payOf(x as Row));
      },
      async stats(todayFrom, monthFrom) {
        const r = await q(
          `SELECT
             COALESCE(SUM(amount_paise) FILTER (WHERE status IN ('captured','refunded') AND occurred_at >= $1), 0)::bigint AS today,
             COALESCE(SUM(amount_paise) FILTER (WHERE status IN ('captured','refunded') AND occurred_at >= $2), 0)::bigint AS month,
             count(*) FILTER (WHERE status = 'failed')::int AS failed,
             COALESCE(SUM(amount_refunded_paise) FILTER (WHERE updated_at >= $2), 0)::bigint AS refunded
           FROM razorpay_records WHERE kind = 'payment'`,
          [todayFrom, monthFrom],
        );
        const bad = await q("SELECT count(*)::int AS n FROM razorpay_records WHERE kind = 'event' AND signature_ok = false");
        const x = r.rows[0] as Row;
        return { todayPaise: Number(x.today), monthPaise: Number(x.month), failed: Number(x.failed), refundedPaise: Number(x.refunded), rejected: Number((bad.rows[0] as Row).n) };
      },
      async counts() {
        const r = await q("SELECT business, count(*)::int AS n FROM razorpay_records WHERE kind = 'payment' GROUP BY business");
        const n = (b: string): number => Number((r.rows.find((x) => (x as Row).business === b) as Row | undefined)?.n ?? 0);
        return { hotel: n("hotel"), food: n("food") };
      },
      async recordRefund(i) {
        const p = await q("SELECT id FROM razorpay_records WHERE kind = 'payment' AND business = $1 AND ref = $2", [i.business, i.paymentId]);
        if (p.rows.length === 0) return false;
        await q(
          `INSERT INTO razorpay_records (kind, business, ref, parent_id, parent_ref, amount_paise, status, speed, reason, note, created_by, occurred_at)
           VALUES ('refund', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           ON CONFLICT (kind, business, ref) WHERE ref IS NOT NULL DO UPDATE SET status = EXCLUDED.status, speed = COALESCE(EXCLUDED.speed, razorpay_records.speed), reason = COALESCE(EXCLUDED.reason, razorpay_records.reason), note = COALESCE(EXCLUDED.note, razorpay_records.note)`,
          [i.business, i.refundId, String((p.rows[0] as Row).id), i.paymentId, i.amountPaise, i.status, i.speed, i.reason, i.note, i.byUserId],
        );
        return true;
      },
      async recordOrder(i) {
        await q(
          `INSERT INTO razorpay_records (kind, business, ref, amount_paise, status, description, url, bill_ref, created_by, company_id, customer_id, occurred_at)
           VALUES ('order', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           ON CONFLICT (kind, business, ref) WHERE ref IS NOT NULL DO UPDATE SET status = EXCLUDED.status, url = COALESCE(EXCLUDED.url, razorpay_records.url)`,
          [i.business, i.ref, i.amountPaise, i.status, i.description, i.url, i.billRef, i.byUserId, i.companyId ?? null, i.customerId ?? null],
        );
      },
      async partyNames(i) {
        const company = i.companyId ? await q("SELECT name FROM company_profiles WHERE id = $1 AND deleted_at IS NULL", [i.companyId]) : null;
        const customer = i.customerId ? await q("SELECT name FROM customers WHERE id = $1", [i.customerId]) : null;
        return { company: company?.rows[0] ? String((company.rows[0] as Row).name) : null, customer: customer?.rows[0] ? String((customer.rows[0] as Row).name) : null };
      },
      async markOrderPaid(business, ref) {
        await q("UPDATE razorpay_records SET status = 'paid' WHERE kind = 'order' AND business = $1 AND ref = $2", [business, ref]);
      },
      async lastEvent() {
        const r = await q("SELECT business, max(created_at) AS at FROM razorpay_records WHERE kind = 'event' AND signature_ok GROUP BY business");
        const at = (b: string): Date | null => asDate((r.rows.find((x) => (x as Row).business === b) as Row | undefined)?.at);
        return { hotel: at("hotel"), food: at("food") };
      },
    },
    menuItems: pgMenuRepo(tx),
    adminSettings: {
      async get(keys) {
        if (keys.length === 0) return [];
        const r = await q("SELECT key, value, is_secret, updated_at FROM app_settings WHERE key = ANY($1::text[]) ORDER BY key", [keys]);
        return r.rows.map((x) => ({ key: String(x.key), value: x.value === null ? null : String(x.value), secret: x.is_secret === true, updatedAt: x.updated_at instanceof Date ? x.updated_at : x.updated_at ? new Date(String(x.updated_at)) : null }));
      },
      async set(rows) {
        if (rows.length === 0) return;
        await guard(
          q(
            `INSERT INTO app_settings (key, value, is_secret) SELECT * FROM unnest($1::text[], $2::text[], $3::boolean[])
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_secret = EXCLUDED.is_secret`,
            [rows.map((r) => r.key), rows.map((r) => r.value), rows.map((r) => r.secret)],
          ),
        );
      },
    },

    planRates: {
      async list() {
        return (await q("SELECT * FROM meal_plan_rates ORDER BY effective_from DESC, created_at DESC, id DESC")).rows.map(rateOf);
      },
      async get(id) {
        const r = await q("SELECT * FROM meal_plan_rates WHERE id = $1", [id]);
        return r.rows[0] ? rateOf(r.rows[0]) : null;
      },
      async upsert(rate, by) {
        // one price per plan per date: a second one replaces it and keeps the plan's first spelling, the row and its creation moment
        const existing = await q("SELECT * FROM meal_plan_rates WHERE lower(plan) = lower($1) AND effective_from = $2 FOR UPDATE", [rate.plan, rate.effectiveFrom]);
        if (existing.rows[0]) {
          const before = rateOf(existing.rows[0]);
          const r = await guard(q("UPDATE meal_plan_rates SET rate_per_person_paise = $2, note = $3, created_by = $4, updated_by = $4 WHERE id = $1 RETURNING *", [before.id, rate.ratePaise.toString(), rate.note, by]));
          return { record: rateOf(r.rows[0]), created: false, before };
        }
        const r = await guard(q("INSERT INTO meal_plan_rates (plan, rate_per_person_paise, effective_from, note, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *", [rate.plan, rate.ratePaise.toString(), rate.effectiveFrom, rate.note, by]));
        return { record: rateOf(r.rows[0]), created: true, before: null };
      },
      async remove(id) {
        return (await q("DELETE FROM meal_plan_rates WHERE id = $1", [id])).affectedRows > 0;
      },
      async planFoodOwed(from, to) {
        const r = await q("SELECT COALESCE(SUM(plan_food_amount_paise), 0) AS n FROM bill_master_bills WHERE deleted_at IS NULL AND bill_date >= $1 AND bill_date < $2", [from, to]);
        return toBigInt(r.rows[0].n);
      },
    },

    expenseCatalog: {
      async categories(business) {
        const cats = await q('SELECT * FROM expense_categories WHERE business = $1 ORDER BY sort_order, name COLLATE "C", id', [business]);
        if (cats.rows.length === 0) return [];
        const items = await q('SELECT * FROM expense_items WHERE expense_category_id = ANY($1::uuid[]) ORDER BY sort_order, name COLLATE "C", id', [cats.rows.map((c) => String(c.id))]);
        return cats.rows.map((c) => categoryOf(c, items.rows.filter((i) => String(i.expense_category_id) === String(c.id)).map(catalogItemOf)));
      },
      category: (id) => categoryById(id),
      async createCategory(business, name) {
        const r = await guard(
          q("INSERT INTO expense_categories (business, name, sort_order) VALUES ($1::text, $2, COALESCE((SELECT MAX(sort_order) FROM expense_categories WHERE business = $1::text), 0) + 1) RETURNING *", [business, name]),
        );
        return categoryOf(r.rows[0], []);
      },
      async renameCategory(id, name) {
        const r = await guard(q("UPDATE expense_categories SET name = $2 WHERE id = $1 RETURNING id", [id, name]));
        if (!r.rows[0]) return null;
        return categoryById(id);
      },
      async removeCategory(id) {
        return (await q("DELETE FROM expense_categories WHERE id = $1", [id])).affectedRows > 0;
      },
      async item(id) {
        const r = await q("SELECT expense_category_id FROM expense_items WHERE id = $1", [id]);
        if (!r.rows[0]) return null;
        const category = await categoryById(String(r.rows[0].expense_category_id));
        const item = category?.items.find((i) => i.id === id);
        return category && item ? { item, category } : null;
      },
      async createItem(categoryId, name, pricePaise) {
        const r = await guard(
          q("INSERT INTO expense_items (expense_category_id, name, price_paise, sort_order) VALUES ($1::uuid, $2, $3, COALESCE((SELECT MAX(sort_order) FROM expense_items WHERE expense_category_id = $1::uuid), 0) + 1) RETURNING *", [categoryId, name, pricePaise.toString()]),
        );
        return catalogItemOf(r.rows[0]);
      },
      async updateItem(id, fields) {
        const r = await guard(q("UPDATE expense_items SET name = $2, price_paise = $3 WHERE id = $1 RETURNING *", [id, fields.name, fields.pricePaise.toString()]));
        return r.rows[0] ? catalogItemOf(r.rows[0]) : null;
      },
      async removeItem(id) {
        return (await q("DELETE FROM expense_items WHERE id = $1", [id])).affectedRows > 0;
      },
    },

    optionSets: {
      async sets() {
        return (await q('SELECT * FROM option_sets ORDER BY sort_order, name COLLATE "C", id')).rows.map(setOf);
      },
      async setByKey(key) {
        const r = await q("SELECT * FROM option_sets WHERE key = $1", [key]);
        return r.rows[0] ? setOf(r.rows[0]) : null;
      },
      async items(setId) {
        return ordered(setId);
      },
      async item(id) {
        const r = await q("SELECT * FROM option_items WHERE id = $1", [id]);
        return r.rows[0] ? itemOf(r.rows[0]) : null;
      },
      async valueTaken(setId, value, except) {
        const r = await q("SELECT 1 AS x FROM option_items WHERE option_set_id = $1 AND lower(value) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1", [setId, value, except ?? null]);
        return r.rows.length > 0;
      },
      async createItem(setId, fields) {
        const r = await guard(
          q(
            `INSERT INTO option_items (option_set_id, label, value, color, is_active, is_default, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT MAX(sort_order) FROM option_items WHERE option_set_id = $1), 0) + 1) RETURNING *`,
            [setId, fields.label, fields.value, fields.color, fields.isActive, fields.isDefault],
          ),
        );
        return itemOf(r.rows[0]);
      },
      async updateItem(id, patch) {
        const map: Record<string, string> = { label: "label", value: "value", color: "color", isActive: "is_active", isDefault: "is_default" };
        const sets: string[] = [];
        const params: unknown[] = [id];
        for (const [field, value] of Object.entries(patch)) {
          if (value === undefined || !map[field]) continue;
          params.push(value);
          sets.push(`${map[field]} = $${params.length}`);
        }
        const r = await guard(q(`UPDATE option_items SET ${sets.length ? sets.join(", ") : "id = id"} WHERE id = $1 RETURNING *`, params));
        if (!r.rows[0]) throw new RepoError("check", "no such option");
        return itemOf(r.rows[0]);
      },
      async clearDefaultsExcept(setId, itemId) {
        await q("UPDATE option_items SET is_default = false WHERE option_set_id = $1 AND id <> $2 AND is_default", [setId, itemId]);
      },
      async swap(itemId, direction) {
        const item = await q("SELECT option_set_id FROM option_items WHERE id = $1", [itemId]);
        if (!item.rows[0]) return false;
        const list = await ordered(String(item.rows[0].option_set_id));
        const at = list.findIndex((i) => i.id === itemId);
        const other = list[direction === "up" ? at - 1 : at + 1];
        if (!other) return false;
        await q("UPDATE option_items SET sort_order = CASE id WHEN $1::uuid THEN $4::int WHEN $2::uuid THEN $3::int END WHERE id IN ($1::uuid, $2::uuid)", [list[at].id, other.id, list[at].sortOrder, other.sortOrder]);
        return true;
      },
      async removeItem(id) {
        return (await q("DELETE FROM option_items WHERE id = $1", [id])).affectedRows > 0;
      },
      async removeSet(id) {
        return (await guard(q("DELETE FROM option_sets WHERE id = $1", [id]))).affectedRows > 0;
      },
    },
  };
}

export function createPgAdminUnit(withHotel: WithHotel): Unit<AdminRepos> {
  return createPgUnit(withHotel, pgAdminRepos);
}

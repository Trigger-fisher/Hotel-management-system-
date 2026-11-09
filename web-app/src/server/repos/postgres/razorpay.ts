import "server-only";
// Problems with online payments on PostgreSQL: a dispute is a row of kind dispute in razorpay_records (hotel migration 0054), the one table for everything Razorpay does.
// A guest or company session sees only its own rows (row-level security).
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type { DisputeKind, DisputeStatus, RazorpayDisputeRecord, RazorpayDisputeRepo, RazorpayPaymentRecord, RazorpayRepos } from "../razorpay";
import type { Unit } from "../types";
import { asDate, asText } from "./shared";
import { pgCashSupport } from "./support";
import { createPgUnit } from "./unit";

type Row = Record<string, unknown>;
const T = "razorpay_records";

const paymentOf = (r: Row): RazorpayPaymentRecord => ({
  id: String(r.id),
  business: r.business === "food" ? "food" : "hotel",
  paymentId: String(r.ref),
  status: String(r.status ?? "created"),
  method: asText(r.method),
  amountPaise: Number(r.amount_paise),
  amountRefundedPaise: Number(r.amount_refunded_paise),
  description: asText(r.description),
  paidAt: asDate(r.occurred_at),
  createdAt: asDate(r.created_at) as Date,
});
const disputeOf = (r: Row): RazorpayDisputeRecord => ({
  id: String(r.id),
  number: String(r.ref),
  business: r.business === "food" ? "food" : "hotel",
  paymentId: String(r.parent_ref),
  kind: String(r.reason) as DisputeKind,
  status: String(r.status) as DisputeStatus,
  title: String(r.title),
  message: String(r.message),
  amountPaise: r.amount_paise === null || r.amount_paise === undefined || Number(r.amount_paise) === 0 ? null : Number(r.amount_paise),
  customerId: asText(r.customer_id),
  companyId: asText(r.company_id),
  reply: asText(r.reply),
  repliedAt: asDate(r.replied_at),
  repliedByName: asText(r.replied_by_name),
  createdAt: asDate(r.created_at) as Date,
});

export function pgRazorpayDisputeRepo(tx: TxClient): RazorpayDisputeRepo {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  return {
    async paymentOf(business, paymentId) {
      const r = await q(`SELECT * FROM ${T} WHERE kind = 'payment' AND business = $1 AND ref = $2`, [business, paymentId]);
      return r.rows[0] ? paymentOf(r.rows[0] as Row) : null;
    },

    async create(i) {
      // the number is eight random hex characters from the new row's own id; the unique index would refuse a repeat
      const r = await q(
        `WITH n AS (SELECT uuidv7() AS id)
         INSERT INTO ${T} (id, kind, business, ref, parent_id, parent_ref, reason, status, title, message, amount_paise, customer_id, company_id, created_by, occurred_at)
         SELECT n.id, 'dispute', $1, 'RD-' || upper(right(replace(n.id::text, '-', ''), 8)), $2, $3, $4, 'open', $5, $6, COALESCE($7, 0), $8, $9, $10, now() FROM n
         RETURNING *`,
        [i.business, i.payment.id, i.payment.paymentId, i.kind, i.title, i.message, i.amountPaise, i.customerId, i.companyId, i.byUserId],
      );
      return disputeOf(r.rows[0] as Row);
    },

    async get(id, opts) {
      const r = await q(`SELECT * FROM ${T} WHERE kind = 'dispute' AND id = $1${opts?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
      return r.rows[0] ? disputeOf(r.rows[0] as Row) : null;
    },

    async list(query) {
      const where = ["kind = 'dispute'"];
      const params: unknown[] = [];
      if (query.status && query.status !== "all") {
        params.push(query.status);
        where.push(`status = $${params.length}`);
      }
      if (query.paymentId) {
        params.push(query.paymentId);
        where.push(`parent_ref = $${params.length}`);
      }
      const cond = `WHERE ${where.join(" AND ")}`;
      const total = Number((await q(`SELECT count(*) AS n FROM ${T} ${cond}`, params)).rows[0].n);
      const rows = await q(`SELECT * FROM ${T} ${cond} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, query.pageSize, (query.page - 1) * query.pageSize]);
      return { items: rows.rows.map(disputeOf), total };
    },

    async respond(id, input) {
      const r = await q(
        `UPDATE ${T} SET status = $2, reply = COALESCE($3, reply), replied_at = $4, replied_by = $5, replied_by_name = $6 WHERE kind = 'dispute' AND id = $1 AND status IN ('open', 'answered') RETURNING *`,
        [id, input.status, input.reply, input.at, input.by.id, input.by.name],
      );
      return r.rows[0] ? disputeOf(r.rows[0] as Row) : null;
    },

    async hotelName() {
      const r = await q("SELECT value FROM app_settings WHERE key = 'general.site_name'");
      return asText((r.rows[0] as Row | undefined)?.value)?.trim() || "Your hotel";
    },

    async addresseesOf(d) {
      if (!d.customerId && !d.companyId) return [];
      const r = await q(
        `SELECT email, name FROM (
           SELECT lower(trim(email)) AS email, name, 1 AS src FROM customers WHERE id = $1::uuid
           UNION ALL SELECT lower(trim(email)), name, 1 FROM company_profiles WHERE id = $2::uuid AND deleted_at IS NULL
           UNION ALL SELECT lower(trim(c->>'email')), COALESCE(NULLIF(trim(c->>'name'), ''), p.name), 2 FROM company_profiles p, jsonb_array_elements(COALESCE(p.contacts, '[]'::jsonb)) c WHERE p.id = $2::uuid AND p.deleted_at IS NULL
         ) a
         WHERE email IS NOT NULL AND email <> '' AND position('@' in email) > 1 AND NOT EXISTS (SELECT 1 FROM mail_optouts o WHERE lower(o.email) = a.email)
         ORDER BY src, email`,
        [d.customerId, d.companyId],
      );
      const seen = new Set<string>();
      const out: { email: string; name: string }[] = [];
      for (const x of r.rows) {
        const email = String(x.email);
        if (seen.has(email) || out.length >= 3) continue;
        seen.add(email);
        out.push({ email, name: (asText(x.name) ?? "").trim() });
      }
      return out;
    },

    async withdraw(id) {
      const r = await q(`UPDATE ${T} SET status = 'withdrawn' WHERE kind = 'dispute' AND id = $1 AND status = 'open' RETURNING *`, [id]);
      return r.rows[0] ? disputeOf(r.rows[0] as Row) : null;
    },

    async listPayments(query) {
      const where = ["kind = 'payment'"];
      const params: unknown[] = [];
      if (query.status) {
        params.push(query.status);
        where.push(`status = $${params.length}`);
      }
      const cond = `WHERE ${where.join(" AND ")}`;
      const total = Number((await q(`SELECT count(*) AS n FROM ${T} ${cond}`, params)).rows[0].n);
      const rows = await q(`SELECT * FROM ${T} ${cond} ORDER BY COALESCE(occurred_at, created_at) DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, query.pageSize, (query.page - 1) * query.pageSize]);
      return { items: rows.rows.map(paymentOf), total };
    },
  };
}
export function pgRazorpayRepos(tx: TxClient): RazorpayRepos {
  return { disputes: pgRazorpayDisputeRepo(tx), systemLogs: pgCashSupport(tx).systemLogs };
}

export function createPgRazorpayUnit(withHotel: WithHotel): Unit<RazorpayRepos> {
  return createPgUnit(withHotel, pgRazorpayRepos);
}
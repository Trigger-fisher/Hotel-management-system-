import "server-only";
// Support requests on PostgreSQL (repos/supportRequests.ts; the in-memory double repos/memory/supportRequests.ts is the reference). Values only through $n; a guest's transaction sees only
// its own customer's requests through the row-level security of migration 0042.
import type { TxClient } from "../../../db/types";
import type { SupportRepo, SupportRequestRecord, SupportStatus } from "../supportRequests";
import { asDate, asText, countTotal, guard, wordsCondition } from "./shared";

type Row = Record<string, unknown>;

const supportOf = (r: Row): SupportRequestRecord => ({
  id: String(r.id),
  number: String(r.number),
  customerId: asText(r.customer_id),
  guestName: String(r.guest_name),
  subject: String(r.subject),
  message: String(r.message),
  billRef: asText(r.bill_ref),
  orderRef: asText(r.order_ref),
  status: r.status as SupportStatus,
  reply: asText(r.reply),
  repliedAt: asDate(r.replied_at),
  repliedBy: asText(r.replied_by),
  repliedByName: asText(r.replied_by_name),
  createdBy: asText(r.created_by),
  createdAt: asDate(r.created_at) as Date,
});

export function pgSupportRepo(tx: TxClient): SupportRepo {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  return {
    async create(i) {
      const r = await guard(
        q("INSERT INTO support_requests (number, customer_id, guest_name, subject, message, bill_ref, order_ref, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *", [
          i.number, i.customerId, i.guestName.slice(0, 150), i.subject, i.message, i.billRef, i.orderRef, i.createdBy, i.createdAt.toISOString(),
        ]),
      );
      return supportOf(r.rows[0]);
    },
    async get(id, options) {
      const r = await q(`SELECT * FROM support_requests WHERE id = $1${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
      return r.rows[0] ? supportOf(r.rows[0]) : null;
    },
    async forCustomer(customerId, limit) {
      return (await q("SELECT * FROM support_requests WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2", [customerId, limit])).rows.map(supportOf);
    },
    async openCount(customerId) {
      return Number((await q("SELECT COUNT(*) AS n FROM support_requests WHERE customer_id = $1 AND status = 'open'", [customerId])).rows[0].n);
    },
    async list(query) {
      const params: unknown[] = [];
      const parts: string[] = [];
      if (query.status) {
        params.push(query.status);
        parts.push(`status = $${params.length}`);
      }
      parts.push(wordsCondition("concat_ws(' ', number, guest_name, subject, message, bill_ref, order_ref)", query.words, params));
      const where = parts.join(" AND ");
      const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM support_requests WHERE ${where}`, params);
      params.push(query.pageSize, (query.page - 1) * query.pageSize);
      const order = query.status === "open" ? "created_at ASC, id ASC" : "created_at DESC, id DESC";
      const r = await q(`SELECT * FROM support_requests WHERE ${where} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return { rows: r.rows.map(supportOf), total };
    },
    async respond(id, input) {
      const r = await guard(
        q("UPDATE support_requests SET status = $2, reply = $3, replied_at = $4, replied_by = $5, replied_by_name = $6 WHERE id = $1 RETURNING *", [id, input.status, input.reply, input.at.toISOString(), input.by.id, input.by.name.slice(0, 150)]),
      );
      return r.rows[0] ? supportOf(r.rows[0]) : null;
    },
  };
}

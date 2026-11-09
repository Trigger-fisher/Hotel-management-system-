import "server-only";
// The notifications repositories on PostgreSQL (repos/notifications.ts; the in-memory double repos/memory/notifications.ts is the reference for every rule).
// Values only through $n. Status is computed from withdrawn_at and expires_at (a date, compared with the IST day the service passes). The targets are written in
// chunks of 500 with one unnest each. A company's own reads rely on the row-level security of migration 0039 as the second fence, and still filter by company_id.
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type { Addressee } from "../companies";
import type { NotificationRecord, NotificationRepo, NotificationsRepos, NotificationStatus, NotificationSummary } from "../notifications";
import type { Unit } from "../types";
import { pgCompaniesRepos } from "./companies";
import { asDate, asText, countTotal, guard, wordsCondition } from "./shared";
import { createPgUnit } from "./unit";

type Row = Record<string, unknown>;

/** Targets written per statement. */
const TARGET_CHUNK = 500;

const COLUMNS = `n.id, n.audience_kind, n.title, n.body, n.priority, n.link_view, n.link_id, n.expires_at::text AS expires_at, n.withdrawn_at, n.withdrawn_by, n.also_email, n.target_count, n.created_by, n.created_at`;
const READ_COUNT = `(SELECT count(*) FROM notification_targets t WHERE t.notification_id = n.id AND t.read_at IS NOT NULL) AS read_count`;

const recordOf = (r: Row): NotificationRecord => ({
  id: String(r.id),
  audienceKind: r.audience_kind as NotificationRecord["audienceKind"],
  title: String(r.title),
  body: String(r.body),
  priority: r.priority as NotificationRecord["priority"],
  linkView: asText(r.link_view),
  linkId: asText(r.link_id),
  expiresAt: asText(r.expires_at),
  alsoEmail: r.also_email === true,
  targetCount: Number(r.target_count),
  withdrawnAt: asDate(r.withdrawn_at),
  withdrawnBy: asText(r.withdrawn_by),
  createdBy: asText(r.created_by),
  createdAt: asDate(r.created_at) as Date,
});
const summaryOf = (r: Row): NotificationSummary => ({ ...recordOf(r), readCount: Number(r.read_count) });

/** The computed status as a condition on `n` ($today is a parameter number already pushed). */
const statusSql = (status: NotificationStatus, today: string): string =>
  status === "withdrawn" ? "n.withdrawn_at IS NOT NULL" : status === "expired" ? `(n.withdrawn_at IS NULL AND n.expires_at < ${today}::date)` : `(n.withdrawn_at IS NULL AND (n.expires_at IS NULL OR n.expires_at >= ${today}::date))`;

export function pgNotificationRepo(tx: TxClient): NotificationRepo {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  const live = (today: string) => statusSql("active", today);

  return {
    async create(input, targets, at) {
      const r = await guard(
        q(
          `INSERT INTO notifications (audience_kind, title, body, priority, link_view, link_id, expires_at, also_email, target_count, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11) RETURNING id`,
          [input.audienceKind, input.title, input.body, input.priority, input.linkView, input.linkId, input.expiresAt, input.alsoEmail, targets.length, input.createdBy, at.toISOString()],
        ),
      );
      const id = String(r.rows[0].id);
      for (let i = 0; i < targets.length; i += TARGET_CHUNK) {
        const chunk = targets.slice(i, i + TARGET_CHUNK);
        await guard(
          q("INSERT INTO notification_targets (notification_id, company_id, email_status) SELECT $1, c, s FROM unnest($2::uuid[], $3::text[]) AS t(c, s)", [id, chunk.map((x) => x.companyId), chunk.map((x) => x.emailStatus)]),
        );
      }
      const row = await q(`SELECT ${COLUMNS} FROM notifications n WHERE n.id = $1`, [id]);
      return recordOf(row.rows[0]);
    },
    async get(id) {
      const r = await q(`SELECT ${COLUMNS}, ${READ_COUNT} FROM notifications n WHERE n.id = $1`, [id]);
      return r.rows[0] ? summaryOf(r.rows[0]) : null;
    },
    async targets(id) {
      const r = await q(
        `SELECT t.company_id, c.name, t.read_at, t.email_status FROM notification_targets t JOIN company_profiles c ON c.id = t.company_id WHERE t.notification_id = $1 ORDER BY lower(c.name) COLLATE "C", c.name COLLATE "C", t.company_id`,
        [id],
      );
      return r.rows.map((x) => ({ companyId: String(x.company_id), companyName: String(x.name), readAt: asDate(x.read_at), emailStatus: x.email_status as "none" | "queued" | "skipped" }));
    },
    async list(query) {
      const params: unknown[] = [];
      const parts = [wordsCondition("concat_ws(' ', n.title, n.body)", query.words, params)];
      if (query.status) {
        // "withdrawn" does not look at the date: pushing the parameter anyway would leave the statement with one it never uses
        if (query.status !== "withdrawn") params.push(query.today);
        parts.push(statusSql(query.status, `$${params.length}`));
      }
      const where = parts.join(" AND ");
      const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM notifications n WHERE ${where}`, params);
      params.push(query.pageSize, (query.page - 1) * query.pageSize);
      const r = await q(`SELECT ${COLUMNS}, ${READ_COUNT} FROM notifications n WHERE ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return { rows: r.rows.map(summaryOf), total };
    },
    async withdraw(id, actorId, at) {
      await q("UPDATE notifications SET withdrawn_at = $2, withdrawn_by = $3 WHERE id = $1 AND withdrawn_at IS NULL", [id, at.toISOString(), actorId]);
      const r = await q(`SELECT ${COLUMNS} FROM notifications n WHERE n.id = $1`, [id]);
      return r.rows[0] ? recordOf(r.rows[0]) : null;
    },
    async liveCompanyIds(ids) {
      const r = ids ? await q("SELECT id FROM company_profiles WHERE deleted_at IS NULL AND id = ANY($1::uuid[]) ORDER BY id", [ids]) : await q("SELECT id FROM company_profiles WHERE deleted_at IS NULL ORDER BY id");
      return r.rows.map((x) => String(x.id));
    },
    async emailsOf(companyIds) {
      const out = new Map<string, Addressee[]>();
      if (companyIds.length === 0) return out;
      const r = await q(
        `SELECT company_id, email, name FROM (
           SELECT id AS company_id, lower(trim(email)) AS email, name, 1 AS src FROM company_profiles WHERE deleted_at IS NULL AND id = ANY($1::uuid[])
           UNION ALL
           SELECT p.id, lower(trim(c->>'email')), COALESCE(NULLIF(trim(c->>'name'), ''), p.name), 2
             FROM company_profiles p, jsonb_array_elements(COALESCE(p.contacts, '[]'::jsonb)) c WHERE p.deleted_at IS NULL AND p.id = ANY($1::uuid[])
         ) a
         WHERE email IS NOT NULL AND email <> '' AND position('@' in email) > 1
           AND NOT EXISTS (SELECT 1 FROM mail_optouts o WHERE lower(o.email) = a.email)
         ORDER BY company_id, src, email`,
        [companyIds],
      );
      for (const x of r.rows) {
        const id = String(x.company_id);
        const list = out.get(id) ?? [];
        if (!list.some((a) => a.email === x.email)) list.push({ email: String(x.email), name: (asText(x.name) ?? "").trim() });
        out.set(id, list);
      }
      return out;
    },

    async forCompany(companyId, query) {
      const params: unknown[] = [companyId, query.today];
      let where = `t.company_id = $1 AND ${live("$2")}${query.unread ? " AND t.read_at IS NULL" : query.read ? " AND t.read_at IS NOT NULL" : ""}`;
      // the search: every word in the title or the text (LIKE wildcards in the words are taken literally)
      for (const word of (query.search ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
        params.push(`%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        where += ` AND (n.title ILIKE $${params.length} OR n.body ILIKE $${params.length})`;
      }
      const from = "FROM notification_targets t JOIN notifications n ON n.id = t.notification_id";
      const total = await countTotal(tx, query, `SELECT COUNT(*) AS n ${from} WHERE ${where}`, params);
      let rowsWhere = where;
      if (query.through) {
        params.push(query.through.toISOString());
        rowsWhere = `${where} AND n.created_at <= $${params.length}::timestamptz`;
      }
      params.push(query.pageSize, (query.page - 1) * query.pageSize);
      const r = await q(`SELECT n.id, n.title, n.body, n.priority, n.link_view, n.link_id, n.created_at, t.read_at ${from} WHERE ${rowsWhere} ORDER BY n.created_at DESC, n.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return {
        rows: r.rows.map((x) => ({ id: String(x.id), title: String(x.title), body: String(x.body), priority: x.priority as "normal" | "important", linkView: asText(x.link_view), linkId: asText(x.link_id), createdAt: asDate(x.created_at) as Date, readAt: asDate(x.read_at) })),
        total,
      };
    },
    async unreadCount(companyId, today) {
      const r = await q(`SELECT COUNT(*) AS n FROM notification_targets t JOIN notifications n ON n.id = t.notification_id WHERE t.company_id = $1 AND t.read_at IS NULL AND ${live("$2")}`, [companyId, today]);
      return Number(r.rows[0].n);
    },
    async markRead(companyId, notificationId, at, today) {
      const liveOf = (today$: string) => `EXISTS (SELECT 1 FROM notifications n WHERE n.id = t.notification_id AND ${live(today$)})`;
      const changed = await q(`UPDATE notification_targets t SET read_at = $3 WHERE t.company_id = $1 AND t.notification_id = $2 AND t.read_at IS NULL AND ${liveOf("$4")}`, [companyId, notificationId, at.toISOString(), today]);
      if (changed.affectedRows > 0) return true;
      // already read (the first read time stays) or not theirs / not live
      const there = await q(`SELECT 1 AS x FROM notification_targets t WHERE t.company_id = $1 AND t.notification_id = $2 AND ${liveOf("$3")} LIMIT 1`, [companyId, notificationId, today]);
      return there.rows.length > 0;
    },
    async markAllRead(companyId, at, today) {
      const r = await q(`UPDATE notification_targets t SET read_at = $2 WHERE t.company_id = $1 AND t.read_at IS NULL AND EXISTS (SELECT 1 FROM notifications n WHERE n.id = t.notification_id AND ${live("$3")})`, [companyId, at.toISOString(), today]);
      return r.affectedRows;
    },
  };
}

/** ONE withHotel transaction over the companies (with billing) and the notifications. */
export function createPgNotificationsUnit(withHotel: WithHotel): Unit<NotificationsRepos> {
  return createPgUnit(withHotel, (tx, hotelId) => ({ ...pgCompaniesRepos(tx, hotelId), notifications: pgNotificationRepo(tx) }));
}

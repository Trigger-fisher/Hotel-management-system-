import "server-only";
import type { ClientPool } from "../../../db/withHotel";
import type { CampaignAudience, CampaignRecord, CampaignStatus } from "../../whatsapp/campaigns";
import type { CampaignRunsStore } from "../../whatsapp/campaignRunner";
import type { CampaignStore, CampaignTemplate } from "../../whatsapp/campaignStore";

// A hotel's campaigns on PostgreSQL (hotel 0058), bound to the hotel's transaction, and the short list of running campaigns on the platform side (platform 0185).
type Query = { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, name, template_id, audience, variables, status, status_reason, recipient_count, sent, failed, skipped, created_by, started_at, finished_at, created_at";
const last10 = "right(regexp_replace(coalesce(c.mobile, ''), '[^0-9]', '', 'g'), 10)";

const recordOf = (x: Record<string, unknown>): CampaignRecord => ({
  id: String(x.id),
  name: String(x.name),
  templateId: String(x.template_id),
  audience: (typeof x.audience === "object" && x.audience !== null ? x.audience : {}) as CampaignAudience,
  variables: (Array.isArray(x.variables) ? x.variables : []).map((v) => String(v)),
  status: x.status as CampaignStatus,
  statusReason: x.status_reason === null || x.status_reason === undefined ? null : String(x.status_reason),
  recipientCount: Number(x.recipient_count),
  sent: Number(x.sent),
  failed: Number(x.failed),
  skipped: Number(x.skipped),
  createdBy: String(x.created_by),
  startedAt: (x.started_at as Date | null) ?? null,
  finishedAt: (x.finished_at as Date | null) ?? null,
  createdAt: x.created_at as Date,
});

/** The guests the audience reaches: agreed, with a mobile number, not opted out, and (when given) stayed within the days. One row per number (the customer list has a unique mobile). */
const audienceSql = (days: number | undefined): { from: string; params: unknown[] } => ({
  from: `FROM customers c
         WHERE c.is_active AND c.wa_consent_at IS NOT NULL AND length(regexp_replace(coalesce(c.mobile, ''), '[^0-9]', '', 'g')) >= 10
           AND NOT EXISTS (SELECT 1 FROM wa_optouts o WHERE right(o.phone_digits, 10) = ${last10})
           ${days === undefined ? "" : `AND EXISTS (SELECT 1 FROM pms_stays s WHERE right(regexp_replace(coalesce(s.mobile, ''), '[^0-9]', '', 'g'), 10) = ${last10} AND s.check_in_at >= now() - ($1::int * interval '1 day'))`}`,
  params: days === undefined ? [] : [days],
});

export function pgCampaignStore(db: Query): CampaignStore {
  return {
    async list() {
      return (await db.query(`SELECT ${COLUMNS} FROM wa_campaigns ORDER BY created_at DESC, id LIMIT 200`)).rows.map(recordOf);
    },
    async get(id) {
      if (!UUID.test(id)) return null;
      const r = await db.query(`SELECT ${COLUMNS} FROM wa_campaigns WHERE id = $1`, [id]);
      return r.rows[0] ? recordOf(r.rows[0]) : null;
    },
    async create(i, by) {
      const r = await db.query(`INSERT INTO wa_campaigns (name, template_id, audience, variables, created_by) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5) RETURNING ${COLUMNS}`, [i.name, i.templateId, JSON.stringify(i.audience), JSON.stringify(i.variables), by]);
      return recordOf(r.rows[0]);
    },
    async update(id, i) {
      if (!UUID.test(id)) return null;
      const r = await db.query(`UPDATE wa_campaigns SET name = $2, template_id = $3, audience = $4::jsonb, variables = $5::jsonb WHERE id = $1 AND status = 'draft' RETURNING ${COLUMNS}`, [id, i.name, i.templateId, JSON.stringify(i.audience), JSON.stringify(i.variables)]);
      return r.rows[0] ? recordOf(r.rows[0]) : null;
    },
    async remove(id) {
      if (!UUID.test(id)) return false;
      return (await db.query("DELETE FROM wa_campaigns WHERE id = $1 AND status IN ('draft', 'done', 'cancelled') RETURNING id", [id])).rows.length > 0;
    },
    async template(id) {
      if (!UUID.test(id)) return null;
      const r = await db.query("SELECT id, name, language, status, category, body FROM wa_templates WHERE id = $1", [id]);
      const x = r.rows[0];
      if (!x) return null;
      return { id: String(x.id), name: String(x.name), language: String(x.language), status: x.status as CampaignTemplate["status"], category: x.category as CampaignTemplate["category"], blanks: new Set([...String(x.body).matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)].map((m) => m[1])).size };
    },
    async audienceSize(audience) {
      const q = audienceSql(audience.stayedWithinDays);
      const r = await db.query(`SELECT count(*)::int AS n ${q.from}`, q.params);
      return Number(r.rows[0]?.n ?? 0);
    },
    async enroll(id, audience) {
      const q = audienceSql(audience.stayedWithinDays);
      const idParam = `$${q.params.length + 1}`;
      // one row per number: two customers who share a number (a family) are written once
      // the number as WhatsApp wants it: digits with the country code. A 10-digit Indian mobile (after any leading 0) gets 91; a longer one already has its code. The first customer of a number names it.
      const digits = `ltrim(regexp_replace(coalesce(c.mobile, ''), '[^0-9]', '', 'g'), '0')`;
      const r = await db.query(
        `INSERT INTO wa_campaign_recipients (campaign_id, customer_id, phone_digits, guest_name)
         SELECT ${idParam}::uuid, (array_agg(c.id ORDER BY c.created_at))[1], max(CASE WHEN length(${digits}) = 10 THEN '91' || ${digits} ELSE ${digits} END), (array_agg(c.name ORDER BY c.created_at))[1]
         ${q.from}
         GROUP BY ${last10}
         ON CONFLICT (campaign_id, phone_digits) DO NOTHING RETURNING id`,
        [...q.params, id],
      );
      await db.query("UPDATE wa_campaigns SET recipient_count = (SELECT count(*) FROM wa_campaign_recipients WHERE campaign_id = $1) WHERE id = $1", [id]);
      return r.rows.length;
    },
    async setStatus(id, from, to, reason, at) {
      if (!UUID.test(id)) return null;
      const r = await db.query(
        `UPDATE wa_campaigns SET status = $3, status_reason = $4,
           started_at = CASE WHEN $3 = 'running' AND started_at IS NULL THEN $5::timestamptz ELSE started_at END,
           finished_at = CASE WHEN $3 IN ('done', 'cancelled') THEN $5::timestamptz ELSE finished_at END
         WHERE id = $1 AND status = ANY($2::text[]) RETURNING ${COLUMNS}`,
        [id, [...from], to, reason, at.toISOString()],
      );
      return r.rows[0] ? recordOf(r.rows[0]) : null;
    },
    async batch(id, size) {
      if (!UUID.test(id)) return [];
      const r = await db.query("SELECT id, phone_digits, guest_name FROM wa_campaign_recipients WHERE campaign_id = $1 AND state = 'queued' ORDER BY created_at, id LIMIT $2", [id, size]);
      return r.rows.map((x) => ({ id: String(x.id), phoneDigits: String(x.phone_digits), guestName: x.guest_name === null ? null : String(x.guest_name) }));
    },
    async mark(campaignId, recipientId, state, reason, at) {
      if (!UUID.test(campaignId) || !UUID.test(recipientId)) return;
      const r = await db.query("UPDATE wa_campaign_recipients SET state = $3, reason = $4, sent_at = CASE WHEN $3 = 'sent' THEN $5::timestamptz ELSE sent_at END WHERE id = $2 AND campaign_id = $1 AND state = 'queued' RETURNING id", [campaignId, recipientId, state, reason, at.toISOString()]);
      if (r.rows.length === 0) return;
      const column = state === "sent" ? "sent" : state === "failed" ? "failed" : "skipped";
      await db.query(`UPDATE wa_campaigns SET ${column} = ${column} + 1 WHERE id = $1`, [campaignId]);
    },
    async queued(id) {
      if (!UUID.test(id)) return 0;
      return Number((await db.query("SELECT count(*)::int AS n FROM wa_campaign_recipients WHERE campaign_id = $1 AND state = 'queued'", [id])).rows[0]?.n ?? 0);
    },
  };
}

type Q = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
async function one<T>(pool: ClientPool, work: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  const onError = (): void => {
    broken = true;
  };
  client.on("error", onError);
  try {
    return await work((text, params) => client.query(text, params) as ReturnType<Q>);
  } finally {
    client.removeListener("error", onError);
    client.release(broken);
  }
}

/** The platform's short list of running campaigns (platform 0185), on the shared pool. */
export function pgCampaignRuns(pool: ClientPool): CampaignRunsStore {
  return {
    due: (now, limit) =>
      one(pool, async (q) => {
        const r = await q("SELECT hotel_id, campaign_id FROM platform.whatsapp_campaign_runs WHERE next_at <= $1 ORDER BY next_at LIMIT $2", [now.toISOString(), limit]);
        return r.rows.map((x) => ({ hotelId: String(x.hotel_id), campaignId: String(x.campaign_id) }));
      }),
    schedule: (hotelId, campaignId, at) =>
      one(pool, async (q) => {
        await q("INSERT INTO platform.whatsapp_campaign_runs (hotel_id, campaign_id, next_at) VALUES ($1, $2, $3) ON CONFLICT (hotel_id, campaign_id) DO UPDATE SET next_at = EXCLUDED.next_at", [hotelId, campaignId, at.toISOString()]);
      }),
    remove: (hotelId, campaignId) =>
      one(pool, async (q) => {
        await q("DELETE FROM platform.whatsapp_campaign_runs WHERE hotel_id = $1 AND campaign_id = $2", [hotelId, campaignId]);
      }),
  };
}

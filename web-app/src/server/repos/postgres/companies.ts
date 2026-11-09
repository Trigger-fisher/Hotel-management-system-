import "server-only";
// The Companies repositories on PostgreSQL: company profiles (soft delete, name unique among live rows without regard to case), customers,
// email marketing (campaigns, their recipients, opt-outs), and the Company Ledger's source, whose overview figures are ONE aggregate query over bills and advances
// (GROUP BY company, never the lines). The in-memory double (repos/memory/companies.ts) is the reference for every rule.
import { toBigInt } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type { Addressee, CampaignAudience, CampaignFields, CampaignRecord, CompaniesRepos, CompanyContactRecord, CompanyFields, CompanyRecord, CustomerFields, CustomerRecord, LedgerSummaryRow } from "../companies";
import type { Unit } from "../types";
import { advanceOf, billOf, pgBillingRepos } from "./billing";
import { asDate, asText, countTotal, guard, read, write, type Kind } from "./shared";
import { numberSealer, sealedWrite, type NumberSealer } from "./sealedNumbers";
import { createPgUnit } from "./unit";

type Row = Record<string, unknown>;

const COMPANY_SPEC: Record<string, Kind> = {
  name: "text", email: "text", mobileNumber: "text", phoneNumber: "text", country: "text", nationality: "text", pincode: "text", gstNumber: "text", address: "text",
  discountPercentage: "text", gstPercentage: "text", tcsPercentage: "text", tdsPercentage: "text", instruction: "text", contacts: "json",
};
const CUSTOMER_SPEC: Record<string, Kind> = { name: "text", mobile: "text", email: "text", address: "text", city: "text", idProofType: "text", idProofNumber: "text", notes: "text", isActive: "text", source: "text" };
const CAMPAIGN_SPEC: Record<string, Kind> = { subject: "text", body: "text", audience: "text" };

const audit = (r: Row) => ({ createdBy: asText(r.created_by), updatedBy: asText(r.updated_by), createdAt: asDate(r.created_at) as Date, updatedAt: asDate(r.updated_at) as Date });
const companyOf = (r: Row): CompanyRecord => ({
  id: String(r.id), ...(read(COMPANY_SPEC, r) as unknown as CompanyFields), contacts: (r.contacts as CompanyContactRecord[] | null) ?? [],
  ...audit(r), deletedAt: asDate(r.deleted_at), deletedBy: asText(r.deleted_by),
});
/** `sealer` (decision 74): the ID number is opened from its sealed column; without one the plain column is read as it is. */
const customerOf = (r: Row, sealer?: NumberSealer): CustomerRecord => ({ id: String(r.id), ...(read(CUSTOMER_SPEC, r) as unknown as CustomerFields), ...(sealer ? { idProofNumber: sealer.plainOf("customers", r) } : {}), isActive: r.is_active === true, source: r.source as CustomerFields["source"], ...audit(r) });
const campaignOf = (r: Row): CampaignRecord => ({
  id: String(r.id), ...(read(CAMPAIGN_SPEC, r) as unknown as CampaignFields), status: r.status as CampaignRecord["status"], recipients: Number(r.recipients),
  // hotel migration 0044's columns (a campaign sent before it went out whole: all queued)
  queued: r.queued === undefined || r.queued === null ? (r.status === "sent" ? Number(r.recipients) : 0) : Number(r.queued), leftOut: Number(r.left_out ?? 0),
  sentAt: asDate(r.sent_at), pausedAt: asDate(r.paused_at ?? null), finishedAt: asDate(r.finished_at ?? null), ...audit(r),
});

/** Contacts and the booleans are written as they are; the writer only needs the column names. */
const writeCompany = (values: object) => write(COMPANY_SPEC, values);
const writeCustomer = (values: object) => write({ ...CUSTOMER_SPEC, isActive: "int" }, values);
const writeCampaign = (values: object) => write(CAMPAIGN_SPEC, values);

function words(columns: string[], list: readonly string[] | undefined, params: unknown[]): string {
  if (!list || list.length === 0) return "true";
  return list
    .map((w) => {
      params.push(w.toLowerCase());
      return `position($${params.length}::text in lower(concat_ws(' ', ${columns.join(", ")}))) > 0`;
    })
    .join(" AND ");
}

const COMPANY_TEXT = ["name", "email", "mobile_number", "phone_number", "country", "nationality", "pincode", "gst_number", "address", "discount_percentage::text", "gst_percentage::text", "tcs_percentage::text", "tds_percentage::text", "instruction", "contacts::text"];
const CUSTOMER_TEXT = ["name", "mobile", "email", "address", "city", "id_proof_type", "notes"];
/**
 * The audience as ONE query (repos/companies.ts `audience`): the three sources unioned, addresses lower-cased, each once (DISTINCT ON keeps the first
 * name by source order), opt-outs left out. `kinds` names the sources to include.
 */
const AUDIENCE_SQL = `
  SELECT DISTINCT ON (email) email, name FROM (
    SELECT lower(trim(email)) AS email, name, 1 AS src FROM customers WHERE is_active AND 'customers' = ANY($1::text[])
    UNION ALL
    SELECT lower(trim(email)), name, 2 FROM company_profiles WHERE deleted_at IS NULL AND 'companies' = ANY($1::text[])
    UNION ALL
    SELECT lower(trim(c->>'email')), COALESCE(NULLIF(trim(c->>'name'), ''), p.name), 3
      FROM company_profiles p, jsonb_array_elements(COALESCE(p.contacts, '[]'::jsonb)) c WHERE p.deleted_at IS NULL AND 'companies' = ANY($1::text[])
    UNION ALL
    SELECT lower(trim(email)), guest_name, 4 FROM pms_stays WHERE 'guests' = ANY($1::text[])
  ) a
  WHERE email IS NOT NULL AND email <> '' AND position('@' in email) > 1
    AND NOT EXISTS (SELECT 1 FROM mail_optouts o WHERE lower(o.email) = a.email)
  ORDER BY email, src`;
const sourcesOf = (kind: CampaignAudience): string[] => (kind === "all" ? ["customers", "companies", "guests"] : [kind]);

/** "Starts with, ignoring case", without LIKE: nothing in the prefix needs escaping. */
const startsWith = (column: string, param: string): string => `left(lower(${column}), length(${param}::text)) = lower(${param}::text)`;

export function pgCompaniesRepos(tx: TxClient, hotelId: string): CompaniesRepos {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  const sealer = numberSealer(hotelId);
  const customer = (r: Row): CustomerRecord => customerOf(r, sealer);
  const billing = pgBillingRepos(tx);

  return {
    ...billing,

    companyProfiles: {
      async get(id, options) {
        const r = await q(`SELECT * FROM company_profiles WHERE id = $1 AND deleted_at IS ${options?.deleted === true ? "NOT NULL" : "NULL"}`, [id]);
        return r.rows[0] ? companyOf(r.rows[0]) : null;
      },
      async list(query) {
        const params: unknown[] = [];
        const where = `deleted_at IS ${query.deleted === "only" ? "NOT NULL" : "NULL"} AND ${words(COMPANY_TEXT, query.words, params)}`;
        const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM company_profiles WHERE ${where}`, params);
        params.push(query.pageSize, (query.page - 1) * query.pageSize);
        const r = await q(`SELECT * FROM company_profiles WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: r.rows.map(companyOf), total };
      },
      async byName(query) {
        const params: unknown[] = [];
        const where = words(["name", "gst_number", "email", "mobile_number"], query.words, params);
        params.push(query.limit);
        return (await q(`SELECT * FROM company_profiles WHERE deleted_at IS NULL AND ${where} ORDER BY lower(name) COLLATE "C", name COLLATE "C", id LIMIT $${params.length}`, params)).rows.map(companyOf);
      },
      async stats(monthFrom) {
        const r = await q(
          `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE COALESCE(gst_number, '') <> '') AS with_gst, COALESCE(SUM(jsonb_array_length(COALESCE(contacts, '[]'::jsonb))), 0) AS contacts,
                  COUNT(*) FILTER (WHERE created_at >= $1) AS month FROM company_profiles WHERE deleted_at IS NULL`,
          [monthFrom.toISOString()],
        );
        const x = r.rows[0];
        return { total: Number(x.total), withGst: Number(x.with_gst), contacts: Number(x.contacts), month: Number(x.month) };
      },
      async withGstNumber(gstNumber, except) {
        const r = await q("SELECT * FROM company_profiles WHERE deleted_at IS NULL AND gst_number = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) ORDER BY created_at, id LIMIT 1", [gstNumber, except ?? null]);
        return r.rows[0] ? companyOf(r.rows[0]) : null;
      },
      async nameTaken(name, except) {
        const r = await q("SELECT 1 AS x FROM company_profiles WHERE deleted_at IS NULL AND lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1", [name, except ?? null]);
        return r.rows.length > 0;
      },
      async lookup(prefix, limit) {
        const r = await q(`SELECT id, name, gst_number FROM company_profiles WHERE deleted_at IS NULL AND ${startsWith("name", "$1")} ORDER BY lower(name) COLLATE "C", name COLLATE "C", id LIMIT $2`, [prefix, limit]);
        return r.rows.map((x) => ({ id: String(x.id), name: String(x.name), gstNumber: asText(x.gst_number) }));
      },
      async create(input) {
        const { createdBy, ...fields } = input;
        const w = writeCompany(fields);
        const columns = [...w.columns, "created_by"];
        const params = [...w.params, createdBy];
        const r = await guard(q(`INSERT INTO company_profiles (${columns.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params));
        return companyOf(r.rows[0]);
      },
      async update(id, patch, actorId) {
        const w = writeCompany(patch);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 2}`), `updated_by = $${w.columns.length + 2}`].join(", ");
        const r = await guard(q(`UPDATE company_profiles SET ${set} WHERE id = $1 AND deleted_at IS NULL RETURNING *`, [id, ...w.params, actorId]));
        return r.rows[0] ? companyOf(r.rows[0]) : null;
      },
      async softDelete(id, actorId) {
        const r = await q("UPDATE company_profiles SET deleted_at = now(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL", [id, actorId]);
        return r.affectedRows > 0;
      },
      async restore(id, actorId) {
        const r = await guard(q("UPDATE company_profiles SET deleted_at = NULL, deleted_by = NULL, updated_by = $2 WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *", [id, actorId]));
        return r.rows[0] ? companyOf(r.rows[0]) : null;
      },
      async purge(id) {
        const r = await guard(q("DELETE FROM company_profiles WHERE id = $1 AND deleted_at IS NOT NULL", [id]));
        return r.affectedRows > 0;
      },
    },

    customers: {
      async get(id) {
        const r = await q("SELECT * FROM customers WHERE id = $1", [id]);
        return r.rows[0] ? customer(r.rows[0]) : null;
      },
      async getMany(ids) {
        if (ids.length === 0) return new Map();
        return new Map((await q("SELECT * FROM customers WHERE id = ANY($1::uuid[])", [ids])).rows.map((r) => [String(r.id), customer(r)]));
      },
      async list(query) {
        const params: unknown[] = [];
        let where = words(CUSTOMER_TEXT, query.words, params);
        if (query.active !== undefined) {
          params.push(query.active);
          where += ` AND is_active = $${params.length}`;
        }
        const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM customers WHERE ${where}`, params);
        params.push(query.pageSize, (query.page - 1) * query.pageSize);
        const r = await q(`SELECT * FROM customers WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: r.rows.map(customer), total };
      },
      async counts(list) {
        const params: unknown[] = [];
        const r = await q(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE is_active) AS active, COUNT(*) FILTER (WHERE NOT is_active) AS off FROM customers WHERE ${words(CUSTOMER_TEXT, list, params)}`, params);
        return { all: Number(r.rows[0].n), active: Number(r.rows[0].active), off: Number(r.rows[0].off) };
      },
      async stats(monthFrom) {
        const r = await q(
          "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE source = 'self') AS self, COUNT(*) FILTER (WHERE COALESCE(email, '') <> '') AS with_email, COUNT(*) FILTER (WHERE created_at >= $1) AS month FROM customers",
          [monthFrom.toISOString()],
        );
        const x = r.rows[0];
        return { total: Number(x.total), selfSignup: Number(x.self), withEmail: Number(x.with_email), month: Number(x.month) };
      },
      async byMobile(mobile) {
        const r = await q("SELECT * FROM customers WHERE mobile = $1", [mobile]);
        return r.rows[0] ? customer(r.rows[0]) : null;
      },
      async lookup(prefix, limit) {
        const r = await q(`SELECT id, name, mobile FROM customers WHERE ${startsWith("name", "$1")} OR left(mobile, length($1::text)) = $1::text ORDER BY lower(name) COLLATE "C", name COLLATE "C", id LIMIT $2`, [prefix, limit]);
        return r.rows.map((x) => ({ id: String(x.id), name: String(x.name), mobile: String(x.mobile) }));
      },
      async create(input) {
        const { createdBy, ...fields } = input;
        const w = sealedWrite(sealer, "customers", writeCustomer(fields), fields.idProofNumber);
        const columns = [...w.columns, "created_by"];
        const params = [...w.params, createdBy];
        const r = await guard(q(`INSERT INTO customers (${columns.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params));
        return customer(r.rows[0]);
      },
      async update(id, patch, actorId) {
        const w = sealedWrite(sealer, "customers", writeCustomer(patch), patch.idProofNumber);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 2}`), `updated_by = $${w.columns.length + 2}`].join(", ");
        const r = await guard(q(`UPDATE customers SET ${set} WHERE id = $1 RETURNING *`, [id, ...w.params, actorId]));
        return r.rows[0] ? customer(r.rows[0]) : null;
      },
      async delete(id) {
        return (await q("DELETE FROM customers WHERE id = $1", [id])).affectedRows > 0;
      },
    },

    marketing: {
      async get(id, options) {
        const r = await q(`SELECT * FROM mail_campaigns WHERE id = $1${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return r.rows[0] ? campaignOf(r.rows[0]) : null;
      },
      async list(limit) {
        return (await q("SELECT * FROM mail_campaigns ORDER BY created_at DESC, id DESC LIMIT $1", [limit])).rows.map(campaignOf);
      },
      async create(input) {
        const { createdBy, ...fields } = input;
        const w = writeCampaign(fields);
        const columns = [...w.columns, "created_by"];
        const params = [...w.params, createdBy];
        const r = await guard(q(`INSERT INTO mail_campaigns (${columns.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params));
        return campaignOf(r.rows[0]);
      },
      async update(id, patch, actorId) {
        const w = writeCampaign(patch);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 2}`), `updated_by = $${w.columns.length + 2}`].join(", ");
        const r = await guard(q(`UPDATE mail_campaigns SET ${set} WHERE id = $1 RETURNING *`, [id, ...w.params, actorId]));
        return r.rows[0] ? campaignOf(r.rows[0]) : null;
      },
      async delete(id) {
        return (await q("DELETE FROM mail_campaigns WHERE id = $1", [id])).affectedRows > 0;
      },
      async begin(id, recipients, leftOut, at, actorId) {
        const r = await guard(q("UPDATE mail_campaigns SET status = 'sending', recipients = $2, left_out = $3, queued = 0, sent_at = $4, updated_by = $5 WHERE id = $1 RETURNING *", [id, recipients.length, leftOut, at.toISOString(), actorId]));
        if (!r.rows[0]) return null;
        // in slices of 5,000 rows a statement (one transaction): 50,000 addresses are ten inserts
        for (let i = 0; i < recipients.length; i += 5000) {
          const part = recipients.slice(i, i + 5000);
          await q("INSERT INTO mail_campaign_recipients (campaign_id, email, name) SELECT $1, e, n FROM unnest($2::text[], $3::text[]) AS t(e, n)", [id, part.map((x) => x.email), part.map((x) => x.name)]);
        }
        return campaignOf(r.rows[0]);
      },
      async setStatus(id, status, at, actorId) {
        const when = at.toISOString();
        const [set, params]: [string, unknown[]] =
          status === "paused" ? ["status = 'paused', paused_at = $2::timestamptz, updated_by = COALESCE($3::uuid, updated_by)", [when, actorId]]
          : status === "sending" ? ["status = 'sending', paused_at = NULL, updated_by = COALESCE($2::uuid, updated_by)", [actorId]]
          : status === "cancelled" ? ["status = 'cancelled', paused_at = NULL, finished_at = $2::timestamptz, cancelled_by = $3::uuid, updated_by = COALESCE($3::uuid, updated_by)", [when, actorId]]
          : ["status = 'sent', paused_at = NULL, finished_at = $2::timestamptz", [when]];
        const r = await guard(q(`UPDATE mail_campaigns SET ${set} WHERE id = $1 RETURNING *`, [id, ...params]));
        return r.rows[0] ? campaignOf(r.rows[0]) : null;
      },
      async nextRecipients(campaignId, limit) {
        const r = await q("SELECT id, email, name FROM mail_campaign_recipients WHERE campaign_id = $1 AND queued_at IS NULL AND skipped IS NULL ORDER BY id LIMIT $2", [campaignId, limit]);
        return r.rows.map((x) => ({ id: String(x.id), email: String(x.email), name: (asText(x.name) ?? "").trim() }));
      },
      async markQueued(campaignId, recipientIds, at) {
        if (recipientIds.length === 0) return;
        const r = await q("UPDATE mail_campaign_recipients SET queued_at = $3 WHERE campaign_id = $1 AND id = ANY($2::uuid[]) AND queued_at IS NULL AND skipped IS NULL", [campaignId, recipientIds, at.toISOString()]);
        if (r.affectedRows > 0) await guard(q("UPDATE mail_campaigns SET queued = queued + $2 WHERE id = $1", [campaignId, r.affectedRows]));
      },
      async markSkipped(campaignId, recipientIds, why) {
        if (recipientIds.length === 0) return;
        const r = await q("UPDATE mail_campaign_recipients SET skipped = $3 WHERE campaign_id = $1 AND id = ANY($2::uuid[]) AND queued_at IS NULL AND skipped IS NULL", [campaignId, recipientIds, why]);
        if (r.affectedRows > 0 && why !== "cancelled") await q("UPDATE mail_campaigns SET left_out = left_out + $2 WHERE id = $1", [campaignId, r.affectedRows]);
      },
      async optedOutAmong(emails) {
        const out = new Set<string>();
        if (emails.length === 0) return out;
        const r = await q("SELECT lower(email) AS email FROM mail_optouts WHERE lower(email) = ANY($1::text[])", [emails.map((e) => e.trim().toLowerCase())]);
        for (const x of r.rows) out.add(String(x.email));
        return out;
      },
      async recipients(campaignId) {
        return (await q("SELECT email, name FROM mail_campaign_recipients WHERE campaign_id = $1 ORDER BY created_at, id", [campaignId])).rows.map((r) => ({ email: String(r.email), name: asText(r.name) ?? "" }));
      },
      async audience(kind) {
        return (await q(AUDIENCE_SQL, [sourcesOf(kind)])).rows.map((r) => ({ email: String(r.email), name: (asText(r.name) ?? "").trim() })) as Addressee[];
      },
      async audienceCounts() {
        const count = async (kind: CampaignAudience) => Number((await q(`SELECT COUNT(*) AS n FROM (${AUDIENCE_SQL}) x`, [sourcesOf(kind)])).rows[0].n);
        return { customers: await count("customers"), companies: await count("companies"), guests: await count("guests"), all: await count("all") };
      },
      async optOut(email) {
        await q("INSERT INTO mail_optouts (email) VALUES ($1) ON CONFLICT DO NOTHING", [email.trim().toLowerCase()]);
      },
      async optOuts() {
        return Number((await q("SELECT COUNT(*) AS n FROM mail_optouts")).rows[0].n);
      },
    },

    ledgerSource: {
      async forCompany(companyId) {
        const bills = await q(
          "SELECT b.*, a.company_id AS advance_company_id FROM bill_master_bills b LEFT JOIN bill_master_advances a ON a.id = b.advance_id WHERE b.deleted_at IS NULL AND b.company_id = $1 ORDER BY b.entry_no",
          [companyId],
        );
        const advances = await q("SELECT * FROM bill_master_advances WHERE deleted_at IS NULL AND company_id = $1 ORDER BY entry_no", [companyId]);
        return { bills: bills.rows.map((r) => ({ ...billOf(r), advanceCompanyId: asText(r.advance_company_id) })), advances: advances.rows.map(advanceOf) };
      },

      async openBills() {
        const r = await q(
          "SELECT company_id, bill_date, balance_hotel_amount_paise + balance_food_amount_paise AS balance FROM bill_master_bills WHERE deleted_at IS NULL AND company_id IS NOT NULL AND bill_date IS NOT NULL AND balance_hotel_amount_paise + balance_food_amount_paise > 0",
          [],
        );
        return r.rows.map((x) => ({ companyId: asText(x.company_id) as string, billDate: String(x.bill_date).slice(0, 10), balancePaise: toBigInt(x.balance) }));
      },

      /**
       * Every company's figures in ONE statement (CompanyLedger::summaries): each line the ledger would have is one row of an events list (a bill, a
       * payment or advance credit, a debit settlement, a refund), and GROUP BY company adds them up. The rules are the double's, line for line.
       */
      async summaryByCompany(monthFrom) {
        const slots = [0, 1, 2, 3, 4].map((i) => {
          const date = i === 0 ? "debit_bill_date" : `debit_bill_date_${i}`;
          const hotel = i === 0 ? "debit_hotel_amount_paise" : `debit_hotel_amount_${i}_paise`;
          const food = i === 0 ? "debit_food_amount_paise" : `debit_food_amount_${i}_paise`;
          return `SELECT b.company_id, b.${date} AS d, 0::bigint AS billed, COALESCE(b.${hotel}, 0) + COALESCE(b.${food}, 0) AS received, 0::bigint AS refunded, 1 AS lines, 0 AS bills, 0 AS open_bills
                    FROM bill_master_bills b WHERE b.deleted_at IS NULL AND b.company_id IS NOT NULL AND b.${date} IS NOT NULL AND COALESCE(b.${hotel}, 0) + COALESCE(b.${food}, 0) > 0`;
        });
        const dueOf = (mode: string, total: string, taken: string): string => `CASE WHEN COALESCE(lower(b.${mode}) = 'debit', false) OR b.${total} - b.${taken} <= 0 THEN 0 ELSE b.${total} - b.${taken} END`;
        const paid = `${dueOf("hotel_mode_of_payment", "total_hotel_amount_paise", "advance_hotel_amount_paise")} + ${dueOf("food_mode_of_payment", "total_food_amount_paise", "advance_food_amount_paise")}`;
        const sql = `
          WITH ev AS (
            SELECT a.company_id, a.payment_date AS d, 0::bigint AS billed, COALESCE(a.hotel_amount_paise, 0) + COALESCE(a.food_amount_paise, 0) AS received, 0::bigint AS refunded, 1 AS lines, 0 AS bills, 0 AS open_bills
              FROM bill_master_advances a WHERE a.deleted_at IS NULL AND a.company_id IS NOT NULL AND a.payment_date IS NOT NULL AND COALESCE(a.receipt_number, '') NOT LIKE 'Excessive / %'
               AND COALESCE(a.hotel_amount_paise, 0) + COALESCE(a.food_amount_paise, 0) > 0
            UNION ALL
            SELECT a.company_id, a.refund_payment_date, 0, 0, COALESCE(a.hotel_refund_amount_paise, 0) + COALESCE(a.food_refund_amount_paise, 0), 1, 0, 0
              FROM bill_master_advances a WHERE a.deleted_at IS NULL AND a.company_id IS NOT NULL AND a.refund_payment_date IS NOT NULL AND COALESCE(a.hotel_refund_amount_paise, 0) + COALESCE(a.food_refund_amount_paise, 0) > 0
            UNION ALL
            SELECT b.company_id, b.bill_date, CASE WHEN b.bill_date IS NULL THEN 0 ELSE b.total_hotel_amount_paise + b.total_food_amount_paise END, 0, 0, CASE WHEN b.bill_date IS NULL THEN 0 ELSE 1 END, 1,
                   CASE WHEN b.balance_hotel_amount_paise + b.balance_food_amount_paise > 0 THEN 1 ELSE 0 END
              FROM bill_master_bills b WHERE b.deleted_at IS NULL AND b.company_id IS NOT NULL
            UNION ALL
            SELECT b.company_id, b.bill_date, 0, b.advance_hotel_amount_paise + b.advance_food_amount_paise, 0, 1, 0, 0
              FROM bill_master_bills b LEFT JOIN bill_master_advances a ON a.id = b.advance_id
             WHERE b.deleted_at IS NULL AND b.company_id IS NOT NULL AND b.bill_date IS NOT NULL AND b.advance_hotel_amount_paise + b.advance_food_amount_paise > 0
               AND NOT (b.advance_id IS NOT NULL AND a.company_id IS NOT DISTINCT FROM b.company_id AND a.company_id IS NOT NULL)
            UNION ALL
            SELECT b.company_id, b.bill_date, 0, ${paid}, 0, 1, 0, 0
              FROM bill_master_bills b WHERE b.deleted_at IS NULL AND b.company_id IS NOT NULL AND b.bill_date IS NOT NULL AND ${paid} > 0
            UNION ALL
            ${slots.join("\n            UNION ALL\n            ")}
          )
          SELECT company_id, COALESCE(SUM(billed), 0) AS billed, COALESCE(SUM(received), 0) AS received, COALESCE(SUM(refunded), 0) AS refunded,
                 COALESCE(SUM(billed) FILTER (WHERE d >= $1), 0) AS month_billed, COALESCE(SUM(received) FILTER (WHERE d >= $1), 0) AS month_received,
                 SUM(lines) AS lines, MAX(d) AS last_date, SUM(bills) AS bills, SUM(open_bills) AS open_bills
            FROM ev GROUP BY company_id ORDER BY company_id`;
        const r = await q(sql, [monthFrom]);
        return r.rows.map(
          (x): LedgerSummaryRow => ({
            companyId: String(x.company_id), billedPaise: toBigInt(x.billed), receivedPaise: toBigInt(x.received), refundedPaise: toBigInt(x.refunded),
            balancePaise: toBigInt(x.billed) + toBigInt(x.refunded) - toBigInt(x.received), monthBilledPaise: toBigInt(x.month_billed), monthReceivedPaise: toBigInt(x.month_received),
            lines: Number(x.lines), lastDate: asText(x.last_date), bills: Number(x.bills), openBills: Number(x.open_bills),
          }),
        );
      },
    },

    settings: {
      async values(keys) {
        const out = new Map<string, string | null>(keys.map((k) => [k, null]));
        if (keys.length === 0) return out;
        for (const row of (await q("SELECT key, value FROM app_settings WHERE key = ANY($1::text[])", [keys])).rows) out.set(String(row.key), row.value === null ? null : String(row.value));
        return out;
      },
    },
    idProofTypes: {
      async activeNames() {
        return (await q('SELECT name FROM id_proof_types WHERE is_active ORDER BY name COLLATE "C"')).rows.map((r) => String(r.name));
      },
    },
  };
}

export function createPgCompaniesUnit(withHotel: WithHotel): Unit<CompaniesRepos> {
  return createPgUnit(withHotel, pgCompaniesRepos);
}

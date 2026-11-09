import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createMailAddressService, createMemoryExtraAddressStore, type ExtraAddressRow, type ExtraAddressStore, type MailAddressService } from "../services/platform/mailAddressService";
import { personalSendingDomain, takenMailAddresses } from "./personalMailbox";
import { getPlatformConsoleUnit } from "./platform";

// Extra email addresses (platform 0189): the store over platform.mail_extra_addresses, or memory without a database.

async function q(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const client = await getDatabase().pool.connect();
  try {
    return (await client.query(text, params)).rows as Record<string, unknown>[];
  } finally {
    client.release();
  }
}

/** Before platform 0189 is run the table is missing: there are no extra addresses, and adding one says the update is needed. */
const missing = (e: unknown): boolean => (e as { code?: string }).code === "42P01";
const rowOf = (r: Record<string, unknown>): ExtraAddressRow => ({ id: String(r.id), loginId: String(r.login_id), local: String(r.local_part), domain: String(r.domain), createdBy: r.created_by ? String(r.created_by) : null, createdAt: new Date(String(r.created_at)) });
const COLS = "id, login_id, local_part, domain, created_by, created_at";

function pgStore(): ExtraAddressStore {
  const read = async (text: string, params: unknown[]) => {
    try {
      return (await q(text, params)).map(rowOf);
    } catch (e) {
      if (missing(e)) return [];
      throw e;
    }
  };
  return {
    list: (loginId) => read(`SELECT ${COLS} FROM platform.mail_extra_addresses WHERE login_id = $1::uuid ORDER BY created_at`, [loginId]),
    byLocals: (domain, locals) => read(`SELECT ${COLS} FROM platform.mail_extra_addresses WHERE domain = $1 AND local_part = ANY($2::text[])`, [domain, [...locals]]),
    add: async (row, at) => {
      try {
        const r = await q(`INSERT INTO platform.mail_extra_addresses (login_id, local_part, domain, created_by, created_at) VALUES ($1::uuid, $2, $3, $4::uuid, $5) ON CONFLICT ON CONSTRAINT mail_extra_addresses_unique DO NOTHING RETURNING ${COLS}`, [row.loginId, row.local, row.domain, row.createdBy, at]);
        return r[0] ? rowOf(r[0]) : null;
      } catch (e) {
        if (missing(e)) throw Object.assign(new Error("Extra email addresses need the database update platform 0189."), { code: "NOT_READY" });
        throw e;
      }
    },
    remove: async (loginId, id) => (await read(`DELETE FROM platform.mail_extra_addresses WHERE id = $1::uuid AND login_id = $2::uuid RETURNING ${COLS}`, [id, loginId]))[0] ?? null,
  };
}

let made: MailAddressService | null = null;

export function getMailAddresses(): MailAddressService {
  if (made) return made;
  const real = Boolean(getConfig().DATABASE_URL);
  made = createMailAddressService({
    unit: getPlatformConsoleUnit(),
    now: () => new Date(),
    store: real ? pgStore() : createMemoryExtraAddressStore(),
    domain: personalSendingDomain,
    taken: takenMailAddresses,
    isUsername: async (local) => (real ? (await q("SELECT 1 FROM platform.people WHERE lower(username) = $1 LIMIT 1", [local])).length > 0 : false),
  });
  return made;
}

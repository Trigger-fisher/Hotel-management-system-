import "server-only";
// A personal mailbox on PostgreSQL (platform migrations 0178 and 0179): the person's own rows of platform.pmail_*. EVERY query of this file runs inside withPersonalMailbox's transaction, which sets
// hms.pmail_login_id from the SESSION first (set_config with a bound value, never string-built SQL); row level security (forced) then shows and accepts only that person's rows, and an unset
// setting shows nothing. Values only through $n.
import type { SqlClient } from "../../../db/types";
import type { ClientPool } from "../../../db/withHotel";
import { AppError } from "../../errors";
import type { PersonalAddressRepo, PersonalMailboxRepos } from "../personalMailbox";
import type { ConversationsRepos, LinkMatcher } from "../conversations";
import type { Unit } from "../types";
import { pgConversationsRepo } from "./conversations";
import { createPlatformUnit } from "./platformUnit";
import { asText } from "./shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A personal mailbox links its contacts to nothing: every lookup answers none. */
export const noLinks: LinkMatcher = {
  byEmail: async () => null,
  byPhone: async () => null,
  search: async () => [],
  details: async () => null,
  exists: async () => null,
};

export function pgPersonalAddress(db: SqlClient): PersonalAddressRepo {
  return {
    async get() {
      const r = await db.query("SELECT address FROM platform.pmail_addresses");
      return asText(r.rows[0]?.address);
    },
    async save(address) {
      // login_id is filled by the database from the transaction's setting; the conflict target is that same column. A savepoint keeps the unit's transaction alive when the address belongs to
      // another login (a person since deleted): the unique key refuses, nothing else changes.
      await db.query("SAVEPOINT pmail_address");
      try {
        await db.query("INSERT INTO platform.pmail_addresses (address) VALUES ($1) ON CONFLICT (login_id) DO UPDATE SET address = EXCLUDED.address", [address]);
        await db.query("RELEASE SAVEPOINT pmail_address");
        return true;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT pmail_address");
        if ((error as { code?: unknown }).code === "23505") return false;
        throw error;
      }
    },
  };
}

/** The person's hub repositories over one transaction whose login is already set. */
export function bindPersonalMailbox(db: SqlClient, loginId: string): PersonalMailboxRepos {
  const hub: ConversationsRepos = {
    conversations: pgConversationsRepo(db, { schema: "platform.pmail_" }),
    matcher: noLinks,
    // no mailbox to read: a person's mail arrives through Amazon SES receiving and goes out through the platform's SES
    adminSettings: { get: async () => [] },
    hotelProfile: {
      header: async () => ({ name: String((await db.query("SELECT display_name FROM platform.people WHERE id = $1::uuid", [loginId])).rows[0]?.display_name ?? "Me") }),
    },
    systemLogs: {
      write: async (e) => {
        await db.query("INSERT INTO platform.pmail_conv_logs (action, summary, conversation_id, user_id, user_name, ip_address, trace_id) VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7)", [
          e.action,
          e.summary.slice(0, 300),
          e.subjectId,
          e.userId,
          e.userName.slice(0, 160),
          e.ipAddress,
          e.traceId,
        ]);
      },
    },
  };
  return { ...hub, address: pgPersonalAddress(db) };
}

/**
 * The person's rows on one transaction: hms.pmail_login_id is set FIRST, from the session's own login id (never from a request), so row level security shows and accepts only that
 * person's rows. A session whose id is not a login id gets nothing at all.
 */
export function createPgPersonalUnit(pool: ClientPool): Unit<PersonalMailboxRepos> {
  const unit = createPlatformUnit(pool, (db: SqlClient) => db);
  return {
    run: (session, work) =>
      unit.run(async (db) => {
        const loginId = session.userId;
        if (!UUID.test(loginId) || session.hotelId !== loginId) throw new AppError("FORBIDDEN");
        await db.query("SELECT set_config('hms.pmail_login_id', $1, true)", [loginId]);
        return work(bindPersonalMailbox(db, loginId));
      }),
  };
}

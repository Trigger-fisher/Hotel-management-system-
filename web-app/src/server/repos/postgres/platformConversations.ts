import "server-only";
// The platform side of Conversations on PostgreSQL (platform migration 0139): the platform's own hub (the same repository as a hotel's, over the "platform." tables), its
// matcher (platform users and hotels), and the registry of mailboxes (platform.conv_channel_accounts: the platform's own row and one row per hotel). Values only through $n;
// a missing table (0139 not run yet) is ConversationsNotReady. Used through createPlatformUnit (one transaction on the platform schema).
import type { ConvChannel, ConvLinkKind } from "@shared/dashboards/conversations";
import type { SqlClient } from "../../../db/types";
import { last10 } from "../../conversations/match";
import type { ChannelAccountRecord, ChannelAccountsRepo, LinkCandidateRecord, LinkMatcher, LinkTarget, PlatformConversationsRepos } from "../conversations";
import { notReadyGuard, pgConversationsRepo } from "./conversations";
import { asDate, asText, guard, wordsCondition } from "./shared";

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The registry's unique key: the platform's own row has no hotel. */
const OWNER = "COALESCE(hotel_id, '00000000-0000-0000-0000-000000000000'::uuid), channel";

const accountOf = (r: Row): ChannelAccountRecord => ({
  id: String(r.id),
  hotelId: asText(r.hotel_id),
  channel: r.channel === "whatsapp" ? "whatsapp" : "email",
  status: r.status === "on" ? "on" : "off",
  imapHost: asText(r.imap_host),
  imapPort: r.imap_port === null || r.imap_port === undefined ? null : Number(r.imap_port),
  lastCheckedAt: asDate(r.last_checked_at),
  lastOkAt: asDate(r.last_ok_at),
  lastPurgedAt: asDate(r.last_purged_at),
  lastError: asText(r.last_error),
});

export function pgChannelAccounts(db: SqlClient): ChannelAccountsRepo {
  const q = (text: string, params?: readonly unknown[]) => notReadyGuard(db).query(text, params);
  return {
    async platformAccount(channel: ConvChannel) {
      const r = await q(`SELECT * FROM platform.conv_channel_accounts WHERE hotel_id IS NULL AND channel = $1`, [channel]);
      return r.rows[0] ? accountOf(r.rows[0]) : null;
    },
    async savePlatformAccount(input, by) {
      const r = await guard(
        q(
          `INSERT INTO platform.conv_channel_accounts (hotel_id, channel, status, imap_host, imap_port, updated_by) VALUES (NULL, 'email', $1, $2, $3, $4)
           ON CONFLICT (${OWNER}) DO UPDATE SET status = EXCLUDED.status, imap_host = EXCLUDED.imap_host, imap_port = EXCLUDED.imap_port, updated_by = EXCLUDED.updated_by RETURNING *`,
          [input.status, input.imapHost, input.imapPort, UUID.test(by) ? by : null],
        ),
      );
      return accountOf(r.rows[0]);
    },
    async setHotelReading(hotelId, on) {
      await q(
        `INSERT INTO platform.conv_channel_accounts (hotel_id, channel, status) VALUES ($1, 'email', $2)
         ON CONFLICT (${OWNER}) DO UPDATE SET status = EXCLUDED.status`,
        [hotelId, on ? "on" : "off"],
      );
    },
    async report(hotelId, result) {
      if (hotelId === null) {
        await q(`UPDATE platform.conv_channel_accounts SET last_checked_at = $1, last_ok_at = CASE WHEN $2::boolean THEN $1::timestamptz ELSE last_ok_at END, last_error = $3 WHERE hotel_id IS NULL AND channel = 'email'`, [result.at.toISOString(), result.ok, result.error]);
        return;
      }
      await q(
        `INSERT INTO platform.conv_channel_accounts (hotel_id, channel, status, last_checked_at, last_ok_at, last_error) VALUES ($1, 'email', 'on', $2, CASE WHEN $3::boolean THEN $2::timestamptz END, $4)
         ON CONFLICT (${OWNER}) DO UPDATE SET last_checked_at = EXCLUDED.last_checked_at, last_ok_at = COALESCE(EXCLUDED.last_ok_at, platform.conv_channel_accounts.last_ok_at), last_error = EXCLUDED.last_error`,
        [hotelId, result.at.toISOString(), result.ok, result.error],
      );
    },
    async dueSync(now, limit) {
      const r = await q(
        `SELECT a.hotel_id FROM platform.conv_channel_accounts a JOIN platform.hotels h ON h.id = a.hotel_id
          WHERE a.channel = 'email' AND a.status = 'on' AND h.deleted_at IS NULL AND h.provisioned_at IS NOT NULL AND (a.last_checked_at IS NULL OR a.last_checked_at < $1)
          ORDER BY a.last_checked_at NULLS FIRST, a.hotel_id LIMIT $2`,
        [new Date(now.getTime() - 6 * 3_600_000).toISOString(), limit],
      );
      return r.rows.map((x) => String(x.hotel_id));
    },
    async duePurge(today, limit) {
      // every provisioned hotel, whatever its reading switch, and also those that never saved Settings > Email (no row yet): C5 holds for all
      const r = await q(
        `SELECT h.id FROM platform.hotels h LEFT JOIN platform.conv_channel_accounts a ON a.hotel_id = h.id AND a.channel = 'email'
          WHERE h.provisioned_at IS NOT NULL AND h.deleted_at IS NULL AND (a.id IS NULL OR a.last_purged_at IS NULL OR a.last_purged_at < $1)
          ORDER BY a.last_purged_at NULLS FIRST, h.id LIMIT $2`,
        [today.toISOString(), limit],
      );
      return r.rows.map((x) => String(x.id));
    },
    async markPurged(hotelId, at) {
      if (hotelId === null) {
        await q(`UPDATE platform.conv_channel_accounts SET last_purged_at = $1 WHERE hotel_id IS NULL AND channel = 'email'`, [at.toISOString()]);
        return;
      }
      await q(
        `INSERT INTO platform.conv_channel_accounts (hotel_id, channel, status, last_purged_at) VALUES ($1, 'email', 'off', $2)
         ON CONFLICT (${OWNER}) DO UPDATE SET last_purged_at = EXCLUDED.last_purged_at`,
        [hotelId, at.toISOString()],
      );
    },
  };
}

/** Who an address or a number belongs to on the platform: a platform account first, then a hotel's own address. */
export function pgPlatformLinkMatcher(db: SqlClient): LinkMatcher {
  const q = (text: string, params?: readonly unknown[]) => db.query(text, params);
  const user = async (cond: string, value: string): Promise<LinkTarget | null> => {
    const r = await q(`SELECT id, display_name FROM platform.people WHERE deleted_at IS NULL AND ${cond} ORDER BY created_at, id LIMIT 1`, [value]);
    return r.rows[0] ? { kind: "user", id: String(r.rows[0].id), label: String(r.rows[0].display_name) } : null;
  };
  return {
    async byEmail(email) {
      const found = await user("email = $1", email.toLowerCase());
      if (found) return found;
      const h = await q(`SELECT id, name FROM platform.hotels WHERE deleted_at IS NULL AND email IS NOT NULL AND lower(btrim(email)) = $1 ORDER BY created_at, id LIMIT 1`, [email.toLowerCase()]);
      return h.rows[0] ? { kind: "hotel", id: String(h.rows[0].id), label: String(h.rows[0].name) } : null;
    },
    async byPhone(digits) {
      const key = last10(digits);
      return key.length === 10 ? user("mobile IS NOT NULL AND right(regexp_replace(mobile, '[^0-9]', '', 'g'), 10) = $1", key) : null;
    },
    async search(words, kinds) {
      const out: LinkCandidateRecord[] = [];
      if (kinds.includes("user")) {
        const params: unknown[] = [];
        const cond = wordsCondition("concat_ws(' ', display_name, email, username)", words, params);
        for (const r of (await q(`SELECT id, display_name, email FROM platform.people WHERE deleted_at IS NULL AND ${cond} ORDER BY display_name LIMIT 20`, params)).rows) out.push({ kind: "user", id: String(r.id), label: String(r.display_name), detail: asText(r.email) });
      }
      if (kinds.includes("hotel")) {
        const params: unknown[] = [];
        const cond = wordsCondition("concat_ws(' ', name, email, slug)", words, params);
        for (const r of (await q(`SELECT id, name FROM platform.hotels WHERE deleted_at IS NULL AND ${cond} ORDER BY name LIMIT 20`, params)).rows) out.push({ kind: "hotel", id: String(r.id), label: String(r.name), detail: null });
      }
      return out.slice(0, 20);
    },
    async details(link) {
      if (link.kind === "user") {
        const r = await q(`SELECT display_name FROM platform.people WHERE id = $1`, [link.id]);
        return r.rows[0] ? { label: String(r.rows[0].display_name) } : null;
      }
      if (link.kind === "hotel") {
        const r = await q(`SELECT name FROM platform.hotels WHERE id = $1`, [link.id]);
        return r.rows[0] ? { label: String(r.rows[0].name), hotelName: String(r.rows[0].name) } : null;
      }
      return null;
    },
    async exists(kind: ConvLinkKind, id) {
      if (!UUID.test(id)) return null;
      if (kind === "user") {
        const r = await q(`SELECT id, display_name FROM platform.people WHERE id = $1 AND deleted_at IS NULL`, [id]);
        return r.rows[0] ? { kind, id, label: String(r.rows[0].display_name) } : null;
      }
      if (kind === "hotel") {
        const r = await q(`SELECT id, name FROM platform.hotels WHERE id = $1 AND deleted_at IS NULL`, [id]);
        return r.rows[0] ? { kind, id, label: String(r.rows[0].name) } : null;
      }
      return null;
    },
  };
}

/** The platform's Conversations repositories over one platform-unit connection (createPlatformUnit). */
export function pgPlatformConversations(db: SqlClient): PlatformConversationsRepos {
  return { conversations: pgConversationsRepo(db, { schema: "platform." }), matcher: pgPlatformLinkMatcher(db), accounts: pgChannelAccounts(db) };
}

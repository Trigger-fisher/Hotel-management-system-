import "server-only";
import type { InboundEntry } from "../../conversations/channel";
import type { SqlClient } from "../../../db/types";
import type { ClientPool, WithHotel } from "../../../db/withHotel";
import { hashNumber, whatsappConfig } from "../../whatsapp/config";
import type { InboundMessage, SaveTarget, WaInboxStore } from "../../whatsapp/inbound";
import { pgConversationsRepo, pgHotelLinkMatcher } from "./conversations";
import { pgPlatformLinkMatcher } from "./platformConversations";
import { createPlatformUnit } from "./platformUnit";

// The PostgreSQL side of the WhatsApp inbound path (phase 1 task 7). A hotel's message goes into THAT hotel's own Conversations tables inside withHotel (the hotel's role and search path are the
// isolation; nothing here names another hotel); the platform line's goes into the platform's own conversation tables. The save itself is the hub's own ingest (the one email uses), so a
// WhatsApp contact is found or made by its phone handle and linked to a guest or stay the same way; this adds the line, the 24-hour window and the notes of the plan (message index, last wrote
// time, daily received count, opt-outs). Every statement is idempotent: a repeated event changes nothing.
const DAY_MS = 86_400_000;

const previewOf = (m: InboundMessage): string => {
  if (m.text) return m.text.slice(0, 240);
  const kind = m.media?.kind;
  return typeof kind === "string" ? `[${kind}]` : m.type === "unsupported" ? "[unsupported message]" : `[${m.type}]`;
};

function entryOf(m: InboundMessage): InboundEntry {
  return {
    channel: "whatsapp",
    direction: "in",
    externalId: m.wamid,
    sentAt: m.at,
    person: m.digits,
    personName: m.name,
    from: m.digits,
    replyTo: null,
    to: [],
    cc: [],
    subject: null,
    preview: previewOf(m),
    hasAttachments: m.media !== null,
    inReplyTo: null,
    references: [],
    box: "main",
    // Meta has checked the number: it may link the contact to a guest or stay by phone
    senderVerified: true,
    sentFrom: "contact",
    status: "received",
    whatsapp: { type: m.type, text: m.text ?? undefined, media: m.media ?? undefined, sentFrom: "contact", status: "received", contextId: m.contextWamid ?? undefined },
  };
}

// a reaction replaces the guest's earlier one on that message; an empty emoji takes it away
const reactionSql = (prefix: string): string =>
  `UPDATE ${prefix}conv_messages SET wa_reactions = (
       SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(coalesce(wa_reactions, '[]'::jsonb)) e WHERE (e ->> 'fromContact')::boolean IS NOT TRUE
     ) || CASE WHEN $2::text = '' THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('emoji', $2::text, 'fromContact', true)) END
   WHERE channel = 'whatsapp' AND external_id = $1`;

export function createPgWhatsAppInbox(deps: { pool: ClientPool; withHotel: WithHotel }): WaInboxStore {
  const unit = createPlatformUnit(deps.pool, (db) => db);
  const hotel = <T>(hotelId: string, work: (db: SqlClient) => Promise<T>): Promise<T> => deps.withHotel({ hotelId }, (tx) => work(tx));
  const onPlatform = <T>(work: (db: SqlClient) => Promise<T>): Promise<T> => unit.run(work);
  const where = <T>(target: SaveTarget, work: (db: SqlClient, prefix: "" | "platform.") => Promise<T>): Promise<T> =>
    target.kind === "hotel" ? hotel(target.hotelId, (db) => work(db, "")) : onPlatform((db) => work(db, "platform."));
  const hashKey = (): Buffer => {
    const key = whatsappConfig()?.hashKey;
    if (!key) throw new Error("WhatsApp is not configured");
    return key;
  };

  return {
    async saveInbound(target, m, lineId) {
      return where(target, async (db, prefix) => {
        const repo = pgConversationsRepo(db, { schema: prefix });
        const matcher = target.kind === "hotel" ? pgHotelLinkMatcher(db) : pgPlatformLinkMatcher(db);
        const result = await repo.ingest([entryOf(m)], { mailbox: null }, matcher, new Date());
        await db.query(`UPDATE ${prefix}conv_messages SET line_id = $1 WHERE channel = 'whatsapp' AND external_id = $2 AND line_id IS NULL`, [lineId, m.wamid]);
        if (result.added > 0) {
          // Meta's 24-hour window opens at the guest's message
          await db.query(`UPDATE ${prefix}conv_conversations SET wa_window_closes_at = GREATEST(coalesce(wa_window_closes_at, $2::timestamptz), $2::timestamptz) WHERE id = ANY($1::uuid[])`, [result.conversationIds, new Date(m.at.getTime() + DAY_MS)]);
        }
        return { created: result.added > 0, conversationIds: result.conversationIds };
      });
    },

    async mediaPending(target, wamid) {
      return where(target, async (db, prefix) => (await db.query(`SELECT 1 FROM ${prefix}conv_messages WHERE channel = 'whatsapp' AND external_id = $1 AND wa_media ->> 'pending' = 'true'`, [wamid])).rows.length > 0);
    },

    async attachMedia(target, wamid, patch) {
      await where(target, (db, prefix) => db.query(`UPDATE ${prefix}conv_messages SET wa_media = coalesce(wa_media, '{}'::jsonb) || $2::jsonb || '{"pending": false}'::jsonb WHERE channel = 'whatsapp' AND external_id = $1 AND wa_media ->> 'pending' = 'true'`, [wamid, JSON.stringify(patch)]));
    },

    async applyReaction(target, reaction) {
      return where(target, async (db, prefix) => (await db.query(reactionSql(prefix), [reaction.targetWamid, reaction.emoji])).affectedRows > 0);
    },

    async indexMessage(lineId, wamid, hotelId, direction) {
      await onPlatform((db) => db.query("INSERT INTO platform.whatsapp_message_index (line_id, wamid, hotel_id, direction) VALUES ($1, $2, $3, $4) ON CONFLICT (line_id, wamid) DO NOTHING", [lineId, wamid, hotelId, direction]));
    },

    async touchGuestHotel(hotelId, digits, at) {
      await onPlatform((db) =>
        db.query(
          `UPDATE platform.guest_hotels gh SET wa_last_in_at = greatest(coalesce(gh.wa_last_in_at, $3::timestamptz), $3::timestamptz)
           FROM platform.guests g WHERE g.id = gh.guest_id AND gh.hotel_id = $1 AND g.mobile = $2 AND g.merged_into IS NULL`,
          [hotelId, `+${digits}`, at],
        ),
      );
    },

    async countReceived(target, lineId, at) {
      // a day's count is per hotel; the platform line is counted per person when it sends, not here
      if (target.kind !== "hotel") return;
      await hotel(target.hotelId, (db) =>
        db.query(
          `INSERT INTO wa_usage (day, line_id, category, received) VALUES (($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date, $1, 'service', 1)
           ON CONFLICT (day, line_id, category) DO UPDATE SET received = wa_usage.received + 1`,
          [lineId, at],
        ),
      );
    },

    async recordOptOut(hotelId, digits, lineId) {
      await hotel(hotelId, (db) => db.query("INSERT INTO wa_optouts (phone_digits, line_id) VALUES ($1, $2) ON CONFLICT (phone_digits) DO NOTHING", [digits, lineId]));
    },

    async removeOptOut(hotelId, digits) {
      await hotel(hotelId, (db) => db.query("DELETE FROM wa_optouts WHERE phone_digits = $1", [digits]));
    },

    async suppressEverywhere(digits, reason) {
      const key = hashKey();
      await onPlatform((db) => db.query("INSERT INTO platform.whatsapp_suppressions (number_hash, hotel_id, reason) VALUES ($1, NULL, $2) ON CONFLICT (number_hash) WHERE hotel_id IS NULL DO NOTHING", [hashNumber(key, digits), reason]));
    },

    async liftSuppression(digits) {
      const key = hashKey();
      await onPlatform((db) => db.query("DELETE FROM platform.whatsapp_suppressions WHERE number_hash = $1 AND hotel_id IS NULL AND reason IN ('stop', 'stop_all')", [hashNumber(key, digits)]));
    },
  };
}

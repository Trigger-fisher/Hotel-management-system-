import "server-only";
// The Conversations repositories on PostgreSQL (repos/conversations.ts; the in-memory double repos/memory/conversations.ts is the reference for every rule). The same code
// serves a hotel (unqualified names: the hotel's schema is first on search_path) and the platform ("platform." names): the prefix is one of two constants, never input.
// Values only through $n. A missing table (the migration not run yet, SQLSTATE 42P01) is thrown as ConversationsNotReady; the transaction is then over (the unit rolls it back)
// and the service answers from outside it. Ingest: duplicates in a batch are dropped first; a message is added with ON CONFLICT (channel, external_id) DO NOTHING, so a
// second check of the same mail adds nothing and counts nothing; the conversation's newest-message fields move only forward (GREATEST).
import { EMAIL_FOLDERS, sharedDesk, type ConvBox, type ConvChannel, type ConvChannelFilter, type ConvLinkKind, type ConvTab, type EmailFolder } from "@shared/dashboards/conversations";
import type { TxClient, SqlClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type { InboundEntry, Position } from "../../conversations/channel";
import { last10 } from "../../conversations/match";
import { ConversationsNotReady, type ContactLink, type ConvDraftRecord, type ConversationListRecord, type ConversationRecord, type ConversationsRepo, type ConversationsRepos, type ConvMessageRecord, type ConvNoteRecord, type IngestResult, type LinkCandidateRecord, type LinkMatcher, type LinkTarget, type QuickReplyRecord } from "../conversations";
import { RepoError, type Unit } from "../types";
import { dedupeBatch, handleOfEntry } from "../memory/conversations";
import { pgAdminRepos } from "./admin";
import { pgBillingRepos } from "./billing";
import { asDate, asText, countTotal, guard, wordsCondition } from "./shared";
import { createPgUnit } from "./unit";

type Row = Record<string, unknown>;
type Prefix = "" | "platform." | "platform.group_" | "platform.pmail_";

/** The link columns of a contact: a hotel's (guest, stay, booking, company) or the platform's (user, hotel). */
const LINKS: Record<Prefix, readonly { kind: ConvLinkKind; column: string }[]> = {
  "": [
    { kind: "customer", column: "customer_id" },
    { kind: "stay", column: "stay_id" },
    { kind: "reservation", column: "reservation_id" },
    { kind: "company", column: "company_id" },
  ],
  "platform.": [
    { kind: "user", column: "user_id" },
    { kind: "hotel", column: "hotel_id" },
  ],
  // a group's own inbox (platform 0166: platform.group_conv_*): the platform's shapes, every row carrying its group
  "platform.group_": [
    { kind: "user", column: "user_id" },
    { kind: "hotel", column: "hotel_id" },
  ],
  // a Super Admin's or Platform Admin's personal mailbox (platform 0178: platform.pmail_conv_*): the same shapes, every row carrying its login
  "platform.pmail_": [
    { kind: "user", column: "user_id" },
    { kind: "hotel", column: "hotel_id" },
  ],
};

/** A query that turns "the table is not there" into ConversationsNotReady. */
export function notReadyGuard(db: SqlClient): SqlClient {
  return {
    async query(text, params) {
      try {
        return await db.query(text, params);
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === "42P01") throw new ConversationsNotReady();
        throw error;
      }
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const list = (v: unknown): string[] => (typeof v === "string" && v !== "" ? v.split(/[\s,]+/).filter(Boolean) : []);

/** The tab rule of ui-shared inTab as SQL over `v` ($me already pushed as text); on the shared desk (sharedDesk: WhatsApp) every chat counts as open. */
export function tabSql(tab: ConvTab, me: string, channel?: ConvChannelFilter): string {
  const open = sharedDesk(channel) ? "" : " AND v.status = 'open'";
  switch (tab) {
    case "all":
      return `(v.box = 'main'${open})`;
    case "unread":
      return "(v.box = 'main' AND v.unread_count > 0)";
    case "mine":
      return `(v.assigned_to::text = ${me}${open})`;
    case "unassigned":
      return `(v.box = 'main'${open} AND v.assigned_to IS NULL)`;
    case "waiting":
      return `(v.box = 'main'${open} AND v.last_direction = 'in')`;
    case "done":
      return "(v.status = 'done')";
    case "other":
      return `(v.box = 'other'${open})`;
  }
}

/** The Email page's folder rule (ui-shared conversations.mock inFolder) as SQL over `v` ($me already pushed as text). Snoozed = hidden from the Inbox until then. */
export function folderSql(folder: EmailFolder, me: string): string {
  const snoozed = "(v.snoozed_until IS NOT NULL AND v.snoozed_until > now())";
  switch (folder) {
    case "inbox":
      return `(v.box = 'main' AND v.status = 'open' AND v.draft IS NULL AND NOT ${snoozed})`;
    case "snoozed":
      return snoozed;
    case "starred":
      return "(v.starred)";
    case "unread":
      return "(v.unread_count > 0 AND v.box = 'main')";
    case "sent":
      return `(v.draft IS NULL AND v.last_direction = 'out' OR v.draft IS NULL AND EXISTS (SELECT 1 FROM CONV_MESSAGES_TABLE m WHERE m.conversation_id = v.id AND m.direction = 'out'))`;
    case "drafts":
      return "(v.draft IS NOT NULL)";
    case "mine":
      return `(v.assigned_to::text = ${me} AND v.status = 'open')`;
    case "waiting":
      return "(v.box = 'main' AND v.status = 'open' AND v.last_direction = 'in')";
    case "unassigned":
      return "(v.box = 'main' AND v.status = 'open' AND v.assigned_to IS NULL)";
    case "archive":
      return "(v.status = 'done')";
    case "other":
      return "(v.box = 'other' AND v.status = 'open')";
  }
}

/** A saved draft (jsonb) as the record carries it; anything else is no draft. */
function draftOf(v: unknown): ConvDraftRecord | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  return { to: typeof d.to === "string" ? d.to : "", cc: Array.isArray(d.cc) ? d.cc.filter((x): x is string => typeof x === "string") : [], subject: typeof d.subject === "string" ? d.subject : "", text: typeof d.text === "string" ? d.text : "", at: typeof d.at === "string" ? d.at : new Date(0).toISOString() };
}

export function pgConversationsRepo(tx: SqlClient, options: { schema: Prefix }): ConversationsRepo {
  const S = options.schema;
  const db = notReadyGuard(tx);
  const q = (text: string, params?: readonly unknown[]) => db.query(text, params);
  const links = LINKS[S];
  const linkCols = links.map((l) => `c.${l.column}`).join(", ");
  // a group's inbox keeps its natural keys per group (platform 0166): the conflict targets carry group_id, filled by the database from the transaction's group
  // a personal mailbox does the same per login (platform 0178: login_id, filled by the database from hms.pmail_login_id)
  const G = S === "platform.group_" ? "group_id, " : S === "platform.pmail_" ? "login_id, " : "";

  const CONV_COLUMNS = `v.id, v.contact_id, v.status, v.box, v.assigned_to, v.assigned_by, v.assigned_at, v.last_message_at, v.last_channel, v.last_direction, v.last_inbound_at, v.channels, v.unread_count, v.wa_window_closes_at,
    v.starred, v.labels, v.snoozed_until, v.trashed_at, v.draft,
    c.display_name, ${linkCols}, c.link_source, c.linked_by, c.linked_at, c.muted,
    (SELECT COALESCE(json_agg(json_build_object('kind', h.kind, 'value', h.value) ORDER BY h.created_at, h.id), '[]'::json) FROM ${S}conv_contact_handles h WHERE h.contact_id = c.id) AS handles`;
  const FROM = `${S}conv_conversations v JOIN ${S}conv_contacts c ON c.id = v.contact_id`;

  const linkOf = (r: Row): ContactLink | null => {
    for (const l of links) if (r[l.column]) return { kind: l.kind, id: String(r[l.column]), source: r.link_source === "manual" ? "manual" : "auto" };
    return null;
  };
  const recordOf = (r: Row): ConversationRecord => ({
    id: String(r.id),
    contactId: String(r.contact_id),
    status: r.status === "done" ? "done" : "open",
    box: r.box === "other" ? "other" : "main",
    assignedTo: asText(r.assigned_to),
    assignedBy: asText(r.assigned_by),
    assignedAt: asDate(r.assigned_at),
    lastMessageAt: asDate(r.last_message_at) as Date,
    lastChannel: r.last_channel as ConvChannel,
    lastDirection: r.last_direction === "out" ? "out" : "in",
    lastInboundAt: asDate(r.last_inbound_at),
    channels: [...((r.channels as string[] | null) ?? [])].sort() as ConvChannel[],
    unreadCount: Number(r.unread_count),
    waWindowClosesAt: asDate(r.wa_window_closes_at),
    contact: {
      id: String(r.contact_id),
      displayName: asText(r.display_name),
      link: linkOf(r),
      linkedBy: asText(r.linked_by),
      linkedAt: asDate(r.linked_at),
      muted: r.muted === true,
      handles: ((r.handles as { kind: "email" | "phone"; value: string }[] | null) ?? []).map((h) => ({ kind: h.kind, value: h.value })),
    },
    starred: r.starred === true,
    labels: [...((r.labels as string[] | null) ?? [])],
    snoozedUntil: asDate(r.snoozed_until),
    trashedAt: asDate(r.trashed_at),
    draft: draftOf(r.draft),
  });
  const listRecordOf = (r: Row): ConversationListRecord => ({ ...recordOf(r), latestPreview: asText(r.l_preview), latestSubject: asText(r.l_subject), latestHasAttachments: r.l_attach === true, latestInboundVerified: r.li_verified === null || r.li_verified === undefined ? null : r.li_verified === true });
  const messageOf = (r: Row): ConvMessageRecord => ({
    id: String(r.id),
    conversationId: String(r.conversation_id),
    channel: r.channel as ConvChannel,
    direction: r.direction === "out" ? "out" : "in",
    status: r.status as ConvMessageRecord["status"],
    externalId: String(r.external_id),
    sentAt: asDate(r.sent_at) as Date,
    sentBy: asText(r.sent_by),
    sentFrom: r.sent_from as ConvMessageRecord["sentFrom"],
    senderVerified: r.sender_verified === null || r.sender_verified === undefined ? null : r.sender_verified === true,
    failureCode: asText(r.failure_code),
    preview: asText(r.preview),
    mailBox: asText(r.mail_box),
    mailFolder: (asText(r.mail_folder) as ConvMessageRecord["mailFolder"]) ?? null,
    mailUid: num(r.mail_uid),
    mailUidValidity: num(r.mail_uid_validity),
    subject: asText(r.subject),
    fromAddr: asText(r.from_addr),
    replyToAddr: asText(r.reply_to_addr),
    toAddrs: list(r.to_addrs),
    ccAddrs: list(r.cc_addrs),
    inReplyTo: asText(r.in_reply_to),
    referenceIds: list(r.reference_ids),
    hasAttachments: r.has_attachments === true,
    hasBill: r.has_bill === true,
    waType: asText(r.wa_type),
    waText: asText(r.wa_text),
    waMedia: (r.wa_media as Record<string, unknown> | null) ?? null,
    waContextId: asText(r.wa_context_id),
    waReactions: (r.wa_reactions as ConvMessageRecord["waReactions"]) ?? null,
  });
  const noteOf = (r: Row): ConvNoteRecord => ({ id: String(r.id), conversationId: String(r.conversation_id), authorId: String(r.author_id), body: String(r.body), createdAt: asDate(r.created_at) as Date });
  const quickOf = (r: Row): QuickReplyRecord => ({ id: String(r.id), title: String(r.title), body: String(r.body), channel: r.channel as QuickReplyRecord["channel"], sortOrder: Number(r.sort_order), createdBy: asText(r.created_by) });
  const positionOf = (r: Row): Position => ({ folder: r.folder === "sent" ? "sent" : "inbox", mailbox: String(r.mailbox), uidValidity: num(r.uid_validity), lastUid: Number(r.last_uid), checkedAt: asDate(r.checked_at), lastOkAt: asDate(r.last_ok_at), leaseUntil: asDate(r.lease_until), lastError: asText(r.last_error) });

  /** The filters shared by the list and the counts: the words (name, address or number, any subject) and the channel. */
  const filters = (words: readonly string[] | undefined, channel: "all" | ConvChannel, params: unknown[]): string => {
    const hay = `concat_ws(' ', c.display_name, (SELECT string_agg(h.value, ' ') FROM ${S}conv_contact_handles h WHERE h.contact_id = c.id), (SELECT string_agg(m.subject, ' ') FROM ${S}conv_messages m WHERE m.conversation_id = v.id AND m.subject IS NOT NULL))`;
    // a conversation in the Trash is in no list and no count
    const parts = [wordsCondition(hay, words, params), "v.trashed_at IS NULL"];
    if (channel !== "all") {
      params.push(channel);
      parts.push(`$${params.length}::text = ANY(v.channels)`);
    }
    return parts.join(" AND ");
  };

  /** The conversation's newest-message fields after one message (only forward), its unread count and status, and its box (rule 2). */
  const touchConversation = async (id: string, m: { sentAt: Date; channel: ConvChannel; direction: "in" | "out"; entryBox: ConvBox; muted: boolean; linked: boolean }): Promise<void> => {
    await q(
      `UPDATE ${S}conv_conversations SET
         last_channel = CASE WHEN $2::timestamptz >= last_message_at THEN $3::text ELSE last_channel END,
         last_direction = CASE WHEN $2::timestamptz >= last_message_at THEN $4::text ELSE last_direction END,
         last_message_at = GREATEST(last_message_at, $2::timestamptz),
         last_inbound_at = CASE WHEN $4::text = 'in' THEN GREATEST(COALESCE(last_inbound_at, $2::timestamptz), $2::timestamptz) ELSE last_inbound_at END,
         channels = CASE WHEN $3::text = ANY(channels) THEN channels ELSE array_append(channels, $3::text) END,
         unread_count = LEAST(100000, unread_count + CASE WHEN $4::text = 'in' THEN 1 ELSE 0 END),
         status = CASE WHEN $4::text = 'in' THEN 'open' ELSE status END,
         box = CASE WHEN $4::text <> 'in' THEN box WHEN $6::boolean THEN 'other' WHEN $7::boolean OR $5::text = 'main' THEN 'main' ELSE box END
       WHERE id = $1`,
      [id, m.sentAt.toISOString(), m.channel, m.direction, m.entryBox, m.muted, m.linked],
    );
  };

  const insertMessage = async (conversationId: string, externalId: string, e: InboundEntry): Promise<string | null> => {
    const r = await q(
      `INSERT INTO ${S}conv_messages (conversation_id, channel, direction, status, external_id, sent_at, sent_from, sender_verified, preview, mail_box, mail_folder, mail_uid, mail_uid_validity,
         subject, from_addr, reply_to_addr, to_addrs, cc_addrs, in_reply_to, reference_ids, has_attachments, wa_type, wa_text, wa_media, wa_context_id, wa_reactions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
       ON CONFLICT (${G}channel, external_id) DO NOTHING RETURNING id, (xmax = 0) AS inserted`,
      [
        conversationId, e.channel, e.direction, e.status, externalId, e.sentAt.toISOString(), e.sentFrom, e.senderVerified, e.preview.slice(0, 240) || null, e.mail?.mailbox ?? null, e.mail?.folder ?? null,
        e.mail?.uid ?? null, e.mail?.uidValidity ?? null, e.subject?.slice(0, 500) ?? null, e.from?.slice(0, 254) ?? null, e.replyTo?.slice(0, 254) ?? null, e.to.join(", ").slice(0, 2000) || null,
        e.cc.join(", ").slice(0, 2000) || null, e.inReplyTo, e.references.join(" ").slice(-4000) || null, e.hasAttachments, e.whatsapp?.type ?? null, e.whatsapp?.text ?? null,
        e.whatsapp?.media ? JSON.stringify(e.whatsapp.media) : null, e.whatsapp?.contextId ?? null, e.whatsapp?.reactions ? JSON.stringify(e.whatsapp.reactions) : null,
      ],
    );
    return r.rows[0] && r.rows[0].inserted === true ? String(r.rows[0].id) : null;
  };

  const repo: ConversationsRepo = {
    async list(query) {
      const params: unknown[] = [];
      let where = filters(query.words, query.channel, params);
      if (query.label) {
        params.push(query.label);
        where += ` AND $${params.length}::text = ANY(v.labels)`;
      }
      if (query.address) {
        params.push(query.address.toLowerCase());
        const p = `$${params.length}::text`;
        where += ` AND EXISTS (SELECT 1 FROM ${S}conv_messages am WHERE am.conversation_id = v.id AND am.channel = 'email' AND (lower(am.from_addr) = ${p} OR ${p} = ANY(regexp_split_to_array(lower(coalesce(am.to_addrs, '') || ',' || coalesce(am.cc_addrs, '')), '[\\s,]+'))))`;
      }
      // only the Mine tab (or folder) names the viewer (an unused parameter is an error in PostgreSQL)
      if (query.folder ? query.folder === "mine" : query.tab === "mine") params.push(query.me);
      const tab = query.folder ? folderSql(query.folder, `$${params.length}`).replace("CONV_MESSAGES_TABLE", `${S}conv_messages`) : tabSql(query.tab, `$${params.length}`, query.channel);
      const total = await countTotal(tx as TxClient, query, `SELECT COUNT(*) AS n FROM ${FROM} WHERE ${where} AND ${tab}`, params).catch((e: unknown) => {
        if ((e as { code?: unknown } | null)?.code === "42P01") throw new ConversationsNotReady();
        throw e;
      });
      params.push(query.pageSize, (query.page - 1) * query.pageSize);
      const r = await q(
        `SELECT ${CONV_COLUMNS}, l.preview AS l_preview, l.subject AS l_subject, l.has_attachments AS l_attach, li.sender_verified AS li_verified
           FROM ${FROM}
           LEFT JOIN LATERAL (SELECT m.preview, m.subject, m.has_attachments FROM ${S}conv_messages m WHERE m.conversation_id = v.id ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) l ON true
           LEFT JOIN LATERAL (SELECT m.sender_verified FROM ${S}conv_messages m WHERE m.conversation_id = v.id AND m.direction = 'in' AND m.channel = 'email' ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) li ON true
          WHERE ${where} AND ${tab}
          ORDER BY v.last_message_at DESC, v.id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: r.rows.map(listRecordOf), total };
    },
    async counts(query) {
      const params: unknown[] = [];
      const where = filters(query.words, query.channel, params);
      params.push(query.me);
      const me = `$${params.length}`;
      const tabs: ConvTab[] = ["all", "unread", "mine", "unassigned", "waiting", "done", "other"];
      const r = await q(`SELECT ${tabs.map((t) => `COUNT(*) FILTER (WHERE ${tabSql(t, me, query.channel)}) AS "${t}"`).join(", ")} FROM ${FROM} WHERE ${where}`, params);
      return Object.fromEntries(tabs.map((t) => [t, Number(r.rows[0]?.[t] ?? 0)])) as Record<ConvTab, number>;
    },
    async folderCounts(query) {
      const params: unknown[] = [];
      const where = filters(query.words, query.channel, params);
      params.push(query.me);
      const me = `$${params.length}`;
      const r = await q(`SELECT ${EMAIL_FOLDERS.map((f) => `COUNT(*) FILTER (WHERE ${folderSql(f, me).replace("CONV_MESSAGES_TABLE", `${S}conv_messages`)}) AS "${f}"`).join(", ")} FROM ${FROM} WHERE ${where}`, params);
      return Object.fromEntries(EMAIL_FOLDERS.map((f) => [f, Number(r.rows[0]?.[f] ?? 0)])) as Record<EmailFolder, number>;
    },
    async setExtras(id, patch) {
      if (!UUID.test(id)) return false;
      const sets: string[] = [];
      const params: unknown[] = [id];
      const put = (column: string, value: unknown, cast = "") => {
        params.push(value);
        sets.push(`${column} = $${params.length}${cast}`);
      };
      if (patch.starred !== undefined) put("starred", patch.starred);
      if (patch.labels !== undefined) put("labels", patch.labels, "::text[]");
      if (patch.snoozedUntil !== undefined) put("snoozed_until", patch.snoozedUntil ? patch.snoozedUntil.toISOString() : null, "::timestamptz");
      if (patch.trashed !== undefined) sets.push(patch.trashed ? "trashed_at = now()" : "trashed_at = NULL");
      if (patch.draft !== undefined) put("draft", patch.draft ? JSON.stringify(patch.draft) : null, "::jsonb");
      if (sets.length === 0) return (await q(`SELECT 1 AS x FROM ${S}conv_conversations WHERE id = $1`, [id])).rows.length > 0;
      return (await q(`UPDATE ${S}conv_conversations SET ${sets.join(", ")} WHERE id = $1`, params)).affectedRows > 0;
    },
    async conversationForAddress(address, at) {
      const value = address.trim().toLowerCase();
      let contactId = asText((await q(`SELECT contact_id FROM ${S}conv_contact_handles WHERE kind = 'email' AND value = $1`, [value])).rows[0]?.contact_id);
      if (!contactId) {
        const made = String((await q(`INSERT INTO ${S}conv_contacts (display_name) VALUES (NULL) RETURNING id`)).rows[0].id);
        const handleRow = await q(`INSERT INTO ${S}conv_contact_handles (contact_id, kind, value) VALUES ($1, 'email', $2) ON CONFLICT (${G}kind, value) DO NOTHING RETURNING contact_id`, [made, value]);
        if (handleRow.rows[0]) contactId = made;
        else {
          // another request made this person a moment ago: theirs is kept
          await q(`DELETE FROM ${S}conv_contacts WHERE id = $1`, [made]);
          contactId = String((await q(`SELECT contact_id FROM ${S}conv_contact_handles WHERE kind = 'email' AND value = $1`, [value])).rows[0].contact_id);
        }
      }
      await q(`INSERT INTO ${S}conv_conversations (contact_id, box, last_message_at, last_channel, last_direction) VALUES ($1, 'main', $2, 'email', 'out') ON CONFLICT (contact_id) DO NOTHING`, [contactId, at.toISOString()]);
      // writing to the person again brings the conversation back from the Trash
      const c = await q(`UPDATE ${S}conv_conversations SET trashed_at = NULL WHERE contact_id = $1 RETURNING id`, [contactId]);
      return String(c.rows[0].id);
    },
    async unreadTotal() {
      const r = await q(`SELECT COUNT(*) AS n FROM ${S}conv_conversations WHERE box = 'main' AND unread_count > 0 AND trashed_at IS NULL`);
      return Number(r.rows[0].n);
    },
    async get(id) {
      if (!UUID.test(id)) return null;
      const r = await q(`SELECT ${CONV_COLUMNS} FROM ${FROM} WHERE v.id = $1`, [id]);
      return r.rows[0] ? recordOf(r.rows[0]) : null;
    },
    async messages(conversationId, query) {
      const params: unknown[] = [conversationId];
      let before = "";
      if (query.before) {
        params.push(query.before.toISOString());
        before = ` AND sent_at < $${params.length}::timestamptz`;
      }
      params.push(query.limit + 1);
      const r = await q(`SELECT * FROM ${S}conv_messages WHERE conversation_id = $1${before} ORDER BY sent_at DESC, id DESC LIMIT $${params.length}`, params);
      const rows = r.rows.slice(0, query.limit).map(messageOf).reverse();
      return { rows, hasOlder: r.rows.length > query.limit };
    },
    async message(conversationId, messageId) {
      if (!UUID.test(messageId) || !UUID.test(conversationId)) return null;
      const r = await q(`SELECT * FROM ${S}conv_messages WHERE id = $1 AND conversation_id = $2`, [messageId, conversationId]);
      return r.rows[0] ? messageOf(r.rows[0]) : null;
    },
    async messageByExternal(channel, externalId) {
      const r = await q(`SELECT * FROM ${S}conv_messages WHERE channel = $1 AND external_id = $2`, [channel, externalId]);
      return r.rows[0] ? messageOf(r.rows[0]) : null;
    },
    async mailSource(messageId) {
      const r = await q(`SELECT source FROM ${S}conv_mail_sources WHERE message_id = $1::uuid`, [messageId]);
      const v = r.rows[0]?.source;
      return Buffer.isBuffer(v) ? v : null;
    },
    async saveMailSource(messageId, source) {
      await q(`INSERT INTO ${S}conv_mail_sources (message_id, source) VALUES ($1::uuid, $2) ON CONFLICT (message_id) DO NOTHING`, [messageId, source]);
    },
    async knownMessageIds(ids) {
      if (ids.length === 0) return new Set();
      const r = await q(`SELECT external_id FROM ${S}conv_messages WHERE channel = 'email' AND external_id = ANY($1::text[])`, [ids]);
      return new Set(r.rows.map((x) => String(x.external_id)));
    },
    async ingest(entries, own, matcher, at) {
      const result: IngestResult = { added: 0, conversationIds: [], newInbound: [] };
      const mailbox = own.mailbox?.toLowerCase() ?? null;
      for (const e of dedupeBatch(entries)) {
        let externalId = e.externalId;
        const existing = (await q(`SELECT id, direction, sent_from, mail_uid, mail_folder, from_addr FROM ${S}conv_messages WHERE channel = $1 AND external_id = $2`, [e.channel, externalId])).rows[0];
        if (existing) {
          const ourCopy = mailbox !== null && e.from === mailbox;
          if (e.mail?.folder === "sent" && ourCopy && existing.direction === "out" && existing.sent_from === "hms" && existing.mail_uid === null) {
            await q(`UPDATE ${S}conv_messages SET mail_uid = $2, mail_folder = 'sent', mail_uid_validity = $3, mail_box = $4 WHERE id = $1 AND mail_uid IS NULL`, [existing.id, e.mail.uid, e.mail.uidValidity, e.mail.mailbox]);
            continue;
          }
          // the same message read again (a renumbered folder, an overlapping first window): nothing new; where it now sits in the mailbox is kept
          if ((asText(existing.from_addr) ?? "") === (e.from ?? "")) {
            if (e.mail && existing.mail_folder === e.mail.folder) await q(`UPDATE ${S}conv_messages SET mail_uid = $2, mail_uid_validity = $3, mail_box = $4 WHERE id = $1`, [existing.id, e.mail.uid, e.mail.uidValidity, e.mail.mailbox]);
            continue;
          }
          if (ourCopy || !e.fallbackId || e.fallbackId === externalId) continue;
          externalId = e.fallbackId;
        }
        // the conversation: an HMS reply names its own; otherwise the person's handle
        let conversation: { id: string; contactId: string } | null = null;
        if (e.hmsConversation && UUID.test(e.hmsConversation)) {
          const r = await q(`SELECT id, contact_id FROM ${S}conv_conversations WHERE id = $1`, [e.hmsConversation]);
          if (r.rows[0]) conversation = { id: String(r.rows[0].id), contactId: String(r.rows[0].contact_id) };
        }
        if (!conversation) {
          const handle = handleOfEntry(e);
          if (!handle) continue;
          let contactId = asText((await q(`SELECT contact_id FROM ${S}conv_contact_handles WHERE kind = $1 AND value = $2`, [handle.kind, handle.value])).rows[0]?.contact_id);
          if (!contactId) {
            const target: LinkTarget | null = e.senderVerified === true || e.direction === "out" ? await (handle.kind === "email" ? matcher.byEmail(handle.value) : matcher.byPhone(handle.value)) : null;
            const col = target ? links.find((l) => l.kind === target.kind)?.column : undefined;
            const made = await q(
              `INSERT INTO ${S}conv_contacts (display_name${col ? `, ${col}, link_source, linked_at` : ""}) VALUES ($1${col ? ", $2, 'auto', $3" : ""}) RETURNING id`,
              col && target ? [e.direction === "in" ? (e.personName?.slice(0, 160) ?? null) : null, target.id, at.toISOString()] : [e.direction === "in" ? (e.personName?.slice(0, 160) ?? null) : null],
            );
            const newId = String(made.rows[0].id);
            const handleRow = await q(`INSERT INTO ${S}conv_contact_handles (contact_id, kind, value) VALUES ($1, $2, $3) ON CONFLICT (${G}kind, value) DO NOTHING RETURNING contact_id`, [newId, handle.kind, handle.value]);
            if (handleRow.rows[0]) contactId = newId;
            else {
              // another check made this person a moment ago: theirs is kept
              await q(`DELETE FROM ${S}conv_contacts WHERE id = $1`, [newId]);
              contactId = String((await q(`SELECT contact_id FROM ${S}conv_contact_handles WHERE kind = $1 AND value = $2`, [handle.kind, handle.value])).rows[0].contact_id);
            }
          } else if (e.direction === "in" && e.personName) {
            await q(`UPDATE ${S}conv_contacts SET display_name = $2 WHERE id = $1 AND display_name IS NULL`, [contactId, e.personName.slice(0, 160)]);
          }
          await q(
            `INSERT INTO ${S}conv_conversations (contact_id, box, last_message_at, last_channel, last_direction) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (contact_id) DO NOTHING`,
            [contactId, e.direction === "in" ? e.box : "main", e.sentAt.toISOString(), e.channel, e.direction],
          );
          const c = await q(`SELECT id FROM ${S}conv_conversations WHERE contact_id = $1 FOR UPDATE`, [contactId]);
          conversation = { id: String(c.rows[0].id), contactId };
        }
        const contact = (await q(`SELECT c.muted, ${linkCols}, c.display_name, (SELECT h.value FROM ${S}conv_contact_handles h WHERE h.contact_id = c.id ORDER BY h.created_at, h.id LIMIT 1) AS handle FROM ${S}conv_contacts c WHERE c.id = $1`, [conversation.contactId])).rows[0];
        const inserted = await insertMessage(conversation.id, externalId, e);
        if (!inserted) continue;
        result.added += 1;
        await touchConversation(conversation.id, { sentAt: e.sentAt, channel: e.channel, direction: e.direction, entryBox: e.box, muted: contact?.muted === true, linked: contact !== undefined && linkOf(contact) !== null });
        if (e.direction === "in" && !result.newInbound.some((n) => n.conversationId === conversation.id)) result.newInbound.push({ conversationId: conversation.id, name: asText(contact?.display_name) ?? asText(contact?.handle) ?? "" });
        if (!result.conversationIds.includes(conversation.id)) result.conversationIds.push(conversation.id);
      }
      return result;
    },
    async recordOutgoing(conversationId, m) {
      // a mail check may have read our own reply from Sent between the send and this record: that row is completed (who sent it, the bill), not refused; a row of the
      // same id that is not our reply in this conversation is left alone and refused as a duplicate
      const r = await guard(
        q(
          `INSERT INTO ${S}conv_messages AS x (conversation_id, channel, direction, status, external_id, sent_at, sent_by, sent_from, preview, mail_box, subject, from_addr, to_addrs, cc_addrs, in_reply_to, reference_ids, has_attachments, has_bill, wa_type)
           VALUES ($1, $2, 'out', $3, $4, $5, $6, 'hms', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (${G}channel, external_id) DO UPDATE SET sent_by = EXCLUDED.sent_by, sent_from = 'hms', has_bill = EXCLUDED.has_bill,
             has_attachments = x.has_attachments OR EXCLUDED.has_attachments, preview = COALESCE(x.preview, EXCLUDED.preview), mail_box = COALESCE(x.mail_box, EXCLUDED.mail_box)
             WHERE x.direction = 'out' AND x.conversation_id = EXCLUDED.conversation_id
           RETURNING *`,
          [conversationId, m.channel, m.status, m.externalId, m.sentAt.toISOString(), m.sentBy, m.preview.slice(0, 240) || null, m.mailBox, m.subject, m.fromAddr, m.toAddrs.join(", ").slice(0, 2000) || null, m.ccAddrs.join(", ").slice(0, 2000) || null, m.inReplyTo, m.referenceIds.join(" ").slice(-4000) || null, m.hasAttachments, m.hasBill, m.channel === "whatsapp" ? "text" : null],
        ),
      );
      if (!r.rows[0]) throw new RepoError("unique", "conv_messages_channel_external_id_key");
      await touchConversation(conversationId, { sentAt: m.sentAt, channel: m.channel, direction: "out", entryBox: "main", muted: false, linked: false });
      return messageOf(r.rows[0]);
    },
    async setAssignee(id, userId, by, at) {
      const r = await q(`UPDATE ${S}conv_conversations SET assigned_to = $2, assigned_by = $3, assigned_at = $4 WHERE id = $1`, [id, userId, userId ? by : null, userId ? at.toISOString() : null]);
      return r.affectedRows > 0;
    },
    async setStatus(id, status) {
      return (await q(`UPDATE ${S}conv_conversations SET status = $2 WHERE id = $1`, [id, status])).affectedRows > 0;
    },
    async setBox(id, box) {
      return (await q(`UPDATE ${S}conv_conversations SET box = $2 WHERE id = $1`, [id, box])).affectedRows > 0;
    },
    async setMuted(contactId, muted) {
      const r = await q(`UPDATE ${S}conv_contacts SET muted = $2 WHERE id = $1`, [contactId, muted]);
      if (muted) await q(`UPDATE ${S}conv_conversations SET box = 'other' WHERE contact_id = $1`, [contactId]);
      return r.affectedRows > 0;
    },
    async markRead(id) {
      return (await q(`UPDATE ${S}conv_conversations SET unread_count = 0 WHERE id = $1`, [id])).affectedRows > 0;
    },
    async markUnread(id) {
      return (await q(`UPDATE ${S}conv_conversations SET unread_count = GREATEST(unread_count, 1) WHERE id = $1`, [id])).affectedRows > 0;
    },
    async notes(conversationId) {
      return (await q(`SELECT * FROM ${S}conv_notes WHERE conversation_id = $1 ORDER BY created_at, id`, [conversationId])).rows.map(noteOf);
    },
    async addNote(conversationId, authorId, body, at) {
      const r = await guard(q(`INSERT INTO ${S}conv_notes (conversation_id, author_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING *`, [conversationId, authorId, body, at.toISOString()]));
      return noteOf(r.rows[0]);
    },
    async note(conversationId, noteId) {
      if (!UUID.test(noteId)) return null;
      const r = await q(`SELECT * FROM ${S}conv_notes WHERE id = $1 AND conversation_id = $2`, [noteId, conversationId]);
      return r.rows[0] ? noteOf(r.rows[0]) : null;
    },
    async removeNote(conversationId, noteId) {
      if (!UUID.test(noteId)) return false;
      return (await q(`DELETE FROM ${S}conv_notes WHERE id = $1 AND conversation_id = $2`, [noteId, conversationId])).affectedRows > 0;
    },
    async setLink(contactId, link, by, at) {
      const col = links.find((l) => l.kind === link.kind)?.column;
      if (!col) return false;
      const clear = links.filter((l) => l.column !== col).map((l) => `${l.column} = NULL`).join(", ");
      const r = await guard(q(`UPDATE ${S}conv_contacts SET ${col} = $2, ${clear}, link_source = $3, linked_by = $4, linked_at = $5 WHERE id = $1`, [contactId, link.id, link.source, by, at.toISOString()]));
      if (r.affectedRows > 0) await q(`UPDATE ${S}conv_conversations v SET box = 'main' FROM ${S}conv_contacts c WHERE c.id = v.contact_id AND c.id = $1 AND NOT c.muted`, [contactId]);
      return r.affectedRows > 0;
    },
    async clearLink(contactId) {
      const r = await q(`UPDATE ${S}conv_contacts SET ${links.map((l) => `${l.column} = NULL`).join(", ")}, link_source = NULL, linked_by = NULL, linked_at = NULL WHERE id = $1`, [contactId]);
      return r.affectedRows > 0;
    },
    async quickReplies() {
      return (await q(`SELECT * FROM ${S}conv_quick_replies ORDER BY sort_order, lower(title), id`)).rows.map(quickOf);
    },
    async addQuickReply(input, by) {
      const r = await guard(q(`INSERT INTO ${S}conv_quick_replies (title, body, channel, sort_order, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [input.title, input.body, input.channel, input.sortOrder, by]));
      return quickOf(r.rows[0]);
    },
    async updateQuickReply(id, input) {
      if (!UUID.test(id)) return null;
      const r = await guard(q(`UPDATE ${S}conv_quick_replies SET title = $2, body = $3, channel = $4, sort_order = $5 WHERE id = $1 RETURNING *`, [id, input.title, input.body, input.channel, input.sortOrder]));
      return r.rows[0] ? quickOf(r.rows[0]) : null;
    },
    async removeQuickReply(id) {
      if (!UUID.test(id)) return false;
      return (await q(`DELETE FROM ${S}conv_quick_replies WHERE id = $1`, [id])).affectedRows > 0;
    },
    async positions() {
      return (await q(`SELECT * FROM ${S}conv_mail_positions ORDER BY folder`)).rows.map(positionOf);
    },
    async acquireLease(mailbox, now, ms) {
      await q(`INSERT INTO ${S}conv_mail_positions (folder, mailbox) VALUES ('inbox', $1), ('sent', $1) ON CONFLICT (${G}folder) DO NOTHING`, [mailbox]);
      const r = await q(`UPDATE ${S}conv_mail_positions SET lease_until = $2 WHERE folder = 'inbox' AND (lease_until IS NULL OR lease_until < $1) RETURNING id`, [now.toISOString(), new Date(now.getTime() + ms).toISOString()]);
      return r.rows.length > 0;
    },
    async savePositions(mailbox, positions, result) {
      for (const p of positions) await q(`UPDATE ${S}conv_mail_positions SET mailbox = $2, uid_validity = $3, last_uid = $4 WHERE folder = $1`, [p.folder, mailbox, p.uidValidity, p.lastUid]);
      await q(`UPDATE ${S}conv_mail_positions SET checked_at = $1, last_ok_at = CASE WHEN $2::boolean THEN $1::timestamptz ELSE last_ok_at END, last_error = $3, lease_until = NULL`, [result.checkedAt.toISOString(), result.ok, result.error]);
    },
    async releaseLease() {
      await q(`UPDATE ${S}conv_mail_positions SET lease_until = NULL`);
    },
    async resetPositions(mailbox) {
      await q(`UPDATE ${S}conv_mail_positions SET mailbox = $1, uid_validity = NULL, last_uid = 0`, [mailbox]);
    },
    async purge(before) {
      const gone = await q(`DELETE FROM ${S}conv_messages WHERE sent_at < $1`, [before.toISOString()]);
      await q(`DELETE FROM ${S}conv_conversations v WHERE NOT EXISTS (SELECT 1 FROM ${S}conv_messages m WHERE m.conversation_id = v.id)`);
      await q(`DELETE FROM ${S}conv_contacts c WHERE NOT EXISTS (SELECT 1 FROM ${S}conv_conversations v WHERE v.contact_id = c.id)`);
      return gone.affectedRows;
    },
  };
  return repo;
}

// ------------------------------------------------------------------------------------------------ the hotel's matcher

/** In-house stay > latest stay > a coming booking > the guest record > the company: the first that has this address or number (the indexed expressions of hotel 0050). */
export function pgHotelLinkMatcher(tx: SqlClient): LinkMatcher {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  const STAY_LABEL = `s.guest_name || COALESCE(' · Room ' || r.number, '')`;
  const find = async (by: "email" | "phone", value: string): Promise<LinkTarget | null> => {
    const email = by === "email";
    const key = email ? value.toLowerCase() : last10(value);
    if (!email && key.length !== 10) return null;
    const cond = (col: string): string => (email ? `lower(btrim(${col})) = $1` : `right(regexp_replace(${col}, '[^0-9]', '', 'g'), 10) = $1`);
    const stay = await q(`SELECT s.id, ${STAY_LABEL} AS label FROM pms_stays s LEFT JOIN pms_rooms r ON r.id = s.room_id WHERE ${email ? "s.email IS NOT NULL AND " : "s.mobile IS NOT NULL AND "}${cond("s.email".replace("email", email ? "email" : "mobile"))} ORDER BY (s.status = 'in_house') DESC, s.check_in_at DESC, s.id DESC LIMIT 1`, [key]);
    if (stay.rows[0]) return { kind: "stay", id: String(stay.rows[0].id), label: String(stay.rows[0].label) };
    const res = await q(`SELECT id, guest_name || COALESCE(' · ' || reference, '') AS label FROM pms_reservations WHERE status IN ('confirmed', 'checked_in') AND ${email ? "email IS NOT NULL" : "mobile IS NOT NULL"} AND ${cond(email ? "email" : "mobile")} ORDER BY check_in DESC, id DESC LIMIT 1`, [key]);
    if (res.rows[0]) return { kind: "reservation", id: String(res.rows[0].id), label: String(res.rows[0].label) };
    const cust = await q(`SELECT id, name FROM customers WHERE ${email ? "email IS NOT NULL AND " : ""}${cond(email ? "email" : "mobile")} ORDER BY created_at DESC, id DESC LIMIT 1`, [key]);
    if (cust.rows[0]) return { kind: "customer", id: String(cust.rows[0].id), label: String(cust.rows[0].name) };
    if (!email) return null;
    const co = await q(`SELECT id, name FROM company_profiles WHERE deleted_at IS NULL AND email IS NOT NULL AND lower(btrim(email)) = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [key]);
    return co.rows[0] ? { kind: "company", id: String(co.rows[0].id), label: String(co.rows[0].name) } : null;
  };
  return {
    byEmail: (email) => find("email", email),
    byPhone: (digits) => find("phone", digits),
    async search(words, kinds) {
      const out: LinkCandidateRecord[] = [];
      const run = async (kind: ConvLinkKind, sql: (cond: string) => string, hay: string): Promise<void> => {
        if (!kinds.includes(kind)) return;
        const params: unknown[] = [];
        const cond = wordsCondition(hay, words, params);
        for (const r of (await q(sql(cond), params)).rows) out.push({ kind, id: String(r.id), label: String(r.label), detail: asText(r.detail) });
      };
      await run("stay", (c) => `SELECT s.id, ${STAY_LABEL} AS label, to_char(s.check_in_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') || ' to ' || s.expected_check_out::text AS detail FROM pms_stays s LEFT JOIN pms_rooms r ON r.id = s.room_id WHERE ${c} ORDER BY (s.status = 'in_house') DESC, s.check_in_at DESC LIMIT 20`, "concat_ws(' ', s.guest_name, s.email, s.mobile)");
      await run("reservation", (c) => `SELECT id, guest_name || COALESCE(' · ' || reference, '') AS label, check_in::text || ' to ' || check_out::text AS detail FROM pms_reservations WHERE status IN ('confirmed', 'checked_in') AND ${c} ORDER BY check_in DESC LIMIT 20`, "concat_ws(' ', guest_name, email, mobile, reference)");
      await run("customer", (c) => `SELECT id, name AS label, mobile AS detail FROM customers WHERE ${c} ORDER BY name LIMIT 20`, "concat_ws(' ', name, email, mobile)");
      await run("company", (c) => `SELECT id, name AS label, email AS detail FROM company_profiles WHERE deleted_at IS NULL AND ${c} ORDER BY name LIMIT 20`, "concat_ws(' ', name, email)");
      return out.slice(0, 20);
    },
    async details(link) {
      if (link.kind === "stay") {
        const r = await q(
          `SELECT s.guest_name, r.number AS room, to_char(s.check_in_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS check_in, COALESCE(to_char(s.check_out_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD'), s.expected_check_out::text) AS check_out, s.status,
                  b.id AS bill_id, b.bill_number, (b.total_hotel_amount_paise + b.total_food_amount_paise)::text AS bill_total
             FROM pms_stays s LEFT JOIN pms_rooms r ON r.id = s.room_id LEFT JOIN bill_master_bills b ON b.id = s.bill_id AND b.deleted_at IS NULL WHERE s.id = $1`,
          [link.id],
        );
        const x = r.rows[0];
        return x ? { label: String(x.guest_name), room: asText(x.room), checkIn: asText(x.check_in), checkOut: asText(x.check_out), status: asText(x.status), billId: asText(x.bill_id), billNo: asText(x.bill_number), billTotalPaise: x.bill_total === null || x.bill_total === undefined ? null : Number(x.bill_total) } : null;
      }
      if (link.kind === "reservation") {
        const r = await q(`SELECT guest_name || COALESCE(' · ' || reference, '') AS label, check_in::text AS check_in, check_out::text AS check_out, status FROM pms_reservations WHERE id = $1`, [link.id]);
        const x = r.rows[0];
        return x ? { label: String(x.label), checkIn: asText(x.check_in), checkOut: asText(x.check_out), status: asText(x.status) } : null;
      }
      if (link.kind === "customer") {
        const r = await q(`SELECT name FROM customers WHERE id = $1`, [link.id]);
        return r.rows[0] ? { label: String(r.rows[0].name) } : null;
      }
      if (link.kind === "company") {
        const r = await q(`SELECT name FROM company_profiles WHERE id = $1 AND deleted_at IS NULL`, [link.id]);
        return r.rows[0] ? { label: String(r.rows[0].name) } : null;
      }
      return null;
    },
    async exists(kind, id) {
      if (!UUID.test(id)) return null;
      const sql: Partial<Record<ConvLinkKind, string>> = {
        stay: `SELECT s.id, ${STAY_LABEL} AS label FROM pms_stays s LEFT JOIN pms_rooms r ON r.id = s.room_id WHERE s.id = $1`,
        reservation: `SELECT id, guest_name || COALESCE(' · ' || reference, '') AS label FROM pms_reservations WHERE id = $1`,
        customer: `SELECT id, name AS label FROM customers WHERE id = $1`,
        company: `SELECT id, name AS label FROM company_profiles WHERE id = $1 AND deleted_at IS NULL`,
      };
      const text = sql[kind];
      if (!text) return null;
      const r = await q(text, [id]);
      return r.rows[0] ? { kind, id, label: String(r.rows[0].label) } : null;
    },
  };
}

/** ONE withHotel transaction over the hub, the matcher, and the settings, hotel name and system log the Conversations service reads. */
export function pgConversationsRepos(tx: TxClient): ConversationsRepos {
  const admin = pgAdminRepos(tx);
  const billing = pgBillingRepos(tx);
  return { conversations: pgConversationsRepo(tx, { schema: "" }), matcher: pgHotelLinkMatcher(tx), adminSettings: admin.adminSettings, hotelProfile: billing.hotelProfile, systemLogs: billing.systemLogs };
}

export function createPgConversationsUnit(withHotel: WithHotel): Unit<ConversationsRepos> {
  return createPgUnit(withHotel, pgConversationsRepos);
}

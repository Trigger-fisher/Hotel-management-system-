import "server-only";
import { randomUUID } from "node:crypto";
import type { ConvPerson } from "@shared/dashboards/conversations";
import { getDatabase } from "../../db";
import type { SqlClient } from "../../db/types";
import type { VerifiedSession } from "../auth/session";
import { getConfig } from "../config/env";
import { AppError } from "../errors";
import { getLogger } from "../logger";
import { failureCodeOf } from "../mail/failure";
import { isServiceSideFailure } from "../mail/failover";
import { readGroupMail, serversOf } from "../mail/hotelMail";
import { createImapClientFactory } from "../mail/imap";
import { smtpSecretKeyOf } from "../mail/key";
import { mailAddressOf, sendingDomainOf } from "../mail/sendingDomain";
import { composeReply, createSmtpSender } from "../mail/smtp";
import type { ConversationsRepos, LinkMatcher } from "../repos/conversations";
import { createMemoryConversationsHotel } from "../repos/memory/conversations";
import { pgConversationsRepo } from "../repos/postgres/conversations";
import { createPlatformUnit } from "../repos/postgres/platformUnit";
import type { Unit } from "../repos/types";
import type { MailAttachment, MailMessage } from "../services/auth/mail";
import { createConversationsService, type ConversationsService } from "../services/conversations/conversationsService";
import { billingDefaults } from "./billing";
import { liveGroupUnit } from "./convLive";

// A group's own inbox (MJ, 2 Nov 2026: "group's own inbox"; platform 0166). Mail to <group slug without dashes>@<the platform sending domain> is kept whole in platform.group_conv_*, every row
// carrying its group; row level security shows a transaction only the rows of the group it set (hms.group_id), so one group never reads another's mail. The Group Admin reads, writes and replies
// from the group console's Email page. The SAME conversations service as a hotel's runs it: the unit below opens the group's rows for a "group session" (the group's id where a hotel's would be,
// full rights), the matcher links nothing, there is no mailbox to read, and mail goes out through the group's own accounts (its SES, its Google), then the platform's, from the group's address.

const log = (message: string, fields: Record<string, unknown>): void => getLogger().info(message, fields);

async function platformQuery(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const client = await getDatabase().pool.connect();
  try {
    return (await client.query(text, params)).rows as Record<string, unknown>[];
  } finally {
    client.release();
  }
}

/** A group links its contacts to nothing (no guests, no stays): every lookup answers none. */
const noLinks: LinkMatcher = {
  byEmail: async () => null,
  byPhone: async () => null,
  search: async () => [],
  details: async () => null,
  exists: async () => null,
};

/** The group's rows on one transaction: hms.group_id is set first, so row level security shows and accepts only this group's rows. */
function pgGroupUnit(): Unit<ConversationsRepos> {
  const unit = createPlatformUnit(getDatabase().pool, (db: SqlClient) => db);
  return {
    run: (session, work) =>
      unit.run(async (db) => {
        const groupId = session.hotelId;
        if (!/^[0-9a-f-]{36}$/i.test(groupId)) throw new AppError("FORBIDDEN");
        await db.query("SELECT set_config('hms.group_id', $1, true)", [groupId]);
        const repos: ConversationsRepos = {
          conversations: pgConversationsRepo(db, { schema: "platform.group_" }),
          matcher: noLinks,
          // no mailbox of its own to read: replies and new mail go out through the group's mail
          adminSettings: { get: async () => [] },
          hotelProfile: {
            header: async () => ({ name: String((await db.query("SELECT name FROM platform.hotel_groups WHERE id = $1::uuid", [groupId])).rows[0]?.name ?? "Group") }),
          },
          systemLogs: {
            write: async (e) => {
              await db.query(
                "INSERT INTO platform.group_conv_logs (action, summary, conversation_id, user_id, user_name, ip_address, trace_id) VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7)",
                [e.action, e.summary.slice(0, 300), e.subjectId, e.userId, e.userName.slice(0, 160), e.ipAddress, e.traceId],
              );
            },
          },
        };
        return work(repos);
      }),
  };
}

/** The active group this person is the Group Admin of (remembered half a minute), or null. */
const adminOf = new Map<string, { at: number; group: { id: string; name: string } | null }>();
async function groupOfAdmin(userId: string): Promise<{ id: string; name: string } | null> {
  const hit = adminOf.get(userId);
  if (hit && Date.now() - hit.at < 30_000) return hit.group;
  const { getPlatformConsoleUnit } = await import("./platform");
  const g = await getPlatformConsoleUnit().run(async (repos) => (await repos.groups.list()).find((x) => x.admin?.id === userId && x.status === "active") ?? null);
  const group = g ? { id: g.id, name: g.name } : null;
  adminOf.set(userId, { at: Date.now(), group });
  return group;
}

/** The id of the active group this person is the Group Admin of, or null (remembered half a minute). */
export async function groupIdOfAdmin(userId: string): Promise<string | null> {
  if (!getConfig().DATABASE_URL) return null;
  return (await groupOfAdmin(userId))?.id ?? null;
}

/**
 * The session the group inbox runs in: the Group Admin of an active group, never an API key and never during a visit. The group's id stands where a hotel's would, with full rights: the
 * group's own mail is the Group Admin's to read and answer.
 */
export async function asGroup(session: VerifiedSession): Promise<VerifiedSession> {
  if (session.client === "token" || session.token !== undefined || session.visit !== undefined) throw new AppError("FORBIDDEN");
  const group = await groupOfAdmin(session.userId);
  if (!group) throw new AppError("FORBIDDEN", "Only the Group Admin can open the group's Email.");
  return { ...session, hotelId: group.id, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, permissions: {} };
}

/** The group's admin, for "Assign". */
async function groupStaff(groupId: string): Promise<ConvPerson[]> {
  const { getPlatformConsoleUnit } = await import("./platform");
  const g = await getPlatformConsoleUnit().run(async (repos) => (await repos.groups.list()).find((x) => x.id === groupId) ?? null);
  return g?.admin ? [{ id: g.admin.id, name: g.admin.displayName }] : [];
}

/**
 * One email from the group: its own accounts first (Amazon SES, then Google; a service-side failure goes on), then the platform's mail as the group (its name, <slug>@<domain>). With `keep`,
 * the whole email as sent comes back, kept with its message in the group's rows.
 */
async function sendAsGroup(
  groupId: string,
  mail: { to: string; cc?: readonly string[]; bcc?: readonly string[]; subject: string; text: string; inReplyTo?: string | null; references?: readonly string[]; attachments?: MailAttachment[]; keep?: { conversationId: string; cc: readonly string[] } },
): Promise<{ messageId: string; sentAt: Date; source?: Buffer }> {
  const config = getConfig();
  const rows = await platformQuery(
    `SELECT g.name, g.slug, m.ses_region, m.ses_user, m.ses_password, m.ses_from, m.gmail_user, m.gmail_password, m.from_name, m.reply_to, m.pause,
       (SELECT value #>> '{}' FROM platform.platform_settings WHERE key = 'mail.from_email') AS from_email, (SELECT value #>> '{}' FROM platform.platform_settings WHERE key = 'mail.sending_domain') AS stored_domain
       FROM platform.hotel_groups g LEFT JOIN platform.group_mail m ON m.group_id = g.id WHERE g.id = $1::uuid AND g.deleted_at IS NULL`,
    [groupId],
  );
  const g = rows[0];
  if (!g) throw new AppError("NOT_FOUND");
  if (g.pause) throw new AppError("CONFLICT", "The group's mail is paused by the Super Admin.");
  const t = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const name = String(g.name);
  const slug = String(g.slug);
  const domain = sendingDomainOf(t(g.from_email), t(g.stored_domain));
  const own = t(g.ses_user) || t(g.gmail_user)
    ? readGroupMail({ groupId, sesRegion: t(g.ses_region), sesUser: t(g.ses_user), sesPassword: t(g.ses_password), sesFrom: t(g.ses_from), gmailUser: t(g.gmail_user), gmailPassword: t(g.gmail_password), fromName: t(g.from_name), replyTo: t(g.reply_to), sesTest: null, gmailTest: null, updatedAt: null }, smtpSecretKeyOf(config), name)
    : null;
  const messageId = `<${randomUUID()}@hms.mail>`;
  const message: MailMessage = { to: mail.to, ...(mail.cc && mail.cc.length > 0 ? { cc: [...mail.cc] } : {}), ...(mail.bcc && mail.bcc.length > 0 ? { bcc: [...mail.bcc] } : {}), subject: mail.subject, text: mail.text, messageId, ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}), ...(mail.references && mail.references.length > 0 ? { references: [...mail.references] } : {}), ...(mail.attachments ? { attachments: mail.attachments } : {}) };
  let sent = false;
  for (const server of serversOf(own)) {
    const sender = createSmtpSender(server);
    try {
      await sender.send({ ...message, useEnvironmentFrom: true });
      sent = true;
      break;
    } catch (error) {
      if (!isServiceSideFailure(failureCodeOf(error))) throw error;
      log("group mail: own account failed, trying the next", { groupId, code: failureCodeOf(error) });
    } finally {
      sender.close();
    }
  }
  if (!sent) {
    const platform = (await import("./mail")).mailSenderFor(config);
    if (!platform) throw new AppError("CONFLICT", "Mail cannot be sent from this server yet.");
    await platform.send({ ...message, fromName: name, fromLocal: slug });
  }
  const sentAt = new Date();
  if (!mail.keep) return { messageId, sentAt };
  try {
    const from = mailAddressOf(slug, domain) ?? "group@hms.invalid";
    const { raw } = await composeReply({ from }, { to: mail.to, cc: mail.keep.cc, subject: mail.subject, text: mail.text, inReplyTo: mail.inReplyTo ?? null, references: mail.references ?? [], messageId, conversationId: mail.keep.conversationId, ...(mail.attachments ? { attachments: mail.attachments } : {}), bill: mail.attachments !== undefined, date: sentAt });
    return { messageId, sentAt, source: raw };
  } catch {
    return { messageId, sentAt };
  }
}

/** The address a group's mail arrives at through Amazon SES receiving (its own SES From address, else <slug>@<the sending domain>), or null while receiving is not set up. */
const receiving = new Map<string, { at: number; value: string | null }>();
async function groupReceivingAddress(groupId: string): Promise<string | null> {
  const hit = receiving.get(groupId);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  let value: string | null = null;
  if ((await import("./mailInbound")).inboundTopicArn()) {
    const rows = await platformQuery(
      `SELECT g.slug, lower(m.ses_from) AS own, (SELECT value #>> '{}' FROM platform.platform_settings WHERE key = 'mail.from_email') AS from_email,
         (SELECT value #>> '{}' FROM platform.platform_settings WHERE key = 'mail.sending_domain') AS stored_domain
         FROM platform.hotel_groups g LEFT JOIN platform.group_mail m ON m.group_id = g.id WHERE g.id = $1::uuid`,
      [groupId],
    ).catch(() => []);
    const r = rows[0];
    const t = (v: unknown): string | null => (typeof v === "string" ? v : null);
    if (r) value = t(r.own) ?? mailAddressOf(t(r.slug), sendingDomainOf(t(r.from_email), t(r.stored_domain)));
  }
  receiving.set(groupId, { at: Date.now(), value });
  return value;
}

let service: ConversationsService | null = null;

/** The group inbox service (the hotel's Conversations service over the group's rows); call its methods with asGroup(session). */
export function getGroupConversations(): ConversationsService {
  if (service) return service;
  const base = billingDefaults();
  const config = getConfig();
  const unit = liveGroupUnit(config.DATABASE_URL ? pgGroupUnit() : createMemoryConversationsHotel().unit);
  service = createConversationsService({
    unit,
    people: base.people,
    catalog: base.catalog,
    now: base.now,
    smtpKey: () => smtpSecretKeyOf(getConfig()),
    imap: createImapClientFactory(),
    ...(config.DATABASE_URL ? { sendHotelMail: sendAsGroup, sesReceivingAddress: groupReceivingAddress } : {}),
    staff: groupStaff,
    registry: { report: async () => undefined },
    log,
  });
  return service;
}

/** Replaces the group inbox service (tests). */
export function configureGroupConversations(next: ConversationsService | null): void {
  service = next;
}

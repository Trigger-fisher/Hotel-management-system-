import "server-only";
import { timingSafeEqual } from "node:crypto";
import { DESK_LABELS, deskOf, type DeskLabel } from "@shared/dashboards/conversations";
import { MAILBOX_ROLES } from "@shared/dashboards/mailboxAccess";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { hmacHex, parseHashKey } from "../crypto/hash";
import { getLogger } from "../logger";
import { isReservedLocal, sendingDomainOf } from "../mail/sendingDomain";
import { createInboundMailService, type InboundMailPorts, type InboundMailService } from "../services/mail/inboundService";

// The composition of mail that arrives through Amazon SES receiving (mail/inbound.ts; the mail-inbound route). Two settings of the server make it work:
//   HMS_HASH_KEY (already there): the secret part of the address is derived from it, so nothing is stored and the address is never guessable;
//   HMS_INBOUND_SNS_TOPIC_ARN: the Amazon SNS topic the SES receipt rule publishes to. A message of any other topic is refused, so a leaked address cannot be fed from another AWS account.
// Without both, the address answers 404 and nothing is taken in.

/** The Amazon SNS topic the receipt rule publishes to (arn:aws:sns:<region>:<account>:<name>), or null while it is not set. */
export const inboundTopicArn = (): string | null => {
  const v = (process.env.HMS_INBOUND_SNS_TOPIC_ARN ?? "").trim();
  return /^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/.test(v) ? v : null;
};

/** The secret segment of the receiving address: an HMAC under the server key, null without the key. */
export function inboundWebhookKey(): string | null {
  const raw = getConfig().HMS_HASH_KEY;
  return raw ? hmacHex(parseHashKey(raw), "mail-inbound", ["ses"]) : null;
}

/** Is this the receiving address's secret segment (constant time)? */
export function inboundKeyMatches(got: string | undefined): boolean {
  const expected = inboundWebhookKey();
  if (!expected || typeof got !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The full address the SNS subscription takes (shown to the Super Admin); null while the server cannot make it. */
export function inboundAddress(): string | null {
  const key = inboundWebhookKey();
  const base = (getConfig().HMS_PUBLIC_URL ?? "").replace(/\/+$/, "");
  return key && base ? `${base}/api/v1/public/mail-inbound/${key}` : null;
}

async function query(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const client = await getDatabase().pool.connect();
  try {
    return (await client.query(text, params)).rows as Record<string, unknown>[];
  } finally {
    client.release();
  }
}

/** The live hotels the addresses belong to: a hotel's own SES From address (Platform > Hotel mail), or <slug without dashes>@<the platform sending domain>. */
async function hotelsOf(recipients: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  const live = "h.deleted_at IS NULL AND h.status IN ('active', 'suspended')";
  try {
    for (const r of await query(`SELECT m.hotel_id FROM platform.hotel_mail m JOIN platform.hotels h ON h.id = m.hotel_id WHERE ${live} AND lower(m.ses_from) = ANY($1::text[])`, [recipients])) found.add(String(r.hotel_id));
  } catch {
    // the table of Hotel mail is not there yet (migration 0161): only the platform addresses count
  }
  const settings = await query("SELECT key, value #>> '{}' AS v FROM platform.platform_settings WHERE key IN ('mail.from_email', 'mail.sending_domain')", []);
  const get = (k: string): string | null => (settings.find((x) => x.key === k)?.v as string | null | undefined) ?? null;
  const domain = sendingDomainOf(get("mail.from_email"), get("mail.sending_domain"));
  if (domain) {
    const locals = [...new Set(recipients.filter((a) => a.endsWith(`@${domain}`)).map((a) => a.slice(0, a.length - domain.length - 1)).filter((l) => l !== "" && !isReservedLocal(l)))];
    if (locals.length > 0) for (const r of await query(`SELECT h.id FROM platform.hotels h WHERE ${live} AND replace(h.slug, '-', '') = ANY($1::text[])`, [locals])) found.add(String(r.id));
  }
  return [...found];
}

/** The platform's desk the addresses name (MJ, 2 Nov 2026): sales@ or support@ at the platform sending domain (the same domain hotelsOf reads), or null. */
async function platformDeskOf(recipients: readonly string[]): Promise<DeskLabel | null> {
  const settings = await query("SELECT key, value #>> '{}' AS v FROM platform.platform_settings WHERE key IN ('mail.from_email', 'mail.sending_domain')", []);
  const get = (k: string): string | null => (settings.find((x) => x.key === k)?.v as string | null | undefined) ?? null;
  const domain = sendingDomainOf(get("mail.from_email"), get("mail.sending_domain"));
  if (!domain) return null;
  const map: Record<string, DeskLabel> = {};
  for (const label of DESK_LABELS) map[`${label.toLowerCase()}@${domain.toLowerCase()}`] = label;
  return deskOf(recipients, map);
}

/**
 * The staff logins whose own mailbox the addresses belong to (MJ, 3 Nov 2026; platform 0179): <username>@<the platform sending domain> of an active, not deleted, not blocked login of a staff
 * account role. A candidate is kept only when its address is USABLE (compose/personalMailbox.ts): a hotel, a group and a desk keep the addresses they already answer to.
 */
export async function personsOf(recipients: readonly string[]): Promise<string[]> {
  const settings = await query("SELECT key, value #>> '{}' AS v FROM platform.platform_settings WHERE key IN ('mail.from_email', 'mail.sending_domain')", []);
  const get = (k: string): string | null => (settings.find((x) => x.key === k)?.v as string | null | undefined) ?? null;
  const domain = sendingDomainOf(get("mail.from_email"), get("mail.sending_domain"));
  if (!domain) return [];
  const locals = [...new Set(recipients.filter((a) => a.endsWith(`@${domain}`)).map((a) => a.slice(0, a.length - domain.length - 1)).filter((l) => l !== "" && !isReservedLocal(l)))];
  if (locals.length === 0) return [];
  const candidates = await query("SELECT id FROM platform.people WHERE username = ANY($1::text[]) AND status = 'active' AND deleted_at IS NULL AND blocked_at IS NULL AND account_role = ANY($2::text[])", [locals, [...MAILBOX_ROLES]]);
  // the extra addresses the Super Admin gave (platform 0189): delivered into the owner's own mailbox
  const extraOwners = await (await import("./mailAddresses")).getMailAddresses().ownersOf(domain, locals);
  const account = (await import("./personalMailbox")).getPersonalMailbox();
  const found: string[] = [];
  for (const id of new Set([...candidates.map((c) => String(c.id)), ...extraOwners])) {
    if ((await account.usableAddress(id)) !== null) found.push(id);
  }
  return found;
}

// (the open pages hear of new mail from the hubs themselves: compose/convLive.ts publishes every change the hub's unit saved, with the ping where it is set up)
let service: InboundMailService | null = null;

export function getInboundMail(): InboundMailService {
  if (service) return service;
  const hasDatabase = Boolean(getConfig().DATABASE_URL);
  const ports: InboundMailPorts = {
    hotelsOf: (recipients) => (hasDatabase ? hotelsOf(recipients) : Promise.resolve([])),
    deliver: async (hotelId, entries, sources) => (await import("./conversations")).getConversations().receiveForWorker(hotelId, entries, sources),
    // A group has no mailbox of its own any more (MJ, 3 Nov 2026): mail goes to the hotels (their name address), the platform desks and the staff mailboxes.
    groupsOf: () => Promise.resolve([]),
    deliverGroup: async (groupId, entries, sources) => (await import("./groupConversations")).getGroupConversations().receiveForWorker(groupId, entries, sources),
    deskOf: (recipients) => (hasDatabase ? platformDeskOf(recipients) : Promise.resolve(null)),
    deliverPlatform: async (entries, sources, desk) => (await import("./conversations")).getPlatformConversations().receiveForWorker(entries, sources, desk),
    personsOf: (recipients) => (hasDatabase ? personsOf(recipients) : Promise.resolve([])),
    deliverPerson: async (loginId, entries, sources) => (await import("./personalMailbox")).getPersonalMailbox().receive(loginId, entries, sources),
  };
  service = createInboundMailService({ ports, now: () => new Date(), log: (message, fields) => getLogger().info(message, fields) });
  return service;
}

/** Replaces the service (tests). */
export function configureInboundMail(next: InboundMailService | null): void {
  service = next;
}

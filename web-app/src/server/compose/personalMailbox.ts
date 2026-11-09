import "server-only";
import { MAILBOX_ROLES } from "@shared/dashboards/mailboxAccess";
import { getDatabase } from "../../db";
import type { VerifiedSession } from "../auth/session";
import { getConfig } from "../config/env";
import { getLogger } from "../logger";
import type { ImapClientFactory } from "../mail/imap";
import { smtpSecretKeyOf } from "../mail/key";
import { createPersonSender } from "../mail/personSender";
import { PLATFORM_SMTP_KEYS, readPlatformSmtp } from "../mail/platformSmtp";
import { sendingDomainOf } from "../mail/sendingDomain";
import { createMemoryPersonalMailbox } from "../repos/memory/personalMailbox";
import type { PersonalMailboxRepos } from "../repos/personalMailbox";
import { createPgPersonalUnit } from "../repos/postgres/personalMailbox";
import type { Unit } from "../repos/types";
import { createConversationsService, type ConversationsService } from "../services/conversations/conversationsService";
import { createPersonalMailboxService, personalSession, type PersonalMailboxService } from "../services/conversations/personalMailboxService";
import { billingDefaults } from "./billing";
import { livePersonUnit } from "./convLive";
import { getMailFiles } from "./mailFiles";

// My mailbox (platform 0178, 0179; MJ, 3 Nov 2026): the composition root. ONE unit serves both services: PostgreSQL with DATABASE_URL (every query inside withPersonalMailbox's transaction, which
// sets hms.pmail_login_id from the session, so row level security fences the rows), the in-memory double (one store per login) without. The mail itself is the hotel's Conversations
// service run over the person's own rows; the address and the delivery of received mail are the personal mailbox service. A person SENDS through the platform's one SES server only
// (mail/personSender.ts): this file never reaches the hotel/group/platform sender chain or the provider failover, which are for automated system mail.

const log = (message: string, fields: Record<string, unknown>): void => getLogger().info(message, fields);

let unitCache: Unit<PersonalMailboxRepos> | null = null;
let mailService: ConversationsService | null = null;
let accountService: PersonalMailboxService | null = null;

function personalUnit(): Unit<PersonalMailboxRepos> {
  return (unitCache ??= livePersonUnit(getConfig().DATABASE_URL ? createPgPersonalUnit(getDatabase().pool) : createMemoryPersonalMailbox().unit));
}

async function platformQuery(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const client = await getDatabase().pool.connect();
  try {
    return (await client.query(text, params)).rows as Record<string, unknown>[];
  } finally {
    client.release();
  }
}

const settingOf = async (keys: string[]): Promise<Map<string, string | null>> => {
  const rows = await platformQuery("SELECT key, value #>> '{}' AS v FROM platform.platform_settings WHERE key = ANY($1::text[])", [keys]);
  return new Map(rows.map((x) => [String(x.key), x.v === null || x.v === undefined ? null : String(x.v)]));
};

/** The ONE mail server a person sends through: the platform's saved server (Platform settings > Mail), the password opened with the mail key. Null = none saved. Never the server's own SMTP_* variables. */
async function platformServer() {
  const config = getConfig();
  const rows = await platformQuery("SELECT key, value #>> '{}' AS v, value AS j FROM platform.platform_settings WHERE key = ANY($1::text[])", [[...PLATFORM_SMTP_KEYS]]);
  const by = new Map(rows.map((x) => [String(x.key), x.j]));
  const sealed = rows.find((x) => x.key === "mail.smtp_password")?.v;
  return readPlatformSmtp((k) => by.get(k) ?? null, typeof sealed === "string" ? sealed : null, smtpSecretKeyOf(config), undefined).config;
}

/** The platform sending domain, the same value the hotel and group addresses use. */
async function sendingDomain(): Promise<string | null> {
  if (!getConfig().DATABASE_URL) return null;
  const s = await settingOf(["mail.from_email", "mail.sending_domain"]);
  return sendingDomainOf(s.get("mail.from_email"), s.get("mail.sending_domain"));
}

/** The login, only while it is an active, not deleted, not blocked login of a staff account role. */
async function identityOf(loginId: string): Promise<{ username: string; name: string } | null> {
  if (!getConfig().DATABASE_URL || !/^[0-9a-f-]{36}$/i.test(loginId)) return null;
  const rows = await platformQuery(
    "SELECT username, display_name FROM platform.people WHERE id = $1::uuid AND status = 'active' AND deleted_at IS NULL AND blocked_at IS NULL AND account_role = ANY($2::text[])",
    [loginId, [...MAILBOX_ROLES]],
  );
  return rows[0] ? { username: String(rows[0].username), name: String(rows[0].display_name) } : null;
}

/**
 * The addresses a hotel, a group or the platform already answers on this domain (<slug without dashes>@domain, their own SES From addresses, the platform's From address). They keep winning at
 * delivery, so a username that equals one has no working address. Remembered half a minute.
 */
const takenCache = new Map<string, { at: number; value: ReadonlySet<string> }>();
async function takenOn(domain: string): Promise<ReadonlySet<string>> {
  const hit = takenCache.get(domain);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  const out = new Set<string>();
  const local = (x: unknown): void => {
    const l = String(x ?? "").replace(/-/g, "").toLowerCase();
    if (l !== "") out.add(`${l}@${domain}`);
  };
  for (const r of await platformQuery("SELECT slug FROM platform.hotels WHERE deleted_at IS NULL", [])) local(r.slug);
  for (const r of await platformQuery("SELECT slug FROM platform.hotel_groups WHERE deleted_at IS NULL", [])) local(r.slug);
  // their own SES From addresses (Platform > Hotel mail, Group mail), when the tables are there
  for (const sql of ["SELECT lower(ses_from) AS a FROM platform.hotel_mail WHERE ses_from IS NOT NULL", "SELECT lower(ses_from) AS a FROM platform.group_mail WHERE ses_from IS NOT NULL"]) {
    try {
      for (const r of await platformQuery(sql, [])) if (typeof r.a === "string") out.add(r.a);
    } catch {
      // the table is not there yet: only the platform addresses count
    }
  }
  const from = (await settingOf(["mail.from_email"])).get("mail.from_email");
  if (from) out.add(from.trim().toLowerCase());
  takenCache.set(domain, { at: Date.now(), value: out });
  return out;
}

/** The sending domain and the addresses already answered on it, for the extra addresses (compose/mailAddresses.ts). */
export { sendingDomain as personalSendingDomain, takenOn as takenMailAddresses };

/** Drops what is remembered about the taken addresses (tests, and a hotel or group saved a moment ago). */
export const forgetTakenAddresses = (): void => takenCache.clear();

/** The address and delivery service. */
export function getPersonalMailbox(): PersonalMailboxService {
  if (accountService) return accountService;
  accountService = createPersonalMailboxService({ unit: personalUnit(), now: billingDefaults().now, identity: identityOf, domain: sendingDomain, taken: takenOn, extras: async (loginId) => (await import("./mailAddresses")).getMailAddresses().extrasOf(loginId), log });
  return accountService;
}

/** There is no mailbox of the person's own to read: no IMAP server is ever contacted for a personal mailbox. */
const noImap: ImapClientFactory = () => Promise.reject(new Error("A personal mailbox does not read an outside mailbox."));

/** The mail service (list, threads, reply, compose, labels, files): the hotel's Conversations service over the person's own rows. Call its methods with asPersonal(session). */
export function getPersonalConversations(): ConversationsService {
  if (mailService) return mailService;
  const base = billingDefaults();
  const account = getPersonalMailbox();
  const send = createPersonSender({ platformServer, identity: (loginId, from) => account.senderOf(loginId, from), log });
  mailService = createConversationsService({
    unit: personalUnit(),
    people: base.people,
    catalog: base.catalog,
    now: base.now,
    smtpKey: () => smtpSecretKeyOf(getConfig()),
    imap: noImap,
    staff: async () => [],
    ...(getMailFiles() ? { mailFiles: getMailFiles() as NonNullable<ReturnType<typeof getMailFiles>> } : {}),
    // a person's email: SES only, as the person's own address, no fallback (the hotel router and the failover are never used)
    sendHotelMail: send,
    // the person's main address and the extra ones the Super Admin gave (platform 0189): the From choice of reply and compose
    fromChoices: (loginId) => account.fromChoices(loginId),
    // the address that receives for this inbox: the page then says Connected (a hotel id here is the login id)
    sesReceivingAddress: (loginId) => account.usableAddress(loginId),
    registry: { report: async () => undefined },
    log,
  });
  return mailService;
}

/**
 * The ONE way any query of this feature runs: a staff login in the browser (not in a visit, not an API key), inside a transaction that first sets hms.pmail_login_id to the SESSION's login id
 * (set_config with a bound value). The login id never comes from a request.
 */
export function withPersonalMailbox<T>(session: VerifiedSession, work: (repos: PersonalMailboxRepos) => Promise<T>): Promise<T> {
  return personalUnit().run(personalSession(session), work);
}

/** The session the mail routes run in (the checks of personalSession). */
export const asPersonal = personalSession;

/** Replaces the services (tests). */
export function configurePersonalMailbox(next: { mail?: ConversationsService | null; account?: PersonalMailboxService | null; unit?: Unit<PersonalMailboxRepos> | null }): void {
  if (next.mail !== undefined) mailService = next.mail;
  if (next.account !== undefined) accountService = next.account;
  if (next.unit !== undefined) {
    unitCache = next.unit;
    mailService = null;
    accountService = null;
  }
}

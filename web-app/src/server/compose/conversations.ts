import "server-only";
import { randomUUID } from "node:crypto";
import type { ConvPerson } from "@shared/dashboards/conversations";
import { platformCopy } from "@shared/dashboards/platform";
import { getDatabase } from "../../db";
import { isPortalAccount } from "../auth/permissions";
import type { VerifiedSession } from "../auth/session";
import { getConfig } from "../config/env";
import { AppError } from "../errors";
import { getLogger } from "../logger";
import { createImapClientFactory, type ImapClientFactory } from "../mail/imap";
import { smtpSecretKeyOf } from "../mail/key";
import { composeReply } from "../mail/smtp";
import { PLATFORM_SMTP_KEYS, readPlatformSmtp } from "../mail/platformSmtp";
import { sendingDomainOf } from "../mail/sendingDomain";
import { isConversationsNotReady, type ChannelAccountsRepo, type PlatformConversationsRepos } from "../repos/conversations";
import { createMemoryConversationsHotel, createMemoryPlatformConversations } from "../repos/memory/conversations";
import { createPgConversationsUnit } from "../repos/postgres/conversations";
import { pgChannelAccounts, pgPlatformConversations } from "../repos/postgres/platformConversations";
import { createPlatformUnit } from "../repos/postgres/platformUnit";
import type { MailAttachment } from "../services/auth/mail";
import { sentMailLoader } from "./sentMail";
import { getMailFiles } from "./mailFiles";
import { getWhatsAppObjects } from "./whatsappMedia";
import { hotelWhatsAppSend, hotelWhatsAppState, platformWhatsAppHotels, platformWhatsAppSend, platformWhatsAppState } from "./whatsappPlatformChat";
import { createConversationsService, type ConversationsService } from "../services/conversations/conversationsService";
import { createPlatformConversationsService, type PlatformConversationsService, type PlatformGatePort } from "../services/conversations/platformConversationsService";
import { createGate } from "../services/platform/access";
import { billingDefaults } from "./billing";
import { liveHotelUnit, livePlatformUnit } from "./convLive";

// The composition root of Conversations (decision 66): the hotel's hub on the hotel unit (PostgreSQL with DATABASE_URL, the in-memory double without), the platform's hub and
// the registry of mailboxes on the platform unit, the real IMAP client (mail/imap.ts), the sealed-password key (mail/key.ts), the hotel's staff for assignment, the bill PDF
// for a reply, and the daily safety net (runConversationsCron). Background hotel work runs as "conversations-worker" with no visit.

let hotelService: ConversationsService | null = null;
let platformService: PlatformConversationsService | null = null;
let imapFactory: ImapClientFactory | null = null;
let registryUnit: { run<T>(work: (repos: ChannelAccountsRepo) => Promise<T>): Promise<T> } | null = null;
let platformUnit: { run<T>(work: (repos: PlatformConversationsRepos) => Promise<T>): Promise<T> } | null = null;

const imap = (): ImapClientFactory => (imapFactory ??= createImapClientFactory());
const log = (message: string, fields: Record<string, unknown>): void => getLogger().info(message, fields);

/** platform.conv_channel_accounts on its own (the hotel side reports its checks there; the cron reads what is due). */
function registry(): { run<T>(work: (repos: ChannelAccountsRepo) => Promise<T>): Promise<T> } {
  if (registryUnit) return registryUnit;
  if (getConfig().DATABASE_URL) return (registryUnit = createPlatformUnit(getDatabase().pool, pgChannelAccounts));
  const unit = platformHubUnit();
  return (registryUnit = { run: (work) => unit.run((repos) => work(repos.accounts)) });
}

function platformHubUnit(): { run<T>(work: (repos: PlatformConversationsRepos) => Promise<T>): Promise<T> } {
  if (platformUnit) return platformUnit;
  const base: { run<T>(work: (repos: PlatformConversationsRepos) => Promise<T>): Promise<T> } = getConfig().DATABASE_URL ? createPlatformUnit(getDatabase().pool, pgPlatformConversations) : createMemoryPlatformConversations().unit;
  platformUnit = livePlatformUnit<PlatformConversationsRepos, typeof base>(base);
  return platformUnit;
}

/** A query on the platform pool (staff lists, the platform mail server). */
async function platformQuery(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const client = await getDatabase().pool.connect();
  try {
    return (await client.query(text, params)).rows as Record<string, unknown>[];
  } finally {
    client.release();
  }
}

/** The hotel's active staff (the Assign list). */
async function hotelStaff(hotelId: string): Promise<ConvPerson[]> {
  if (!getConfig().DATABASE_URL) return [];
  const rows = await platformQuery(
    `SELECT u.id, u.display_name FROM platform.people u JOIN platform.user_hotels uh ON uh.user_id = u.id
      WHERE uh.hotel_id = $1 AND uh.status = 'active' AND u.status = 'active' AND u.deleted_at IS NULL AND u.account_role IN ('hotel_admin', 'hotel_user')
      ORDER BY u.display_name, u.id LIMIT 500`,
    [hotelId],
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.display_name) }));
}

/** The platform's staff (Super Admin and Platform Admins). */
async function platformStaff(): Promise<ConvPerson[]> {
  if (!getConfig().DATABASE_URL) return [];
  const rows = await platformQuery(`SELECT id, display_name FROM platform.people WHERE status = 'active' AND deleted_at IS NULL AND account_role IN ('super_admin', 'platform_admin') ORDER BY display_name, id LIMIT 200`, []);
  return rows.map((r) => ({ id: String(r.id), name: String(r.display_name) }));
}

/** The platform mail server of Platform settings > Mail, as saved (the password opened with the server key). */
async function platformSmtp(): Promise<ReturnType<typeof readPlatformSmtp>> {
  if (!getConfig().DATABASE_URL) return { config: null, passwordUnreadable: false };
  const config = getConfig();
  const rows = await platformQuery("SELECT key, value #>> '{}' AS v, value AS j FROM platform.platform_settings WHERE key = ANY($1::text[])", [[...PLATFORM_SMTP_KEYS]]);
  const by = new Map(rows.map((x) => [String(x.key), x.j]));
  const sealed = rows.find((x) => x.key === "mail.smtp_password")?.v;
  return readPlatformSmtp((k) => by.get(k) ?? null, typeof sealed === "string" ? sealed : null, smtpSecretKeyOf(config), config.SMTP_FROM);
}

/** A bill's PDF, exactly as the Bills screen prints it (the bill service checks the Bills right of the session itself). Loaded on first use. */
async function billPdf(session: VerifiedSession, billId: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const [{ getDocumentRenderer }, { getBillingBills }] = await Promise.all([import("../documents"), import("./billing")]);
  const doc = await getDocumentRenderer().render("bill", await getBillingBills().preview(session, billId));
  return { filename: doc.filename, bytes: doc.bytes };
}

/** The console's gate for the platform hub, over the platform console unit (loaded on first use: hotel routes never load the console). */
export function platformGate(): PlatformGatePort {
  const now = (): Date => new Date();
  let made: Promise<{ gate: ReturnType<typeof createGate>; unit: Parameters<typeof createGate>[0] }> | null = null;
  const get = () =>
    (made ??= import("./platform").then((m) => {
      const unit = m.getPlatformConsoleUnit();
      return { gate: createGate(unit, now), unit };
    }));
  const input = (reason: string | null) => ({ action: "conversation_updated" as const, entity: "platform" as const, entityId: null, reason });
  return {
    read(session) {
      // the account-role check of the console gate (no data read): Platform Admin and Super Admin, never a portal or hotel account
      if (isPortalAccount(session) || (session.accountRole !== "super_admin" && session.accountRole !== "platform_admin")) throw new AppError("FORBIDDEN");
    },
    async write(session, meta) {
      const { gate } = await get();
      await gate.write(session, meta, input(null));
    },
    superRead(session) {
      if (isPortalAccount(session) || session.accountRole !== "super_admin") throw new AppError("FORBIDDEN", platformCopy.a8Errors.superOnly);
    },
    async superWrite(session, meta) {
      const { gate } = await get();
      await gate.superWrite(session, meta, input(null));
    },
    async audit(session, meta, reason) {
      const { gate, unit } = await get();
      await unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        await gate.audit(repos, actor, meta, input(reason));
      });
    },
  };
}

/**
 * A hotel's own accounts from the Super Admin, remembered for a minute (the Email page asks on every open): its Google login is the mailbox read there. Loaded on first use, because
 * compose/mail.ts reaches this file through compose/admin.ts.
 */
function dedicatedMailboxLoader(config: ReturnType<typeof getConfig>): (hotelId: string) => Promise<import("../mail/hotelMail").HotelMailRead | null> {
  const seen = new Map<string, { at: number; value: import("../mail/hotelMail").HotelMailRead | null }>();
  let load: ((hotelId: string) => Promise<import("../mail/hotelMail").HotelMailRead | null>) | null = null;
  return async (hotelId) => {
    const hit = seen.get(hotelId);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    load ??= (await import("./mail")).hotelMailLoader(config);
    const value = await load(hotelId);
    seen.set(hotelId, { at: Date.now(), value });
    return value;
  };
}

/**
 * Compose for a hotel with no mailbox of its own: one email through the hotel's mail (the router: the hotel's SES, its Google, its group's, then the platform's), sent now, not queued, so
 * the page can say at once that it went. Our own Message-ID keeps it apart in the conversation. Loaded on first use (compose/mail.ts reaches this file through compose/admin.ts).
 */
async function sendAsHotel(
  hotelId: string,
  mail: { to: string; cc?: readonly string[]; bcc?: readonly string[]; subject: string; text: string; inReplyTo?: string | null; references?: readonly string[]; attachments?: MailAttachment[]; /** false for files added to an email (not a bill) */ bill?: boolean; keep?: { conversationId: string; cc: readonly string[] } },
): Promise<{ messageId: string; sentAt: Date; source?: Buffer }> {
  const sender = (await import("./mail")).routedMailSender(getConfig());
  if (!sender) throw new AppError("CONFLICT", "Mail cannot be sent from this server yet.");
  const messageId = `<${randomUUID()}@hms.mail>`;
  await sender.send({ to: mail.to, ...(mail.cc && mail.cc.length > 0 ? { cc: [...mail.cc] } : {}), ...(mail.bcc && mail.bcc.length > 0 ? { bcc: [...mail.bcc] } : {}), subject: mail.subject, text: mail.text, hotelId, messageId, ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}), ...(mail.references && mail.references.length > 0 ? { references: [...mail.references] } : {}), ...(mail.attachments ? { attachments: mail.attachments } : {}) });
  const sentAt = new Date();
  if (!mail.keep) return { messageId, sentAt };
  // the copy kept in the hotel's schema (hotel 0053): the same mail, from the hotel's own address on the platform's sending domain. A copy that cannot be made does not undo the send.
  try {
    const { platformMailIdentityOf } = await import("./mailIdentity");
    const from = (await platformMailIdentityOf(hotelId)).address ?? "hotel@hms.invalid";
    const { raw } = await composeReply({ from }, { to: mail.to, cc: mail.keep.cc, subject: mail.subject, text: mail.text, inReplyTo: mail.inReplyTo ?? null, references: mail.references ?? [], messageId, conversationId: mail.keep.conversationId, ...(mail.attachments ? { attachments: mail.attachments } : {}), bill: mail.bill ?? mail.attachments !== undefined, date: sentAt });
    return { messageId, sentAt, source: raw };
  } catch {
    return { messageId, sentAt };
  }
}

/**
 * The address a hotel's mail arrives at through Amazon SES receiving (its own SES From address, else <slug>@<the sending domain>), or null while receiving is not set up on this server
 * (HMS_INBOUND_SNS_TOPIC_ARN). Remembered a minute: the Email page asks on every list.
 */
const receiving = new Map<string, { at: number; value: string | null }>();
async function hotelReceivingAddress(hotelId: string): Promise<string | null> {
  const hit = receiving.get(hotelId);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  let value: string | null = null;
  if ((await import("./mailInbound")).inboundTopicArn()) {
    const own = await platformQuery("SELECT lower(ses_from) AS a FROM platform.hotel_mail WHERE hotel_id = $1::uuid AND ses_from IS NOT NULL", [hotelId]).catch(() => []);
    value = typeof own[0]?.a === "string" ? own[0].a : (await (await import("./mailIdentity")).platformMailIdentityOf(hotelId)).address;
  }
  receiving.set(hotelId, { at: Date.now(), value });
  return value;
}

export function getConversations(): ConversationsService {
  if (hotelService) return hotelService;
  const base = billingDefaults();
  const config = getConfig();
  const unit = liveHotelUnit(config.DATABASE_URL ? createPgConversationsUnit(getDatabase().withHotel) : createMemoryConversationsHotel().unit);
  hotelService = createConversationsService({
    unit,
    people: base.people,
    catalog: base.catalog,
    now: base.now,
    smtpKey: () => smtpSecretKeyOf(getConfig()),
    imap: imap(),
    ...(config.DATABASE_URL ? { dedicatedMailbox: dedicatedMailboxLoader(config), sentMail: sentMailLoader(), sendHotelMail: sendAsHotel, sesReceivingAddress: hotelReceivingAddress, whatsapp: hotelWhatsAppState, whatsappSend: hotelWhatsAppSend, ...(getWhatsAppObjects() ? { whatsappFiles: getWhatsAppObjects() as NonNullable<ReturnType<typeof getWhatsAppObjects>> } : {}) } : {}),
    staff: hotelStaff,
    billPdf,
    ...(getMailFiles() ? { mailFiles: getMailFiles() as NonNullable<ReturnType<typeof getMailFiles>> } : {}),
    registry: { report: (hotelId, result) => registry().run((r) => r.report(hotelId, result)) },
    log,
  });
  return hotelService;
}

/** Replaces the hotel's Conversations service (tests). */
export function configureConversations(next: ConversationsService | null): void {
  hotelService = next;
}

export function getPlatformConversations(): PlatformConversationsService {
  if (platformService) return platformService;
  const base = billingDefaults();
  platformService = createPlatformConversationsService({ unit: platformHubUnit(), gate: platformGate(), people: base.people, now: base.now, imap: imap(), smtp: platformSmtp, staff: platformStaff, ...(getConfig().DATABASE_URL ? { sentMail: sentMailLoader(), deskDomain: platformDeskDomain, whatsapp: platformWhatsAppState, whatsappSend: platformWhatsAppSend, whatsappHotels: platformWhatsAppHotels, ...(getWhatsAppObjects() ? { whatsappFiles: getWhatsAppObjects() as NonNullable<ReturnType<typeof getWhatsAppObjects>> } : {}) } : {}), log });
  return platformService;
}

/** The platform's own domain for the desks sales@ and support@ (MJ, 2 Nov 2026): the sending domain of Platform settings > Mail, as the SES receiving reads it. */
async function platformDeskDomain(): Promise<string | null> {
  const client = await getDatabase().pool.connect();
  try {
    const rows = (await client.query("SELECT key, value #>> '{}' AS v FROM platform.platform_settings WHERE key IN ('mail.from_email', 'mail.sending_domain')")).rows as { key: string; v: string | null }[];
    const get = (k: string): string | null => rows.find((r) => r.key === k)?.v ?? null;
    return sendingDomainOf(get("mail.from_email"), get("mail.sending_domain"));
  } finally {
    client.release();
  }
}

/** Replaces the platform's Conversations service (tests). */
export function configurePlatformConversations(next: PlatformConversationsService | null): void {
  platformService = next;
}

/** Settings > Email saves the hotel's reading switch in the registry (platform 0139); a missing table is the typed ConversationsNotReady. */
export const hotelMailboxRegistry = (): { setHotelReading(hotelId: string, on: boolean): Promise<void> } => ({ setHotelReading: (hotelId, on) => registry().run((r) => r.setHotelReading(hotelId, on)) });

// ------------------------------------------------------------------------------------------------ the daily safety net (cron)

export interface ConversationsCronRun {
  hotels: number;
  checked: number;
  added: number;
  purged: number;
  failed: number;
  /** Present (true) when hotels are left for the next call. */
  more?: true;
}

export const RETENTION_DAYS = 365;
const PER_HOTEL_BUDGET_MS = 20_000;
const POOL = 4;

export interface CronPorts {
  /**
   * Delete messages older than RETENTION_DAYS (C5). OFF unless set (MJ, 2 Nov 2026: "I do not want to delete the email; if I do, I will handle it from the Super Admin"): every email
   * of a hotel, a group and the platform is kept. The purge itself stays here for a Super Admin action later.
   */
  autoPurge?: boolean;
  registry: { run<T>(work: (repos: ChannelAccountsRepo) => Promise<T>): Promise<T> };
  hotel: Pick<ConversationsService, "syncForWorker" | "purgeForWorker">;
  platform: Pick<PlatformConversationsService, "syncForWorker" | "purgeForWorker">;
  /** The Super Admin's and Platform Admins' personal mailboxes (platform 0178): the pass calls it but it deletes nothing (MJ, 3 Nov 2026: personal entries are never auto-deleted; only the person's own Remove my mailbox deletes them). */
  personal?: { purgeForWorker(before: Date): Promise<number> };
  now: () => Date;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

/**
 * One call of the daily safety net (budget 40 s inside a 60 s function):
 *   1. purge first (database only, fast): every provisioned hotel not purged today, whatever its reading switch (C5), then the platform's own hub once a day;
 *   2. sync: the hotels whose mailbox is read and was not checked for 6 hours, four at a time, each only while enough time is left; then the platform mailbox.
 * `more` = hotels are left (the route hands the rest to a new call).
 */
export async function runConversationsPass(ports: CronPorts, o: { budgetMs: number }): Promise<ConversationsCronRun> {
  const started = Date.now();
  const timeLeft = (): number => o.budgetMs - (Date.now() - started);
  const now = ports.now();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const before = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const run: ConversationsCronRun = { hotels: 0, checked: 0, added: 0, purged: 0, failed: 0 };
  let more = false;

  // 1. purge: only when switched on (it is off: emails are kept, MJ 2 Nov 2026)
  let duePurge: string[] = [];
  try {
    if (ports.autoPurge === true) duePurge = await ports.registry.run((r) => r.duePurge(today, 50));
  } catch (error) {
    if (!isConversationsNotReady(error)) throw error;
    return run;
  }
  if (duePurge.length === 50) more = true;
  for (const hotelId of duePurge) {
    if (timeLeft() < 10_000) {
      more = true;
      break;
    }
    try {
      run.purged += await ports.hotel.purgeForWorker(hotelId, before);
    } catch (error) {
      // a hotel without hotel 0050 has nothing to purge; anything else is counted
      if (!isConversationsNotReady(error)) run.failed += 1;
    }
    await ports.registry.run((r) => r.markPurged(hotelId, now)).catch(() => undefined);
  }
  // the personal mailboxes (platform 0178): a no-op by MJ's decision (3 Nov 2026), kept as the one place to change if a rule is ever decided
  if (ports.autoPurge === true && ports.personal) run.purged += await ports.personal.purgeForWorker(before).catch(() => 0);
  const platformRow = await ports.registry.run((r) => r.platformAccount("email")).catch(() => null);
  if (ports.autoPurge === true && platformRow && (platformRow.lastPurgedAt === null || platformRow.lastPurgedAt.getTime() < today.getTime())) {
    run.purged += await ports.platform.purgeForWorker(before).catch(() => 0);
    await ports.registry.run((r) => r.markPurged(null, now)).catch(() => undefined);
  }

  // 2. sync, four at a time, each hotel only with enough time left
  const due = await ports.registry.run((r) => r.dueSync(now, 25)).catch(() => [] as string[]);
  if (due.length === 25) more = true;
  const queue = [...due];
  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      if (timeLeft() < PER_HOTEL_BUDGET_MS + 5_000) {
        more = true;
        return;
      }
      const hotelId = queue.shift() as string;
      run.hotels += 1;
      // a hotel that could not be checked (hotel 0050 not pasted yet, a password the key no longer opens, another check holding the lease) is still marked as tried,
      // so dueSync moves on to the next hotels instead of answering the same ones on every call
      const tried = (error: string): Promise<void> => ports.registry.run((r) => r.report(hotelId, { at: now, ok: false, error })).catch(() => undefined);
      try {
        const outcome = await ports.hotel.syncForWorker(hotelId, { budgetMs: Math.min(PER_HOTEL_BUDGET_MS, timeLeft() - 5_000) });
        if (outcome.checked) run.checked += 1;
        else await tried(outcome.error ?? "NOT_CHECKED");
        run.added += outcome.added;
        if (outcome.error && outcome.error !== "RATE_LIMITED") run.failed += 1;
      } catch (error) {
        run.failed += 1;
        await tried(isConversationsNotReady(error) ? "NOT_READY" : "FAILED");
      }
    }
  };
  await Promise.all(Array.from({ length: POOL }, () => worker()));
  if (queue.length > 0) more = true;
  if (platformRow?.status === "on" && (platformRow.lastCheckedAt === null || now.getTime() - platformRow.lastCheckedAt.getTime() >= 6 * 3_600_000) && timeLeft() >= PER_HOTEL_BUDGET_MS + 5_000) {
    try {
      const outcome = await ports.platform.syncForWorker({ budgetMs: Math.min(PER_HOTEL_BUDGET_MS, timeLeft() - 5_000) });
      if (outcome.checked) run.checked += 1;
      run.added += outcome.added;
    } catch {
      run.failed += 1;
    }
  }
  ports.log?.("conversations cron", { hotels: run.hotels, checked: run.checked, added: run.added, purged: run.purged, failed: run.failed, more });
  return more ? { ...run, more: true } : run;
}

/** The cron route's pass with the app's own services. */
export async function runConversationsCron(o: { budgetMs: number }): Promise<ConversationsCronRun> {
  // loaded on first use: compose/personalMailbox.ts reaches this file for the console's gate
  const personal = (await import("./personalMailbox")).getPersonalMailbox();
  return runConversationsPass({ registry: registry(), hotel: getConversations(), platform: getPlatformConversations(), personal, now: () => new Date(), log }, o);
}

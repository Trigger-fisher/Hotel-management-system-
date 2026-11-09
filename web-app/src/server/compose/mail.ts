import "server-only";
import { appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { after } from "next/server";
import { getDatabase } from "../../db";
import { verifiedDomainAddress } from "./hotelIdentity";
import { platformMailIdentityOf } from "./mailIdentity";
import { getConfig, type AppConfig } from "../config/env";
import { createHotelMailRouter, EMAIL_SETTING_KEYS, hotelSmtpFromSettings } from "../mail/hotelSmtp";
import { readGroupMail, readHotelMail, type HotelMailRead } from "../mail/hotelMail";
import { mailAddressOf } from "../mail/sendingDomain";
import { createPlatformSettingsSender, PLATFORM_BACKUP_KEYS, PLATFORM_SMTP_KEYS, readPlatformBackup, readPlatformSmtp, type PlatformFailoverPorts } from "../mail/platformSmtp";
import { cachedBrandOf, type MailBrand } from "../mail/layout";
import { createSmtpSender, isMailAddress, securityOfEnv, type SmtpConfig } from "../mail/smtp";
import { getWebsitePublic } from "./website";
import { smtpSecretKeyOf } from "../mail/key";
import type { PlatformUnit } from "../repos/auth";
import { businessNamesOf } from "../services/admin/context";
import { runOutboxPass, utcDay, type BulkLimits, type BulkPolicy, type MailSender } from "../services/auth/mail";
import { feedCampaigns, type FeedPorts } from "../services/companies/campaignFeed";
import { getHashKey } from "../crypto";
import { effectiveLimits, providerOfSaved } from "../mail/provider";
import { mailWake } from "../services/auth/mailWake";
import { getDocumentRenderer } from "../documents";
import type { OutboxRecord } from "../repos/auth";
import type { MailAttachment, MailMessage, MailPayload } from "../services/auth/mail";
import { getAdminUnit } from "./admin";
import { billingDefaults, getBillingAdvances, getBillingBills } from "./billing";
import { getPlatformUnit } from "./auth";

// The mail worker: sends what platform.outbox holds (sign-in codes, reset codes, temporary passwords, "your password changed", a hotel's enquiry mails).
// Started once by src/instrumentation.ts when the server starts, and only when the real database is configured. Three things make it quick:
//  - it is WOKEN the moment a mail is queued (services/auth/mailWake.ts): in-process a pass starts within a quarter of a second; on a serverless host the
//    request that queued the mail runs one pass right after its answer went out (next/server `after`), so nobody waits for the cron;
//  - a pass sends up to 50 mails, 8 at a time, and runs again at once while a full batch was claimed (up to a time budget);
//  - a mail that names a hotel goes through that hotel's own mail server (mail/hotelSmtp.ts: pooled connections, settings cached a minute), the rest
//    through the platform sender.
//
// Two platform drivers, chosen by MAIL_DRIVER (default log):
//  - log: the mail is written to the server's own console (the terminal running the app) and, outside production, appended to the git-ignored file
//    db/.dev-mail.log so a tool can read the latest code; nothing leaves the machine. Development only: in production the log driver does not run, the
//    worker does not start and the queue simply waits (mail is never dropped, and a code is never printed or written in production).
//  - smtp: a real mail server (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM); works in production too. Keys come from the hosting environment.
const INTERVAL_MS = 5000;
/** How soon after a queued mail the in-process worker starts a pass (several mails queued together share one pass). */
const WAKE_DELAY_MS = 250;
/** One drain keeps claiming batches for at most this long (in-process; the cron route has its own budget). */
const DRAIN_BUDGET_MS = 20_000;
let timer: NodeJS.Timeout | undefined;
let wakeTimer: NodeJS.Timeout | undefined;
let unsubscribe: (() => void) | undefined;
let running = false;
let again = false;

/** db/.dev-mail.log at the repository root (the app runs from web-app/, scripts from the root); null when no db/migrations folder is found. */
export function devMailLogPath(cwd: string = process.cwd()): string | null {
  for (const dir of [path.join(cwd, "common", "db"), path.join(cwd, "..", "common", "db")]) if (existsSync(path.join(dir, "migrations"))) return path.join(dir, ".dev-mail.log");
  return null;
}

/** "attachment: bill-xxx.pdf (N bytes)" per file, so a developer sees in the dev log that the PDF was made (name and size only, never the content). */
export function attachmentLines(message: Pick<MailMessage, "attachments">): string {
  return (message.attachments ?? []).map((a) => `\nattachment: ${a.filename} (${a.content.byteLength} bytes)`).join("");
}

export const logMailSender: MailSender = {
  async send(message) {
    // the log driver is development only: in production it does nothing at all (and the production boot check refuses MAIL_DRIVER=log anyway)
    if (process.env.NODE_ENV === "production") return;
    const attached = attachmentLines(message);
    // eslint-disable-next-line no-console -- the mail goes to the terminal running the app and nowhere else
    console.info(`[mail] to ${message.to}${message.hotelId ? ` (hotel ${message.hotelId})` : ""} | ${message.subject}\n${message.text}${attached}`);
    const file = devMailLogPath();
    if (!file) return;
    // the file is git-ignored (root .gitignore); a failed write never fails the send (the console copy is there)
    await appendFile(file, `----- ${new Date().toISOString()}\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}${attached}\n\n`, { encoding: "utf8", mode: 0o600 }).catch(() => undefined);
  },
};

/** The sender the platform settings name (Platform > Settings > Mail sender), read at most once a minute; null = use SMTP_FROM. */
function settingsFrom(): () => Promise<{ name: string | null; email: string | null } | null> {
  let cached: { at: number; value: { name: string | null; email: string | null } | null } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    const client = await getDatabase().pool.connect();
    try {
      const r = await client.query("SELECT key, value #>> '{}' AS v FROM platform.platform_settings WHERE key IN ('mail.from_name', 'mail.from_email')");
      const by = new Map(r.rows.map((x) => [String(x.key), x.v === null ? null : String(x.v)]));
      const value = { name: by.get("mail.from_name") ?? null, email: by.get("mail.from_email") ?? null };
      cached = { at: Date.now(), value: value.name || value.email ? value : null };
    } finally {
      client.release();
    }
    return cached.value;
  };
}

/**
 * The mail server the Super Admin saved (Platform settings > Mail), read at most once a minute; null = none saved or unusable (then the server's own configuration sends).
 * The saved password is opened here with the mail key (mail/key.ts) and goes nowhere but the transport.
 */
export function platformSmtpLoader(config: AppConfig): () => Promise<SmtpConfig | null> {
  let cached: { at: number; value: SmtpConfig | null } | null = null;
  const key = smtpSecretKeyOf(config);
  return async () => {
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    const client = await getDatabase().pool.connect();
    try {
      const r = await client.query("SELECT key, value #>> '{}' AS v, value AS j FROM platform.platform_settings WHERE key = ANY($1::text[])", [[...PLATFORM_SMTP_KEYS]]);
      const by = new Map(r.rows.map((x) => [String(x.key), x.j]));
      const sealed = r.rows.find((x) => x.key === "mail.smtp_password")?.v;
      cached = { at: Date.now(), value: readPlatformSmtp((k) => by.get(k) ?? null, typeof sealed === "string" ? sealed : null, key, config.SMTP_FROM).config };
    } finally {
      client.release();
    }
    return cached.value;
  };
}

/**
 * The Google backup and the failover rules (Platform settings > Mail), read at most once a minute; and the place a switch is written down (platform_settings 'mail.failover_state').
 * The app password is opened here with the mail key and goes nowhere but the transport.
 */
export function platformFailoverPorts(config: AppConfig): PlatformFailoverPorts {
  let cached: { at: number; value: Awaited<ReturnType<PlatformFailoverPorts["load"]>> } | null = null;
  const key = smtpSecretKeyOf(config);
  return {
    async load() {
      if (cached && Date.now() - cached.at < 60_000) return cached.value;
      const client = await getDatabase().pool.connect();
      try {
        const r = await client.query("SELECT key, value #>> '{}' AS v, value AS j FROM platform.platform_settings WHERE key = ANY($1::text[])", [[...PLATFORM_BACKUP_KEYS, "mail.from_name", "mail.reply_to"]]);
        const by = new Map(r.rows.map((x) => [String(x.key), x.j]));
        const sealed = r.rows.find((x) => x.key === "mail.backup_password")?.v;
        const read = readPlatformBackup((k) => by.get(k) ?? null, typeof sealed === "string" ? sealed : null, key);
        cached = { at: Date.now(), value: { backup: read.config, rule: read.rule, state: read.state } };
      } finally {
        client.release();
      }
      return cached.value;
    },
    async save(state) {
      const client = await getDatabase().pool.connect();
      try {
        await client.query("INSERT INTO platform.platform_settings (key, value, is_secret) VALUES ('mail.failover_state', $1::jsonb, false) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify(state)]);
        if (cached) cached = { at: cached.at, value: { ...cached.value, state } };
      } finally {
        client.release();
      }
    },
  };
}

/**
 * The PLATFORM sender for this configuration; null when none may run (the log driver in production). The mail server saved in Platform settings is used FIRST; while it is
 * empty the server's own configuration (MAIL_DRIVER smtp, or the log driver in development) sends.
 */
export function mailSenderFor(config: AppConfig): MailSender | null {
  let env: MailSender | null;
  if (config.MAIL_DRIVER === "smtp" && config.SMTP_HOST && config.SMTP_FROM) {
    env = createSmtpSender({ host: config.SMTP_HOST, port: config.SMTP_PORT, security: securityOfEnv(config.SMTP_PORT, config.SMTP_SECURE), ...(config.SMTP_USER !== undefined && config.SMTP_PASS !== undefined ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : {}), from: config.SMTP_FROM }, { resolveFrom: settingsFrom() });
  } else {
    env = config.NODE_ENV === "production" ? null : logMailSender;
  }
  if (!env || !config.DATABASE_URL) return env;
  return createPlatformSettingsSender({ env, load: platformSmtpLoader(config), failover: platformFailoverPorts(config) });
}

/** What a hotel's campaign mail may do: its own mail service when it has one, else the platform service its mail falls back to. 0 = no fixed limit. Read at most once a minute per hotel. */
export function bulkPolicyFor(config: AppConfig): BulkPolicy {
  const key = smtpSecretKeyOf(config);
  const hotels = new Map<string, { at: number; limits: BulkLimits }>();
  let platform: { at: number; limits: BulkLimits } | null = null;
  const workspace = (user: string | undefined): boolean => !!user && !/@(gmail|googlemail)\.com$/i.test(user);

  async function platformLimits(): Promise<BulkLimits> {
    if (platform && Date.now() - platform.at < 60_000) return platform.limits;
    const client = await getDatabase().pool.connect();
    let limits: BulkLimits;
    try {
      const r = await client.query("SELECT key, value #>> '{}' AS v FROM platform.platform_settings WHERE key IN ('mail.provider', 'mail.smtp_host', 'mail.smtp_user', 'mail.daily_limit')");
      const by = new Map(r.rows.map((x) => [String(x.key), x.v === null ? "" : String(x.v)]));
      const provider = providerOfSaved(by.get("mail.provider"), by.get("mail.smtp_host"));
      const dailyLimit = Number(by.get("mail.daily_limit") ?? 0) || null;
      // nothing saved: the server's own SMTP_* sends; its service is not known, so only a gentle rate applies (the log driver in development is not paced)
      limits = provider ? (({ perSecond, perDay }) => ({ perSecond, perDay }))(effectiveLimits(provider, { workspace: provider === "gmail" && workspace(by.get("mail.smtp_user")), dailyLimit })) : { perSecond: config.MAIL_DRIVER === "smtp" ? 5 : 0, perDay: 0 };
    } finally {
      client.release();
    }
    platform = { at: Date.now(), limits };
    return limits;
  }

  return {
    async limitsOf(hotelId) {
      const hit = hotels.get(hotelId);
      if (hit && Date.now() - hit.at < 60_000) return hit.limits;
      const settings = await getAdminUnit().run({ hotelId, userId: "mail-worker", visit: undefined }, async (repos) => ({ rows: await repos.adminSettings.get(EMAIL_SETTING_KEYS), hotelName: (await businessNamesOf(repos)).hotel }));
      const read = hotelSmtpFromSettings(settings.rows, settings.hotelName, hotelId, key);
      let limits: BulkLimits;
      if (read.config && read.provider) {
        const l = effectiveLimits(read.provider, { workspace: read.provider === "gmail" && workspace(read.config.user), dailyLimit: read.dailyLimit });
        limits = { perSecond: l.perSecond, perDay: l.perDay };
      } else {
        // the hotel sends through the platform email: the platform's service sets the limits (and the hotel's own daily limit, if it set one, lowers the day figure)
        const p = await platformLimits();
        limits = { perSecond: p.perSecond, perDay: read.dailyLimit && read.dailyLimit > 0 ? (p.perDay === 0 ? read.dailyLimit : Math.min(p.perDay, read.dailyLimit)) : p.perDay };
      }
      hotels.set(hotelId, { at: Date.now(), limits });
      return limits;
    },
  };
}

/**
 * The platform's Amazon SES login and the owner's automatic address on its domain (slug@domain, the same rule as the platform sender): what a hotel's or group's SES level sends with
 * unless an email address was saved for it. `[null, null]` while the platform has no saved mail server.
 */
async function autoSesOf(platformSes: () => Promise<SmtpConfig | null>, slug: string | null): Promise<[SmtpConfig | null, string | null]> {
  const ses = await platformSes().catch(() => null);
  return [ses, ses?.sendingDomain ? mailAddressOf(slug, ses.sendingDomain) : null];
}

/**
 * A hotel's own mail accounts set by the Super Admin (platform.hotel_mail: Amazon SES and Google), opened with the mail key; null when the hotel has no row. The router remembers
 * the answer for a minute, so a saved change is used by the mail sent a minute later at the latest.
 */
export function hotelMailLoader(config: AppConfig): (hotelId: string) => Promise<HotelMailRead | null> {
  const key = smtpSecretKeyOf(config);
  const platformSes = platformSmtpLoader(config);
  const t = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return async (hotelId) => {
    const client = await getDatabase().pool.connect();
    try {
      const r = await client.query(
        "SELECT m.hotel_id, m.ses_region, m.ses_user, m.ses_password, m.ses_from, m.gmail_user, m.gmail_password, m.from_name, m.reply_to, h.name AS hotel_name, h.slug AS hotel_slug FROM platform.hotel_mail m JOIN platform.hotels h ON h.id = m.hotel_id WHERE m.hotel_id = $1::uuid",
        [hotelId],
      );
      const x = r.rows[0];
      if (!x) return null;
      return readHotelMail({ hotelId, sesRegion: t(x.ses_region), sesUser: t(x.ses_user), sesPassword: t(x.ses_password), sesFrom: t(x.ses_from), gmailUser: t(x.gmail_user), gmailPassword: t(x.gmail_password), fromName: t(x.from_name), replyTo: t(x.reply_to), sesTest: null, gmailTest: null, updatedAt: null }, key, t(x.hotel_name), ...(await autoSesOf(platformSes, t(x.hotel_slug))));
    } finally {
      client.release();
    }
  };
}

/**
 * The mail accounts of the GROUP a hotel belongs to (platform.group_mail: Amazon SES and Google), opened with the mail key; null when the hotel is in no real group (the "Individual
 * hotels" holder is not one) or the group has no row. Tried by the router after the hotel's own accounts and before the platform's.
 */
export function groupMailLoader(config: AppConfig): (hotelId: string) => Promise<HotelMailRead | null> {
  const key = smtpSecretKeyOf(config);
  const platformSes = platformSmtpLoader(config);
  const t = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return async (hotelId) => {
    const client = await getDatabase().pool.connect();
    try {
      const r = await client.query(
        `SELECT m.group_id, m.ses_region, m.ses_user, m.ses_password, m.ses_from, m.gmail_user, m.gmail_password, m.from_name, m.reply_to, g.name AS group_name, g.slug AS group_slug
           FROM platform.group_members gm
           JOIN platform.hotel_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL AND g.kind <> 'individual'
           JOIN platform.group_mail m ON m.group_id = gm.group_id AND m.pause IS NULL
          WHERE gm.hotel_id = $1::uuid
          LIMIT 1`,
        [hotelId],
      );
      const x = r.rows[0];
      if (!x) return null;
      return readGroupMail({ groupId: String(x.group_id), sesRegion: t(x.ses_region), sesUser: t(x.ses_user), sesPassword: t(x.ses_password), sesFrom: t(x.ses_from), gmailUser: t(x.gmail_user), gmailPassword: t(x.gmail_password), fromName: t(x.from_name), replyTo: t(x.reply_to), sesTest: null, gmailTest: null, updatedAt: null }, key, t(x.group_name), ...(await autoSesOf(platformSes, t(x.group_slug))));
    } finally {
      client.release();
    }
  };
}

/**
 * Whether a hotel's mail is paused by the Super Admin (Platform > Hotel and group mail): the hotel's own pause, or its group's pause that covers every hotel (scope "all"). A group paused
 * with scope "one" only has its own accounts skipped (groupMailLoader), its hotels keep sending.
 */
export function pausedLoader(): (hotelId: string) => Promise<boolean> {
  return async (hotelId) => {
    const client = await getDatabase().pool.connect();
    try {
      const r = await client.query(
        `SELECT 1 FROM platform.hotel_mail WHERE hotel_id = $1::uuid AND pause IS NOT NULL
         UNION ALL
         SELECT 1 FROM platform.group_members gm
           JOIN platform.hotel_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL AND g.kind <> 'individual'
           JOIN platform.group_mail m ON m.group_id = gm.group_id AND m.pause->>'scope' = 'all'
          WHERE gm.hotel_id = $1::uuid
         LIMIT 1`,
        [hotelId],
      );
      return r.rows.length > 0;
    } finally {
      client.release();
    }
  };
}

let router: (MailSender & { close(): void }) | null = null;
/**
 * The sender the worker uses: each hotel's own mail server for the mails that name a hotel (Settings > Email, read through the hotel's own unit), the platform
 * sender for the rest. Null when the platform sender may not run AND there is no database (nothing could be sent at all).
 */
export function routedMailSender(config: AppConfig): MailSender | null {
  if (router) return router;
  const platform = mailSenderFor(config);
  if (!config.DATABASE_URL) return platform;
  router = createHotelMailRouter({
    platform,
    secretKey: smtpSecretKeyOf(config),
    dedicatedOf: hotelMailLoader(config),
    groupDedicatedOf: groupMailLoader(config),
    pausedOf: pausedLoader(),
    settingsOf: async (hotelId) => {
      try {
        const hotel = await getAdminUnit().run({ hotelId, userId: "mail-worker", visit: undefined }, async (repos) => ({ rows: await repos.adminSettings.get(EMAIL_SETTING_KEYS), hotelName: (await businessNamesOf(repos)).hotel }));
        // the hotel's slug: the local part of its address on the platform's sending domain (only used when its mail goes out through the platform)
        const slug = await platformMailIdentityOf(hotelId).then((i) => i.slug, () => null);
        // "My own domain": the hotel's address, only when its domain passed the DNS check and the platform confirmed it in SES
        const chosen = hotel.rows.find((r) => r.key === "email.provider")?.value;
        const domainFrom = chosen === "domain" ? await verifiedDomainAddress(hotelId).catch(() => null) : null;
        return { ...hotel, slug, domainFrom };
      } catch {
        // an unknown or deleted hotel: the platform sender takes it
        return null;
      }
    },
  });
  return router;
}

/**
 * The PDF of an invoice or a receipt mail, made WHEN THE MAIL IS SENT from the hotel's own data (nothing is stored in the outbox): the same bill / receipt document the
 * Bills screen prints. A bill or advance removed since the mail was queued is not found and the mail fails with the reason RENDER.
 */
export async function attachmentsOf(row: OutboxRecord, payload: MailPayload): Promise<MailAttachment[]> {
  if (!row.hotelId) throw new Error("an invoice names its hotel");
  if (row.kind === "bill_invoice" && payload.billId) {
    const doc = await getDocumentRenderer().render("bill", await getBillingBills().previewForMail(row.hotelId, payload.billId));
    return [{ filename: doc.filename, contentType: "application/pdf", content: doc.bytes }];
  }
  if (row.kind === "advance_receipt" && payload.advanceId) {
    const doc = await getDocumentRenderer().render("advance", await getBillingAdvances().previewForMail(row.hotelId, payload.advanceId));
    return [{ filename: doc.filename, contentType: "application/pdf", content: doc.bytes }];
  }
  throw new Error("nothing to attach");
}

/**
 * Who a hotel's mail is from, for the HTML layout (mail/layout.ts): its name, address and phone (Settings > General), its reply address (Settings > Email) and the logo
 * of its website when it has one (a public https address). Read through the hotel's own unit, remembered a minute; anything that cannot be read is left out.
 */
export function hotelBrandLoader(): (hotelId: string) => Promise<MailBrand | null> {
  return cachedBrandOf(async (hotelId) => {
    const read = await getAdminUnit().run({ hotelId, userId: "mail-worker", visit: undefined }, async (repos) => ({ header: await repos.hotelProfile.header(), rows: await repos.adminSettings.get(["email.reply_to", "email.from_address"]) }));
    const v = (k: string): string => (read.rows.find((r) => r.key === k)?.value ?? "").trim();
    const email = [v("email.reply_to"), v("email.from_address")].find((x) => isMailAddress(x)) ?? null;
    const slug = await platformMailIdentityOf(hotelId).then((i) => i.slug, () => null);
    const logoUrl = slug ? await getWebsitePublic().brand(slug).then((b) => b.logoUrl, () => null) : null;
    return { name: read.header.name, address: read.header.address, phone: read.header.phone, email, logoUrl };
  });
}
let brandOf: ((hotelId: string) => Promise<MailBrand | null>) | null = null;
const brandOfHotel = (): ((hotelId: string) => Promise<MailBrand | null>) => (brandOf ??= hotelBrandLoader());

/**
 * A drain: passes until nothing more is due or the budget is spent. Two drains at once are safe (the claim skips rows another one holds), but one process runs
 * one at a time and remembers a wake that came meanwhile.
 */
async function drain(unit: PlatformUnit, sender: MailSender, budgetMs: number): Promise<{ sent: number; failed: number }> {
  const started = Date.now();
  let sent = 0;
  let tried = 0;
  // the lanes: system mail first, then each hotel's campaign mail within its service's limits (bulkPolicyFor)
  const policy = getConfig().DATABASE_URL ? policyOf() : undefined;
  for (;;) {
    // the running campaigns first get their next recipients into the queue (within what each hotel may send today)
    const fed = await feedOnce();
    const pass = await runOutboxPass({ unit, sender, now: () => new Date(), attach: attachmentsOf, publicUrl: getConfig().HMS_PUBLIC_URL ?? null, ...(policy ? { policy, brandOf: brandOfHotel() } : {}) });
    sent += pass.sent;
    tried += pass.claimed;
    // go on while more is probably waiting (the pass says so) or the feeder just added campaign mail that this pass sent; a capped or held hotel no longer stops the
    // drain for the others (MAIL-LOAD-REPORT F1)
    const goOn = pass.more || (fed > 0 && pass.claimed > 0);
    if (!goOn || pass.claimed === 0 || Date.now() - started > budgetMs) break;
  }
  return { sent, failed: tried - sent };
}

let bulkPolicy: BulkPolicy | null = null;
const policyOf = (): BulkPolicy => (bulkPolicy ??= bulkPolicyFor(getConfig()));

/** What a hotel's mail service allows for campaign mail (0 = no fixed limit); none can be read = a gentle default. For the campaign estimate. */
export async function campaignLimits(hotelId: string): Promise<BulkLimits> {
  if (!getConfig().DATABASE_URL) return { perSecond: 0, perDay: 0 };
  return policyOf().limitsOf(hotelId);
}

/** How many more mails a hotel may send today: its service's day limit, its own limit and the Super Admin's cap, less what it sent today. Infinity = no daily limit. */
async function campaignAllowance(hotelId: string): Promise<number> {
  const limits = await policyOf().limitsOf(hotelId);
  const day = utcDay(new Date());
  const unit = getPlatformUnit();
  const [caps, sent] = await unit.run(async (r) => [await r.outbox.caps([hotelId]), await r.outbox.sentToday([hotelId], day)] as const);
  const cap = caps.get(hotelId);
  const perDay = cap === undefined ? limits.perDay : limits.perDay === 0 ? cap : Math.min(limits.perDay, cap);
  if (perDay === 0 && cap === undefined) return Infinity;
  return Math.max(0, perDay - (sent.get(hotelId) ?? 0));
}

/** The campaign feeder's parts (services/companies/campaignFeed.ts): the platform's running list, holds and queue, and the hotels' own companies unit. */
function feedPorts(): FeedPorts | null {
  const config = getConfig();
  if (!config.DATABASE_URL || !config.HMS_HASH_KEY) return null;
  const platform = getPlatformUnit();
  return {
    publicUrl: config.HMS_PUBLIC_URL ?? "http://localhost:3000",
    secret: () => getHashKey(),
    suppressedAmong: (hotelId, emails) => platform.run((r) => r.mailSafety.suppressedAmong(hotelId, emails)),
    runs: () => platform.run((r) => r.campaignRuns.active()),
    setRunState: (hotelId, campaignId, state) => platform.run((r) => r.campaignRuns.setState(hotelId, campaignId, state)),
    endRun: (hotelId, campaignId) => platform.run((r) => r.campaignRuns.end(hotelId, campaignId)),
    held: (hotelIds) => platform.run((r) => r.mailSafety.heldAmong(hotelIds)),
    waiting: (hotelIds) => platform.run((r) => r.outbox.bulkWaiting(hotelIds)),
    allowance: campaignAllowance,
    pending: async (hotelId, template) => (await platform.run((r) => r.outbox.countByTemplate(hotelId, [template]))).get(template)?.pending ?? 0,
    enqueue: (hotelId, rows) =>
      platform.run(async (r) => {
        const at = new Date();
        for (const x of rows) await r.outbox.enqueue({ userId: null, hotelId, kind: "campaign", toEmail: x.to, template: x.template, payload: JSON.stringify(x.payload) }, at);
      }),
    hotel: billingDefaults().unit,
  };
}
let feeder: FeedPorts | null | undefined;
/** One round of the campaign feeder; how many mails it moved into the queue. A failure never stops the mail worker (0 then). */
async function feedOnce(): Promise<number> {
  if (feeder === undefined) feeder = feedPorts();
  if (!feeder) return 0;
  return (await feedCampaigns(feeder, () => new Date()).catch(() => ({ fed: 0 }))).fed;
}

function runInProcess(unit: PlatformUnit, sender: MailSender): void {
  if (running) {
    again = true;
    return;
  }
  running = true;
  void drain(unit, sender, DRAIN_BUDGET_MS)
    .catch(() => undefined)
    .finally(() => {
      running = false;
      if (again) {
        again = false;
        runInProcess(unit, sender);
      }
    });
}

export function startMailWorker(given?: MailSender): void {
  if (timer || unsubscribe) return;
  const config = getConfig();
  if (!config.DATABASE_URL || !config.HMS_HASH_KEY) return;
  // HMS_MAIL_WORKER=cron (a serverless host: a timer would not outlive the request): no timer; a scheduler calls GET /api/v1/cron/mail -> drainMailOnce(), and
  // the request that queued a mail runs one pass right after it answered (`after`), so the cron is only the safety net.
  if (config.HMS_MAIL_WORKER === "cron") {
    unsubscribe = mailWake.subscribe(() => {
      try {
        after(() => drainMailOnce().catch(() => undefined));
      } catch {
        // outside a request (a script): the next cron call sends it
      }
    });
    return;
  }
  const sender = given ?? routedMailSender(config);
  if (!sender) return;
  const unit = getPlatformUnit();
  timer = setInterval(() => runInProcess(unit, sender), INTERVAL_MS);
  timer.unref();
  unsubscribe = mailWake.subscribe(() => {
    if (wakeTimer) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = undefined;
      runInProcess(unit, sender);
    }, WAKE_DELAY_MS);
    wakeTimer.unref();
  });
}

export function stopMailWorker(): void {
  if (timer) clearInterval(timer);
  if (wakeTimer) clearTimeout(wakeTimer);
  timer = undefined;
  wakeTimer = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  router?.close();
  router = null;
}

/* ---------------------------------------------------------------- one pass on request (HMS_MAIL_WORKER=cron) */

export interface MailDrainSummary {
  /** Mails sent in this pass. */
  sent: number;
  /** Mails tried in this pass that did not go (retried later, or given up after the last try). */
  failed: number;
  /** Mails still waiting after this pass (pending, due now or later). */
  remaining: number;
}

interface DrainParts {
  unit: PlatformUnit;
  sender: MailSender | null;
  /** How many mails wait (status pending). */
  pending: () => Promise<number>;
}
let drainParts: DrainParts | null = null;

/** Replaces what drainMailOnce uses (tests). */
export function configureMailDrain(next: DrainParts | null): void {
  drainParts = next;
}

function defaultDrainParts(): DrainParts | null {
  const config = getConfig();
  if (!config.DATABASE_URL || !config.HMS_HASH_KEY) return null;
  return {
    unit: getPlatformUnit(),
    sender: routedMailSender(config),
    pending: async () => {
      const client = await getDatabase().pool.connect();
      try {
        const r = await client.query("SELECT count(*)::int AS n FROM platform.outbox WHERE status = 'pending'");
        return Number(r.rows[0]?.n ?? 0);
      } finally {
        client.release();
      }
    },
  };
}

/**
 * The mail queue drained once for GET /api/v1/cron/mail: passes of at most 50 mails, 8 at a time, until nothing is due or `budgetMs` (default 40 s, under the
 * route's 60 s) is spent. Two drains at the same time are safe (the claim skips rows another one holds). Without a database, or with no sender allowed (the log
 * driver in production), nothing is sent and the queue waits.
 */
export async function drainMailOnce(budgetMs = 40_000): Promise<MailDrainSummary> {
  const parts = drainParts ?? defaultDrainParts();
  if (!parts) return { sent: 0, failed: 0, remaining: 0 };
  if (!parts.sender) return { sent: 0, failed: 0, remaining: await parts.pending() };
  const done = await drain(parts.unit, parts.sender, budgetMs);
  return { ...done, remaining: await parts.pending() };
}

import "server-only";
import { createHash } from "node:crypto";
import type { SettingRow } from "../repos/admin";
import type { MailSender } from "../services/auth/mail";
import { createSmtpSender, fromHeader, isMailAddress, MailSendError, readSmtpPassword, securityOfStored, type SmtpConfig, type TransportFactory } from "./smtp";
import { providerOfSaved, type ProviderId } from "./provider";
import { failureCodeOf } from "./failure";
import { isServiceSideFailure } from "./failover";
import { serversOf, type HotelMailRead } from "./hotelMail";

// Each hotel sends its own mail from its own mail server (Settings > Email: the SAME fields as the platform's: host, port, security, login, password, from name, from address,
// reply-to), so a guest sees the hotel's address, not a shared one. This module is the router the outbox worker calls: a queued mail that names a hotel goes out through that
// hotel's SMTP; a mail with no hotel (sign-in codes, platform invitations) goes through the platform sender. A hotel mail of a hotel that has not set its mail up still goes,
// through the platform sender, as the hotel (its name as the sender name, its address as the reply-to). Everything that sends is the shared module (mail/smtp.ts).
//
// Built for many hotels at once: the settings of a hotel are read at most once a minute; one pooled sender per hotel (3 connections, reused across mails) is kept in a small
// LRU (200 hotels), closed when idle for five minutes or when pushed out. A hotel's password is read from app_settings only here and goes nowhere but the transport (never into
// a log, an error or an answer).

/** The app_settings keys of Settings > Email (services/admin/settingsDefs.ts); the last three switch on reading the same mailbox for Conversations (mail/mailbox.ts). */
export const EMAIL_SETTING_KEYS = ["email.mode", "email.provider", "email.host", "email.port", "email.encryption", "email.region", "email.username", "email.password", "email.from_address", "email.from_name", "email.reply_to", "email.daily_limit", "email.imap", "email.imap_host", "email.imap_port"] as const;

export interface HotelSmtpRead {
  /** The hotel's mail server; null = not set up (no host or no from address, a bad port) or not usable (a saved password that cannot be opened). */
  config: SmtpConfig | null;
  /** A password is saved but cannot be opened (no key, a changed key, another hotel's). */
  passwordUnreadable: boolean;
  /** The mail service the hotel saved (or the one its host belongs to, for settings saved before the picker); null = none saved: the platform email sends. */
  provider: ProviderId | null;
  /** The hotel's own daily limit (email.daily_limit); null = the service's own. */
  dailyLimit: number | null;
}

/**
 * The hotel's SMTP settings as the shared sender needs them. Pure: tests feed rows straight in. `hotelName` fills the from name when the hotel left it empty. The password is
 * a sealed value (opened with `key`, bound to `hotelId`) or an older plain one (still used; it is sealed at the next save of Settings > Email).
 */
export function hotelSmtpFromSettings(rows: readonly SettingRow[], hotelName: string | null, hotelId: string, key: Buffer | null): HotelSmtpRead {
  const v = (k: string): string => (rows.find((r) => r.key === k)?.value ?? "").trim();
  const host = v("email.host");
  // the form asks only for the Gmail address: it is the From address (an older hotel may still have a separate from address saved)
  const fromAddress = (v("email.from_address") || v("email.username")).toLowerCase();
  const port = Number(v("email.port") || "587");
  const password = readSmtpPassword(rows.find((r) => r.key === "email.password")?.value, key, hotelId);
  const choice = v("email.provider");
  const dailyLimit = Number(v("email.daily_limit")) > 0 ? Number(v("email.daily_limit")) : null;
  // "Use the platform's mail" (email.mode = platform, or the earlier provider "platform"): nothing of the hotel's own is used, whatever else is saved
  if (v("email.mode") === "platform" || choice === "platform") return { config: null, passwordUnreadable: false, provider: null, dailyLimit };
  // "My own domain": the platform sends, from the hotel's address on its verified domain (the router decides if it is verified); the hotel has no connection of its own
  if (choice === "domain") return { config: null, passwordUnreadable: false, provider: "domain", dailyLimit };
  const provider = host === "" ? null : providerOfSaved(choice, host);
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host) || !isMailAddress(fromAddress) || !Number.isInteger(port) || port < 1 || port > 65535) return { config: null, passwordUnreadable: password.unreadable, provider, dailyLimit };
  if (password.unreadable) return { config: null, passwordUnreadable: true, provider, dailyLimit };
  const user = v("email.username");
  const fromName = v("email.from_name").replace("{hotel}", hotelName ?? "").trim() || hotelName;
  const replyTo = v("email.reply_to").toLowerCase();
  return {
    config: {
      host,
      port,
      security: port === 465 ? "ssl" : securityOfStored(v("email.encryption") || "tls"),
      ...(user !== "" && password.pass !== null ? { user, pass: password.pass } : {}),
      from: fromHeader(fromName, fromAddress),
      ...(isMailAddress(replyTo) ? { replyTo } : {}),
    },
    passwordUnreadable: false,
    provider,
    dailyLimit,
  };
}

/**
 * Who a hotel is to its guests even when it has no mail server of its own: its name (the From name it set, else the hotel's name) and, when it saved one, its address (the
 * reply-to it set, else the "from address"). A hotel mail that has to go out through the PLATFORM sender carries these: the From NAME and the Reply-To.
 */
export function hotelIdentityFromSettings(rows: readonly SettingRow[], hotelName: string | null): { name: string | null; replyTo: string | null } {
  const v = (k: string): string => (rows.find((r) => r.key === k)?.value ?? "").trim();
  const address = (v("email.reply_to") || v("email.from_address") || v("email.username")).toLowerCase();
  const name = v("email.from_name").replace("{hotel}", hotelName ?? "").trim() || hotelName;
  return { name: name && !/[\r\n]/.test(name) ? name : null, replyTo: isMailAddress(address) ? address : null };
}

export interface HotelMailRouterOptions {
  /** The platform sender (MAIL_DRIVER); null when none may run (then a hotel without its own settings cannot be served and the mail is retried later). */
  platform: MailSender | null;
  /** The hotel's Email settings rows and its name; null when the hotel is not there. */
  settingsOf(hotelId: string): Promise<{ rows: SettingRow[]; hotelName: string | null; /** The hotel's slug: the local part of its address on the platform's sending domain. */ slug?: string | null; /** The hotel's address on its own verified domain (provider "domain"), set only when the DNS check and the SES confirmation passed. */ domainFrom?: string | null } | null>;
  /**
   * The hotel's own mail accounts set by the Super Admin (Platform > Hotel mail: Amazon SES and Google), already opened; null = none. When there is one, the hotel's mail tries its SES
   * first (its Google when it has no SES); if that fails for a reason on the service's side, the platform sender takes the mail (its SES, then the platform's Google backup).
   */
  dedicatedOf?(hotelId: string): Promise<HotelMailRead | null>;
  /** The accounts of the GROUP this hotel belongs to (Platform > Hotel mail, groups); null = no group, or none set. Tried after the hotel's own and before the platform's. */
  groupDedicatedOf?(hotelId: string): Promise<HotelMailRead | null>;
  /** True while the hotel's mail is paused (its own pause, or its group's with scope "all"; Platform > Hotel and group mail). Such a mail is not sent: the queue keeps it and tries again later. */
  pausedOf?(hotelId: string): Promise<boolean>;
  /** SMTP_SECRET_KEY: opens a sealed password. */
  secretKey?: Buffer | null;
  createTransport?: TransportFactory;
  now?: () => number;
  /** How long a hotel's settings are trusted before they are read again. Default 60 s. */
  settingsTtlMs?: number;
  /** Hotels whose sender stays open at once. Default 200. */
  maxTransports?: number;
  /** A sender unused for this long is closed. Default 5 min. */
  idleMs?: number;
}

/** How long a hotel whose own account failed is sent through the platform before its own account is tried again. */
const DOWN_MS = 5 * 60_000;

interface Entry {
  key: string;
  sender: ReturnType<typeof createSmtpSender>;
  lastUsed: number;
}

/**
 * The outbox worker's sender: picks the hotel's own SMTP for a mail that names a hotel, the platform sender otherwise. `close()` drops every pooled connection
 * (server stop). `stats()` is for tests and System Health.
 */
export function createHotelMailRouter(options: HotelMailRouterOptions): MailSender & { close(): void; stats(): { transports: number; cachedSettings: number } } {
  const now = options.now ?? (() => Date.now());
  const ttl = options.settingsTtlMs ?? 60_000;
  const max = options.maxTransports ?? 200;
  const idle = options.idleMs ?? 5 * 60_000;
  const key = options.secretKey ?? null;
  const settings = new Map<string, { at: number; config: SmtpConfig | null; identity: { name: string | null; replyTo: string | null; slug: string | null; domainFrom: string | null } }>();
  const senders = new Map<string, Entry>();

  async function configOf(hotelId: string): Promise<{ config: SmtpConfig | null; identity: { name: string | null; replyTo: string | null; slug: string | null; domainFrom: string | null } }> {
    const hit = settings.get(hotelId);
    if (hit && now() - hit.at < ttl) return hit;
    // a hotel that cannot be opened (removed, never provisioned, an id that is no hotel) has no server of its own: the platform sender takes the mail; never an error
    const read = await options.settingsOf(hotelId).catch(() => null);
    const config = read ? hotelSmtpFromSettings(read.rows, read.hotelName, hotelId, key).config : null;
    const identity = read ? { ...hotelIdentityFromSettings(read.rows, read.hotelName), slug: read.slug ?? null, domainFrom: read.domainFrom ?? null } : { name: null, replyTo: null, slug: null, domainFrom: null };
    settings.set(hotelId, { at: now(), config, identity });
    if (settings.size > max * 4) for (const [k, v] of settings) if (now() - v.at >= ttl) settings.delete(k);
    return { config, identity };
  }

  /** The hotel's own accounts and its group's, from the Super Admin (each read at most once per settings TTL; a read that fails means none). */
  const dedicatedCache = new Map<string, { at: number; value: HotelMailRead | null }>();
  const groupCache = new Map<string, { at: number; value: HotelMailRead | null }>();
  const downUntil = new Map<string, number>();
  async function cachedRead(cache: typeof dedicatedCache, load: ((hotelId: string) => Promise<HotelMailRead | null>) | undefined, hotelId: string): Promise<HotelMailRead | null> {
    if (!load) return null;
    const hit = cache.get(hotelId);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = await load(hotelId).catch(() => null);
    cache.set(hotelId, { at: now(), value });
    if (cache.size > max * 4) for (const [k, v] of cache) if (now() - v.at >= ttl) cache.delete(k);
    return value;
  }
  const pausedCache = new Map<string, { at: number; value: boolean }>();
  /** Paused hotels: read at most once per settings TTL; a read that fails means "not paused" (a broken check never stops a hotel's mail). */
  async function isPaused(hotelId: string): Promise<boolean> {
    if (!options.pausedOf) return false;
    const hit = pausedCache.get(hotelId);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = await options.pausedOf(hotelId).catch(() => false);
    pausedCache.set(hotelId, { at: now(), value });
    if (pausedCache.size > max * 4) for (const [k, v] of pausedCache) if (now() - v.at >= ttl) pausedCache.delete(k);
    return value;
  }
  const dedicatedConfig = (hotelId: string) => cachedRead(dedicatedCache, options.dedicatedOf, hotelId);
  const groupConfig = (hotelId: string) => cachedRead(groupCache, options.groupDedicatedOf, hotelId);

  /** A pooled sender for one slot (a hotel's SES, its Google, its group's SES, ...), rebuilt when its settings changed (the key carries a digest of the password, never the password). */
  function senderFor(slot: string, c: SmtpConfig): ReturnType<typeof createSmtpSender> {
    const id = `${slot}|${c.host}|${c.port}|${c.security}|${c.user ?? ""}|${c.pass === undefined ? "" : createHash("sha256").update(c.pass).digest("hex").slice(0, 16)}|${c.from}|${c.replyTo ?? ""}`;
    const t = now();
    for (const [h, e] of senders) {
      if (t - e.lastUsed >= idle) {
        e.sender.close();
        senders.delete(h);
      }
    }
    const have = senders.get(slot);
    if (have && have.key === id) {
      have.lastUsed = t;
      return have.sender;
    }
    have?.sender.close();
    if (!have && senders.size >= max) {
      // the slot unused for the longest goes
      const oldest = [...senders.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) {
        oldest[1].sender.close();
        senders.delete(oldest[0]);
      }
    }
    const sender = createSmtpSender(c, { createTransport: options.createTransport, pool: true });
    senders.set(slot, { key: id, sender, lastUsed: t });
    return sender;
  }

  return {
    async send(message) {
      const hotelId = message.hotelId ?? null;
      // a paused hotel or group sends nothing: the queue keeps the mail (services/auth/mail.ts) and it goes out after the pause ends
      if (hotelId && (await isPaused(hotelId))) throw Object.assign(new MailSendError("SMTP_FAILED"), { reason: "PAUSED" });
      const found = hotelId ? await configOf(hotelId) : null;
      // The order of a hotel's mail (MJ, 1 Nov 2026): the hotel's own SES, its own Google, its group's SES, its group's Google, then the platform sender (the platform's SES, then its Google
      // backup). An account that is not set is skipped; a failure on the service's side moves on to the next one, and one that failed is not tried again for a few minutes.
      const dedicated = hotelId ? await dedicatedConfig(hotelId) : null;
      const group = hotelId ? await groupConfig(hotelId) : null;
      // the name a guest sees: the hotel's, even when the group's account is the one sending
      const hotelName = dedicated?.fromName ?? found?.identity.name ?? null;
      let ownFailure: unknown = null;
      // the hotel's own mail server from its Settings > Email (older hotels, when the Super Admin set no accounts for it) is the hotel's own level: it sends alone, as before
      if (hotelId && serversOf(dedicated).length === 0 && found?.config) return senderFor(`${hotelId}|own`, found.config).send({ ...message, useEnvironmentFrom: true });
      if (hotelId) {
        const levels: { level: "hotel" | "group"; read: HotelMailRead | null }[] = [{ level: "hotel", read: dedicated }, { level: "group", read: group }];
        for (const { level, read } of levels) {
          for (const [which, config] of [["ses", read?.ses], ["gmail", read?.gmail]] as const) {
            if (!config) continue;
            const slot = `${hotelId}|${level}|${which}`;
            if (now() < (downUntil.get(slot) ?? 0)) continue;
            try {
              return await senderFor(slot, config).send({ ...message, useEnvironmentFrom: true, ...(level === "group" && hotelName && !message.fromName ? { fromName: hotelName } : {}) });
            } catch (error) {
              if (!isServiceSideFailure(failureCodeOf(error))) throw error;
              ownFailure = error;
              downUntil.set(slot, now() + DOWN_MS);
            }
          }
        }
      }
      if (!options.platform) throw ownFailure ?? Object.assign(new MailSendError("SMTP_FAILED"), { reason: "NO_SENDER" });
      // nothing of the hotel's or its group's is set (or all of it failed): the mail still goes, through the platform sender, but as the HOTEL (its name as the sender name, its address as the reply-to)
      const replyTo = message.replyTo ? null : (dedicated?.replyTo ?? group?.replyTo ?? found?.identity.replyTo ?? null);
      return options.platform.send(hotelId && (found || dedicated || group) ? { ...message, ...(hotelName ? { fromName: hotelName } : {}), ...(found?.identity.slug ? { fromLocal: found.identity.slug } : {}), ...(found?.identity.domainFrom ? { fromAddress: found.identity.domainFrom } : {}), ...(replyTo ? { replyTo } : {}) } : message);
    },
    close() {
      for (const e of senders.values()) e.sender.close();
      senders.clear();
      settings.clear();
      dedicatedCache.clear();
      groupCache.clear();
      pausedCache.clear();
      downUntil.clear();
    },
    stats: () => ({ transports: senders.size, cachedSettings: settings.size }),
  };
}
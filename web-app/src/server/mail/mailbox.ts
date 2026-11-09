import "server-only";
import type { SettingRow } from "../repos/admin";
import type { ImapConfig } from "./imap";
import type { HotelMailRead } from "./hotelMail";
import { hotelSmtpFromSettings } from "./hotelSmtp";
import { providerIdOfHost } from "./hints";
import { isSafeHostName } from "./safeHost";
import type { SmtpConfig } from "./smtp";

// A mailbox HMS reads for Conversations (decision 66): the SAME account that sends (Settings > Email for a hotel, Platform settings > Mail for the platform), with the SAME
// sealed password (a Gmail app password works for SMTP and IMAP). Pure: rows and settings in, a usable mailbox or the reason it is not one out.
//   Gmail          reads imap.gmail.com, port 993 (fixed)
//   another server reads the IMAP server and port saved with it (993 SSL/TLS or 143 STARTTLS)
//   Amazon SES, Brevo, "My own domain"  only send: no mailbox to read ("send_only")
//   the platform's mail (a hotel with nothing of its own)  nothing to read ("platform_mail")

export const IMAP_PRESETS = { gmail: { host: "imap.gmail.com", port: 993 } } as const;

export interface MailboxConfig {
  /** The mailbox's own address (lower case): the From of its mail. */
  address: string;
  smtp: SmtpConfig;
  imap: ImapConfig;
  /** Gmail files a sent message in Sent by itself (no APPEND). */
  gmail: boolean;
}

export type MailboxReason = "off" | "platform_mail" | "send_only" | "not_set" | "password_unreadable";

export interface MailboxRead {
  config: MailboxConfig | null;
  /** Why there is no mailbox to read; null when `config` is set. */
  reason: MailboxReason | null;
  /** The settings say "read this mailbox" (Settings > Email: email.imap). */
  reading: boolean;
  provider: "gmail" | "smtp" | "send_only" | null;
}

const addressOf = (from: string): string => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
const portOf = (v: string | number | null | undefined): 993 | 143 => (Number(v) === 143 ? 143 : 993);

/** The IMAP side of an SMTP account: Gmail's fixed server, or the saved one. null = not set (or not a public server name). */
function imapOf(smtp: SmtpConfig, provider: "gmail" | "smtp", host: string, port: 993 | 143): ImapConfig | null {
  if (smtp.user === undefined || smtp.pass === undefined) return null;
  if (provider === "gmail") return { host: IMAP_PRESETS.gmail.host, port: 993, user: smtp.user, pass: smtp.pass };
  const h = host.trim().toLowerCase();
  if (!isSafeHostName(h)) return null;
  return { host: h, port, user: smtp.user, pass: smtp.pass };
}

/** A hotel's mailbox from its Settings > Email rows (the 15 keys of EMAIL_SETTING_KEYS). The password is opened with `key`, bound to the hotel. */
export function hotelMailboxFromSettings(rows: readonly SettingRow[], hotelName: string | null, hotelId: string, key: Buffer | null): MailboxRead {
  const v = (k: string): string => (rows.find((r) => r.key === k)?.value ?? "").trim();
  const reading = v("email.imap") === "1";
  const read = hotelSmtpFromSettings(rows, hotelName, hotelId, key);
  const choice = v("email.provider");
  if (v("email.mode") === "platform" || choice === "platform") return { config: null, reason: "platform_mail", reading: false, provider: null };
  const provider = read.provider ?? (choice === "gmail" || choice === "smtp" || choice === "ses" || choice === "brevo" || choice === "domain" ? choice : null);
  if (provider === "domain" || provider === "ses" || provider === "brevo") return { config: null, reason: "send_only", reading: false, provider: "send_only" };
  // nothing of its own saved: the platform's mail sends for it (an "own" choice without its details is "not set")
  if (provider === null) return { config: null, reason: v("email.mode") === "own" ? "not_set" : "platform_mail", reading: false, provider: null };
  if (!reading) return { config: null, reason: "off", reading, provider };
  if (read.passwordUnreadable) return { config: null, reason: "password_unreadable", reading, provider };
  if (!read.config) return { config: null, reason: "not_set", reading, provider };
  const imap = imapOf(read.config, provider, v("email.imap_host"), portOf(v("email.imap_port")));
  if (!imap) return { config: null, reason: "not_set", reading, provider };
  return { config: { address: addressOf(read.config.from), smtp: read.config, imap, gmail: provider === "gmail" }, reason: null, reading, provider };
}

/**
 * A hotel's mailbox from the Google account the Super Admin saved for it (Platform > Hotel and group mail): reading is on by itself, nobody in the hotel has a switch. Only a Google
 * login can be read (Amazon SES only sends), and only the HOTEL's own: a group's Google is shared by its hotels, so reading it would show every hotel the others' mail.
 * null = the hotel has no Google login of its own (the settings rows of the hotel decide, as before).
 */
export function hotelMailboxFromAccount(read: HotelMailRead | null): MailboxRead | null {
  const gmail = read?.gmail;
  if (!gmail || gmail.user === undefined || gmail.pass === undefined) return null;
  return { config: { address: addressOf(gmail.from), smtp: gmail, imap: { host: IMAP_PRESETS.gmail.host, port: IMAP_PRESETS.gmail.port, user: gmail.user, pass: gmail.pass }, gmail: true }, reason: null, reading: true, provider: "gmail" };
}

/** The platform's mailbox: the platform mail server of Platform settings > Mail and the reading switch and IMAP server of Console > Conversations > Settings. */
export function platformMailboxFrom(smtp: { config: SmtpConfig | null; passwordUnreadable: boolean }, account: { status: "on" | "off"; imapHost: string | null; imapPort: number | null } | null): MailboxRead {
  const reading = account?.status === "on";
  if (smtp.passwordUnreadable) return { config: null, reason: "password_unreadable", reading, provider: null };
  if (!smtp.config) return { config: null, reason: "not_set", reading, provider: null };
  const id = providerIdOfHost(smtp.config.host);
  if (id === "ses" || id === "brevo") return { config: null, reason: "send_only", reading: false, provider: "send_only" };
  const provider: "gmail" | "smtp" = id === "gmail" ? "gmail" : "smtp";
  if (!reading) return { config: null, reason: "off", reading, provider };
  const imap = imapOf(smtp.config, provider, account?.imapHost ?? "", portOf(account?.imapPort));
  if (!imap) return { config: null, reason: "not_set", reading, provider };
  return { config: { address: addressOf(smtp.config.user && provider === "gmail" ? smtp.config.user : smtp.config.from), smtp: smtp.config, imap, gmail: provider === "gmail" }, reason: null, reading, provider };
}

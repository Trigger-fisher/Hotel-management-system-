import "server-only";
import type { MailSender } from "../services/auth/mail";
import { createSmtpSender, fromHeader, GMAIL, isGmail, isMailAddress, readSmtpPassword, securityOfStored, type SmtpConfig, type TransportFactory } from "./smtp";
import { createFailoverRouter, failoverRuleOf, failoverStateOf, type FailoverRule, type FailoverState } from "./failover";
import { sendingDomainOf } from "./sendingDomain";

// The PLATFORM mail server the Super Admin sets up in Platform settings > Mail (platform_settings keys mail.smtp_*, migration 0123), and the sender that uses it FIRST and falls
// back to the server's own configuration (MAIL_DRIVER / SMTP_* variables) while it is empty. Everything that is not "where the settings are read from" is the shared module
// (mail/smtp.ts): the same configuration type, transport, send function, test and encrypted password as a hotel's own mail server.

export const PLATFORM_SMTP_KEYS = ["mail.from_name", "mail.from_email", "mail.smtp_host", "mail.smtp_port", "mail.smtp_security", "mail.smtp_user", "mail.smtp_password", "mail.reply_to", "mail.sending_domain"] as const;
/** The rows of the Google backup and of the failover rules (migration 0141), read together with the main service's. */
export const PLATFORM_BACKUP_KEYS = ["mail.backup_user", "mail.backup_password", "mail.failover_enabled", "mail.failover_return_minutes", "mail.failover_state"] as const;

/** The scope the platform's password is sealed under (a hotel's is its id). */
export const PLATFORM_SCOPE = "platform";
/** The scope of the backup's app password: a sealed value of the main service does not open as the backup's, and the other way round. */
export const PLATFORM_BACKUP_SCOPE = "platform:backup";

/**
 * The "From" header for this server. Gmail sends as the account it logs in to, so with Gmail the From address IS the Gmail address (with the sender name). An older server keeps the
 * old order: the platform sender address when set, else `envFrom` (SMTP_FROM), else the login when it is an address. null when there is none.
 */
function fromOf(name: string | null, email: string | null, envFrom: string | undefined, user: string | null, gmail: boolean): string | null {
  if (gmail && user && isMailAddress(user)) return fromHeader(name, user);
  if (email && isMailAddress(email)) return fromHeader(name, email);
  if (envFrom) return envFrom;
  if (user && isMailAddress(user)) return fromHeader(name, user);
  return null;
}

export interface PlatformSmtpRead {
  /** The mail server as the shared sender needs it; null = not set up, or not usable (no host, a password that cannot be opened, no From address). */
  config: SmtpConfig | null;
  /** A password is saved but cannot be opened (no key, a changed key). */
  passwordUnreadable: boolean;
}

/** The saved settings as a usable mail server. `get` reads a plain setting by key; `sealed` is the stored password text. */
export function readPlatformSmtp(get: (key: string) => unknown, sealed: string | null, key: Buffer | null, envFrom: string | undefined): PlatformSmtpRead {
  const text = (k: string): string | null => {
    const v = get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const password = readSmtpPassword(sealed, key, PLATFORM_SCOPE);
  const host = text("mail.smtp_host");
  const port = Number(get("mail.smtp_port") ?? 587);
  if (!host || password.unreadable || !Number.isInteger(port) || port < 1 || port > 65535) return { config: null, passwordUnreadable: password.unreadable };
  const user = text("mail.smtp_user");
  const security = securityOfStored(text("mail.smtp_security"));
  const from = fromOf(text("mail.from_name"), text("mail.from_email"), envFrom, user, isGmail({ host, port, security }));
  if (!from) return { config: null, passwordUnreadable: false };
  const replyTo = text("mail.reply_to");
  // the domain of the From address the Super Admin saved (no separate setting to keep in step): change that address and every hotel follows
  const sendingDomain = sendingDomainOf(text("mail.from_email"), text("mail.sending_domain"));
  return {
    config: { host, port, security, ...(user !== null && password.pass !== null ? { user, pass: password.pass } : {}), from, ...(replyTo ? { replyTo } : {}), ...(sendingDomain ? { sendingDomain } : {}) },
    passwordUnreadable: false,
  };
}

export interface PlatformBackupRead {
  /** The Google backup as the shared sender needs it; null = no backup, or not usable (no address, a password that cannot be opened). */
  config: SmtpConfig | null;
  passwordUnreadable: boolean;
  /** The failover rules (defaults: on, back to the main service after 15 minutes) and the saved state. */
  rule: FailoverRule;
  state: FailoverState | null;
}

/** The saved Google backup and failover rows as usable settings. Google sends as the account itself, so the From address is the Google address. */
export function readPlatformBackup(get: (key: string) => unknown, sealed: string | null, key: Buffer | null): PlatformBackupRead {
  const text = (k: string): string | null => {
    const v = get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const rule = failoverRuleOf(get("mail.failover_enabled"), get("mail.failover_return_minutes"));
  const state = failoverStateOf(get("mail.failover_state"));
  const password = readSmtpPassword(sealed, key, PLATFORM_BACKUP_SCOPE);
  const user = text("mail.backup_user")?.toLowerCase() ?? null;
  if (!user || !isMailAddress(user) || password.pass === null) return { config: null, passwordUnreadable: password.unreadable, rule, state };
  const replyTo = text("mail.reply_to");
  return {
    config: { host: GMAIL.host, port: GMAIL.port, security: GMAIL.security, user, pass: password.pass, from: fromHeader(text("mail.from_name"), user), ...(replyTo ? { replyTo } : {}) },
    passwordUnreadable: false,
    rule,
    state,
  };
}

/** What the failover needs from outside: the saved backup and rules (read at most once a minute), and where the switch is written down. */
export interface PlatformFailoverPorts {
  load: () => Promise<{ backup: SmtpConfig | null; rule: FailoverRule; state: FailoverState | null }>;
  save: (state: FailoverState) => Promise<void>;
}

/**
 * The platform sender: the saved mail server when there is one (read at most once a minute by `load`), else `env` (the server's own configuration). A changed setting is
 * used by the next mail; a sender (and its connection) is kept per distinct setting. With `failover`, a Google backup takes over when the main service fails (mail/failover.ts).
 */
export function createPlatformSettingsSender(options: { env: MailSender; load: () => Promise<SmtpConfig | null>; createTransport?: TransportFactory; failover?: PlatformFailoverPorts; now?: () => number }): MailSender {
  const senders = new Map<string, ReturnType<typeof createSmtpSender>>();
  const senderOf = (config: SmtpConfig): ReturnType<typeof createSmtpSender> => {
    const id = JSON.stringify(config);
    let sender = senders.get(id);
    if (!sender) {
      if (senders.size > 4) {
        for (const s of senders.values()) s.close();
        senders.clear();
      }
      sender = createSmtpSender(config, { createTransport: options.createTransport });
      senders.set(id, sender);
    }
    return sender;
  };
  const failover = options.failover ? createFailoverRouter({ now: options.now ?? (() => Date.now()), save: options.failover.save }) : null;
  return {
    async send(message) {
      let config: SmtpConfig | null = null;
      try {
        config = await options.load();
      } catch {
        // the settings could not be read: the server's own configuration sends
      }
      const main: MailSender = config ? { send: (m) => senderOf(config as SmtpConfig).send({ ...m, useEnvironmentFrom: true }) } : options.env;
      if (!failover || !options.failover) return main.send(message);
      let saved: Awaited<ReturnType<PlatformFailoverPorts["load"]>> | null = null;
      try {
        saved = await options.failover.load();
      } catch {
        // the backup could not be read: the main service sends alone
      }
      if (!saved || !saved.backup) return main.send(message);
      const backupConfig = saved.backup;
      const backup: MailSender = { send: (m) => senderOf(backupConfig).send({ ...m, useEnvironmentFrom: true }) };
      return failover.send(message, { main, backup, rule: saved.rule, saved: saved.state });
    },
  };
}
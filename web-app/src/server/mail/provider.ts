import "server-only";
import type { MailMessage, MailSender } from "../services/auth/mail";
import { failureCodeOf, type MailFailureCode } from "./failure";
import { BREVO_HOST, GMAIL_HOST, isProviderId, providerIdOfHost, SES_HOST_RE, type ProviderId } from "./hints";
import { createSmtpSender, type SmtpConfig, type SmtpSecurity, type SmtpSenderOptions } from "./smtp";

export { PROVIDER_IDS, isProviderId, providerIdOfHost, type ProviderId } from "./hints";

// ONE mail provider interface for the platform sender and for every hotel (MAIL-PROVIDERS-50K plan, 18 Oct 2026): a provider is a mail service (Gmail, Brevo, Amazon SES, or any other
// SMTP server) with the connection it needs, the limits it sets (per second, per day, mails per batch) and one way to send. Today all four go over the shared SMTP module
// (mail/smtp.ts); a provider with a batch API (SES, Brevo) can override `sendBatch` later without any caller changing.

export interface ProviderLimits {
  /** Mails a second the service accepts (a pass never sends faster). */
  perSecond: number;
  /** Mails a day. 0 = no fixed limit (the account's own limit applies). */
  perDay: number;
  /** Most mails handed over in one batch call. */
  maxBatch: number;
}

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  /** The server this service always uses; null = typed by the person (other SMTP) or made from the region (SES). */
  host: string | null;
  port: number;
  security: SmtpSecurity;
  limits: ProviderLimits;
  /** The person types host, port and security (other SMTP only). */
  editableServer: boolean;
}

export const SES_DEFAULT_REGION = "ap-south-1";
export const SES_REGIONS = ["ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "eu-west-1", "eu-central-1", "us-east-1", "us-west-2"] as const;
export const sesHostOf = (region: string): string => `email-smtp.${region}.amazonaws.com`;
export const sesRegionOf = (host: string): string | null => SES_HOST_RE.exec(host.trim().toLowerCase())?.[1] ?? null;

/** What each service allows with a new account. SES and Brevo are raised by the service itself; the hotel's own daily limit (if lower) or the Super Admin's cap still apply. */
export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  gmail: { id: "gmail", label: "Gmail", host: GMAIL_HOST, port: 587, security: "starttls", limits: { perSecond: 1, perDay: 500, maxBatch: 1 }, editableServer: false },
  brevo: { id: "brevo", label: "Brevo", host: BREVO_HOST, port: 587, security: "starttls", limits: { perSecond: 5, perDay: 300, maxBatch: 50 }, editableServer: false },
  ses: { id: "ses", label: "Amazon SES", host: null, port: 587, security: "starttls", limits: { perSecond: 14, perDay: 0, maxBatch: 50 }, editableServer: false },
  // a hotel that sends through the PLATFORM's mail from an address on its own verified domain (mail/identity.ts): no connection of its own, the platform service's limits
  domain: { id: "domain", label: "My own domain (sent by the platform)", host: null, port: 587, security: "starttls", limits: { perSecond: 14, perDay: 0, maxBatch: 50 }, editableServer: false },
  smtp: { id: "smtp", label: "Other SMTP server", host: null, port: 587, security: "starttls", limits: { perSecond: 5, perDay: 0, maxBatch: 1 }, editableServer: true },
};

/** A mail address in Google Workspace or a company can send more than a personal Gmail account. */
export const GMAIL_WORKSPACE_PER_DAY = 2000;

const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;
export const providerChecks = {
  host: (v: string): boolean => v.length >= 1 && v.length <= 253 && HOST_RE.test(v),
  port: (v: number): boolean => Number.isInteger(v) && v >= 1 && v <= 65535,
  security: (v: string): v is SmtpSecurity => v === "starttls" || v === "ssl" || v === "none",
  region: (v: string): boolean => /^[a-z]{2}(?:-[a-z]+)+-\d$/.test(v),
} as const;

export interface ConnectionInput {
  host?: string;
  port?: number;
  security?: string;
  region?: string;
}

/** The connection a provider uses: fixed for Gmail and Brevo, made from the region for SES, typed (and checked) for another SMTP server. `error` names the field that is wrong. */
export function connectionOf(provider: ProviderId, input: ConnectionInput): { host: string; port: number; security: SmtpSecurity } | { error: "host" | "port" | "security" | "region" } {
  const preset = PROVIDER_PRESETS[provider];
  // a hotel on its own domain has no connection of its own: the platform sends
  if (provider === "domain") return { error: "host" };
  if (provider === "ses") {
    const region = (input.region ?? sesRegionOf(input.host ?? "") ?? SES_DEFAULT_REGION).trim().toLowerCase();
    if (!providerChecks.region(region)) return { error: "region" };
    return { host: sesHostOf(region), port: preset.port, security: preset.security };
  }
  if (!preset.editableServer) return { host: preset.host as string, port: preset.port, security: preset.security };
  const host = (input.host ?? "").trim();
  if (!providerChecks.host(host)) return { error: "host" };
  const port = input.port ?? preset.port;
  if (!providerChecks.port(port)) return { error: "port" };
  const security = input.security ?? preset.security;
  if (!providerChecks.security(security)) return { error: "security" };
  return { host, port, security };
}

/**
 * The provider a stored setting means: the one saved (`mail.provider` / `email.provider`), else (older settings) the one the host belongs to. null = no server saved.
 * A hotel with nothing saved stays null and keeps working exactly as before (the platform sender takes its mail).
 */
export function providerOfSaved(saved: string | null | undefined, host: string | null | undefined): ProviderId | null {
  if (isProviderId(saved)) return saved;
  const h = (host ?? "").trim();
  return h === "" ? null : providerIdOfHost(h);
}

/** The limits that apply: the service's own, with the account's daily limit (typed by the hotel or the platform) replacing the day figure when it is lower, and a Super Admin cap on top. */
export function effectiveLimits(provider: ProviderId, options: { workspace?: boolean; dailyLimit?: number | null; cap?: number | null } = {}): ProviderLimits {
  const base = PROVIDER_PRESETS[provider].limits;
  let perDay = base.perDay;
  if (provider === "gmail" && options.workspace === true) perDay = GMAIL_WORKSPACE_PER_DAY;
  for (const v of [options.dailyLimit, options.cap]) if (typeof v === "number" && v > 0) perDay = perDay === 0 ? v : Math.min(perDay, v);
  return { ...base, perDay };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface BatchItem {
  ok: boolean;
  /** Why it failed (mail/failure.ts); only when `ok` is false. */
  reason?: MailFailureCode;
}

export interface MailProvider {
  readonly id: ProviderId;
  readonly limits: ProviderLimits;
  send(message: MailMessage): Promise<void>;
  /** Up to `limits.maxBatch` mails; one failed address never stops the rest, each gets its own result. */
  sendBatch(messages: readonly MailMessage[]): Promise<BatchItem[]>;
  close(): void;
}

/** A provider over the shared SMTP sender (also the sender the platform and the hotels already use). `sender` lets a caller share one pooled sender. */
export function createMailProvider(id: ProviderId, limits: ProviderLimits, config: SmtpConfig, options: SmtpSenderOptions & { sender?: MailSender & { close(): void } } = {}): MailProvider {
  const sender = options.sender ?? createSmtpSender(config, options);
  return {
    id,
    limits,
    send: (message) => sender.send(message),
    async sendBatch(messages) {
      const out: BatchItem[] = [];
      for (const message of messages.slice(0, limits.maxBatch)) {
        try {
          await sender.send(message);
          out.push({ ok: true });
        } catch (error) {
          out.push({ ok: false, reason: failureCodeOf(error) });
        }
      }
      return out;
    },
    close: () => sender.close(),
  };
}

import "server-only";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { SettingRow } from "../../repos/admin";
import { actorOf, businessNamesOf, logLine, notFound, requireSuperAdmin, type AdminDeps, type Who } from "./context";
import type { SettingsBody } from "./schemas";
import { MAIL_FAILURE_TEXT, isMailFailureCode } from "../../mail/failure";
import { EMAIL_SETTING_KEYS, hotelSmtpFromSettings } from "../../mail/hotelSmtp";
import type { MailSenderIdentity } from "@shared/dashboards/mailProviders";
import { domainOfAddress } from "../../mail/identity";
import { connectionOf, effectiveLimits, isProviderId, providerOfSaved, sesRegionOf, type ProviderId } from "../../mail/provider";
import { isMailAddress, isSealedSmtpSecret, sealSmtpSecret, sendTestMail, type TransportFactory } from "../../mail/smtp";
import { isPlatformSetupSession, isSecretSettingGroup, PLATFORM_SETS_UP } from "../../auth/secretSettings";
import { forgetFoodName } from "../auth/foodName";
import { SETTING_GROUPS, type FieldDef } from "./settingsDefs";
import type { MailCheck, MailConnectionTest } from "@shared/dashboards/conversations";
import { testMailConnection } from "../../mail/connectionTest";
import type { ImapClientFactory } from "../../mail/imap";
import { hotelMailboxFromSettings } from "../../mail/mailbox";
import { isSafeHostName, type HostLookup } from "../../mail/safeHost";
import { isConversationsNotReady } from "../../repos/conversations";

// Settings (Pallav SettingsController + Support/Settings): the SuperAdmin's groups of site settings. A value left empty falls back to the field's
// default; a secret is stored as typed, never returned (only a "set" flag), and an empty secret in a save means "keep what is saved".
// Spec: docs/specs/admin.md §4.

interface SettingFieldDto {
  key: string;
  label: string;
  type: FieldDef["type"];
  secret: boolean;
  options: Record<string, string> | null;
  help: string | null;
  placeholder: string | null;
  /** The value (the default when nothing is saved); null for a secret. */
  value: string | null;
  /** A secret is never returned: only whether one is saved. */
  set: boolean;
  /** When a saved secret was last written (ISO time; the form shows "Saved on <date>"); null when none is saved or for a field that is not a secret. */
  savedAt: string | null;
}

/** What Settings > Email shows besides the fields: the last "Send test email", whether the password can be opened, whether this hotel's mail goes out through the platform (no mail server set up), and the last mail that failed. */
interface EmailStatusDto {
  lastTest: { at: string; ok: boolean; message: string; hint?: string } | null;
  canStorePassword: boolean;
  passwordUnreadable: boolean;
  /** The status line: `settings` = this hotel's saved Gmail sends its mail (address = the Gmail address); `platform` = nothing usable saved here, so its mail goes through the platform email as the hotel. */
  sendingFrom: { source: "settings" | "platform"; address: string | null; provider: ProviderId | null };
  /** Always null now: an older server shows as its own provider. */
  otherServer: string | null;
  /** Who sends this hotel's mail (email.mode): the platform's own mail (default; nothing to set up) or the hotel's own. A hotel with its own service saved before the choice existed is on "own". */
  mode: "platform" | "own";
  /** With mode "platform": the address this hotel's mail is sent from, made from its slug on the platform's sending domain; null until the Super Admin has set the sending domain. */
  platformAddress: string | null;
  /** With the provider "domain" (My own domain): the domain, its DNS records and where it stands; null otherwise. */
  identity: MailSenderIdentity | null;
  /** The mail service in use (gmail, brevo, ses, smtp); null = the platform email sends (nothing of its own saved). */
  provider: ProviderId | null;
  server: { host: string; port: number; security: "starttls" | "ssl" | "none"; region: string } | null;
  /** What the service allows now, after the hotel's own daily limit; null = the platform email. */
  limits: { perSecond: number; perDay: number } | null;
  lastFailure: { at: string; text: string } | null;
  /** The last "Test connection" (reading and sending, Conversations): codes and fixed sentences only. */
  lastConnectionTest: MailConnectionTest | null;
}

interface SettingGroupDto {
  key: string;
  label: string;
  icon: string;
  about: string;
  fields: SettingFieldDto[];
  emailStatus?: EmailStatusDto;
}

export interface SettingsOverview {
  groups: { key: string; label: string; icon: string; about: string }[];
  current: SettingGroupDto;
}

/** The hotel's SMTP password is sealed with SMTP_SECRET_KEY (bound to the hotel); `lastMailFailure` reads the newest failed mail of the hotel from the platform outbox. */
/** The hotel's own sender domain (platform.sender_identities), on the platform unit: what Settings > Email shows, saves and checks. */
export interface HotelIdentityPort {
  view(hotelId: string, hotelName: string): Promise<MailSenderIdentity | null>;
  /** Saves the identity for this address; false while platform migration 0128 is not applied. */
  save(hotelId: string, address: string): Promise<boolean>;
  remove(hotelId: string): Promise<void>;
  check(hotelId: string, hotelName: string): Promise<MailSenderIdentity | null>;
}

export interface SettingsMailDeps {
  identity?: HotelIdentityPort;
  secretKey?: Buffer | null;
  lastMailFailure?: (hotelId: string) => Promise<{ code: string; at: Date } | null>;
  /** The hotel's address on the platform's sending domain (<slug>@<domain>), or null while the hotel or the domain is not there. */
  platformAddressOf?: (hotelId: string) => Promise<string | null>;
  /** Conversations (decision 66): the registry of mailboxes HMS reads (platform 0139); a missing table throws ConversationsNotReady. */
  mailboxRegistry?: { setHotelReading(hotelId: string, on: boolean): Promise<void> };
  /** The IMAP client of "Test connection" (mail/imap.ts). */
  imap?: ImapClientFactory;
  /** Tests: the name lookup of the public-server check (mail/safeHost.ts). */
  lookup?: HostLookup;
}

const KEY_MISSING = "A password cannot be saved: this server has no secret key. Leave the app password empty.";
const PASSWORD_REQUIRED = "Enter the password or key of this mail service.";
const PASSWORD_NEW = "You changed the mail service: enter its password or key.";
const TEST_RESULT_KEY = "email.test_result";
/** The last "Test connection": codes, fixed sentences and the time only (never the server's words, the login or the password). */
const CONNECTION_TEST_KEY = "email.connection_test";
const IMAP_HOST_BAD = "Enter the public IMAP server name, like imap.example.com.";
const IMAP_PORT_BAD = "The IMAP port is 993 (SSL/TLS) or 143 (STARTTLS).";
const READING_NEEDS_0139 = "Reading mail needs platform migration 0139. Ask the platform owner to run it.";

/** A stored connection test, read back only when it has the expected shape (codes and sentences). */
function connectionTestOf(text: string | undefined): MailConnectionTest | null {
  try {
    const t = JSON.parse(text ?? "null") as MailConnectionTest | null;
    const check = (c: unknown): boolean => typeof c === "object" && c !== null && typeof (c as MailCheck).ok === "boolean" && typeof (c as MailCheck).message === "string";
    return t && typeof t.at === "string" && check(t.imap) && check(t.smtp) ? t : null;
  } catch {
    return null;
  }
}

/**
 * The settings groups that hold a secret (the hotel's mail server, both Razorpay accounts, the backup) are set up by the platform's Super Admin from the Set-up centre (MJ, 5 Nov 2026).
 * Every hotel session is refused: the hotel's own top role, a visit (even a full one) and an API key. Only the set-up session made by platformSetupSession passes.
 */
function refuseOutsider(session: VerifiedSession, group: string): void {
  if (isSecretSettingGroup(group) && !isPlatformSetupSession(session)) throw new AppError("FORBIDDEN", PLATFORM_SETS_UP);
}

export function createSettingsService(deps: AdminDeps & SettingsMailDeps & { createTransport?: TransportFactory }) {
  const { unit } = deps;
  const secretKey = deps.secretKey ?? null;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });

  type Repos = Parameters<Parameters<typeof unit.run>[1]>[0];
  /** The definitions carry {hotel} and {food}; the hotel's own names go in (never the project's seed names). */
  const filler = async (repos: Repos): Promise<(s: string) => string> => {
    const names = await businessNamesOf(repos);
    return (s) => s.replaceAll("{hotel}", names.hotel).replaceAll("{food}", names.food);
  };

  async function emailStatus(repos: Repos, hotelId: string, hotelName: string): Promise<EmailStatusDto> {
    const rows = await repos.adminSettings.get([...EMAIL_SETTING_KEYS, TEST_RESULT_KEY, CONNECTION_TEST_KEY]);
    const read = hotelSmtpFromSettings(rows, hotelName, hotelId, secretKey);
    let lastTest: EmailStatusDto["lastTest"] = null;
    try {
      const t = JSON.parse(rows.find((r) => r.key === TEST_RESULT_KEY)?.value ?? "null") as { at?: unknown; ok?: unknown; message?: unknown; hint?: unknown } | null;
      if (t && typeof t.at === "string" && typeof t.ok === "boolean" && typeof t.message === "string") lastTest = { at: t.at, ok: t.ok, message: t.message, ...(typeof t.hint === "string" ? { hint: t.hint } : {}) };
    } catch {
      // an unreadable result is simply not shown
    }
    const failure = deps.lastMailFailure ? await deps.lastMailFailure(hotelId).catch(() => null) : null;
    const stored = rows.find((r) => r.key === "email.mode")?.value ?? "";
    const mode: "platform" | "own" = stored === "platform" || stored === "own" ? stored : read.config ? "own" : "platform";
    const onDomain = !read.config && read.provider === "domain" && mode === "own";
    const identity = onDomain && deps.identity ? await deps.identity.view(hotelId, hotelName).catch(() => null) : null;
    const platformAddress = (mode === "platform" || onDomain) && deps.platformAddressOf ? await deps.platformAddressOf(hotelId).catch(() => null) : null;
    return {
      lastTest,
      mode,
      platformAddress,
      identity,
      canStorePassword: secretKey !== null,
      passwordUnreadable: read.passwordUnreadable,
      sendingFrom: read.config
        ? { source: "settings", address: /<([^>]+)>/.exec(read.config.from)?.[1] ?? read.config.from, provider: read.provider }
        : onDomain
          ? { source: "platform", address: identity?.status === "verified" ? identity.fromAddress : platformAddress, provider: "domain" }
          : { source: "platform", address: null, provider: null },
      otherServer: null,
      provider: read.config ? read.provider : onDomain ? "domain" : null,
      server: read.config ? { host: read.config.host, port: read.config.port, security: read.config.security, region: sesRegionOf(read.config.host) ?? "" } : null,
      limits: read.config && read.provider ? (({ perSecond, perDay }) => ({ perSecond, perDay }))(effectiveLimits(read.provider, { workspace: read.provider === "gmail" && !/@(gmail|googlemail)\.com$/i.test(read.config.user ?? ""), dailyLimit: read.dailyLimit })) : null,
      lastFailure: failure && isMailFailureCode(failure.code) ? { at: failure.at.toISOString(), text: MAIL_FAILURE_TEXT[failure.code] } : null,
      lastConnectionTest: connectionTestOf(rows.find((r) => r.key === CONNECTION_TEST_KEY)?.value ?? undefined),
    };
  }

  async function groupDto(repos: Repos, key: string, hotelId = ""): Promise<SettingGroupDto> {
    const def = SETTING_GROUPS[key];
    const fill = await filler(repos);
    const rows = new Map((await repos.adminSettings.get(Object.keys(def.fields))).map((r) => [r.key, r]));
    return {
      key,
      label: fill(def.label),
      icon: def.icon,
      about: fill(def.about),
      fields: Object.entries(def.fields).map(([k, f]) => {
        const row = rows.get(k);
        const stored = row?.value ?? null;
        const secret = f.secret === true;
        return {
          key: k,
          label: fill(f.label),
          type: f.type,
          secret,
          options: f.options ?? null,
          help: f.help ? fill(f.help) : null,
          placeholder: f.placeholder ? fill(f.placeholder) : null,
          value: secret ? null : stored !== null && stored !== "" ? stored : f.default !== undefined ? fill(f.default) : null,
          set: secret && stored !== null && stored !== "",
          savedAt: secret && stored !== null && stored !== "" && row?.updatedAt ? row.updatedAt.toISOString() : null,
        };
      }),
      ...(key === "email" ? { emailStatus: await emailStatus(repos, hotelId, (await businessNamesOf(repos)).hotel) } : {}),
    };
  }

  const NOT_SET = "Enter the Gmail address and the app password under Email, save, then try again.";

  return {
    /**
     * "Send test email" (Settings > Email): one mail through the hotel's OWN mail server, sent now, to `to` (default: the hotel's from address, so the hotel mails itself), with the
     * exact result back (the server's own words with the password and login cut out). It is the same code a real mail uses (mail/smtp.ts). The result and its time are kept and
     * shown as the last test. SuperAdmin only.
     */
    async testEmail(session: VerifiedSession, input: { to?: string }, meta: RequestMeta): Promise<{ sent: boolean; to: string; message: string; at: string; hint?: string }> {
      requireSuperAdmin(session, "Settings");
      refuseOutsider(session, "email");
      const w = await who(session, meta);
      const { read, hotelName } = await unit.run(session, async (repos) => {
        const names = await businessNamesOf(repos);
        return { read: hotelSmtpFromSettings(await repos.adminSettings.get(EMAIL_SETTING_KEYS), names.hotel, session.hotelId, secretKey), hotelName: names.hotel };
      });
      if (!read.config) throw new AppError("CONFLICT", read.passwordUnreadable ? "The saved app password cannot be opened on this server. Type the app password again and save, then try again." : NOT_SET);
      const to = (input.to ?? "").trim().toLowerCase() || (/<([^>]+)>/.exec(read.config.from)?.[1] ?? read.config.from);
      if (!isMailAddress(to)) throw new AppError("VALIDATION_FAILED", "Enter a valid email address.", { fields: { to: "Enter a valid email address." } });
      const result = await sendTestMail(read.config, to, { subject: `Test email from ${hotelName} (EasyHotelSolutions)`, body: `Hello,\n\nThis is a test email from ${hotelName}'s EasyHotelSolutions mail settings. If you can read it, the mail server, encryption and login are set up correctly.\n\nSent by ${w.actor?.name ?? "the SuperAdmin"}.` }, deps.createTransport);
      const at = new Date().toISOString();
      await unit.run(session, async (repos) => {
        await repos.adminSettings.set([{ key: TEST_RESULT_KEY, value: JSON.stringify({ at, ok: result.ok, message: result.message, ...(result.hint ? { hint: result.hint } : {}) }), secret: false }], session.userId);
        await repos.systemLogs.write(logLine(w, "settings", { action: "updated", entity: "Settings", summary: result.ok ? "Test email sent" : "Test email failed", subject: null, details: { Outcome: result.ok ? "Sent" : "Failed" } }));
      });
      return { sent: result.ok, to, message: result.message, at, ...(result.hint ? { hint: result.hint } : {}) };
    },

    /**
     * "Test connection" (Settings > Email, Conversations decision 66): signs in to the hotel's SAVED mailbox for reading (IMAP: the folders and the Inbox) and for sending
     * (SMTP: a sign-in, nothing sent), at the same time, each with its own time limit. Tested even when reading is still off (that is when it helps). The answer and the kept
     * result hold codes, fixed sentences and the time only. SuperAdmin of the hotel only, in the browser (never a visit or an API key).
     */
    async testMailConnection(session: VerifiedSession, meta: RequestMeta): Promise<MailConnectionTest> {
      requireSuperAdmin(session, "Settings");
      refuseOutsider(session, "email");
      if (!deps.imap) throw new AppError("CONFLICT", "Reading mail is not available on this server.");
      const w = await who(session, meta);
      const read = await unit.run(session, async (repos) => {
        const names = await businessNamesOf(repos);
        const rows = (await repos.adminSettings.get(EMAIL_SETTING_KEYS)).filter((r) => r.key !== "email.imap");
        // as if reading were on: the test tells whether it would work
        return { smtp: hotelSmtpFromSettings(rows, names.hotel, session.hotelId, secretKey), mailbox: hotelMailboxFromSettings([...rows, { key: "email.imap", value: "1", secret: false }], names.hotel, session.hotelId, secretKey) };
      });
      if (!read.smtp.config && !read.mailbox.config && read.mailbox.reason !== "send_only") throw new AppError("CONFLICT", read.smtp.passwordUnreadable ? "The saved app password cannot be opened on this server. Type the app password again and save, then try again." : NOT_SET);
      const result = await testMailConnection({ smtp: read.smtp.config, imap: read.mailbox.config?.imap ?? null, sendOnly: read.mailbox.reason === "send_only" }, { imap: deps.imap, createTransport: deps.createTransport, lookup: deps.lookup });
      const passed = result.imap.ok && result.smtp.ok;
      await unit.run(session, async (repos) => {
        await repos.adminSettings.set([{ key: CONNECTION_TEST_KEY, value: JSON.stringify(result), secret: false }], session.userId);
        await repos.systemLogs.write(logLine(w, "settings", { action: "updated", entity: "Settings", summary: "Mail connection tested", subject: null, details: { Outcome: passed ? "Passed" : "Failed" } }));
      });
      return result;
    },

    /**
     * "Check DNS" (Settings > Email, My own domain): looks the records of the hotel's domain up in DNS and keeps the answer. The platform's confirmation in Amazon SES is not done here.
     * Super Admin of the hotel only.
     */
    async checkDomain(session: VerifiedSession): Promise<MailSenderIdentity> {
      requireSuperAdmin(session, "Settings");
      refuseOutsider(session, "email");
      if (!deps.identity) throw new AppError("CONFLICT", "Own domains are not available on this server.");
      const hotelName = await unit.run(session, async (repos) => (await businessNamesOf(repos)).hotel);
      const view = await deps.identity.check(session.hotelId, hotelName);
      if (!view) throw new AppError("CONFLICT", "Choose \"My own domain\", type your address and save first.");
      return view;
    },

    /** index (:12-32): the groups, and the open one with its values (secrets not returned). */
    async overview(session: VerifiedSession, tab?: string): Promise<SettingsOverview> {
      requireSuperAdmin(session, "Settings");
      // a hotel session sees only the hotel's business settings; the secret ones are the Set-up centre's (MJ, 5 Nov 2026)
      const setup = isPlatformSetupSession(session);
      const shown = Object.keys(SETTING_GROUPS).filter((k) => setup || !isSecretSettingGroup(k));
      return unit.run(session, async (repos) => {
        const key = tab !== undefined && shown.includes(tab) ? tab : shown[0];
        const fill = await filler(repos);
        return { groups: shown.map((k) => ({ key: k, label: fill(SETTING_GROUPS[k].label), icon: SETTING_GROUPS[k].icon, about: fill(SETTING_GROUPS[k].about) })), current: await groupDto(repos, key, session.hotelId) };
      });
    },

    /**
     * update (:34-67): each field of the group is read from the request; a toggle is "1" or "0"; a secret left empty keeps what is saved; an email and a
     * number are checked; a select outside its options falls back to its default. A field not sent is read as empty (Pallav reads every field).
     */
    async update(session: VerifiedSession, groupKey: string, input: SettingsBody, meta: RequestMeta): Promise<{ group: SettingGroupDto; message: string }> {
      requireSuperAdmin(session, "Settings");
      refuseOutsider(session, groupKey);
      const def = SETTING_GROUPS[groupKey];
      if (!def) throw notFound();
      // a Razorpay Key ID must match the mode (rzp_test_ for Test, rzp_live_ for Live), checked as it is saved
      if (groupKey === "razorpay_hotel" || groupKey === "razorpay_food") {
        const mode = String(input.values[`${groupKey}.mode`] ?? "");
        const keyId = String(input.values[`${groupKey}.key_id`] ?? "").trim();
        const want = mode === "live" ? "rzp_live_" : "rzp_test_";
        if (keyId !== "" && !keyId.startsWith(want)) throw new AppError("VALIDATION_FAILED", `This Key ID does not match the mode. A ${mode === "live" ? "Live" : "Test"} key starts with ${want}.`, { fields: { [`${groupKey}.key_id`]: `A ${mode === "live" ? "Live" : "Test"} key starts with ${want}.` } });
      }
      const unknown = Object.keys(input.values).filter((k) => !(k in def.fields));
      if (unknown.length > 0) throw new AppError("VALIDATION_FAILED", "Unknown setting.", { fields: Object.fromEntries(unknown.map((k) => [k, "Not a setting of this group."])) });
      const w = await who(session, meta);
      const rows: SettingRow[] = [];
      const changed: Record<string, string> = {};
      // `clear` names the secrets the person asked to remove ("Remove password"); only a secret of this group counts. Never a setting of its own, stored nowhere.
      const toClear = new Set(input.clear ?? []);
      const badClear = [...toClear].filter((k) => !(k in def.fields) || def.fields[k].secret !== true);
      if (badClear.length > 0) throw new AppError("VALIDATION_FAILED", "Only a saved secret of this group can be removed.", { fields: Object.fromEntries(badClear.map((k) => [k, "Not a secret of this group."])) });
      const clearEmailPassword = toClear.has("email.password");
      for (const [key, f] of Object.entries(def.fields)) {
        const raw = input.values[key];
        let value: string;
        if (f.type === "toggle") value = raw === true || raw === "1" || raw === "true" || raw === "on" ? "1" : "0";
        else if (f.secret) {
          value = (raw === undefined || raw === null ? "" : String(raw)).trim();
          // an app password is shown by Google in groups of four letters: spaces do not belong to it
          if (key === "email.password") value = value.replace(/\s+/g, "");
          if (value === "") {
            // empty = keep what is saved; a secret named in `clear` is removed instead
            if (toClear.has(key)) {
              rows.push({ key, value: "", secret: true });
              changed[f.label] = "removed";
            }
            continue;
          }
          // the mail password is the one secret that is ENCRYPTED (AES-256-GCM, SMTP_SECRET_KEY, bound to this hotel); the others stay as they were
          if (key === "email.password") {
            if (value.length > 500 || /[\r\n\u0000]/.test(value)) throw new AppError("VALIDATION_FAILED", "The password is too long.", { fields: { [key]: "The password is too long." } });
            if (secretKey === null) throw new AppError("VALIDATION_FAILED", KEY_MISSING, { fields: { [key]: KEY_MISSING } });
            value = sealSmtpSecret(secretKey, value, session.hotelId);
          }
        } else {
          value = (raw === undefined || raw === null ? "" : String(raw)).trim();
          if (f.type === "email" && value !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new AppError("VALIDATION_FAILED", `${f.label} is not a valid email address.`, { fields: { [key]: `${f.label} is not a valid email address.` } });
          if (f.type === "number" && value !== "" && !/^\d+$/.test(value)) throw new AppError("VALIDATION_FAILED", `${f.label} must be a number.`, { fields: { [key]: `${f.label} must be a number.` } });
          if (f.type === "select" && !(value in (f.options ?? {}))) value = f.default ?? "";
          const bad = f.check?.(value);
          if (bad) throw new AppError("VALIDATION_FAILED", bad, { fields: { [key]: bad } });
          // a GSTIN is kept in upper case, as typed otherwise
          if (key.endsWith("_gstin")) value = value.toUpperCase();
          // an address is kept in lower case
          if (key === "email.reply_to" || key === "email.from_address") value = value.toLowerCase();
        }
        rows.push({ key, value, secret: f.secret === true });
        changed[f.label] = f.secret ? "changed" : value === "" ? "(empty)" : value;
      }
      // Settings > Email: the hotel picks the service that sends its mail. "platform" = nothing of its own (the platform email sends, with the hotel's name and reply-to). Gmail, Brevo and
      // Amazon SES have a fixed server; another SMTP server is what was typed. An older client that sends no provider is read as before: a login means Gmail, none means the platform.
      let emailProvider: ProviderId | "platform" = "platform";
      let emailLogin = "";
      let domainAddress: string | null = null;
      if (groupKey === "email") {
        const val = (k: string): string => (rows.find((r) => r.key === k)?.value ?? "").trim();
        const sent = input.values["email.provider"];
        const sentMode = input.values["email.mode"];
        const choice = sent === undefined || sent === null || sent === "" ? (val("email.username") !== "" ? "gmail" : "platform") : val("email.provider");
        // the explicit choice wins; an older form without it is read as before (a login = its own Gmail, none = the platform's mail; the earlier provider "platform" = the platform's mail)
        const wantsOwn = sentMode === "own" ? true : sentMode === "platform" ? false : isProviderId(choice);
        emailProvider = wantsOwn ? (isProviderId(choice) ? choice : "gmail") : "platform";
        if (sentMode === "own" && !isProviderId(choice)) emailProvider = isProviderId(val("email.provider")) ? (val("email.provider") as ProviderId) : "gmail";
        const drop = (...keys: string[]): void => {
          for (const k of keys) {
            const i = rows.findIndex((r) => r.key === k);
            if (i >= 0) rows.splice(i, 1);
          }
        };
        drop("email.mode", "email.provider", "email.host", "email.port", "email.encryption", "email.region", "email.from_address", "email.username");
        if (emailProvider === "platform") {
          drop("email.password");
          rows.push({ key: "email.mode", value: "platform", secret: false }, { key: "email.provider", value: "", secret: false }, { key: "email.host", value: "", secret: false }, { key: "email.port", value: "", secret: false }, { key: "email.encryption", value: "tls", secret: false }, { key: "email.region", value: "", secret: false }, { key: "email.from_address", value: "", secret: false }, { key: "email.username", value: "", secret: false }, { key: "email.password", value: "", secret: true });
        } else if (emailProvider === "domain") {
          // "My own domain": the platform sends from the hotel's address on its verified domain; no login, no password, no connection of its own
          const address = (input.values["email.from_address"] === undefined || input.values["email.from_address"] === null ? "" : String(input.values["email.from_address"])).trim().toLowerCase();
          if (!isMailAddress(address) || domainOfAddress(address) === null) {
            const message = "Enter your address on your own domain, like frontdesk@yourhotel.in.";
            throw new AppError("VALIDATION_FAILED", message, { fields: { "email.from_address": message } });
          }
          domainAddress = address;
          drop("email.password");
          rows.push({ key: "email.mode", value: "own", secret: false }, { key: "email.provider", value: "domain", secret: false }, { key: "email.host", value: "", secret: false }, { key: "email.port", value: "", secret: false }, { key: "email.encryption", value: "tls", secret: false }, { key: "email.region", value: "", secret: false }, { key: "email.from_address", value: address, secret: false }, { key: "email.username", value: "", secret: false }, { key: "email.password", value: "", secret: true });
        } else {
          const typed = (k: string): string => (input.values[k] === undefined || input.values[k] === null ? "" : String(input.values[k])).trim();
          emailLogin = emailProvider === "gmail" ? typed("email.username").toLowerCase() : typed("email.username");
          const bad: Record<string, string> = {};
          const fromAddress = emailProvider === "gmail" ? emailLogin : typed("email.from_address").toLowerCase();
          if (emailProvider === "gmail" && !isMailAddress(emailLogin)) bad["email.username"] = "Enter a valid Gmail address, like name@gmail.com.";
          if (emailProvider !== "gmail" && !isMailAddress(fromAddress)) bad["email.from_address"] = "Enter the From address (a valid email address).";
          if (emailProvider !== "smtp" && emailProvider !== "gmail" && emailLogin === "") bad["email.username"] = "Enter the SMTP login of this service.";
          const word = typed("email.encryption") === "ssl" ? "ssl" : typed("email.encryption") === "none" ? "none" : "tls";
          const conn = connectionOf(emailProvider, { host: typed("email.host"), port: typed("email.port") === "" ? undefined : Number(typed("email.port")), security: word === "tls" ? "starttls" : word, ...(typed("email.region") !== "" ? { region: typed("email.region") } : {}) });
          if ("error" in conn) bad[conn.error === "host" ? "email.host" : conn.error === "port" ? "email.port" : conn.error === "security" ? "email.encryption" : "email.region"] = conn.error === "host" ? "Enter the mail server name, like smtp.example.com." : conn.error === "port" ? "Enter a port between 1 and 65535." : conn.error === "security" ? "Choose STARTTLS, SSL/TLS or none." : "Choose an Amazon SES region.";
          if (Object.keys(bad).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(bad)[0], { fields: bad });
          if ("error" in conn) throw new AppError("VALIDATION_FAILED", "The mail server is not valid.");
          rows.push(
            { key: "email.mode", value: "own", secret: false },
            { key: "email.provider", value: emailProvider, secret: false },
            { key: "email.host", value: conn.host, secret: false },
            { key: "email.port", value: String(conn.port), secret: false },
            { key: "email.encryption", value: conn.security === "starttls" ? "tls" : conn.security, secret: false },
            { key: "email.region", value: emailProvider === "ses" ? (sesRegionOf(conn.host) ?? "") : "", secret: false },
            { key: "email.from_address", value: fromAddress, secret: false },
            { key: "email.username", value: emailLogin, secret: false },
          );
        }
      }
      // Conversations (decision 66): reading the same mailbox. Only Gmail (its IMAP server is fixed) and another mail server (its IMAP server, a PUBLIC name, port 993 or 143)
      // can be read; the platform's mail, My own domain, Brevo and Amazon SES only send, so reading is switched off for them.
      let reading: boolean | null = null;
      if (groupKey === "email") {
        const typed = (k: string): string => (input.values[k] === undefined || input.values[k] === null ? "" : String(input.values[k])).trim();
        const put = (key: string, value: string): void => {
          const row = { key, value, secret: false };
          const i = rows.findIndex((r) => r.key === key);
          if (i >= 0) rows[i] = row;
          else rows.push(row);
        };
        const on = rows.find((r) => r.key === "email.imap")?.value === "1";
        if (emailProvider === "gmail") {
          reading = on;
          put("email.imap", on ? "1" : "0");
          put("email.imap_host", "");
          put("email.imap_port", "");
        } else if (emailProvider === "smtp") {
          const host = typed("email.imap_host").toLowerCase();
          const port = typed("email.imap_port") === "" ? "993" : typed("email.imap_port");
          const bad: Record<string, string> = {};
          if ((on || host !== "") && !isSafeHostName(host)) bad["email.imap_host"] = IMAP_HOST_BAD;
          if (port !== "993" && port !== "143") bad["email.imap_port"] = IMAP_PORT_BAD;
          if (Object.keys(bad).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(bad)[0], { fields: bad });
          reading = on;
          put("email.imap", on ? "1" : "0");
          put("email.imap_host", host);
          put("email.imap_port", port);
        } else {
          reading = false;
          put("email.imap", "0");
          put("email.imap_host", "");
          put("email.imap_port", "");
        }
        // the platform keeps a row per hotel (the daily safety net and the 12-month purge read it); switched off, the row stays
        if (deps.mailboxRegistry) {
          try {
            await deps.mailboxRegistry.setHotelReading(session.hotelId, reading);
          } catch (error) {
            if (!isConversationsNotReady(error)) throw error;
            if (reading) throw new AppError("CONFLICT", READING_NEEDS_0139);
          }
        }
      }
      // the hotel's own domain is kept on the platform side: saved when "My own domain" is chosen, dropped for any other choice
      if (groupKey === "email" && deps.identity) {
        if (domainAddress) {
          if (!(await deps.identity.save(session.hotelId, domainAddress))) throw new AppError("CONFLICT", "Own domains need platform migration 0128. Ask the platform owner to run it.");
        } else {
          await deps.identity.remove(session.hotelId);
        }
      }
      const saved = await unit.run(session, async (repos) => {
        if (groupKey === "email" && emailProvider !== "platform") {
          const typedPassword = rows.some((r) => r.key === "email.password" && r.value !== "");
          const saved = await repos.adminSettings.get(["email.password", "email.provider", "email.host", "email.username"]);
          const savedValue = (k: string): string => (saved.find((r) => r.key === k)?.value ?? "").trim();
          const needsLogin = emailProvider !== "domain" && (emailProvider !== "smtp" || emailLogin !== "");
          const savedProvider = providerOfSaved(savedValue("email.provider") === "platform" ? null : savedValue("email.provider"), savedValue("email.host"));
          const providerChanged = savedProvider !== null && savedProvider !== emailProvider && savedValue("email.username") !== "";
          if (needsLogin && !typedPassword && (savedValue("email.password") === "" || providerChanged || clearEmailPassword)) {
            const message = providerChanged && savedValue("email.password") !== "" ? PASSWORD_NEW : PASSWORD_REQUIRED;
            throw new AppError("VALIDATION_FAILED", message, { fields: { "email.password": message } });
          }
          // a mail service that needs no login (a private relay) keeps no password
          if (!needsLogin) {
            const i = rows.findIndex((r) => r.key === "email.password");
            if (i >= 0) rows.splice(i, 1);
            rows.push({ key: "email.password", value: "", secret: true });
          }
        }
        // a password saved before passwords were encrypted is still read as it is; saving Settings > Email seals it
        if (groupKey === "email" && secretKey !== null && emailProvider !== "platform" && !rows.some((r) => r.key === "email.password")) {
          const old = (await repos.adminSettings.get(["email.password"]))[0]?.value ?? "";
          if (old !== "" && !isSealedSmtpSecret(old)) rows.push({ key: "email.password", value: sealSmtpSecret(secretKey, old, session.hotelId), secret: true });
        }
        await repos.adminSettings.set(rows, session.userId);
        await repos.systemLogs.write(logLine(w, "settings", { action: "updated", entity: "Settings", summary: `${def.label} settings saved`, subject: null, details: changed }));
        const group = await groupDto(repos, groupKey, session.hotelId);
        return { group, message: `${group.label} settings saved.` };
      });
      // the food business name is kept per process for GET /auth/session and the shell seed: a new one shows at once here, within a minute elsewhere
      if (rows.some((r) => r.key === "general.food_name")) forgetFoodName(session.hotelId);
      return saved;
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;

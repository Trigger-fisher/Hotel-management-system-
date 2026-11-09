import "server-only";
import type { PlatformRoleDefault, PlatformSettings, PlatformSettingsInput, PlatformSmtpTestResult } from "@shared/dashboards/platform";
import { INVITATION_VALID_HOURS, PLATFORM_GST_RATES, PLATFORM_TIME_ZONES, platformCopy } from "@shared/dashboards/platform";
import { mailProviderCopy } from "@shared/dashboards/mailProviders";
import { MAIL_FILES_KEEP_HOURS_DEFAULT, mailFilesKeepHoursProblem, validMailFilesKeepHours } from "@shared/dashboards/mailFiles";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { SettingRow } from "../../repos/platformConsole";
import { createGate, type PlatformMeta } from "./access";
import type { ConsoleDeps } from "./context";
import { EMAIL_RE } from "./validate";
import { PLATFORM_BACKUP_SCOPE, PLATFORM_SCOPE, readPlatformBackup, readPlatformSmtp } from "../../mail/platformSmtp";
import { failoverRuleOf, failoverStateOf, MAX_RETURN_MINUTES } from "../../mail/failover";
import { effectiveLimits, connectionOf, providerOfSaved, sesRegionOf, type ProviderId } from "../../mail/provider";
import { isMailAddress, readSmtpPassword, sealSmtpSecret, securityOfStored, sendTestMail, smtpChecks, type SmtpConfig, type SmtpTestResult } from "../../mail/smtp";

// Platform settings, Super Admin only (docs/BACKEND.md 14.6): defaults a new hotel starts with and the sender of platform mail. Stored in
// platform.platform_settings (one row per key; the database CHECKs the shape). The invitation validity and the 2-step rule are constants, shown read only.
// NOTE: the values are stored and shown; the hotel builder and the mail worker will read them when they are wired (today the hotel template and the
// mail configuration still use their own fixed values).

const E = platformCopy.errors;
const X = platformCopy.a8Errors;

/** The built-in roles a new hotel can start with (the ladder of migration 0012). Super Admin is always created. */
export const HOTEL_ROLES: readonly Omit<PlatformRoleDefault, "enabled">[] = [
  { key: "super_admin", label: "Super Admin", description: "Owner access to everything, including users and system.", locked: true },
  { key: "admin", label: "Admin", description: "Runs the hotel day to day. Can manage users and settings.", locked: false },
  { key: "editor", label: "Editor", description: "Front desk and accounts staff who add and change entries.", locked: false },
  { key: "viewer", label: "Viewer", description: "Can look at reports and records but not change them.", locked: false },
];

const KEYS = {
  roles: "new_hotel.role_keys", gst: "new_hotel.gst_percent", zone: "new_hotel.time_zone", fromName: "mail.from_name", fromEmail: "mail.from_email", sendingDomain: "mail.sending_domain",
  smtpHost: "mail.smtp_host", smtpPort: "mail.smtp_port", smtpSecurity: "mail.smtp_security", smtpUser: "mail.smtp_user", smtpPassword: "mail.smtp_password", replyTo: "mail.reply_to", test: "mail.test_result", provider: "mail.provider", dailyLimit: "mail.daily_limit",
  backupUser: "mail.backup_user", backupPassword: "mail.backup_password", backupTest: "mail.backup_test_result", failoverEnabled: "mail.failover_enabled", failoverMinutes: "mail.failover_return_minutes", failoverState: "mail.failover_state",
  filesKeep: "mail.files_keep_hours",
} as const;

/** What the settings view needs to know about the mail password without ever seeing it: whether one is saved, and whether the server can encrypt one. */
export interface SmtpFacts {
  passwordSet: boolean;
  canStorePassword: boolean;
  /** A password is saved but cannot be opened (the key is missing or was changed): mail falls back to the server's own settings. */
  passwordUnreadable?: boolean;
  /** When the password was last saved (the date only; never any part of it). */
  lastChangedAt?: string | null;
  /** The same facts about the Google backup's app password. */
  backup?: { passwordSet: boolean; passwordUnreadable: boolean; lastChangedAt: string | null };
}

/** A domain name for the platform's sending identity: lower-case labels, at least one dot. */
const SENDING_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** A Gmail address on its own domain is Google Workspace (more mail a day than a personal account). */
const limitsOf = (provider: ProviderId, workspace: boolean, dailyLimit: number | null): { perSecond: number; perDay: number } => {
  const l = effectiveLimits(provider, { workspace, dailyLimit });
  return { perSecond: l.perSecond, perDay: l.perDay };
};
const workspaceOf = (user: string): boolean => /@/.test(user) && !/@(gmail|googlemail)\.com$/i.test(user);

export function settingsView(rows: readonly SettingRow[], smtp: SmtpFacts = { passwordSet: false, canStorePassword: false }): PlatformSettings {
  const by = new Map(rows.map((r) => [r.key, r]));
  const text = (k: string): string => (typeof by.get(k)?.value === "string" ? String(by.get(k)?.value) : "");
  const test = by.get(KEYS.test)?.value;
  const roleKeys = (by.get(KEYS.roles)?.value as string[] | undefined) ?? HOTEL_ROLES.map((r) => r.key);
  const provider = providerOfSaved(text(KEYS.provider), text(KEYS.smtpHost));
  const dailyLimit = Number(by.get(KEYS.dailyLimit)?.value ?? 0) || 0;
  // a service is in use when a server and a login are saved with a password that can be opened (a relay without a login is a server alone)
  const using = provider !== null && text(KEYS.smtpHost) !== "" && (provider === "smtp" || text(KEYS.smtpUser) !== "") && (smtp.passwordSet || provider === "smtp") && smtp.passwordUnreadable !== true;
  const changed = rows.filter((r) => r.updatedBy !== null).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const backupUser = text(KEYS.backupUser);
  const rule = failoverRuleOf(by.get(KEYS.failoverEnabled)?.value, by.get(KEYS.failoverMinutes)?.value);
  const state = failoverStateOf(by.get(KEYS.failoverState)?.value);
  const testOf = (t: unknown): PlatformSmtpTestResult | null => {
    const x = t as { at?: unknown; ok?: unknown; message?: unknown; hint?: unknown } | null | undefined;
    return x && typeof x.at === "string" && typeof x.ok === "boolean" && typeof x.message === "string" ? { at: x.at, ok: x.ok, message: x.message, ...(typeof x.hint === "string" ? { hint: x.hint } : {}) } : null;
  };
  return {
    newHotelRoles: HOTEL_ROLES.map((r) => ({ ...r, enabled: r.locked || roleKeys.includes(r.key) })),
    defaultGstPercent: Number(by.get(KEYS.gst)?.value ?? 5),
    defaultTimeZone: String(by.get(KEYS.zone)?.value ?? "Asia/Kolkata"),
    invitationValidHours: INVITATION_VALID_HOURS,
    mailFromName: String(by.get(KEYS.fromName)?.value ?? "EasyHotelSolutions"),
    mailFromEmail: String(by.get(KEYS.fromEmail)?.value ?? ""),
    mailFilesKeepHours: validMailFilesKeepHours(by.get(KEYS.filesKeep)?.value) ? (by.get(KEYS.filesKeep)?.value as number) : MAIL_FILES_KEEP_HOURS_DEFAULT,
    mailSendingDomain: text(KEYS.sendingDomain),
    smtp: {
      user: text(KEYS.smtpUser),
      passwordSet: smtp.passwordSet,
      lastChangedAt: smtp.passwordSet ? (smtp.lastChangedAt ?? null) : null,
      canStorePassword: smtp.canStorePassword,
      passwordUnreadable: smtp.passwordUnreadable === true,
      replyTo: text(KEYS.replyTo),
      // an older, non-Gmail server shows as its provider now: nothing is "other" any more
      otherServer: null,
      sendingFrom: using ? { source: "settings", address: text(KEYS.smtpUser), provider } : { source: "server", address: null, provider: null },
      provider: using ? provider : null,
      server: text(KEYS.smtpHost) !== "" ? { host: text(KEYS.smtpHost), port: Number(by.get(KEYS.smtpPort)?.value ?? 587), security: securityOfStored(text(KEYS.smtpSecurity)), region: sesRegionOf(text(KEYS.smtpHost)) ?? "" } : null,
      dailyLimit: dailyLimit > 0 ? dailyLimit : null,
      limits: using && provider ? limitsOf(provider, workspaceOf(text(KEYS.smtpUser)), dailyLimit > 0 ? dailyLimit : null) : null,
      lastTest: testOf(test),
      backup: {
        user: backupUser,
        passwordSet: smtp.backup?.passwordSet === true,
        lastChangedAt: smtp.backup?.passwordSet ? (smtp.backup.lastChangedAt ?? null) : null,
        passwordUnreadable: smtp.backup?.passwordUnreadable === true,
        limits: backupUser !== "" && smtp.backup?.passwordSet === true ? limitsOf("gmail", workspaceOf(backupUser), null) : null,
        lastTest: testOf(by.get(KEYS.backupTest)?.value),
      },
      failover: { enabled: rule.enabled, returnMinutes: rule.returnMinutes, active: state?.active ?? "primary", since: state?.since ?? null, events: state?.events ?? [] },
    },    twoStepForPlatformRoles: true,
    updatedAt: changed ? changed.updatedAt.toISOString() : null,
    updatedBy: changed ? changed.updatedByName : null,
  };
}

/** What the mail password needs from the server: the key that seals it (mail/key.ts: SMTP_SECRET_KEY if set, else derived from HMS_HASH_KEY; null = no key at all), the fallback sender, and (tests) the function that sends the test email. */
export interface SmtpDeps {
  secretKey: Buffer | null;
  envFrom?: string;
  /** Tests: sends the test mail with the shared sender but without a network. Default: the shared sendTestMail. */
  sendTest?: (config: SmtpConfig, to: string) => Promise<SmtpTestResult>;
}

/** Platform settings > Mail: whether Conversations reads the platform mailbox, and where it stands (read only here). */
export interface MailboxReadingLine {
  reading: boolean;
  state: "off" | "not_available" | "ok" | "error" | "checking";
}

export function createSettingsService(deps: ConsoleDeps & { smtp?: SmtpDeps; mailboxReading?: () => Promise<MailboxReadingLine | null> }) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);
  const key = deps.smtp?.secretKey ?? null;

  /** The settings as the screen shows them: the non-secret rows, and only the FACT that a mail password is saved. */
  async function view(repos: Parameters<Parameters<typeof unit.run>[0]>[0]): Promise<PlatformSettings> {
    const secrets = await repos.settings.secrets([KEYS.smtpPassword, KEYS.backupPassword]);
    const saved = secrets.get(KEYS.smtpPassword) ?? null;
    const savedBackup = secrets.get(KEYS.backupPassword) ?? null;
    const unreadable = readSmtpPassword(saved, key, PLATFORM_SCOPE).unreadable;
    const changedAt = await repos.settings.secretChangedAt([KEYS.smtpPassword, KEYS.backupPassword]);
    const at = (k: string): string | null => changedAt.get(k)?.toISOString() ?? null;
    return settingsView(await repos.settings.all(), {
      passwordSet: saved !== null,
      canStorePassword: key !== null,
      passwordUnreadable: unreadable,
      lastChangedAt: at(KEYS.smtpPassword),
      backup: { passwordSet: savedBackup !== null, passwordUnreadable: readSmtpPassword(savedBackup, key, PLATFORM_BACKUP_SCOPE).unreadable, lastChangedAt: at(KEYS.backupPassword) },
    });
  }

  async function get(session: VerifiedSession): Promise<PlatformSettings & { mailboxReading: MailboxReadingLine | null }> {
    gate.superRead(session);
    const settings = await unit.run(async (repos) => {
      await gate.actor(repos, session);
      return view(repos);
    });
    // Conversations (decision 66, A5): the read-only line "Reading this mailbox: on/off"; the switch itself is in Console > Conversations > Settings
    const mailboxReading = deps.mailboxReading ? await deps.mailboxReading().catch(() => null) : null;
    return { ...settings, mailboxReading };
  }

  async function update(session: VerifiedSession, input: PlatformSettingsInput, meta: PlatformMeta): Promise<PlatformSettings> {
    const probe = { action: "settings_updated", entity: "platform", entityId: null } as const;
    await gate.superWrite(session, meta, probe);
    const f: Record<string, string> = {};
    if (input.roleKeys !== undefined && input.roleKeys.some((k) => !HOTEL_ROLES.some((r) => r.key === k))) f.roleKeys = X.rolesUnknown;
    if (input.defaultGstPercent !== undefined && !(PLATFORM_GST_RATES as readonly number[]).includes(input.defaultGstPercent)) f.defaultGstPercent = X.gstRate;
    if (input.defaultTimeZone !== undefined && !(PLATFORM_TIME_ZONES as readonly string[]).includes(input.defaultTimeZone)) f.defaultTimeZone = E.timeZoneUnknown;
    const name = input.mailFromName?.trim();
    if (name !== undefined) {
      if (name === "") f.mailFromName = X.fromNameRequired;
      else if (Array.from(name).length > 100) f.mailFromName = E.nameLong;
    }
    const email = input.mailFromEmail?.trim().toLowerCase();
    if (email !== undefined) {
      if (email === "") f.mailFromEmail = E.required.email;
      else if (!EMAIL_RE.test(email) || email.length > 254) f.mailFromEmail = E.emailFormat;
    }
    if (input.mailFilesKeepHours !== undefined && !validMailFilesKeepHours(input.mailFilesKeepHours)) f.mailFilesKeepHours = mailFilesKeepHoursProblem;
    const sm = input.smtp;
    const S = platformCopy.platformSettings.smtp.errors;
    const PE = mailProviderCopy.errors;
    let smtpReplyTo: string | undefined;
    let smtpUser: string | undefined;
    // an app password / SMTP key is shown by the service in groups: spaces do not belong to it
    const sendingDomain = input.mailSendingDomain?.trim().toLowerCase();
    if (sendingDomain !== undefined && sendingDomain !== "" && !SENDING_DOMAIN_RE.test(sendingDomain)) f.mailSendingDomain = PE.sendingDomain;
    const smtpPassword = sm?.password === undefined ? undefined : sm.password.replace(/\s+/g, "");
    if (sm) {
      if (sm.user !== undefined) {
        // kept as typed: an SES user name or a Brevo login is case sensitive (only a Gmail address is lower-cased, below)
        smtpUser = sm.user.trim();
        if (!smtpChecks.user(smtpUser)) f.smtpUser = S.user;
      }
      if (smtpPassword !== undefined && !smtpChecks.password(smtpPassword)) f.smtpPassword = S.password;
      else if (smtpPassword !== undefined && smtpPassword !== "" && key === null) f.smtpPassword = S.keyMissing;
      if (sm.replyTo !== undefined) {
        smtpReplyTo = sm.replyTo.trim().toLowerCase();
        if (!smtpChecks.address(smtpReplyTo)) f.smtpReplyTo = S.replyTo;
      }
      if (sm.dailyLimit !== undefined && sm.dailyLimit !== null && !(Number.isInteger(sm.dailyLimit) && sm.dailyLimit >= 0 && sm.dailyLimit <= 10_000_000)) f.smtpDailyLimit = PE.dailyLimit;
    }
    // the Google backup: an address and an app password (spaces are not part of it), and the failover rules
    const bk = sm?.backup;
    const backupUser = bk?.user === undefined ? undefined : bk.user.trim().toLowerCase();
    const backupPassword = bk?.password === undefined ? undefined : bk.password.replace(/\s+/g, "");
    if (backupUser !== undefined && backupUser !== "" && !isMailAddress(backupUser)) f.backupUser = S.backupUser;
    if (backupPassword !== undefined && !smtpChecks.password(backupPassword)) f.backupPassword = S.password;
    else if (backupPassword !== undefined && backupPassword !== "" && key === null) f.backupPassword = S.keyMissing;
    const fo = sm?.failover;
    if (fo?.returnMinutes !== undefined && !(Number.isInteger(fo.returnMinutes) && fo.returnMinutes >= 1 && fo.returnMinutes <= MAX_RETURN_MINUTES)) f.failoverMinutes = S.failoverMinutes;
    if (Object.keys(f).length > 0) throw new AppError("VALIDATION_FAILED", undefined, { fields: f });
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const before = await view(repos);
      const W = platformCopy.platformSettings.changed;
      const changed: string[] = [];
      if (input.roleKeys !== undefined) {
        const keys = HOTEL_ROLES.filter((r) => r.locked || input.roleKeys?.includes(r.key)).map((r) => r.key);
        if (keys.join() !== before.newHotelRoles.filter((r) => r.enabled).map((r) => r.key).join()) {
          await repos.settings.set(KEYS.roles, keys, actor.userId, at);
          changed.push(W.roles);
        }
      }
      if (input.defaultGstPercent !== undefined && input.defaultGstPercent !== before.defaultGstPercent) {
        await repos.settings.set(KEYS.gst, input.defaultGstPercent, actor.userId, at);
        changed.push(W.gst);
      }
      if (input.defaultTimeZone !== undefined && input.defaultTimeZone !== before.defaultTimeZone) {
        await repos.settings.set(KEYS.zone, input.defaultTimeZone, actor.userId, at);
        changed.push(W.timeZone);
      }
      if ((name !== undefined && name !== before.mailFromName) || (email !== undefined && email !== before.mailFromEmail)) {
        if (name !== undefined) await repos.settings.set(KEYS.fromName, name, actor.userId, at);
        if (email !== undefined) await repos.settings.set(KEYS.fromEmail, email, actor.userId, at);
        changed.push(W.mail);
      }
      if (input.mailFilesKeepHours !== undefined && input.mailFilesKeepHours !== before.mailFilesKeepHours) {
        await repos.settings.set(KEYS.filesKeep, input.mailFilesKeepHours, actor.userId, at);
        changed.push(`Email files are kept ${input.mailFilesKeepHours} hour${input.mailFilesKeepHours === 1 ? "" : "s"} after the send`);
      }
      if (sendingDomain !== undefined && sendingDomain !== before.mailSendingDomain) {
        await repos.settings.set(KEYS.sendingDomain, sendingDomain === "" ? null : sendingDomain, actor.userId, at);
        if (!changed.includes(W.mail)) changed.push(W.mail);
      }
      let smtpChanged = false;
      if (sm) {
        const b = before.smtp;
        const rows = new Map((await repos.settings.all()).map((r) => [r.key, r.value]));
        const same = async (k: string, v: unknown): Promise<void> => {
          if ((rows.get(k) ?? null) !== v) {
            await repos.settings.set(k, v, actor.userId, at);
            smtpChanged = true;
          }
        };
        const provider: ProviderId = sm.provider ?? b.provider ?? "gmail";
        const providerChanged = sm.provider !== undefined && b.provider !== null && sm.provider !== b.provider && b.user !== "";
        const serverTouched = sm.provider !== undefined || sm.host !== undefined || sm.port !== undefined || sm.security !== undefined || sm.region !== undefined || smtpUser !== undefined;
        const user = smtpUser === undefined ? b.user : provider === "gmail" ? smtpUser.toLowerCase() : smtpUser;
        const typedHost = (sm.host ?? (b.provider === "smtp" ? (b.server?.host ?? "") : "")).trim();
        // switched off: no login (a service that needs one), or no server (another SMTP server): the server's own mail setup sends again
        const off = provider === "smtp" ? typedHost === "" : user === "";
        const clearsPassword = (off || sm.clearPassword === true) && b.passwordSet;
        const bad: Record<string, string> = {};
        let conn: ReturnType<typeof connectionOf> | null = null;
        if (serverTouched && !off) {
          conn = connectionOf(provider, { host: typedHost, ...(sm.port !== undefined ? { port: sm.port } : b.provider === "smtp" && b.server ? { port: b.server.port } : {}), ...(sm.security !== undefined ? { security: sm.security } : b.provider === "smtp" && b.server ? { security: b.server.security } : {}), ...(sm.region !== undefined ? { region: sm.region } : b.server?.region ? { region: b.server.region } : {}) });
          if ("error" in conn) {
            bad[conn.error === "host" ? "smtpHost" : conn.error === "port" ? "smtpPort" : conn.error === "security" ? "smtpSecurity" : "smtpRegion"] = PE[conn.error];
            conn = null;
          }
          if (provider === "gmail" && user !== "" && !isMailAddress(user)) bad.smtpUser = S.user;
          if (provider !== "gmail") {
            const from = (email ?? before.mailFromEmail).trim();
            if (!isMailAddress(from)) bad.mailFromEmail = PE.fromAddress;
          }
          const needsLogin = provider !== "smtp" || user !== "";
          const typed = smtpPassword !== undefined && smtpPassword !== "";
          if (needsLogin && !typed && (!b.passwordSet || sm.clearPassword === true || providerChanged)) bad.smtpPassword = providerChanged ? PE.passwordNew : S.passwordRequired;
        }
        if (Object.keys(bad).length > 0) throw new AppError("VALIDATION_FAILED", undefined, { fields: bad });
        if (serverTouched) {
          if (off) {
            await same(KEYS.provider, provider);
            await same(KEYS.smtpHost, null);
            await same(KEYS.smtpUser, null);
          } else if (conn && !("error" in conn)) {
            // the server of Gmail, Brevo and Amazon SES is fixed by the provider; another SMTP server is what was typed
            await same(KEYS.provider, provider);
            await same(KEYS.smtpHost, conn.host);
            await same(KEYS.smtpPort, conn.port);
            await same(KEYS.smtpSecurity, conn.security);
            await same(KEYS.smtpUser, user === "" ? null : user);
          }
        }
        if (sm.dailyLimit !== undefined) await same(KEYS.dailyLimit, sm.dailyLimit === null || sm.dailyLimit === 0 ? null : sm.dailyLimit);
        if (smtpReplyTo !== undefined) await same(KEYS.replyTo, smtpReplyTo === "" ? null : smtpReplyTo);
        // the password: sealed before it is stored; a new one replaces, "remove" clears; left out keeps the saved one. Never in the audit row.
        if (clearsPassword && !(smtpPassword !== undefined && smtpPassword !== "" && !off)) {
          await repos.settings.set(KEYS.smtpPassword, null, actor.userId, at, { secret: true });
          smtpChanged = true;
        } else if (smtpPassword !== undefined && smtpPassword !== "" && key !== null && !off) {
          await repos.settings.set(KEYS.smtpPassword, sealSmtpSecret(key, smtpPassword, PLATFORM_SCOPE), actor.userId, at, { secret: true });
          smtpChanged = true;
        }
        if (smtpChanged) {
          // an old test result no longer describes the new settings
          await repos.settings.set(KEYS.test, null, actor.userId, at);
          changed.push(W.smtp);
        }      }
      let backupChanged = false;
      if (bk || fo) {
        const rows = new Map((await repos.settings.all()).map((r) => [r.key, r.value]));
        const put = async (k: string, v: unknown): Promise<void> => {
          if ((rows.get(k) ?? null) !== v) {
            await repos.settings.set(k, v, actor.userId, at);
            backupChanged = true;
          }
        };
        if (bk) {
          const b = before.smtp.backup;
          const user = backupUser === undefined ? b.user : backupUser;
          const off = user === "";
          const typed = backupPassword !== undefined && backupPassword !== "";
          // a backup that stays on needs its app password: a new address, a removed password or none saved yet needs a typed one
          if (!off && !typed && (!b.passwordSet || bk.clearPassword === true || user !== b.user)) throw new AppError("VALIDATION_FAILED", undefined, { fields: { backupPassword: b.passwordSet && user !== b.user ? mailProviderCopy.errors.passwordNew : platformCopy.platformSettings.smtp.errors.passwordRequired } });
          await put(KEYS.backupUser, off ? null : user);
          if ((off || bk.clearPassword === true) && !typed && b.passwordSet) {
            await repos.settings.set(KEYS.backupPassword, null, actor.userId, at, { secret: true });
            backupChanged = true;
          } else if (typed && key !== null && !off) {
            await repos.settings.set(KEYS.backupPassword, sealSmtpSecret(key, backupPassword as string, PLATFORM_BACKUP_SCOPE), actor.userId, at, { secret: true });
            backupChanged = true;
          }
        }
        if (fo?.enabled !== undefined) await put(KEYS.failoverEnabled, fo.enabled);
        if (fo?.returnMinutes !== undefined) await put(KEYS.failoverMinutes, fo.returnMinutes);
        if (backupChanged) {
          // an old test result no longer describes the new settings
          if (bk) await repos.settings.set(KEYS.backupTest, null, actor.userId, at);
          changed.push(W.backup);
        }
      }
      if (changed.length > 0) {
        const now2 = smtpChanged || backupChanged ? await view(repos) : null;
        // no password and no sealed value in the audit row: only whether one is set
        const smtpFacts = (s: PlatformSettings["smtp"]) => ({ provider: s.provider, serviceSaved: s.user !== "" || s.server !== null, passwordSet: s.passwordSet, replyToSet: s.replyTo !== "", backup: { addressSaved: s.backup.user !== "", passwordSet: s.backup.passwordSet }, failover: { enabled: s.failover.enabled, returnMinutes: s.failover.returnMinutes } });
        await gate.audit(repos, actor, meta, {
          ...probe,
          reason: changed.join(", "),
          before: { gst: before.defaultGstPercent, timeZone: before.defaultTimeZone, mailFromName: before.mailFromName, mailFromEmail: before.mailFromEmail, ...(smtpChanged || backupChanged ? { smtp: smtpFacts(before.smtp) } : {}) },
          ...(now2 ? { after: { smtp: smtpFacts(now2.smtp) } } : {}),
        });
      }
      return view(repos);
    });
  }

  /**
   * "Send test email": one mail with the SAVED settings to the address the Super Admin typed, and the exact result back. The result (when, ok, the words; not the
   * recipient) is kept as the last test. Audited as a settings action without the address. A password that cannot be opened (no key, or a changed key) is told plainly.
   */
  async function sendTest(session: VerifiedSession, to: string, meta: PlatformMeta, which: "primary" | "backup" = "primary"): Promise<PlatformSmtpTestResult> {
    const probe = { action: "settings_updated", entity: "platform", entityId: null } as const;
    await gate.superWrite(session, meta, probe);
    const E2 = platformCopy.platformSettings.smtp.errors;
    const address = to.trim().toLowerCase();
    if (address === "" || address.length > 254 || !EMAIL_RE.test(address)) throw new AppError("VALIDATION_FAILED", E2.to, { fields: { to: E2.to } });
    const loaded = await unit.run(async (repos) => {
      await gate.actor(repos, session);
      const rows = await repos.settings.all();
      const secrets = await repos.settings.secrets([KEYS.smtpPassword, KEYS.backupPassword]);
      return { rows, sealed: secrets.get(KEYS.smtpPassword) ?? null, sealedBackup: secrets.get(KEYS.backupPassword) ?? null };
    });
    const by = new Map(loaded.rows.map((r) => [r.key, r.value]));
    const read = which === "backup" ? readPlatformBackup((k) => by.get(k) ?? null, loaded.sealedBackup, key) : readPlatformSmtp((k) => by.get(k) ?? null, loaded.sealed, key, deps.smtp?.envFrom);
    let result: SmtpTestResult;
    if (which === "backup" && !read.config) {
      if (typeof by.get(KEYS.backupUser) !== "string" || String(by.get(KEYS.backupUser)).trim() === "") throw new AppError("VALIDATION_FAILED", E2.backupNotSet, { fields: { to: E2.backupNotSet } });
      result = { ok: false, message: read.passwordUnreadable ? (key === null ? E2.keyMissing : "The saved app password cannot be opened on this server. Type the app password again and save.") : E2.backupNotSet };
    } else if (!read.config) {
      if (typeof by.get(KEYS.smtpHost) !== "string" || String(by.get(KEYS.smtpHost)).trim() === "") throw new AppError("VALIDATION_FAILED", E2.notSet, { fields: { to: E2.notSet } });
      result = { ok: false, message: read.passwordUnreadable ? (key === null ? E2.keyMissing : "The saved app password cannot be opened on this server. Type the app password again and save.") : E2.notSet };
    } else {
      result = await (deps.smtp?.sendTest ?? ((c, t) => sendTestMail(c, t, { subject: "EasyHotelSolutions test email", body: `This is a test email from EasyHotelSolutions (Platform settings > Mail${which === "backup" ? ", through the backup service" : ""}). If you can read it, the mail settings work.` })))(read.config, address);
    }
    const at = now();
    const kept: PlatformSmtpTestResult = { at: at.toISOString(), ok: result.ok, message: result.message, ...(result.hint ? { hint: result.hint } : {}) };
    await unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      await repos.settings.set(which === "backup" ? KEYS.backupTest : KEYS.test, kept, actor.userId, at);
      await gate.audit(repos, actor, meta, { ...probe, reason: `Mail ${which === "backup" ? "backup" : "server"} test ${result.ok ? "sent" : "failed"}` });
    });
    return kept;
  }

  return { get, update, sendTest };
}

export type SettingsService = ReturnType<typeof createSettingsService>;

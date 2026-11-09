import "server-only";
import type { PlatformGroupMail, PlatformGroupMailSummary, PlatformHotelMail, PlatformHotelMailInput, PlatformHotelMailSummary, PlatformMailPause, PlatformMailPauseInput, PlatformSmtpTestResult } from "@shared/dashboards/platform";
import { platformCopy } from "@shared/dashboards/platform";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { GroupMailRow, HotelMailPatch, HotelMailRow, PlatformConsoleRepos } from "../../repos/platformConsole";
import { readPlatformSmtp } from "../../mail/platformSmtp";
import { groupGmailScope, groupSesScope, hotelGmailScope, hotelSesScope, readGroupMail, readHotelMail, type HotelMailRead } from "../../mail/hotelMail";
import { providerChecks, SES_DEFAULT_REGION } from "../../mail/provider";
import { mailAddressOf, sendingDomainOf } from "../../mail/sendingDomain";
import { isMailAddress, readSmtpPassword, sealSmtpSecret, sendTestMail, smtpChecks, type SmtpConfig, type SmtpTestResult } from "../../mail/smtp";
import { createGate, type PlatformMeta } from "./access";
import type { ConsoleDeps } from "./context";

// Hotel mail and group mail (MJ, 1 Nov 2026), Super Admin only: for ONE hotel, or ONE group, an Amazon SES login and a Google login. A hotel's mail goes out through its SES, its Google, its
// group's SES, its group's Google, then the platform's SES and Google backup (mail/hotelSmtp.ts). The two passwords are sealed with the mail key, bound to their owner, and are never
// returned: the screen only learns whether one is saved. Stored in platform.hotel_mail (0161) and platform.group_mail (0162). One service body serves both owners.

const E = platformCopy.hotelMail.errors;

export interface HotelMailDeps {
  /** SMTP_SECRET_KEY: seals the passwords. Without it a password cannot be saved. */
  secretKey?: Buffer | null;
  /** The address Amazon SNS posts received mail to, and whether the server knows its topic (compose/mailInbound.ts). */
  inbound?: () => { address: string | null; topicSet: boolean };
  /** Tests send through this instead of a real mail server. */
  sendTest?: (config: SmtpConfig, to: string) => Promise<SmtpTestResult>;
  /** The platform registry of mailboxes (platform 0139): a hotel whose Google login is saved is read by Conversations (the Email page), and the daily check needs to know it. Best effort. */
  mailboxRegistry?: { setHotelReading(hotelId: string, on: boolean): Promise<void> };
}

const text = (v: string | null | undefined): string => (v ?? "").trim();
const testOf = (v: unknown): PlatformSmtpTestResult | null => {
  const t = v as Partial<PlatformSmtpTestResult> | null | undefined;
  return t && typeof t.at === "string" && typeof t.ok === "boolean" && typeof t.message === "string" ? { at: t.at, ok: t.ok, message: t.message, ...(typeof t.hint === "string" ? { hint: t.hint } : {}) } : null;
};

type Repos = PlatformConsoleRepos;
type AccountRow = Omit<HotelMailRow, "hotelId">;

/** The platform's sending domain: the domain of the From address saved in Platform settings > Email (the older sending-domain row only counts without one). null = none, e.g. a Gmail From. */
async function sendingDomainFrom(repos: PlatformConsoleRepos): Promise<string | null> {
  const rows = await repos.settings.all();
  const text = (k: string): string | null => {
    const v = rows.find((r) => r.key === k)?.value;
    return typeof v === "string" ? v : null;
  };
  return sendingDomainOf(text("mail.from_email"), text("mail.sending_domain"));
}

/** What differs between a hotel and a group: where its row is kept, how it is found, how its passwords are sealed, and the words used for it. */
interface Owner {
  noun: "hotel" | "group";
  rows(repos: Repos): {
    get(id: string): Promise<AccountRow | null>;
    all(): Promise<(AccountRow & { id: string })[]>;
    save(id: string, patch: HotelMailPatch, by: string, now: Date): Promise<void>;
    setTest(id: string, which: "ses" | "gmail", result: unknown, now: Date): Promise<void>;
  };
  /** The live owner (a hotel that is active or suspended; a group); throws NOT_FOUND. */
  find(repos: Repos, id: string, at: Date): Promise<{ name: string; slug: string }>;
  scopes(id: string): { ses: string; gmail: string };
  read(id: string, row: AccountRow, key: Buffer | null, name: string, platformSes: SmtpConfig | null, autoFrom: string | null): HotelMailRead;
  unknown: string;
  sesNotSet: string;
  gmailNotSet: string;
  label: string;
}

const hotelOwner: Owner = {
  noun: "hotel",
  rows: (repos) => ({
    get: (id) => repos.hotelMail.get(id),
    all: async () => (await repos.hotelMail.all()).map((r) => ({ ...r, id: r.hotelId })),
    save: (id, patch, by, now) => repos.hotelMail.save(id, patch, by, now),
    setTest: (id, which, result, now) => repos.hotelMail.setTest(id, which, result, now),
  }),
  find: async (repos, id, at) => {
    const hotel = await repos.hotels.get(id, at);
    // only a live hotel (the list shows those): one still waiting for approval, rejected or archived has no mail to set up
    if (!hotel || (hotel.status !== "active" && hotel.status !== "suspended")) throw new AppError("NOT_FOUND", E.hotelUnknown);
    return hotel;
  },
  scopes: (id) => ({ ses: hotelSesScope(id), gmail: hotelGmailScope(id) }),
  read: (id, row, key, name, platformSes, autoFrom) => readHotelMail({ ...row, hotelId: id }, key, name, platformSes, autoFrom),
  unknown: E.hotelUnknown,
  sesNotSet: E.sesNotSet,
  gmailNotSet: E.gmailNotSet,
  label: "Hotel mail",
};

const groupOwner: Owner = {
  noun: "group",
  rows: (repos) => ({
    get: (id) => repos.groupMail.get(id),
    all: async () => (await repos.groupMail.all()).map((r) => ({ ...r, id: r.groupId })),
    save: (id, patch, by, now) => repos.groupMail.save(id, patch, by, now),
    setTest: (id, which, result, now) => repos.groupMail.setTest(id, which, result, now),
  }),
  find: async (repos, id) => {
    const group = await repos.groups.get(id);
    // only a live group (the list shows those): one waiting for approval, rejected or archived has no mail to set up
    if (!group || (group.status !== "active" && group.status !== "suspended")) throw new AppError("NOT_FOUND", E.groupUnknown);
    return group;
  },
  scopes: (id) => ({ ses: groupSesScope(id), gmail: groupGmailScope(id) }),
  read: (id, row, key, name, platformSes, autoFrom) => readGroupMail({ ...(row as GroupMailRow), groupId: id }, key, name, platformSes, autoFrom),
  unknown: E.groupUnknown,
  sesNotSet: E.groupSesNotSet,
  gmailNotSet: E.groupGmailNotSet,
  label: "Group mail",
};

/** A saved pause as the screen shows it; anything that is not a whole pause is no pause. */
export function pauseOf(v: unknown): PlatformMailPause | null {
  const p = v as Partial<PlatformMailPause> | null | undefined;
  return p && typeof p.at === "string" && typeof p.by === "string" && typeof p.reason === "string" && (p.scope === "all" || p.scope === "one") ? { at: p.at, by: p.by, reason: p.reason, scope: p.scope } : null;
}

/** The accounts of one owner as the screen shows them: never a password, only whether one is saved. */
interface AccountsView {
  ses: PlatformHotelMail["ses"];
  gmail: PlatformHotelMail["gmail"];
  fromName: string;
  replyTo: string;
  canStorePassword: boolean;
  /** The address its mail goes out as through Amazon SES unless an email address is saved for SES: made by itself from its name and the From domain; null with no such domain. */
  address: string | null;
  pause: PlatformMailPause | null;
}

/** The Amazon SES login saved in Platform settings > Email (what an owner's automatic SES sends with), or null while none is saved or it is not SES. */
async function platformSesOf(repos: Repos, key: Buffer | null): Promise<SmtpConfig | null> {
  const rows = await repos.settings.all();
  const secrets = await repos.settings.secrets(["mail.smtp_password"]);
  const by = new Map(rows.map((r) => [r.key, r.value]));
  return readPlatformSmtp((k) => by.get(k) ?? null, secrets.get("mail.smtp_password") ?? null, key, undefined).config;
}

function createAccountsService(deps: ConsoleDeps & { hotelMail?: HotelMailDeps }, owner: Owner) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);
  const key = deps.hotelMail?.secretKey ?? null;

  function view(id: string, row: AccountRow | null, address: string | null): AccountsView {
    const scopes = owner.scopes(id);
    const sesPass = readSmtpPassword(row?.sesPassword ?? null, key, scopes.ses);
    const gmPass = readSmtpPassword(row?.gmailPassword ?? null, key, scopes.gmail);
    return {
      ses: { region: row?.sesRegion ?? SES_DEFAULT_REGION, user: text(row?.sesUser), from: text(row?.sesFrom), passwordSet: sesPass.pass !== null || sesPass.unreadable, passwordUnreadable: sesPass.unreadable, lastTest: testOf(row?.sesTest) },
      gmail: { user: text(row?.gmailUser), passwordSet: gmPass.pass !== null || gmPass.unreadable, passwordUnreadable: gmPass.unreadable, lastTest: testOf(row?.gmailTest) },
      fromName: text(row?.fromName),
      replyTo: text(row?.replyTo),
      canStorePassword: key !== null,
      address,
      pause: pauseOf(row?.pause),
    };
  }

  /** Its automatic address: slug@domain, the domain being that of the From address saved in Platform settings > Email. */
  const addressOf = async (repos: Repos, slug: string): Promise<string | null> => mailAddressOf(slug, await sendingDomainFrom(repos));

  const facts = (r: AccountRow | null) => ({ ses: text(r?.sesUser) !== "" || text(r?.sesFrom) !== "", sesPasswordSet: text(r?.sesPassword) !== "", gmail: text(r?.gmailUser) !== "", gmailPasswordSet: text(r?.gmailPassword) !== "", fromNameSet: text(r?.fromName) !== "", replyToSet: text(r?.replyTo) !== "" });

  return {
    /** Every owner's set-up state: which of its own accounts are saved. */
    async setUp(repos: Repos): Promise<Map<string, { ses: boolean; gmail: boolean; pause: PlatformMailPause | null }>> {
      return new Map((await owner.rows(repos).all()).map((r) => [r.id, { ses: text(r.sesUser) !== "" || text(r.sesFrom) !== "", gmail: text(r.gmailUser) !== "", pause: pauseOf(r.pause) }]));
    },

    async get(session: VerifiedSession, id: string): Promise<{ name: string; view: AccountsView }> {
      gate.superRead(session);
      return unit.run(async (repos) => {
        await gate.actor(repos, session);
        const found = await owner.find(repos, id, now());
        return { name: found.name, view: view(id, await owner.rows(repos).get(id), await addressOf(repos, found.slug)) };
      });
    },

    /** Saves what the Super Admin changed (audited without any password). */
    async save(session: VerifiedSession, id: string, input: PlatformHotelMailInput, meta: PlatformMeta): Promise<{ name: string; view: AccountsView }> {
      const probe = { action: "settings_updated", entity: "platform", entityId: null } as const;
      await gate.superWrite(session, meta, probe);
      const f: Record<string, string> = {};
      const ses = input.ses;
      const gm = input.gmail;
      const sesPassword = ses?.password === undefined ? undefined : ses.password.replace(/\s+/g, "");
      const gmailPassword = gm?.password === undefined ? undefined : gm.password.replace(/\s+/g, "");
      const sesUser = ses?.user === undefined ? undefined : ses.user.trim();
      const sesFrom = ses?.from === undefined ? undefined : ses.from.trim().toLowerCase();
      const sesRegion = ses?.region === undefined ? undefined : ses.region.trim().toLowerCase();
      const gmailUser = gm?.user === undefined ? undefined : gm.user.trim().toLowerCase();
      const fromName = input.fromName === undefined ? undefined : input.fromName.trim();
      const replyTo = input.replyTo === undefined ? undefined : input.replyTo.trim().toLowerCase();
      if (sesUser !== undefined && sesUser !== "" && !smtpChecks.user(sesUser)) f.sesUser = E.sesUser;
      if (sesPassword !== undefined && sesPassword !== "" && !smtpChecks.password(sesPassword)) f.sesPassword = E.sesPassword;
      else if (sesPassword !== undefined && sesPassword !== "" && key === null) f.sesPassword = platformCopy.hotelMail.keyMissing;
      if (sesFrom !== undefined && sesFrom !== "" && !isMailAddress(sesFrom)) f.sesFrom = E.sesFrom;
      if (sesRegion !== undefined && sesRegion !== "" && !providerChecks.region(sesRegion)) f.sesRegion = E.sesRegion;
      if (gmailUser !== undefined && gmailUser !== "" && !isMailAddress(gmailUser)) f.gmailUser = E.gmailUser;
      if (gmailPassword !== undefined && gmailPassword !== "" && !smtpChecks.password(gmailPassword)) f.gmailPassword = E.gmailPassword;
      else if (gmailPassword !== undefined && gmailPassword !== "" && key === null) f.gmailPassword = platformCopy.hotelMail.keyMissing;
      if (fromName !== undefined && (Array.from(fromName).length > 100 || /[\r\n]/.test(fromName))) f.fromName = E.fromName;
      if (replyTo !== undefined && !smtpChecks.address(replyTo)) f.replyTo = E.replyTo;
      if (Object.keys(f).length > 0) throw await gate.refuse(session, meta, probe, new AppError("VALIDATION_FAILED", Object.values(f)[0], { fields: f }));

      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const at = now();
        const found = await owner.find(repos, id, at);
        const rows = owner.rows(repos);
        const before = await rows.get(id);
        const scopes = owner.scopes(id);
        const patch: HotelMailPatch = {};
        const bad: Record<string, string> = {};

        if (ses?.clear === true) {
          Object.assign(patch, { sesRegion: null, sesUser: null, sesPassword: null, sesFrom: null, sesTest: null });
        } else if (ses && sesFrom !== undefined && sesUser === undefined && sesPassword === undefined && sesRegion === undefined) {
          // Amazon SES is automatic (the platform's SES login, the owner's own address): only an EMAIL ADDRESS is saved, to replace that address for this hotel or group
          if (sesFrom === "") Object.assign(patch, { sesFrom: null, sesTest: null });
          else Object.assign(patch, { sesFrom, sesTest: null });
        } else if (ses && (sesUser !== undefined || sesPassword !== undefined || sesFrom !== undefined || sesRegion !== undefined)) {
          const user = sesUser ?? text(before?.sesUser);
          const from = sesFrom ?? text(before?.sesFrom);
          const region = (sesRegion || text(before?.sesRegion) || SES_DEFAULT_REGION).toLowerCase();
          const typed = sesPassword !== undefined && sesPassword !== "";
          const userChanged = user !== text(before?.sesUser);
          if (user === "") bad.sesUser = E.sesUser;
          if (from === "") bad.sesFrom = E.sesFrom;
          if (!typed && (text(before?.sesPassword) === "" || userChanged)) bad.sesPassword = E.sesPasswordRequired;
          if (Object.keys(bad).length === 0) {
            Object.assign(patch, { sesRegion: region, sesUser: user, sesFrom: from, sesTest: null });
            if (typed && key !== null) patch.sesPassword = sealSmtpSecret(key, sesPassword as string, scopes.ses);
          }
        }

        if (gm?.clear === true) {
          Object.assign(patch, { gmailUser: null, gmailPassword: null, gmailTest: null });
        } else if (gm && (gmailUser !== undefined || gmailPassword !== undefined)) {
          const user = gmailUser ?? text(before?.gmailUser);
          const typed = gmailPassword !== undefined && gmailPassword !== "";
          const userChanged = user !== text(before?.gmailUser);
          if (user === "") bad.gmailUser = E.gmailUser;
          if (!typed && (text(before?.gmailPassword) === "" || userChanged)) bad.gmailPassword = E.gmailPasswordRequired;
          if (!bad.gmailUser && !bad.gmailPassword) {
            patch.gmailUser = user;
            patch.gmailTest = null;
            if (typed && key !== null) patch.gmailPassword = sealSmtpSecret(key, gmailPassword as string, scopes.gmail);
          }
        }

        if (fromName !== undefined) patch.fromName = fromName === "" ? null : fromName;
        if (replyTo !== undefined) patch.replyTo = replyTo === "" ? null : replyTo;
        if (Object.keys(bad).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(bad)[0], { fields: bad });

        if (Object.keys(patch).length > 0) {
          await rows.save(id, patch, actor.userId, at);
          const after = await rows.get(id);
          await gate.audit(repos, actor, meta, { ...probe, targetLabel: found.name, reason: `${owner.label}: ${found.name}`, before: facts(before), after: facts(after) });
        }
        const saved = await rows.get(id);
        return { name: found.name, view: view(id, saved, await addressOf(repos, found.slug)), googleSet: text(saved?.gmailUser) !== "" && text(saved?.gmailPassword) !== "", googleTouched: "gmailUser" in patch || "gmailPassword" in patch };
      }).then(async (done) => {
        // a hotel's own Google login is the mailbox its Email page reads: switch reading on or off with it (the registry is best effort, and a hotel's mail never waits for it)
        if (owner.noun === "hotel" && done.googleTouched) await deps.hotelMail?.mailboxRegistry?.setHotelReading(id, done.googleSet).catch(() => undefined);
        return { name: done.name, view: done.view };
      });
    },

    /**
     * Pauses or resumes the mail of one hotel or group (audited with who and why). A pause needs a reason; `scope` counts for a group only ("all" stops its hotels too, "one" only skips
     * the group's own accounts). The mail already queued waits and goes out after the pause ends.
     */
    async setPause(session: VerifiedSession, id: string, input: PlatformMailPauseInput, meta: PlatformMeta): Promise<{ name: string; view: AccountsView }> {
      const probe = { action: "settings_updated", entity: "platform", entityId: null } as const;
      await gate.superWrite(session, meta, probe);
      const reason = (input.reason ?? "").trim();
      if (input.paused && (reason.length < 3 || reason.length > 200 || /[\r\n]/.test(reason))) throw await gate.refuse(session, meta, probe, new AppError("VALIDATION_FAILED", E.pauseReason, { fields: { reason: E.pauseReason } }));
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const at = now();
        const found = await owner.find(repos, id, at);
        const rows = owner.rows(repos);
        const before = await rows.get(id);
        const was = pauseOf(before?.pause);
        if (input.paused === (was !== null)) throw new AppError("CONFLICT", input.paused ? E.alreadyPaused : E.notPaused);
        const pause: PlatformMailPause | null = input.paused ? { at: at.toISOString(), by: actor.name, reason, scope: owner.noun === "group" && input.scope === "one" ? "one" : "all" } : null;
        await rows.save(id, { pause }, actor.userId, at);
        await gate.audit(repos, actor, meta, { ...probe, targetLabel: found.name, reason: `${owner.label}: ${input.paused ? `paused (${pause?.scope === "one" ? "only the group's own accounts" : owner.noun === "group" ? "the group and its hotels" : "the hotel"}): ${reason}` : "resumed"}: ${found.name}`, before: { paused: was !== null }, after: { paused: pause !== null } });
        return { name: found.name, view: view(id, await rows.get(id), await addressOf(repos, found.slug)) };
      });
    },

    /** One test mail with the SAVED account of that owner; the result is kept as its last test (no recipient, no password). */
    async test(session: VerifiedSession, id: string, which: "ses" | "gmail", to: string, meta: PlatformMeta): Promise<PlatformSmtpTestResult> {
      const probe = { action: "settings_updated", entity: "platform", entityId: null } as const;
      await gate.superWrite(session, meta, probe);
      const address = to.trim().toLowerCase();
      if (!isMailAddress(address)) throw new AppError("VALIDATION_FAILED", E.to, { fields: { to: E.to } });
      const loaded = await unit.run(async (repos) => {
        await gate.actor(repos, session);
        const found = await owner.find(repos, id, now());
        return { found, row: await owner.rows(repos).get(id), platformSes: await platformSesOf(repos, key), address: await addressOf(repos, found.slug) };
      });
      const notSet = which === "ses" ? owner.sesNotSet : owner.gmailNotSet;
      // Google needs its own login; SES is automatic, so it can be tested with nothing saved (it sends through the platform's SES, as the owner's automatic address)
      if (which === "gmail" && (!loaded.row || text(loaded.row.gmailUser) === "")) throw new AppError("VALIDATION_FAILED", notSet, { fields: { to: notSet } });
      const empty: AccountRow = { sesRegion: null, sesUser: null, sesPassword: null, sesFrom: null, gmailUser: null, gmailPassword: null, fromName: null, replyTo: null, sesTest: null, gmailTest: null, updatedAt: null };
      const read = owner.read(id, loaded.row ?? empty, key, loaded.found.name, loaded.platformSes, loaded.address);
      const config = which === "ses" ? read.ses : read.gmail;
      let result: SmtpTestResult;
      if (!config) {
        const unreadable = which === "ses" ? read.sesUnreadable : read.gmailUnreadable;
        result = { ok: false, message: unreadable ? (key === null ? platformCopy.hotelMail.keyMissing : platformCopy.hotelMail.passwordUnreadable) : notSet };
      } else {
        const subject = "EasyHotelSolutions test email";
        const body = `This is a test email for ${loaded.found.name} (Platform > Hotel mail, ${owner.noun === "group" ? "group, " : ""}${which === "ses" ? "Amazon SES" : "Google"}). If you can read it, this login works.`;
        result = await (deps.hotelMail?.sendTest ?? ((c, t) => sendTestMail(c, t, { subject, body })))(config, address);
      }
      const at = now();
      const kept: PlatformSmtpTestResult = { at: at.toISOString(), ok: result.ok, message: result.message, ...(result.hint ? { hint: result.hint } : {}) };
      await unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        await owner.rows(repos).setTest(id, which, kept, at);
        await gate.audit(repos, actor, meta, { ...probe, targetLabel: loaded.found.name, reason: `${owner.label} test (${which === "ses" ? "SES" : "Google"}) ${result.ok ? "sent" : "failed"}: ${loaded.found.name}` });
      });
      return kept;
    },
  };
}

export function createHotelMailService(deps: ConsoleDeps & { hotelMail?: HotelMailDeps }) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);
  const base = createAccountsService(deps, hotelOwner);
  const asHotel = (id: string, r: { name: string; view: AccountsView }): PlatformHotelMail => ({ hotelId: id, hotelName: r.name, ...r.view });
  return {
    /** Where received mail comes in (Amazon SES receiving): the address to give the SNS subscription, never a secret of AWS. Super Admin only. */
    async inbound(session: VerifiedSession): Promise<{ address: string | null; topicSet: boolean }> {
      gate.superRead(session);
      return deps.hotelMail?.inbound?.() ?? { address: null, topicSet: false };
    },

    /** Every live hotel with which of its own accounts are set up (Super Admin). */
    async list(session: VerifiedSession): Promise<PlatformHotelMailSummary[]> {
      gate.superRead(session);
      return unit.run(async (repos) => {
        await gate.actor(repos, session);
        const setUp = await base.setUp(repos);
        const domain = await sendingDomainFrom(repos);
        return (await repos.hotels.list({ words: [] }, now()))
          .filter((h) => h.status === "active" || h.status === "suspended")
          .map((h) => ({ hotelId: h.id, name: h.name, city: h.city, status: h.status, ses: setUp.get(h.id)?.ses === true, gmail: setUp.get(h.id)?.gmail === true, pause: setUp.get(h.id)?.pause ?? null, address: mailAddressOf(h.slug, domain) }))
          .sort((a, b) => a.name.localeCompare(b.name));
      });
    },
    /** One hotel's accounts (never a password). */
    get: async (session: VerifiedSession, hotelId: string): Promise<PlatformHotelMail> => asHotel(hotelId, await base.get(session, hotelId)),
    save: async (session: VerifiedSession, hotelId: string, input: PlatformHotelMailInput, meta: PlatformMeta): Promise<PlatformHotelMail> => asHotel(hotelId, await base.save(session, hotelId, input, meta)),
    setPause: async (session: VerifiedSession, hotelId: string, input: PlatformMailPauseInput, meta: PlatformMeta): Promise<PlatformHotelMail> => asHotel(hotelId, await base.setPause(session, hotelId, input, meta)),
    test: base.test,
  };
}

export type HotelMailService = ReturnType<typeof createHotelMailService>;

/** The same for GROUPS (Platform > Hotel mail, groups): the accounts a group's hotels use when a hotel has none of its own. */
export function createGroupMailService(deps: ConsoleDeps & { hotelMail?: HotelMailDeps }) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);
  const base = createAccountsService(deps, groupOwner);
  const asGroup = (id: string, r: { name: string; view: AccountsView }): PlatformGroupMail => ({ groupId: id, groupName: r.name, ...r.view });
  return {
    /** Every live group with which of its own accounts are set up (Super Admin). */
    async list(session: VerifiedSession): Promise<PlatformGroupMailSummary[]> {
      gate.superRead(session);
      return unit.run(async (repos) => {
        await gate.actor(repos, session);
        const setUp = await base.setUp(repos);
        const domain = await sendingDomainFrom(repos);
        return (await repos.groups.list())
          .filter((g) => g.status === "active" || g.status === "suspended")
          .map((g) => ({ groupId: g.id, name: g.name, hotels: g.hotelIds.length, hotelIds: [...g.hotelIds], status: g.status, ses: setUp.get(g.id)?.ses === true, gmail: setUp.get(g.id)?.gmail === true, pause: setUp.get(g.id)?.pause ?? null, address: mailAddressOf(g.slug, domain) }))
          .sort((a, b) => a.name.localeCompare(b.name));
      });
    },
    get: async (session: VerifiedSession, groupId: string): Promise<PlatformGroupMail> => asGroup(groupId, await base.get(session, groupId)),
    save: async (session: VerifiedSession, groupId: string, input: PlatformHotelMailInput, meta: PlatformMeta): Promise<PlatformGroupMail> => asGroup(groupId, await base.save(session, groupId, input, meta)),
    setPause: async (session: VerifiedSession, groupId: string, input: PlatformMailPauseInput, meta: PlatformMeta): Promise<PlatformGroupMail> => asGroup(groupId, await base.setPause(session, groupId, input, meta)),
    test: base.test,
  };
}

export type GroupMailService = ReturnType<typeof createGroupMailService>;

import "server-only";
import type {
  CentralCompanyDetail, CentralCompanyInput, CentralDeleteInput, CentralGstDetail, CentralGuestDetail, CentralGuestInput, CentralLoginDetail, CentralLoginInput, CentralLoginPatch,
} from "@shared/dashboards/central";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { CentralConsoleUnit, CompanyWrite, GuestWrite } from "../../repos/centralConsole";
import { centralMobile } from "../../repos/centralProfiles";
import type { PlatformAccountRow, PlatformConsoleRepos } from "../../repos/platformConsole";
import type { AdminCredentials } from "../auth/credentialPort";
import { createGate, type AuditInput, type PlatformMeta } from "./access";
import { EMAIL_RE, Fields, GSTIN_RE, USERNAME_RE, checkAdmin, failIfAny, lower, storedMobile } from "./validate";

// The writes of the Central tabs (MJ, 3 Nov 2026: "full CRUD in all"; contract ui-shared/dashboards/central.ts). Super Admin only, never an API key, never a visit inside a hotel. Every
// write is ONE audit line in the same transaction: who, which tab, which record, what, and the NAMES of the fields changed (never a value). A delete (a profile or a GST record: hidden, not
// removed; a login: closed) asks for the record's name typed out. A login is made, changed and closed through the existing account side (the account repository and the credential port:
// a password is never written, shown or logged here). Guest and company profiles and GST records are the platform's own rows: a hotel's copy is never touched.

export interface CentralWriteDeps {
  unit: CentralConsoleUnit;
  now: () => Date;
  /** The credential side for ONE unit (the invitation mail, an e-mail change); compose passes the platform console's own. */
  credentials: (repos: PlatformConsoleRepos) => AdminCredentials;
  /** The GST lookup service (it saves centrally): create looks up now, refresh asks the provider again. */
  gst: { lookup(session: VerifiedSession, gstin: string, options?: { refresh?: boolean }): Promise<{ message: string; from: string; entry: { gstin: string } | null; check: { ok: boolean } }> };
  detail: (session: VerifiedSession, tab: "logins" | "guests" | "companies" | "gst", id: string) => Promise<unknown>;
}

const E = {
  mobile: "Enter a ten digit Indian mobile number (starting 6 to 9).",
  email: "Enter a valid email address.",
  name: "Enter a name (up to 100 characters).",
  gstin: "This is not a GSTIN. It looks like 24ABCDE1234F1Z5.",
  confirm: "Type the name exactly as shown to confirm.",
  noTables: "Guest and company profiles are not set up on this database yet.",
  restoreFirst: "This record is deleted. Restore it before changing it.",
  hasLogin: "This profile has a sign-in. Delete the login, or move it, before deleting the profile.",
} as const;

const clean = (v: string | null | undefined, max: number, f: Fields, key: string): string | null | undefined => {
  if (v === undefined || v === null) return v;
  const t = v.trim();
  if (Array.from(t).length > max) f[key] = `Use at most ${max} characters.`;
  return t === "" ? null : t;
};
const emailOf = (v: string | null | undefined, f: Fields): string | null | undefined => {
  const t = clean(v, 254, f, "email");
  if (typeof t === "string") {
    const e = t.toLowerCase();
    if (!EMAIL_RE.test(e)) f.email = E.email;
    return e;
  }
  return t;
};
const mobileOf = (v: string | null | undefined, f: Fields): string | null | undefined => {
  if (v === undefined || v === null || v.trim() === "") return v === undefined ? undefined : null;
  const m = centralMobile(v);
  if (!m) f.mobile = E.mobile;
  return m;
};
const names = (o: Record<string, unknown>): string[] => Object.keys(o).filter((k) => o[k] !== undefined);

export function createCentralWrites(deps: CentralWriteDeps) {
  const { unit, now } = deps;
  const gate = createGate({ run: (work) => unit.run((r) => work(r.console)) }, now);

  /** Super Admin only; an API key or a visit inside a hotel is refused before anything else. A refused write is audited as failed. */
  async function allow(session: VerifiedSession, meta: PlatformMeta, probe: AuditInput): Promise<void> {
    if (session.client === "token" || session.token !== undefined || session.visit !== undefined) throw new AppError("FORBIDDEN");
    await gate.superWrite(session, meta, probe);
  }
  const probeOf = (action: AuditInput["action"], id: string | null): AuditInput => ({ action, entity: "platform", entityId: id });
  const typed = (given: string, expected: string): void => {
    if (given.trim() !== expected.trim()) throw new AppError("VALIDATION_FAILED", E.confirm, { fields: { confirmName: E.confirm } });
  };
  const reasonOf = (input: CentralDeleteInput): string | null => {
    const r = (input.reason ?? "").trim();
    if (Array.from(r).length > 300) throw new AppError("VALIDATION_FAILED", "Use at most 300 characters.", { fields: { reason: "Use at most 300 characters." } });
    return r === "" ? null : r;
  };

  async function profilesReady(r: { central: { available(): Promise<{ profiles: boolean }> } }): Promise<void> {
    if (!(await r.central.available()).profiles) throw new AppError("CONFLICT", E.noTables);
  }

  /* ------------------------------------------------------------ guests */
  function guestFields(input: CentralGuestInput, requireName: boolean): GuestWrite {
    const f: Fields = {};
    const name = clean(input.name, 100, f, "name");
    if ((requireName && !name) || (input.name !== undefined && !name)) f.name = E.name;
    const out: GuestWrite = {
      ...(name ? { displayName: name } : {}),
      ...(input.mobile !== undefined ? { mobile: mobileOf(input.mobile, f) ?? null } : {}),
      ...(input.email !== undefined ? { email: emailOf(input.email, f) ?? null } : {}),
      ...(input.address !== undefined ? { address: clean(input.address, 255, f, "address") ?? null } : {}),
      ...(input.city !== undefined ? { city: clean(input.city, 100, f, "city") ?? null } : {}),
    };
    failIfAny(f);
    return out;
  }

  async function createGuest(session: VerifiedSession, input: CentralGuestInput, meta: PlatformMeta): Promise<CentralGuestDetail> {
    await allow(session, meta, probeOf("central_created", null));
    const fields = guestFields(input, true);
    const id = await unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      await profilesReady(r);
      const made = await r.central.guests.create({ ...fields, displayName: fields.displayName as string }, now());
      await gate.audit(r.console, actor, meta, { ...probeOf("central_created", made), targetLabel: `Guest profile: ${fields.displayName}`, after: { tab: "guests", fields: names(fields as Record<string, unknown>) } });
      return made;
    });
    return (await deps.detail(session, "guests", id)) as CentralGuestDetail;
  }

  async function updateGuest(session: VerifiedSession, id: string, input: CentralGuestInput, meta: PlatformMeta): Promise<CentralGuestDetail> {
    await allow(session, meta, probeOf("central_updated", id));
    const patch = guestFields(input, false);
    await unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      await profilesReady(r);
      const cur = await r.central.guests.get(id);
      if (!cur) throw new AppError("NOT_FOUND");
      if (cur.deletedAt) throw new AppError("CONFLICT", E.restoreFirst);
      if (!(await r.central.guests.update(id, patch))) throw new AppError("NOT_FOUND");
      await gate.audit(r.console, actor, meta, { ...probeOf("central_updated", id), targetLabel: `Guest profile: ${patch.displayName ?? cur.name}`, after: { tab: "guests", fields: names(patch as Record<string, unknown>) } });
    });
    return (await deps.detail(session, "guests", id)) as CentralGuestDetail;
  }

  async function deleteGuest(session: VerifiedSession, id: string, input: CentralDeleteInput, meta: PlatformMeta): Promise<{ id: string }> {
    await allow(session, meta, probeOf("central_deleted", id));
    const reason = reasonOf(input);
    return unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      await profilesReady(r);
      const cur = await r.central.guests.get(id);
      if (!cur) throw new AppError("NOT_FOUND");
      if (cur.deletedAt) throw new AppError("CONFLICT", "This profile is already deleted.");
      typed(input.confirmName, cur.name);
      if (cur.hasLogin) throw new AppError("CONFLICT", E.hasLogin);
      if (!(await r.central.guests.markDeleted(id, actor.userId, reason, now()))) throw new AppError("CONFLICT", E.hasLogin);
      await gate.audit(r.console, actor, meta, { ...probeOf("central_deleted", id), targetLabel: `Guest profile: ${cur.name}`, reason, after: { tab: "guests" } });
      return { id };
    });
  }

  async function restoreGuest(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<CentralGuestDetail> {
    await allow(session, meta, probeOf("central_restored", id));
    await unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      await profilesReady(r);
      const cur = await r.central.guests.get(id);
      if (!cur || !cur.deletedAt) throw new AppError("NOT_FOUND");
      await r.central.guests.restore(id);
      await gate.audit(r.console, actor, meta, { ...probeOf("central_restored", id), targetLabel: `Guest profile: ${cur.name}`, after: { tab: "guests" } });
    });
    return (await deps.detail(session, "guests", id)) as CentralGuestDetail;
  }

  /* ------------------------------------------------------------ companies */
  function companyFields(input: CentralCompanyInput, requireName: boolean): CompanyWrite {
    const f: Fields = {};
    const name = clean(input.name, 100, f, "name");
    if ((requireName && !name) || (input.name !== undefined && !name)) f.name = E.name;
    let gstin: string | null | undefined = clean(input.gstin, 50, f, "gstin");
    if (typeof gstin === "string") {
      gstin = gstin.replace(/\s+/g, "").toUpperCase();
      if (!GSTIN_RE.test(gstin)) f.gstin = E.gstin;
    }
    const out: CompanyWrite = {
      ...(name ? { name } : {}),
      ...(input.gstin !== undefined ? { gstin: gstin ?? null } : {}),
      ...(input.mainContactName !== undefined ? { mainContactName: clean(input.mainContactName, 100, f, "mainContactName") ?? null } : {}),
      ...(input.email !== undefined ? { email: emailOf(input.email, f) ?? null } : {}),
      ...(input.mobile !== undefined ? { mobile: clean(input.mobile, 15, f, "mobile") ?? null } : {}),
      ...(input.landline !== undefined ? { landline: clean(input.landline, 15, f, "landline") ?? null } : {}),
      ...(input.address !== undefined ? { address: clean(input.address, 100, f, "address") ?? null } : {}),
      ...(input.pincode !== undefined ? { pincode: clean(input.pincode, 20, f, "pincode") ?? null } : {}),
      ...(input.country !== undefined ? { country: clean(input.country, 100, f, "country") ?? null } : {}),
    };
    failIfAny(f);
    return out;
  }

  async function createCompany(session: VerifiedSession, input: CentralCompanyInput, meta: PlatformMeta): Promise<CentralCompanyDetail> {
    await allow(session, meta, probeOf("central_created", null));
    const fields = companyFields(input, true);
    const id = await unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      await profilesReady(r);
      const made = await r.central.companies.create({ ...fields, name: fields.name as string }, now());
      await gate.audit(r.console, actor, meta, { ...probeOf("central_created", made), targetLabel: `Company profile: ${fields.name}`, after: { tab: "companies", fields: names(fields as Record<string, unknown>) } });
      return made;
    });
    return (await deps.detail(session, "companies", id)) as CentralCompanyDetail;
  }

  async function updateCompany(session: VerifiedSession, id: string, input: CentralCompanyInput, meta: PlatformMeta): Promise<CentralCompanyDetail> {
    await allow(session, meta, probeOf("central_updated", id));
    const patch = companyFields(input, false);
    await unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      await profilesReady(r);
      const cur = await r.central.companies.get(id);
      if (!cur) throw new AppError("NOT_FOUND");
      if (cur.deletedAt) throw new AppError("CONFLICT", E.restoreFirst);
      if (!(await r.central.companies.update(id, patch))) throw new AppError("NOT_FOUND");
      await gate.audit(r.console, actor, meta, { ...probeOf("central_updated", id), targetLabel: `Company profile: ${patch.name ?? cur.name}`, after: { tab: "companies", fields: names(patch as Record<string, unknown>) } });
    });
    return (await deps.detail(session, "companies", id)) as CentralCompanyDetail;
  }

  async function deleteCompany(session: VerifiedSession, id: string, input: CentralDeleteInput, meta: PlatformMeta): Promise<{ id: string }> {
    await allow(session, meta, probeOf("central_deleted", id));
    const reason = reasonOf(input);
    return unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      await profilesReady(r);
      const cur = await r.central.companies.get(id);
      if (!cur) throw new AppError("NOT_FOUND");
      if (cur.deletedAt) throw new AppError("CONFLICT", "This profile is already deleted.");
      typed(input.confirmName, cur.name);
      if (cur.hasLogin) throw new AppError("CONFLICT", E.hasLogin);
      if (!(await r.central.companies.markDeleted(id, actor.userId, reason, now()))) throw new AppError("CONFLICT", E.hasLogin);
      await gate.audit(r.console, actor, meta, { ...probeOf("central_deleted", id), targetLabel: `Company profile: ${cur.name}`, reason, after: { tab: "companies" } });
      return { id };
    });
  }

  async function restoreCompany(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<CentralCompanyDetail> {
    await allow(session, meta, probeOf("central_restored", id));
    await unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      await profilesReady(r);
      const cur = await r.central.companies.get(id);
      if (!cur || !cur.deletedAt) throw new AppError("NOT_FOUND");
      await r.central.companies.restore(id);
      await gate.audit(r.console, actor, meta, { ...probeOf("central_restored", id), targetLabel: `Company profile: ${cur.name}`, after: { tab: "companies" } });
    });
    return (await deps.detail(session, "companies", id)) as CentralCompanyDetail;
  }

  /* ------------------------------------------------------------ GST records */
  async function lookedUp(session: VerifiedSession, gstin: string, meta: PlatformMeta, refresh: boolean, action: AuditInput["action"]): Promise<{ id: string; gstin: string }> {
    const result = await deps.gst.lookup(session, gstin, { refresh });
    if (!result.check.ok) throw new AppError("VALIDATION_FAILED", result.message, { fields: { gstin: result.message } });
    if (result.from !== "provider" && !(result.from === "saved" && !refresh)) throw new AppError("CONFLICT", result.from === "saved" ? "The lookup service did not answer, so the saved record was kept." : result.message);
    if (!result.entry) throw new AppError("CONFLICT", result.message);
    const found = result.entry.gstin;
    return unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      const id = await r.central.gst.idOf(found);
      if (!id) throw new AppError("NOT_FOUND");
      await gate.audit(r.console, actor, meta, { ...probeOf(action, id), targetLabel: `GST record: ${found}`, after: { tab: "gst", from: result.from } });
      return { id, gstin: found };
    });
  }

  async function createGst(session: VerifiedSession, gstin: string, meta: PlatformMeta): Promise<CentralGstDetail> {
    await allow(session, meta, probeOf("central_created", null));
    const { id } = await lookedUp(session, gstin, meta, false, "central_created");
    return (await deps.detail(session, "gst", id)) as CentralGstDetail;
  }

  async function refreshGst(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<CentralGstDetail> {
    await allow(session, meta, probeOf("central_updated", id));
    const cur = await unit.run(async (r) => {
      await gate.actor(r.console, session);
      return r.central.gst.get(id);
    });
    if (!cur) throw new AppError("NOT_FOUND");
    if (cur.deletedAt) throw new AppError("CONFLICT", E.restoreFirst);
    await lookedUp(session, cur.gstin, meta, true, "central_updated");
    return (await deps.detail(session, "gst", id)) as CentralGstDetail;
  }

  async function deleteGst(session: VerifiedSession, id: string, input: CentralDeleteInput, meta: PlatformMeta): Promise<{ id: string }> {
    await allow(session, meta, probeOf("central_deleted", id));
    const reason = reasonOf(input);
    return unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      const cur = await r.central.gst.get(id);
      if (!cur) throw new AppError("NOT_FOUND");
      if (cur.deletedAt) throw new AppError("CONFLICT", "This record is already deleted.");
      typed(input.confirmName, cur.gstin);
      await r.central.gst.markDeleted(id, actor.userId, reason, now());
      await gate.audit(r.console, actor, meta, { ...probeOf("central_deleted", id), targetLabel: `GST record: ${cur.gstin}`, reason, after: { tab: "gst" } });
      return { id };
    });
  }

  async function restoreGst(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<CentralGstDetail> {
    await allow(session, meta, probeOf("central_restored", id));
    await unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      const cur = await r.central.gst.get(id);
      if (!cur || !cur.deletedAt) throw new AppError("NOT_FOUND");
      await r.central.gst.restore(id);
      await gate.audit(r.console, actor, meta, { ...probeOf("central_restored", id), targetLabel: `GST record: ${cur.gstin}`, after: { tab: "gst" } });
    });
    return (await deps.detail(session, "gst", id)) as CentralGstDetail;
  }

  /* ------------------------------------------------------------ logins */
  const ROLE_KEY = { platform_admin: "viewer", hotel_admin: "admin", hotel_user: "viewer" } as const;

  /** A login as the detail shows it, from the account row when the central list cannot see it yet (the in-memory double). */
  function loginFrom(a: PlatformAccountRow): CentralLoginDetail {
    return {
      id: a.id, username: a.username, displayName: a.displayName, roleType: a.accountRole as CentralLoginDetail["roleType"], status: a.status === "disabled" ? "disabled" : a.status === "invited" || a.status === "pending_approval" ? "invited" : "active",
      hotels: a.hotelName ? [a.hotelName] : [], lastLoginAt: a.lastLoginAt ? a.lastLoginAt.toISOString() : null, locked: a.blocked, closed: false, createdAt: a.createdAt.toISOString(),
      hotelLinks: a.hotelId ? [{ hotelId: a.hotelId, hotelName: a.hotelName ?? "", status: "active" }] : [], blockedKind: null, blockedAt: null, lockedUntil: null, failedAttempts: 0, lockLevel: 0,
      mustChangePassword: true, codeRequired: false, passwordChangedAt: null, activeSessions: 0, profile: null,
    };
  }
  const loginDetail = async (session: VerifiedSession, id: string, row: PlatformAccountRow | null): Promise<CentralLoginDetail> => {
    try {
      return (await deps.detail(session, "logins", id)) as CentralLoginDetail;
    } catch (e) {
      if (row) return loginFrom(row);
      throw e;
    }
  };

  async function createLogin(session: VerifiedSession, input: CentralLoginInput, meta: PlatformMeta): Promise<CentralLoginDetail> {
    await allow(session, meta, probeOf("central_created", null));
    const f: Fields = {};
    if (!(input.roleType in ROLE_KEY)) f.roleType = "Choose Platform Admin, Hotel Admin or Hotel User. Other logins are made on their own page.";
    checkAdmin({ name: input.displayName ?? "", username: input.username ?? "", email: input.email ?? "", mobile: input.mobile ?? "" }, "", f);
    if (!f.username && !USERNAME_RE.test(lower(input.username ?? ""))) f.username = "Use 3 to 30 letters, digits, dots or underscores.";
    const needsHotel = input.roleType === "hotel_admin" || input.roleType === "hotel_user";
    if (needsHotel && !input.hotelId) f.hotelId = "Choose the hotel this login belongs to.";
    failIfAny(f);
    const mobile = storedMobile(input.mobile) as string;
    const made = await unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      const at = now();
      const g: Fields = {};
      if (await r.console.accounts.usernameTaken(lower(input.username))) g.username = "That username is already used.";
      if (await r.console.accounts.emailTaken(lower(input.email))) g.email = "That email address is already used by another account.";
      if (await r.console.accounts.mobileTaken(mobile)) g.mobile = "Another account already uses this mobile number.";
      if (needsHotel && !(await r.console.hotels.get(input.hotelId as string, at))) g.hotelId = "That hotel does not exist.";
      failIfAny(g);
      const id = await r.console.accounts.create(
        { username: lower(input.username), email: lower(input.email), mobile, displayName: input.displayName.trim(), accountRole: input.roleType, roleKey: ROLE_KEY[input.roleType], hotelId: needsHotel ? (input.hotelId as string) : null },
        actor.userId, at,
      );
      // the temporary password is made and mailed by the credential side; it is not returned, shown or logged here
      await deps.credentials(r.console).issueInvite(id);
      await gate.audit(r.console, actor, meta, { ...probeOf("central_created", id), targetLabel: `Login: ${lower(input.username)}`, after: { tab: "logins", fields: ["username", "displayName", "email", "mobile", "roleType", ...(needsHotel ? ["hotelId"] : [])] } });
      return { id, row: await r.console.accounts.get(id) };
    });
    return loginDetail(session, made.id, made.row);
  }

  async function updateLogin(session: VerifiedSession, id: string, patch: CentralLoginPatch, meta: PlatformMeta): Promise<CentralLoginDetail> {
    await allow(session, meta, probeOf("central_updated", id));
    const f: Fields = {};
    const name = patch.displayName === undefined ? undefined : patch.displayName.trim();
    if (name !== undefined && (name === "" || Array.from(name).length > 100)) f.displayName = E.name;
    const email = patch.email === undefined ? undefined : lower(patch.email);
    if (email !== undefined && (email === "" || !EMAIL_RE.test(email) || email.length > 254)) f.email = E.email;
    const mobile = patch.mobile === undefined ? undefined : storedMobile(patch.mobile);
    if (patch.mobile !== undefined && !mobile) f.mobile = E.mobile;
    failIfAny(f);
    const row = await unit.run(async (r) => {
      const actor = await gate.actor(r.console, session);
      const cur = await r.console.accounts.get(id, { forUpdate: true });
      if (!cur) throw new AppError("NOT_FOUND");
      const g: Fields = {};
      if (email !== undefined && email !== (cur.email ?? "").toLowerCase() && (await r.console.accounts.emailTaken(email))) g.email = "That email address is already used by another account.";
      if (mobile && mobile !== cur.mobile && (await r.console.accounts.mobileTaken(mobile))) g.mobile = "Another account already uses this mobile number.";
      failIfAny(g);
      const own: Record<string, unknown> = {};
      if (name !== undefined) own.displayName = name;
      if (mobile) own.mobile = mobile;
      if (Object.keys(own).length > 0) await r.console.auth.users.update(id, own);
      if (email !== undefined && email !== (cur.email ?? "").toLowerCase()) {
        const res = await deps.credentials(r.console).changeEmail(id, email);
        if (!res.ok) throw new AppError("VALIDATION_FAILED", res.message, { fields: { email: res.message } });
      }
      await gate.audit(r.console, actor, meta, { ...probeOf("central_updated", id), targetLabel: `Login: ${cur.username}`, after: { tab: "logins", fields: names({ displayName: name, email, mobile: patch.mobile }) } });
      return r.console.accounts.get(id);
    });
    return loginDetail(session, id, row);
  }

  async function deleteLogin(session: VerifiedSession, id: string, input: CentralDeleteInput, meta: PlatformMeta): Promise<{ id: string }> {
    await allow(session, meta, probeOf("central_deleted", id));
    const reason = reasonOf(input);
    const outcome = await unit.run(async (r): Promise<{ ok: { id: string } } | { refused: AppError; label: string }> => {
      const actor = await gate.actor(r.console, session);
      const cur = await r.console.accounts.get(id, { forUpdate: true });
      if (!cur) throw new AppError("NOT_FOUND");
      typed(input.confirmName, cur.username);
      const refuse = (message: string) => ({ refused: new AppError("CONFLICT", message), label: cur.username });
      if (cur.id === actor.userId) return refuse("You cannot delete your own login.");
      if (cur.accountRole === "super_admin" && (await r.console.accounts.activeSuperAdmins()) <= 1) return refuse("This is the last active Super Admin. Make another Super Admin first.");
      if (cur.hotelId && (await r.console.accounts.holdsOwnerRole(cur.id, cur.hotelId))) return refuse("This is the hotel's owner account. Transfer the SuperAdmin role first.");
      if (cur.accountRole === "super_admin" && !actor.isSuper) return refuse("Only a Super Admin can delete a Super Admin.");
      const at = now();
      // closed, not removed: the name stays on everything the account recorded; every sign-in of it ends now
      await r.console.auth.users.update(id, { deletedAt: at });
      await r.console.accounts.endSessions(id, at);
      await gate.audit(r.console, actor, meta, { ...probeOf("central_deleted", id), targetLabel: `Login: ${cur.username}`, reason, after: { tab: "logins" } });
      return { ok: { id } };
    });
    if ("refused" in outcome) {
      // a refused delete is kept in the audit trail as failed (in its own unit)
      await gate.refuse(session, meta, { ...probeOf("central_deleted", id), targetLabel: `Login: ${outcome.label}` }, outcome.refused);
      throw outcome.refused;
    }
    return outcome.ok;
  }

  return { createGuest, updateGuest, deleteGuest, restoreGuest, createCompany, updateCompany, deleteCompany, restoreCompany, createGst, refreshGst, deleteGst, restoreGst, createLogin, updateLogin, deleteLogin };
}

export type CentralWrites = ReturnType<typeof createCentralWrites>;

import "server-only";
import type { Page } from "@shared/dashboards/common";
import type {
  PlatformGroupChange, PlatformHotelChange, PlatformInvitation, PlatformInvitationInput, PlatformInvitationPage, PlatformInvitationSent, PlatformInvitationStatus,
  PlatformInvitationType, PlatformInviteProblem, PlatformOnboardingForm, PlatformOnboardingResult, PlatformPublicInvitation,
} from "@shared/dashboards/platform";
import { APPROVAL_EMAIL_NOTE, INVITATION_VALID_HOURS, INVITE_LINK_NOTE, PLATFORM_STATES, gstCodeOfState, inviteLink, normaliseMobile, passwordProblem, platformCopy, slugFromName } from "@shared/dashboards/platform";
import type { VerifiedSession } from "../../auth/session";
import { hashInviteToken } from "../../crypto/hash";
import { AppError } from "../../errors";
import { ProvisionError } from "../../provisioner/port";
import type { PlatformConsoleRepos, PlatformGroupRow, PlatformHotelRow } from "../../repos/platformConsole";
import type { InvitationRow, PendingAdmin } from "../../repos/platformInvitations";
import { RepoError } from "../../repos/types";
import { signInLink, type MailPayload } from "../auth/mail";
import { auditRow, createGate, type Actor, type AuditInput, type PlatformMeta } from "./access";
import { byName, paged, words, type InviteDeps } from "./context";
import { groupLimitOf, placesTaken } from "./groupLimit";
import { reasonFor, transition } from "./lifecycle";
import { EMAIL_RE, GSTIN_RE, MOBILE_TAKEN, failIfAny, lower, slugProblem, storedMobile, checkAdmin, type Fields } from "./validate";
import { groupView, hotelView } from "./views";
import { groupConsoleCopy } from "@shared/dashboards/groupConsole";

// Invitations, the PUBLIC onboarding form and the approval of what it created (docs/BACKEND.md 14.4, 14.1, 14.3). The token is 256 random bits sent
// once by e-mail; only its keyed hash is stored, no list or answer carries it, and every unknown, replaced or malformed token gets the same answer.
// The form creates a PENDING hotel (or group) and its first account, which cannot sign in until a Platform or Super Admin approves; approval builds the
// hotel's schema through the provisioner (owner side) and then activates the account. Nothing here reads a hotel's data.

const E = platformCopy.errors;
const C = platformCopy;
const PIN_RE = /^[1-9]\d{5}$/;
const LOGO_RE = /\.(png|jpe?g|svg|webp)$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HOUR_MS = 3_600_000;

const INVITER: Record<string, PlatformInvitation["invitedByRole"]> = { super_admin: "super_admin", platform_admin: "platform_admin", group_hotel_admin: "group_admin" };

/** The refusal of a token, as the public page needs it: details.serverCode names the friendly page. */
function tokenError(code: "NOT_FOUND" | "CONFLICT", serverCode: PlatformInviteProblem, message: string): AppError {
  return new AppError(code, message, { serverCode });
}

export function createInvitationService(deps: InviteDeps) {
  const { unit, now } = deps;
  const gate = deps.gate ?? createGate(unit, now);

  const statusOf = (r: InvitationRow, at: Date): PlatformInvitationStatus => {
    if (r.status === "accepted") return "submitted";
    if (r.status === "revoked") return "cancelled";
    if (r.status === "expired" || r.expiresAt.getTime() <= at.getTime()) return "expired";
    return r.openedAt ? "opened" : "sent";
  };

  function view(r: InvitationRow, groups: ReadonlyMap<string, PlatformGroupRow>, at: Date): PlatformInvitation {
    // a 'group' invitation points at its group only once that group is approved; a member hotel's invitation names the group it joins
    const g = r.type === "group" ? (r.madeGroupId ? groups.get(r.madeGroupId) : undefined) : r.groupId ? groups.get(r.groupId) : undefined;
    const shown = r.type === "group" ? (g && g.status === "active" ? g : undefined) : g;
    return {
      id: r.id, hotelName: r.hotelName, contactName: r.contactName, email: r.email, groupId: shown?.id ?? null, groupName: shown?.name ?? null, type: r.type,
      status: statusOf(r, at), createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), openedAt: r.openedAt?.toISOString() ?? null,
      submittedAt: r.submittedAt?.toISOString() ?? null, cancelledAt: r.revokedAt?.toISOString() ?? null, sentBy: r.invitedByName, invitedByName: r.invitedByName,
      invitedByRole: INVITER[r.invitedByRole] ?? "platform_admin", resendCount: r.resendCount, hotelId: r.hotelId,
    };
  }

  const groupMap = async (repos: PlatformConsoleRepos): Promise<Map<string, PlatformGroupRow>> => new Map((await repos.groups.list()).map((g) => [g.id, g]));

  async function mail(repos: PlatformConsoleRepos, to: { userId: string | null; email: string }, kind: "invitation" | "onboarding_waiting" | "onboarding_approved" | "onboarding_rejected", payload: MailPayload): Promise<void> {
    await repos.auth.outbox.enqueue({ userId: to.userId, kind, toEmail: to.email, template: kind.replace(/_/g, "-"), payload: JSON.stringify(payload) }, now());
  }

  async function read<T>(session: VerifiedSession, work: (repos: PlatformConsoleRepos) => Promise<T>): Promise<T> {
    gate.read(session);
    return unit.run(async (repos) => {
      await gate.actor(repos, session);
      return work(repos);
    });
  }

  async function write<T>(session: VerifiedSession, meta: PlatformMeta, probe: AuditInput, work: (repos: PlatformConsoleRepos, actor: Actor) => Promise<T>): Promise<T> {
    await gate.write(session, meta, probe);
    return unit.run(async (repos) => work(repos, await gate.actor(repos, session)));
  }

  /* ------------------------------------------------------------------ the console's invitation pages */

  async function list(session: VerifiedSession, q: { search?: string; status?: "all" | "pending" | PlatformInvitationStatus; type?: "all" | PlatformInvitationType; groupId?: string; page: number; pageSize: number }): Promise<PlatformInvitationPage> {
    return read(session, async (repos) => {
      const at = now();
      const groups = await groupMap(repos);
      const w = words(q.search);
      const base = (await repos.invitations.list())
        .map((r) => view(r, groups, at))
        .filter((i) => !q.groupId || i.groupId === q.groupId)
        .filter((i) => !q.type || q.type === "all" || i.type === q.type)
        .filter((i) => w.every((x) => `${i.hotelName} ${i.contactName} ${i.email} ${i.groupName ?? ""} ${i.invitedByName}`.toLowerCase().includes(x)));
      const n = (s: PlatformInvitationStatus): number => base.filter((i) => i.status === s).length;
      const counts = { all: base.length, pending: n("sent") + n("opened"), sent: n("sent"), opened: n("opened"), submitted: n("submitted"), expired: n("expired"), cancelled: n("cancelled") };
      const status = q.status ?? "all";
      const rows = base.filter((i) => status === "all" || (status === "pending" ? i.status === "sent" || i.status === "opened" : i.status === status));
      return { ...paged(rows, q.page, q.pageSize), counts };
    });
  }

  /** The real server never sends a token to a screen: the link goes by e-mail. */
  async function devLinks(session: VerifiedSession): Promise<{ id: string; token: string }[]> {
    gate.read(session);
    return [];
  }

  const newToken = (): string => deps.newToken();
  const linkFor = (token: string): string => inviteLink(token, deps.publicUrl);

  async function send(session: VerifiedSession, input: PlatformInvitationInput, meta: PlatformMeta): Promise<PlatformInvitationSent> {
    const type: PlatformInvitationType = input.type ?? "individual";
    const f: Fields = {};
    const hotelName = input.hotelName.trim();
    const contactName = input.contactName.trim();
    const email = lower(input.email);
    if (!hotelName) f.hotelName = type === "group" ? E.required.groupName : E.required.hotelName;
    else if (Array.from(hotelName).length > 100) f.hotelName = E.nameLong;
    if (!contactName) f.contactName = E.required.contactName;
    else if (Array.from(contactName).length > 100) f.contactName = E.nameLong;
    if (!email) f.email = E.required.email;
    else if (email.length > 254 || !EMAIL_RE.test(email)) f.email = E.emailFormat;
    if (input.groupId) f.groupId = E.inviteNoGroupForPlatform;
    return write(session, meta, { action: "invitation_sent", entity: "invitation", entityId: null, targetLabel: hotelName }, async (repos, actor) => {
      // only a group's own Group Hotel Admin invites a hotel into that group (that console is built later)
      if (type === "member_hotel") throw new AppError("CONFLICT", E.inviteMemberGroupAdminOnly);
      const at = now();
      await repos.invitations.expireDue(at);
      if (Object.keys(f).length === 0) {
        const clash = await repos.invitations.clashes({ type, groupId: null, hotelName, email, exceptId: null });
        if (clash.email) f.email = E.inviteDuplicate;
        if (clash.name) f.hotelName = type === "group" ? E.inviteDuplicateGroup : E.inviteDuplicateHotel;
      }
      failIfAny(f);
      const token = newToken();
      let id: string;
      try {
        id = await repos.invitations.create({ type, hotelName, contactName, email, groupId: null, invitedBy: actor.userId, invitedByRole: actor.role }, hashInviteToken(deps.hashKey, token), new Date(at.getTime() + INVITATION_VALID_HOURS * HOUR_MS), at);
      } catch (error) {
        if (error instanceof RepoError && error.kind === "unique") throw new AppError("VALIDATION_FAILED", E.inviteDuplicate, { fields: { email: E.inviteDuplicate } });
        throw error;
      }
      await mail(repos, { userId: null, email }, "invitation", { name: contactName, hotelName, invitedBy: actor.name, inviteType: type === "group" ? "group" : "hotel", link: linkFor(token), validHours: INVITATION_VALID_HOURS });
      await gate.audit(repos, actor, meta, { action: "invitation_sent", entity: "invitation", entityId: id, targetLabel: hotelName });
      const row = await repos.invitations.get(id);
      if (!row) throw new AppError("SERVER_ERROR");
      return { invitation: view(row, await groupMap(repos), at), linkNote: INVITE_LINK_NOTE };
    });
  }

  /**
   * A Group Hotel Admin invites a hotel into ITS group (type member_hotel, the group fixed by the caller, never from input). Called only by the group console
   * service, whose gate admits group admins; the same checks, mail, clash rules and audit row as a platform invitation.
   */
  async function sendToGroup(session: VerifiedSession, groupId: string, input: { hotelName: string; contactName: string; email: string }, meta: PlatformMeta): Promise<PlatformInvitationSent> {
    const f: Fields = {};
    const hotelName = input.hotelName.trim();
    const contactName = input.contactName.trim();
    const email = lower(input.email);
    if (!hotelName) f.hotelName = E.required.hotelName;
    else if (Array.from(hotelName).length > 100) f.hotelName = E.nameLong;
    if (!contactName) f.contactName = E.required.contactName;
    else if (Array.from(contactName).length > 100) f.contactName = E.nameLong;
    if (!email) f.email = E.required.email;
    else if (email.length > 254 || !EMAIL_RE.test(email)) f.email = E.emailFormat;
    return write(session, meta, { action: "invitation_sent", entity: "invitation", entityId: null, groupId, targetLabel: hotelName }, async (repos, actor) => {
      const at = now();
      // the group row is locked: the limit below counts hotels and open invitations, so two quick sends cannot both pass
      const g = await repos.groups.get(groupId, { forUpdate: true });
      if (!g || g.status !== "active") throw new AppError("NOT_FOUND");
      // checked again here, under the lock: an admin removed since the console's own check cannot still send
      if (g.admin?.id !== actor.userId) throw new AppError("FORBIDDEN");
      await repos.invitations.expireDue(at);
      await checkGroupLimit(repos, groupId, at, null);
      if (Object.keys(f).length === 0) {
        const clash = await repos.invitations.clashes({ type: "member_hotel", groupId, hotelName, email, exceptId: null });
        if (clash.email) f.email = E.inviteDuplicate;
        if (clash.name) f.hotelName = E.inviteDuplicateHotel;
      }
      failIfAny(f);
      const token = newToken();
      let id: string;
      try {
        id = await repos.invitations.create({ type: "member_hotel", hotelName, contactName, email, groupId, invitedBy: actor.userId, invitedByRole: "group_hotel_admin" }, hashInviteToken(deps.hashKey, token), new Date(at.getTime() + INVITATION_VALID_HOURS * HOUR_MS), at);
      } catch (error) {
        if (error instanceof RepoError && error.kind === "unique") throw new AppError("VALIDATION_FAILED", E.inviteDuplicate, { fields: { email: E.inviteDuplicate } });
        throw error;
      }
      await mail(repos, { userId: null, email }, "invitation", { name: contactName, hotelName, invitedBy: actor.name, inviteType: "member_hotel", groupName: g.name, link: linkFor(token), validHours: INVITATION_VALID_HOURS });
      await gate.audit(repos, actor, meta, { action: "invitation_sent", entity: "invitation", entityId: id, groupId, targetLabel: hotelName });
      const row = await repos.invitations.get(id);
      if (!row) throw new AppError("SERVER_ERROR");
      return { invitation: view(row, await groupMap(repos), at), linkNote: INVITE_LINK_NOTE };
    });
  }

  async function resend(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformInvitationSent> {
    return write(session, meta, { action: "invitation_resent", entity: "invitation", entityId: id }, async (repos, actor) => {
      const at = now();
      // an invitation into a group: the group row is locked FIRST (the same order as a new invitation and the form), then its place is counted again, because a resend
      // can bring an EXPIRED invitation back to life (expired ones hold no place)
      const peek = await repos.invitations.get(id);
      const groupId = peek?.type === "member_hotel" ? peek.groupId : null;
      if (groupId) {
        const g = await repos.groups.get(groupId, { forUpdate: true });
        if (!g) throw new AppError("NOT_FOUND");
        if (actor.role === "group_hotel_admin" && g.admin?.id !== actor.userId) throw new AppError("FORBIDDEN");
      }
      await repos.invitations.expireDue(at);
      const inv = await repos.invitations.get(id, { forUpdate: true });
      if (!inv) throw new AppError("NOT_FOUND");
      if (inv.status === "accepted" || inv.status === "revoked") throw new AppError("CONFLICT", E.resendNotAllowed);
      if (groupId) await checkGroupLimit(repos, groupId, at, inv.id);
      const clash = await repos.invitations.clashes({ type: inv.type, groupId: inv.groupId, hotelName: inv.hotelName, email: inv.email, exceptId: inv.id });
      if (clash.email || clash.name) throw new AppError("CONFLICT", E.resendDuplicate);
      const token = newToken();
      await repos.invitations.reissue(inv.id, hashInviteToken(deps.hashKey, token), new Date(at.getTime() + INVITATION_VALID_HOURS * HOUR_MS), actor.userId, at);
      await mail(repos, { userId: null, email: inv.email }, "invitation", { name: inv.contactName, hotelName: inv.hotelName, invitedBy: actor.name, inviteType: inv.type === "individual" ? "hotel" : inv.type, ...(inv.groupName ? { groupName: inv.groupName } : {}), link: linkFor(token), validHours: INVITATION_VALID_HOURS });
      await gate.audit(repos, actor, meta, { action: "invitation_resent", entity: "invitation", entityId: inv.id, targetLabel: inv.hotelName });
      const row = await repos.invitations.get(inv.id);
      if (!row) throw new AppError("SERVER_ERROR");
      return { invitation: view(row, await groupMap(repos), at), linkNote: INVITE_LINK_NOTE };
    });
  }

  async function cancel(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformInvitation> {
    return write(session, meta, { action: "invitation_cancelled", entity: "invitation", entityId: id }, async (repos, actor) => {
      const at = now();
      const inv = await repos.invitations.get(id, { forUpdate: true });
      if (!inv) throw new AppError("NOT_FOUND");
      if (inv.status === "accepted" || inv.status === "revoked") throw new AppError("CONFLICT", E.cancelNotAllowed);
      await repos.invitations.revoke(inv.id, actor.userId, at);
      await gate.audit(repos, actor, meta, { action: "invitation_cancelled", entity: "invitation", entityId: inv.id, targetLabel: inv.hotelName });
      const row = await repos.invitations.get(inv.id);
      if (!row) throw new AppError("SERVER_ERROR");
      return view(row, await groupMap(repos), at);
    });
  }

  /* ------------------------------------------------------------------ the PUBLIC page and form */

  /** The link's problem, or null when it can be used. Unknown, malformed and replaced tokens are all the same NOT_FOUND. */
  function refusal(found: { invitation: InvitationRow; link: { expiresAt: Date; usedAt: Date | null; revokedAt: Date | null; revokeReason: string | null } } | null, at: Date): AppError | null {
    if (!found || found.link.revokeReason === "resent") return tokenError("NOT_FOUND", "NOT_FOUND", E.inviteNotFound);
    const { invitation: i, link } = found;
    if (i.status === "revoked" || link.revokeReason === "cancelled") return tokenError("CONFLICT", "CANCELLED", E.inviteCancelled);
    if (i.status === "accepted" || link.usedAt) return tokenError("CONFLICT", "ALREADY_SUBMITTED", E.inviteUsed);
    if (i.status === "expired" || link.revokeReason === "expired" || link.expiresAt.getTime() <= at.getTime()) return tokenError("CONFLICT", "EXPIRED", E.inviteExpired);
    return null;
  }

  async function lookup(repos: PlatformConsoleRepos, token: string) {
    const clean = (token ?? "").trim();
    if (clean === "" || clean.length > 200) return null;
    return repos.invitations.byTokenHash(hashInviteToken(deps.hashKey, clean));
  }

  /** Opens the public page: the first look marks it opened (audited as the invited person). */
  async function openByToken(token: string, meta: PlatformMeta): Promise<PlatformPublicInvitation> {
    return unit.run(async (repos) => {
      const at = now();
      const found = await lookup(repos, token);
      const refused = refusal(found, at);
      if (refused || !found) throw refused ?? tokenError("NOT_FOUND", "NOT_FOUND", E.inviteNotFound);
      const i = found.invitation;
      if (await repos.invitations.markOpened(i.id, at)) {
        await repos.audit.write(auditRow({ userId: null, name: i.contactName, role: null }, meta, { action: "invitation_opened", entity: "invitation", entityId: i.id, targetLabel: i.hotelName }, "success", at));
      }
      const group = i.type === "member_hotel" && i.groupId ? await repos.groups.get(i.groupId) : null;
      return { type: i.type, invitation: { hotelName: i.hotelName, contactName: i.contactName, email: i.email, groupName: group?.name ?? null }, status: "opened", expiresAt: found.link.expiresAt.toISOString() };
    });
  }

  const phoneOk = (raw: string): boolean => {
    const d = raw.replace(/\D+/g, "");
    return d.length >= 10 && d.length <= 12;
  };

  function checkGstin(raw: string, state: string, key: string, stateKey: string, f: Fields, stateRequired: boolean): void {
    const st = state.trim();
    const code = st ? gstCodeOfState(st) : null;
    if (!st && stateRequired) f[stateKey] = E.required.state;
    else if (st && !code) f[stateKey] = E.stateUnknown;
    const gstin = raw.trim().toUpperCase();
    if (!gstin) f[key] = E.required.gstin;
    else if (!GSTIN_RE.test(gstin) || !PLATFORM_STATES.some((s) => s.gstCode === gstin.slice(0, 2))) f[key] = E.gstinFormat;
    else if (code && gstin.slice(0, 2) !== code) f[key] = E.gstinState(code, st);
  }

  /** A hotel's facts (the onboarding form's hotel part, and a group admin's "Add a hotel"): the same sentences as the screen. */
  function hotelProblems(h: { name: string; address: string; city: string; state: string; pin: string; gstin: string; phone: string; email: string; logoName?: string | null }, f: Fields): void {
      const name = h.name.trim();
      if (!name) f["hotel.name"] = E.required.hotelName;
      else if (Array.from(name).length > 100) f["hotel.name"] = E.nameLong;
      if (!h.address.trim()) f["hotel.address"] = E.required.address;
      if (!h.city.trim()) f["hotel.city"] = E.required.city;
      checkGstin(h.gstin, h.state, "hotel.gstin", "hotel.state", f, true);
      const pin = h.pin.trim();
      if (!pin) f["hotel.pin"] = E.required.pin;
      else if (!PIN_RE.test(pin)) f["hotel.pin"] = E.pinFormat;
      if (!h.phone.trim()) f["hotel.phone"] = E.required.phone;
      else if (!phoneOk(h.phone)) f["hotel.phone"] = E.phoneFormat;
      const e = lower(h.email);
      if (!e) f["hotel.email"] = E.required.hotelEmail;
      else if (!EMAIL_RE.test(e)) f["hotel.email"] = E.emailFormat;
      if (h.logoName && !LOGO_RE.test(h.logoName)) f["hotel.logoName"] = E.logoType;
  }

  /** The form's shape problems (no database): the same sentences as the screen. */
  function formProblems(form: PlatformOnboardingForm): Fields {
    const f: Fields = {};
    if (form.kind === "hotel") {
      hotelProblems(form.hotel, f);
    } else {
      const g = form.group;
      const name = g.name.trim();
      if (!name) f["group.name"] = E.required.groupName;
      else if (Array.from(name).length > 100) f["group.name"] = E.nameLong;
      if (!g.legalName.trim()) f["group.legalName"] = E.legalNameRequired;
      checkGstin(g.gstin, g.state ?? "", "group.gstin", "group.state", f, false);
      if (!g.address.trim()) f["group.address"] = E.required.address;
      const pin = (g.pin ?? "").trim();
      if (pin && !PIN_RE.test(pin)) f["group.pin"] = E.pinFormat;
      if (!g.phone.trim()) f["group.phone"] = E.required.phone;
      else if (!phoneOk(g.phone)) f["group.phone"] = E.phoneFormat;
      const e = lower(g.email);
      if (!e) f["group.email"] = E.required.email;
      else if (!EMAIL_RE.test(e)) f["group.email"] = E.emailFormat;
    }
    checkAdmin(form.admin, "admin.", f);
    const pw = passwordProblem(form.admin.password);
    if (pw) f["admin.password"] = pw;
    if (!form.admin.passwordConfirm) f["admin.passwordConfirm"] = E.required.passwordConfirm;
    else if (form.admin.passwordConfirm !== form.admin.password) f["admin.passwordConfirm"] = E.passwordMismatch;
    return f;
  }

  async function takenProblems(repos: PlatformConsoleRepos, form: PlatformOnboardingForm, f: Fields): Promise<void> {
    const a = form.admin;
    if (!f["admin.username"] && (await repos.accounts.usernameTaken(lower(a.username)))) f["admin.username"] = E.usernameTaken;
    if (!f["admin.email"] && (await repos.accounts.emailTaken(lower(a.email)))) f["admin.email"] = E.emailTaken;
    const mobile = storedMobile(a.mobile);
    if (!f["admin.mobile"] && mobile && (await repos.accounts.mobileTaken(mobile))) f["admin.mobile"] = MOBILE_TAKEN;
    if (form.kind === "group" && !f["group.name"] && (await repos.groups.nameTaken(form.group.name.trim()))) f["group.name"] = E.groupNameTaken;
  }

  async function freeHotelSlug(repos: PlatformConsoleRepos, name: string): Promise<string> {
    const base = slugFromName(name).slice(0, 36) || "hotel";
    for (let i = 1; i < 200; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      if (slugProblem(candidate) === null && !(await repos.hotels.slugTaken(candidate))) return candidate;
    }
    throw new AppError("SERVER_ERROR");
  }

  async function freeGroupSlug(repos: PlatformConsoleRepos, name: string): Promise<string> {
    const base = slugFromName(name).slice(0, 36) || "group";
    for (let i = 1; i < 200; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      if (!(await repos.groups.slugTaken(candidate))) return candidate;
    }
    throw new AppError("SERVER_ERROR");
  }

  const optionalHotelFields = (h: Extract<PlatformOnboardingForm, { kind: "hotel" }>["hotel"]): Record<string, unknown> => ({
    legalName: h.legalName?.trim() || null,
    tradeName: h.tradeName?.trim() || null,
    gstType: h.gstType === "regular" || h.gstType === "composition" ? h.gstType : null,
    roomCount: typeof h.roomCount === "number" && Number.isInteger(h.roomCount) && h.roomCount > 0 && h.roomCount <= 9999 ? h.roomCount : null,
    checkInTime: h.checkInTime && TIME_RE.test(h.checkInTime) ? h.checkInTime : null,
    checkOutTime: h.checkOutTime && TIME_RE.test(h.checkOutTime) ? h.checkOutTime : null,
  });

  /**
   * The platform's limit of a group (hotel_groups.max_hotels, migration 0133): its waiting, active and suspended hotels plus its open invitations (`exceptId`: the invitation
   * being turned into a hotel right now, which already holds its place). Call it with the group row locked. 422 field `limit` with a plain sentence at the limit.
   */
  async function checkGroupLimit(repos: PlatformConsoleRepos, groupId: string, at: Date, exceptId: string | null): Promise<void> {
    const max = await groupLimitOf(repos, groupId);
    if (max === null) return;
    if ((await placesTaken(repos, groupId, at, exceptId)) >= max) {
      const message = groupConsoleCopy.groupHotel.atLimit(max);
      throw new AppError("VALIDATION_FAILED", message, { fields: { limit: message } });
    }
  }

  /**
   * A hotel its GROUP invited is approved at once (MJ, 18 Oct 2026: no Super Admin approval): the same build as Approve, its account activated, the decision recorded as taken by
   * the group admin who invited it, the approval mail, and the audit row "Created by group G (group admin P)" the Super Admin sees on the Dashboard and in Activity. When the
   * build fails the hotel stays waiting and the Super Admin finishes it with Approve. Answers whether it is live.
   */
  async function approveForGroup(a: { hotelId: string; hotelName: string; groupId: string; groupName: string; invitedBy: string }, meta: PlatformMeta): Promise<boolean> {
    try {
      await deps.provisioner.provision({ hotelId: a.hotelId });
    } catch (error) {
      deps.report?.("group-invited hotel: provisioner failed (it stays waiting for the Super Admin's Approve)", error, meta.traceId);
      return false;
    }
    return unit.run(async (repos) => {
      const at = now();
      const h = await repos.hotels.get(a.hotelId, at, { forUpdate: true });
      if (!h || h.status !== "active") return false;
      const inviter = await repos.accounts.get(a.invitedBy);
      const accounts = await repos.onboarding.pendingAccounts({ hotelId: a.hotelId });
      for (const id of accounts) await repos.accounts.setStatus(id, "active", a.hotelId);
      await repos.onboarding.decide({ hotelId: a.hotelId }, "approved", a.invitedBy, null, at);
      await repos.hotels.setLifecycle(a.hotelId, { status: "active", approvedAt: at });
      await repos.auth.hotelSetup.create(a.hotelId);
      const label = `Created by group ${a.groupName} (group admin ${inviter?.displayName ?? "unknown"})`;
      await repos.hotels.addStatusHistory({ hotelId: a.hotelId, fromStatus: "pending_approval", toStatus: "active", changedBy: a.invitedBy, actorRole: "group_hotel_admin", reason: label, traceId: meta.traceId, at });
      await repos.audit.write(auditRow({ userId: a.invitedBy, name: inviter?.displayName ?? "Group admin", role: "group_hotel_admin" }, meta, { action: "hotel_created", entity: "hotel", entityId: a.hotelId, hotelId: a.hotelId, groupId: a.groupId, targetLabel: a.hotelName, reason: label }, "success", at));
      await accountMails(repos, accounts, "onboarding_approved", a.hotelName, null);
      return true;
    });
  }

  /** The public form: creates the pending hotel or group and its first account; the password is hashed here and never stored in the form or returned. */
  async function submit(token: string, form: PlatformOnboardingForm, meta: PlatformMeta): Promise<PlatformOnboardingResult> {
    // 1. read only: the link, the kind of form, the shape, who is taken
    const checked = await unit.run(async (repos) => {
      const found = await lookup(repos, token);
      const refused = refusal(found, now());
      if (refused || !found) throw refused ?? tokenError("NOT_FOUND", "NOT_FOUND", E.inviteNotFound);
      if ((found.invitation.type === "group") !== (form.kind === "group")) throw new AppError("CONFLICT", E.formMismatch);
      if (found.invitation.type === "member_hotel") {
        const g = found.invitation.groupId ? await repos.groups.get(found.invitation.groupId) : null;
        if (!g || g.status !== "active") throw new AppError("CONFLICT", E.groupNotActive);
      }
      const f = formProblems(form);
      await takenProblems(repos, form, f);
      failIfAny(f);
      return found;
    });
    // 2. the slow part, outside any transaction
    const passwordHash = await deps.hasher.hash(form.admin.password);
    // 3. one unit: re-check the link, make the pending records, mail
    let byGroup: { hotelId: string; hotelName: string; groupId: string; groupName: string; invitedBy: string } | null = null;
    try {
      const done = await unit.run(async (repos) => {
        const at = now();
        const found = await lookup(repos, token);
        const refused = refusal(found, at);
        if (refused || !found || found.invitation.id !== checked.invitation.id) throw refused ?? tokenError("NOT_FOUND", "NOT_FOUND", E.inviteNotFound);
        const inv = found.invitation;
        const a = form.admin;
        const admin: PendingAdmin = { username: lower(a.username), email: lower(a.email), mobile: storedMobile(a.mobile) as string, displayName: a.name.trim(), passwordHash };
        const common = { invitationId: inv.id, linkId: found.link.id, admin, ip: meta.ip, userAgent: meta.userAgent, at };
        const adminForm = { name: admin.displayName, username: admin.username, email: admin.email, mobile: normaliseMobile(a.mobile) ?? "" };
        if (form.kind === "hotel") {
          const h = form.hotel;
          // a hotel its GROUP invited: the group's limit is checked again (this invitation already holds its place), and the hotel is approved at once after this unit
          const groupInvited = inv.type === "member_hotel" && inv.groupId !== null && inv.invitedByRole === "group_hotel_admin";
          if (groupInvited) {
            await repos.groups.get(inv.groupId as string, { forUpdate: true });
            await checkGroupLimit(repos, inv.groupId as string, at, inv.id);
          }
          const slug = await freeHotelSlug(repos, h.name);
          const payload = {
            contactName: inv.contactName,
            hotel: { name: h.name.trim(), address: h.address.trim(), city: h.city.trim(), state: h.state.trim(), pin: h.pin.trim(), gstin: h.gstin.trim().toUpperCase(), phone: h.phone.trim(), email: lower(h.email), logoName: h.logoName || null, ...optionalHotelFields(h) },
            admin: adminForm,
          };
          const made = await repos.onboarding.submitHotel({
            ...common, groupId: inv.type === "member_hotel" ? inv.groupId : null, payload,
            hotel: { name: h.name.trim(), slug, address: h.address.trim(), city: h.city.trim(), state: h.state.trim(), pin: h.pin.trim(), gstin: h.gstin.trim().toUpperCase(), phone: h.phone.trim(), email: lower(h.email), logoName: h.logoName || null },
          });
          await repos.hotels.addStatusHistory({ hotelId: made.hotelId, fromStatus: null, toStatus: "pending_approval", changedBy: null, actorRole: null, reason: null, traceId: meta.traceId, at });
          await repos.audit.write(auditRow({ userId: null, name: inv.contactName, role: null }, meta, { action: "hotel_submitted", entity: "hotel", entityId: made.hotelId, hotelId: made.hotelId, groupId: inv.type === "member_hotel" ? inv.groupId : null, targetLabel: h.name.trim() }, "success", at));
          if (groupInvited) byGroup = { hotelId: made.hotelId, hotelName: h.name.trim(), groupId: inv.groupId as string, groupName: inv.groupName ?? "the group", invitedBy: inv.invitedBy };
          else await mail(repos, { userId: made.userId, email: admin.email }, "onboarding_waiting", { name: admin.displayName, hotelName: h.name.trim() });
          return { kind: "hotel" as const, hotel: { id: made.hotelId, name: h.name.trim(), city: h.city.trim(), state: h.state.trim(), groupName: inv.groupName, status: "pending_approval" as const }, group: null, message: C.onboarding.waitingTitle };
        }
        const g = form.group;
        const payload = {
          contactName: inv.contactName,
          group: { name: g.name.trim(), legalName: g.legalName.trim(), gstin: g.gstin.trim().toUpperCase(), address: g.address.trim(), city: g.city?.trim() || null, state: g.state?.trim() || null, pin: g.pin?.trim() || null, phone: g.phone.trim(), email: lower(g.email) },
          admin: adminForm,
        };
        const slug = await freeGroupSlug(repos, g.name);
        const made = await repos.onboarding.submitGroup({
          ...common, payload,
          group: { name: g.name.trim(), slug, legalName: g.legalName.trim(), gstin: g.gstin.trim().toUpperCase(), address: g.address.trim(), city: g.city?.trim() || null, state: g.state?.trim() || null, pin: g.pin?.trim() || null, phone: g.phone.trim(), email: lower(g.email) },
        });
        await repos.groups.addHistory({ groupId: made.groupId, event: "submitted", fromStatus: null, toStatus: "pending_approval", hotelId: null, adminUserId: made.userId, changedBy: null, actorRole: null, reason: null, traceId: meta.traceId, at });
        await repos.audit.write(auditRow({ userId: null, name: inv.contactName, role: null }, meta, { action: "group_submitted", entity: "group", entityId: made.groupId, groupId: made.groupId, targetLabel: g.name.trim() }, "success", at));
        await mail(repos, { userId: made.userId, email: admin.email }, "onboarding_waiting", { name: admin.displayName, hotelName: g.name.trim() });
        return { kind: "group" as const, hotel: null, group: { id: made.groupId, name: g.name.trim(), status: "pending_approval" as const }, message: C.onboarding.waitingTitle };
      });
      const auto = byGroup as typeof byGroup;
      if (auto && done.hotel && (await approveForGroup(auto, meta))) return { ...done, hotel: { ...done.hotel, status: "active" as const }, message: C.onboarding.readyTitle };
      return done;
    } catch (error) {
      if (error instanceof RepoError && error.kind === "unique") {
        // two people used the link, or a name was taken in between: say which
        const f: Fields = {};
        await unit.run((repos) => takenProblems(repos, form, f));
        if (Object.keys(f).length > 0) failIfAny(f);
        throw tokenError("CONFLICT", "ALREADY_SUBMITTED", E.inviteUsed);
      }
      throw error;
    }
  }

  /* ------------------------------------------------------------------ approval */

  async function accountMails(repos: PlatformConsoleRepos, ids: readonly string[], kind: "onboarding_approved" | "onboarding_rejected", hotelName: string, reason: string | null): Promise<string> {
    let first = "";
    for (const id of ids) {
      const a = await repos.accounts.get(id);
      if (!a?.email) continue;
      first ||= a.email;
      await mail(repos, { userId: a.id, email: a.email }, kind, { name: a.displayName, username: a.username, hotelName, ...(reason ? { reason } : {}), ...(kind === "onboarding_approved" ? { link: signInLink(deps.publicUrl) } : {}) });
    }
    return first;
  }

  /** Approve: build the schema (owner side, its own transaction), then activate the account, record the decision, mail. A retry after a failure in the second step completes it. */
  async function approveHotel(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformHotelChange> {
    const probe: AuditInput = { action: "hotel_approved", entity: "hotel", entityId: id, hotelId: id };
    await gate.write(session, meta, probe);
    // A: may it be approved? (not locked: the provisioner locks the row itself)
    const start = await unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const h = await repos.hotels.get(id, now());
      if (!h) throw new AppError("NOT_FOUND");
      const pending = await repos.onboarding.pendingAccounts({ hotelId: id });
      const resume = h.status === "active" && h.approvedAt === null && pending.length > 0;
      if (h.status !== "pending_approval" && !resume) throw new AppError("CONFLICT", E.notPending);
      return { actor, hotel: h, resume };
    });
    if (!start.resume) {
      try {
        await deps.provisioner.provision({ hotelId: id });
      } catch (error) {
        const failure = error instanceof ProvisionError ? error.failure : "FAILED";
        // the client only ever sees the plain sentence; the real cause (and its chain) goes to the server log with the trace id
        deps.report?.("hotel approval: provisioner failed", error, meta.traceId);
        const refused = failure === "NOT_PENDING" ? new AppError("CONFLICT", E.notPending) : new AppError("SERVER_ERROR", E.createFailed);
        throw await gate.refuse(session, meta, probe, refused);
      }
    }
    // B: the platform side of the approval, in one unit
    return unit.run(async (repos) => {
      const at = now();
      const actor = await gate.actor(repos, session);
      const h = await repos.hotels.get(id, at, { forUpdate: true });
      if (!h || h.status !== "active") throw new AppError("CONFLICT", E.notPending);
      const accounts = await repos.onboarding.pendingAccounts({ hotelId: id });
      for (const a of accounts) await repos.accounts.setStatus(a, "active", id);
      await repos.onboarding.decide({ hotelId: id }, "approved", actor.userId, null, at).catch((error) => {
        if (!(error instanceof RepoError)) throw error; // a retry finds it decided already
      });
      await repos.hotels.setLifecycle(id, { status: "active", approvedAt: at });
      // the new Hotel Admin's "Set up your hotel" checklist starts with the approval (a retry changes nothing)
      await repos.auth.hotelSetup.create(id);
      await repos.hotels.addStatusHistory({ hotelId: id, fromStatus: "pending_approval", toStatus: "active", changedBy: actor.userId, actorRole: actor.role, reason: null, traceId: meta.traceId, at });
      await gate.audit(repos, actor, meta, { action: "hotel_approved", entity: "hotel", entityId: id, hotelId: id, groupId: h.groupId, targetLabel: h.name });
      const email = await accountMails(repos, accounts, "onboarding_approved", h.name, null);
      const fresh = (await repos.hotels.get(id, at)) as PlatformHotelRow;
      return { hotel: hotelView(fresh, at), message: C.approval.approved(h.name, email), note: APPROVAL_EMAIL_NOTE };
    });
  }

  async function rejectHotel(session: VerifiedSession, id: string, rawReason: string | undefined, meta: PlatformMeta): Promise<PlatformHotelChange> {
    const reason = reasonFor("reject", rawReason);
    return write(session, meta, { action: "hotel_rejected", entity: "hotel", entityId: id, hotelId: id }, async (repos, actor) => {
      const at = now();
      const h = await repos.hotels.get(id, at, { forUpdate: true });
      if (!h) throw new AppError("NOT_FOUND");
      const patch = transition(h, "reject", reason, at);
      await repos.hotels.setLifecycle(id, { ...patch, rejectedAt: at, rejectReason: reason });
      await repos.hotels.addStatusHistory({ hotelId: id, fromStatus: h.status, toStatus: "rejected", changedBy: actor.userId, actorRole: actor.role, reason, traceId: meta.traceId, at });
      const accounts = await repos.onboarding.pendingAccounts({ hotelId: id });
      for (const a of accounts) await repos.accounts.setStatus(a, "disabled", id);
      await repos.onboarding.decide({ hotelId: id }, "rejected", actor.userId, reason, at);
      if (h.groupId) {
        await repos.groups.unlink(h.groupId, id);
        await repos.groups.addHistory({ groupId: h.groupId, event: "hotel_unlinked", fromStatus: null, toStatus: null, hotelId: id, adminUserId: null, changedBy: actor.userId, actorRole: actor.role, reason: null, traceId: meta.traceId, at });
        await gate.audit(repos, actor, meta, { action: "group_hotel_removed", entity: "group", entityId: h.groupId, hotelId: id, groupId: h.groupId, targetLabel: h.name });
      }
      await gate.audit(repos, actor, meta, { action: "hotel_rejected", entity: "hotel", entityId: id, hotelId: id, groupId: h.groupId, targetLabel: h.name, reason });
      await accountMails(repos, accounts, "onboarding_rejected", h.name, reason);
      return { hotel: hotelView((await repos.hotels.get(id, at)) as PlatformHotelRow, at), message: C.approval.rejected(h.name), note: null };
    });
  }

  async function approveGroup(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformGroupChange> {
    return write(session, meta, { action: "group_approved", entity: "group", entityId: id, groupId: id }, async (repos, actor) => {
      const at = now();
      const g = await repos.groups.get(id, { forUpdate: true });
      if (!g) throw new AppError("NOT_FOUND");
      if (g.status !== "pending_approval") throw new AppError("CONFLICT", E.notPendingGroup);
      const accounts = await repos.onboarding.pendingAccounts({ groupId: id });
      for (const a of accounts) await repos.accounts.setStatus(a, "active", null);
      await repos.groups.setLifecycle(id, { status: "active", approvedAt: at });
      await repos.onboarding.decide({ groupId: id }, "approved", actor.userId, null, at);
      await repos.groups.addHistory({ groupId: id, event: "approved", fromStatus: "pending_approval", toStatus: "active", hotelId: null, adminUserId: g.admin?.id ?? null, changedBy: actor.userId, actorRole: actor.role, reason: null, traceId: meta.traceId, at });
      await gate.audit(repos, actor, meta, { action: "group_approved", entity: "group", entityId: id, groupId: id, targetLabel: g.name });
      const email = await accountMails(repos, accounts, "onboarding_approved", g.name, null);
      return { group: groupView((await repos.groups.get(id)) as PlatformGroupRow), message: C.approval.groupApproved(g.name, email), note: APPROVAL_EMAIL_NOTE };
    });
  }

  async function rejectGroup(session: VerifiedSession, id: string, rawReason: string | undefined, meta: PlatformMeta): Promise<PlatformGroupChange> {
    const reason = reasonFor("reject", rawReason);
    return write(session, meta, { action: "group_rejected", entity: "group", entityId: id, groupId: id }, async (repos, actor) => {
      const at = now();
      const g = await repos.groups.get(id, { forUpdate: true });
      if (!g) throw new AppError("NOT_FOUND");
      if (g.status !== "pending_approval") throw new AppError("CONFLICT", E.notPendingGroup);
      const accounts = await repos.onboarding.pendingAccounts({ groupId: id });
      for (const a of accounts) await repos.accounts.setStatus(a, "disabled", null);
      await repos.groups.setLifecycle(id, { status: "rejected", rejectedAt: at, rejectReason: reason });
      await repos.onboarding.decide({ groupId: id }, "rejected", actor.userId, reason, at);
      await repos.groups.addHistory({ groupId: id, event: "rejected", fromStatus: "pending_approval", toStatus: "rejected", hotelId: null, adminUserId: g.admin?.id ?? null, changedBy: actor.userId, actorRole: actor.role, reason, traceId: meta.traceId, at });
      await gate.audit(repos, actor, meta, { action: "group_rejected", entity: "group", entityId: id, groupId: id, targetLabel: g.name, reason });
      await accountMails(repos, accounts, "onboarding_rejected", g.name, reason);
      return { group: groupView((await repos.groups.get(id)) as PlatformGroupRow), message: C.approval.groupRejected(g.name), note: null };
    });
  }

  void byName;
  return { list, devLinks, send, sendToGroup, resend, cancel, openByToken, submit, approveHotel, rejectHotel, approveGroup, rejectGroup };
}

export type InvitationService = ReturnType<typeof createInvitationService>;
export type { Page };

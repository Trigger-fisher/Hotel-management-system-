import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthData } from "./auth";
import type { PlatformConsoleData } from "./platformConsole";
import type { InvitationRow, LinkRow, PlatformInvitationsRepo, PlatformOnboardingRepo, StoredInvitationStatus } from "../platformInvitations";
import { RepoError } from "../types";

// The in-memory double of invitations and the onboarding form (repos/platformInvitations.ts). It mirrors the CHECKs and unique indexes of migrations
// 0104 and 0105: one pending invitation per e-mail and per name (per kind and group), one live link per invitation, a link used once, one
// submission per invitation, hotel, group and account, the pending account that cannot sign in, no password in the stored form.

export interface MemInvite {
  id: string;
  type: InvitationRow["type"];
  hotelName: string;
  contactName: string;
  email: string;
  groupId: string | null;
  status: StoredInvitationStatus;
  invitedBy: string;
  invitedByRole: InvitationRow["invitedByRole"];
  resendCount: number;
  createdAt: Date;
  lastSentAt: Date;
  openedAt: Date | null;
  submittedAt: Date | null;
  revokedAt: Date | null;
}

export interface MemLink {
  id: string;
  invitationId: string;
  tokenHash: string;
  issuedBy: string;
  issuedAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: LinkRow["revokeReason"];
}

const clone = <T>(v: T): T => structuredClone(v);
const lower = (s: string): string => s.toLowerCase();
const nameKey = (s: string): string => lower(s.trim());
const check = (ok: boolean, name: string): void => {
  if (!ok) throw new RepoError("check", name);
};
const hasPassword = (v: unknown): boolean => {
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).some(([k, x]) => k === "password" || k === "passwordConfirm" || k === "password_hash" || hasPassword(x));
  return false;
};

export function bindInvitations(auth: AuthData, data: PlatformConsoleData): { invitations: PlatformInvitationsRepo; onboarding: PlatformOnboardingRepo } {
  const liveLink = (invitationId: string): MemLink | undefined => data.links.find((l) => l.invitationId === invitationId && l.usedAt === null && l.revokedAt === null);
  const newestLink = (invitationId: string): MemLink | undefined => data.links.filter((l) => l.invitationId === invitationId).sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())[0];
  const liveGroup = (id: string | null) => (id ? data.groups.find((g) => g.id === id && g.deletedAt === null) : undefined);

  function rowOf(i: MemInvite): InvitationRow {
    const sub = data.submissions.find((s) => s.invitationId === i.id);
    return {
      id: i.id, type: i.type, hotelName: i.hotelName, contactName: i.contactName, email: i.email, groupId: i.groupId, groupName: liveGroup(i.groupId)?.name ?? null, status: i.status,
      invitedBy: i.invitedBy, invitedByName: auth.users.find((u) => u.id === i.invitedBy)?.displayName ?? "", invitedByRole: i.invitedByRole, resendCount: i.resendCount,
      createdAt: i.createdAt, lastSentAt: i.lastSentAt, openedAt: i.openedAt, submittedAt: i.submittedAt, revokedAt: i.revokedAt,
      expiresAt: newestLink(i.id)?.expiresAt ?? i.createdAt, hotelId: sub?.hotelId ?? null, madeGroupId: sub?.groupId ?? null,
    };
  }

  /** The two partial unique indexes of 0104 among pending invitations. */
  function uniqueAmongPending(i: MemInvite): void {
    for (const o of data.invites) {
      if (o.id === i.id || o.status !== "pending") continue;
      if (o.email === i.email) throw new RepoError("unique", "invitations_one_pending_per_email_key");
      if (o.type === i.type && (o.groupId ?? "") === (i.groupId ?? "") && nameKey(o.hotelName) === nameKey(i.hotelName)) throw new RepoError("unique", "invitations_one_pending_per_name_key");
    }
  }

  const linkCheck = (l: MemLink): void => check(l.expiresAt > l.issuedAt && l.expiresAt.getTime() <= l.issuedAt.getTime() + 720 * 3_600_000, "invitation_links_validity");

  const invitations: PlatformInvitationsRepo = {
    async list() {
      return clone([...data.invites].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1)).map(rowOf));
    },
    async get(id) {
      const i = data.invites.find((x) => x.id === id);
      return i ? clone(rowOf(i)) : null;
    },
    async expireDue(now) {
      let n = 0;
      for (const i of data.invites) {
        if (i.status !== "pending") continue;
        const l = liveLink(i.id);
        if (l && l.expiresAt <= now) {
          l.revokedAt = now;
          l.revokeReason = "expired";
          i.status = "expired";
          n += 1;
        }
      }
      return n;
    },
    async clashes(f) {
      const others = data.invites.filter((o) => o.status === "pending" && o.id !== f.exceptId);
      return {
        email: others.some((o) => o.email === f.email),
        name: others.some((o) => o.type === f.type && (o.groupId ?? "") === (f.groupId ?? "") && nameKey(o.hotelName) === nameKey(f.hotelName)),
      };
    },
    async create(f, tokenHash, expiresAt, now) {
      check(f.type !== "individual" || f.groupId === null, "invitations_individual_no_group");
      check(f.type !== "member_hotel" || f.groupId !== null, "invitations_member_hotel_has_group");
      check((f.type === "member_hotel") === (f.invitedByRole === "group_hotel_admin"), "invitations_type_matches_sender");
      check(Array.from(f.hotelName.trim()).length >= 1 && Array.from(f.hotelName).length <= 200, "invitations_hotel_name_check");
      check(Array.from(f.contactName.trim()).length >= 1 && Array.from(f.contactName).length <= 120, "invitations_contact_name_check");
      check(f.email === lower(f.email) && f.email.length <= 254 && /^[^@\s]+@[^@\s]+$/.test(f.email), "invitations_email_check");
      check(auth.users.some((u) => u.id === f.invitedBy), "invitations_invited_by_fkey");
      check(f.groupId === null || data.groups.some((g) => g.id === f.groupId), "invitations_group_id_fkey");
      const inv: MemInvite = {
        id: randomUUID(), type: f.type, hotelName: f.hotelName, contactName: f.contactName, email: f.email, groupId: f.groupId, status: "pending", invitedBy: f.invitedBy,
        invitedByRole: f.invitedByRole, resendCount: 0, createdAt: now, lastSentAt: now, openedAt: null, submittedAt: null, revokedAt: null,
      };
      uniqueAmongPending(inv);
      const link: MemLink = { id: randomUUID(), invitationId: inv.id, tokenHash, issuedBy: f.invitedBy, issuedAt: now, expiresAt, usedAt: null, revokedAt: null, revokeReason: null };
      check(/^[0-9a-f]{64}$/.test(tokenHash), "invitation_links_token_hash_check");
      linkCheck(link);
      if (data.links.some((l) => l.tokenHash === tokenHash)) throw new RepoError("unique", "invitation_links_token_hash_key");
      data.invites.push(inv);
      data.links.push(link);
      return inv.id;
    },
    async reissue(id, tokenHash, expiresAt, by, now) {
      const i = data.invites.find((x) => x.id === id);
      check(!!i && (i.status === "pending" || i.status === "expired"), "invitation cannot be resent");
      if (!i) return;
      const old = liveLink(id);
      if (old) {
        old.revokedAt = now;
        old.revokeReason = "resent";
      }
      const link: MemLink = { id: randomUUID(), invitationId: id, tokenHash, issuedBy: by, issuedAt: now, expiresAt, usedAt: null, revokedAt: null, revokeReason: null };
      check(/^[0-9a-f]{64}$/.test(tokenHash), "invitation_links_token_hash_check");
      linkCheck(link);
      if (data.links.some((l) => l.tokenHash === tokenHash)) throw new RepoError("unique", "invitation_links_token_hash_key");
      check(i.resendCount < 100, "invitations_resend_count_check");
      const wasStatus = i.status;
      i.status = "pending";
      try {
        uniqueAmongPending(i);
      } catch (error) {
        i.status = wasStatus;
        throw error;
      }
      data.links.push(link);
      i.resendCount += 1;
      i.lastSentAt = now;
    },
    async revoke(id, by, now) {
      const i = data.invites.find((x) => x.id === id);
      check(!!i && (i.status === "pending" || i.status === "expired"), "invitation cannot be cancelled");
      if (!i) return;
      const l = liveLink(id);
      if (l) {
        l.revokedAt = now;
        l.revokeReason = "cancelled";
      }
      void by;
      i.status = "revoked";
      i.revokedAt = now;
    },
    async byTokenHash(hash) {
      const l = data.links.find((x) => x.tokenHash === hash);
      const i = l ? data.invites.find((x) => x.id === l.invitationId) : undefined;
      if (!l || !i) return null;
      return clone({ invitation: rowOf(i), link: { id: l.id, invitationId: l.invitationId, expiresAt: l.expiresAt, usedAt: l.usedAt, revokedAt: l.revokedAt, revokeReason: l.revokeReason } });
    },
    async markOpened(id, now) {
      const i = data.invites.find((x) => x.id === id);
      if (!i || i.openedAt !== null || i.status !== "pending") return false;
      i.openedAt = now;
      return true;
    },
  };

  const liveUser = (pred: (u: AuthData["users"][number]) => boolean): boolean => auth.users.some((u) => u.deletedAt === null && pred(u));

  function pendingAdmin(a: { username: string; email: string; mobile: string; displayName: string; passwordHash: string }, accountRole: "hotel_admin" | "group_hotel_admin", roleKey: string, at: Date): string {
    const role = auth.roles.find((r) => r.hotelId === null && r.key === roleKey);
    if (!role) throw new RepoError("check", "no such built-in role");
    check(/^[a-z0-9][a-z0-9._-]{2,63}$/.test(a.username), "users_username_check");
    check(a.email === lower(a.email) && a.email.length <= 254 && /^[^@\s]+@[^@\s]+$/.test(a.email), "users_email_check");
    check(/^\+91[6-9][0-9]{9}$/.test(a.mobile), "users_mobile_check");
    if (liveUser((u) => u.username === a.username)) throw new RepoError("unique", "users_username_key");
    if (liveUser((u) => u.email === a.email)) throw new RepoError("unique", "users_email_key");
    if (liveUser((u) => u.mobile === a.mobile)) throw new RepoError("unique", "users_mobile_key");
    const id = randomUUID();
    auth.users.push({
      id, username: a.username, email: a.email, mobile: a.mobile, displayName: a.displayName, passwordHash: a.passwordHash, roleId: role.id, accountRole, status: "pending_approval",
      mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null,
    });
    data.accountMeta.set(id, { createdAt: at, createdBy: null });
    return id;
  }

  function accept(invitationId: string, linkId: string, at: Date, groupId: string | null): void {
    const i = data.invites.find((x) => x.id === invitationId);
    if (!i || i.status !== "pending") throw new RepoError("unique", "invitation already used");
    const l = data.links.find((x) => x.id === linkId);
    if (!l || l.usedAt !== null || l.revokedAt !== null) throw new RepoError("unique", "link already used");
    i.status = "accepted";
    i.submittedAt = at;
    if (groupId) i.groupId = groupId;
    l.usedAt = at;
  }

  const onboarding: PlatformOnboardingRepo = {
    async submitHotel(s) {
      check(!hasPassword(s.payload), "onboarding_submissions_payload_check");
      if (data.submissions.some((x) => x.invitationId === s.invitationId)) throw new RepoError("unique", "onboarding_submissions_invitation_id_key");
      if ([...data.hotels.values()].some((m) => m.deletedAt === null && m.slug === s.hotel.slug)) throw new RepoError("unique", "hotels_slug_key");
      check(/^[1-9][0-9]{5}$/.test(s.hotel.pin), "hotels_pin_check");
      check(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s.hotel.gstin), "hotels_gstin_check");
      const id = randomUUID();
      const userId = pendingAdmin(s.admin, "hotel_admin", "super_admin", s.at);
      auth.hotels.push({ id, name: s.hotel.name, status: "pending_approval" } as never);
      data.hotels.set(id, {
        slug: s.hotel.slug, city: s.hotel.city, state: s.hotel.state, gstin: s.hotel.gstin, timeZone: "Asia/Kolkata", createdAt: s.at, provisionedAt: null, submittedAt: s.at,
        approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null,
        statusBeforeArchive: null, lastActivityAt: null, deletedAt: null,
      });
      const role = auth.roles.find((r) => r.hotelId === null && r.key === "super_admin");
      auth.memberships.push({ userId, hotelId: id, roleId: role?.id ?? null, status: "active", isDefault: true, subject: null });
      if (s.groupId) {
        if (!data.groups.some((g) => g.id === s.groupId)) throw new RepoError("check", "group_members_group_id_fkey");
        data.members.push({ groupId: s.groupId, hotelId: id, linkedBy: null, createdAt: s.at });
      }
      data.submissions.push({ hotelId: id, groupId: null, invitationId: s.invitationId, payload: clone(s.payload), submittedAt: s.at, status: "pending", adminUserId: userId });
      accept(s.invitationId, s.linkId, s.at, null);
      return { hotelId: id, userId };
    },
    async submitGroup(s) {
      check(!hasPassword(s.payload), "onboarding_submissions_payload_check");
      if (data.submissions.some((x) => x.invitationId === s.invitationId)) throw new RepoError("unique", "onboarding_submissions_invitation_id_key");
      if (data.groups.some((g) => g.deletedAt === null && g.status !== "rejected" && nameKey(g.name) === nameKey(s.group.name))) throw new RepoError("unique", "hotel_groups_name_key");
      if (data.groups.some((g) => g.deletedAt === null && g.slug === s.group.slug)) throw new RepoError("unique", "hotel_groups_slug_key");
      const userId = pendingAdmin(s.admin, "group_hotel_admin", "viewer", s.at);
      const id = randomUUID();
      const g = s.group;
      data.groups.push({
        id, name: g.name, slug: g.slug, status: "pending_approval", adminUserId: userId, createdAt: s.at, deletedAt: null, legalName: g.legalName, gstin: g.gstin, address: g.address,
        city: g.city, state: g.state, pin: g.pin, phone: g.phone, email: g.email, submittedAt: s.at, approvedAt: null, rejectedAt: null, rejectReason: null,
      });
      data.submissions.push({ hotelId: null, groupId: id, invitationId: s.invitationId, payload: clone(s.payload), submittedAt: s.at, status: "pending", adminUserId: userId });
      accept(s.invitationId, s.linkId, s.at, id);
      return { groupId: id, userId };
    },
    async decide(subject, status, by, reason, now) {
      void by;
      const sub = data.submissions.find((x) => ("hotelId" in subject ? x.hotelId === subject.hotelId : x.groupId === subject.groupId) && (x.status ?? "pending") === "pending");
      check(!!sub, "no pending submission");
      check(status !== "rejected" || reason !== null, "onboarding_submissions_reject_reason");
      if (!sub) return;
      sub.status = status;
      sub.decidedAt = now;
    },
    async pendingAccounts(subject) {
      if ("hotelId" in subject) {
        return auth.memberships.filter((m) => m.hotelId === subject.hotelId && auth.users.some((u) => u.id === m.userId && u.status === "pending_approval" && u.deletedAt === null)).map((m) => m.userId);
      }
      const g = liveGroup(subject.groupId);
      const u = g?.adminUserId ? auth.users.find((x) => x.id === g.adminUserId && x.status === "pending_approval" && x.deletedAt === null) : undefined;
      return u ? [u.id] : [];
    },
  };

  return { invitations, onboarding };
}

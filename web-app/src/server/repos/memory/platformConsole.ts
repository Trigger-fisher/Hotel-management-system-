import "server-only";
import { randomUUID } from "node:crypto";
import type { AccountRole } from "../../auth/session";
import type { AuthData } from "./auth";
import { createMemoryAuth, memoryAuthRepos } from "./auth";
import type { MemoryStore } from "./store";
import type {
  AnnouncementRow,
  PlatformAnnouncementsRepo,
  HotelMailRow,
  PlatformHotelMailRepo,
  GroupMailRow,
  PlatformGroupMailRepo,
  GroupHistoryRow, GroupStatus, HotelLifecycleStatus, HotelStatusChange, PlatformAccountRow, PlatformAccountsRepo, PlatformActivityRow, PlatformAuditRepo,
  PlatformAuditRow, PlatformConsoleRepos, PlatformConsoleUnit, PlatformGroupRow, PlatformGroupsRepo, PlatformHotelRow, PlatformHotelsRepo, PlatformVisitsRepo, PlatformAdminAccessRepo,
  HotelBackupRow, HotelExportRow, PlatformAuditEntryRow, PlatformAuditSearchRepo, PlatformBackupsRepo, PlatformExportsRepo, PlatformHealthRepo, PlatformSettingsRepo, PlatformSignInsRepo, SettingRow, SignInEvent,
} from "../platformConsole";
import { RepoError } from "../types";
import type { MemInvite, MemLink } from "./platformInvitations";
import { bindInvitations } from "./platformInvitations";

// The in-memory double of the Platform console repositories, bound to the SAME platform data as sign-in (users, roles, memberships, sessions,
// hotels with their status), so a suspended hotel or a disabled admin is what the next sign-in sees. What the sign-in data does not carry (a
// hotel's lifecycle columns, groups, the two append-only histories, the platform audit rows, onboarding forms, invitation counts) lives in its
// own data here. Never looser than the database: the hotels / groups / users CHECKs, the unique indexes (one group per hotel, live usernames,
// e-mails, mobiles, group names and slugs), the insert-only history and audit. One unit at a time; a failed unit leaves nothing behind.

const LISTED: readonly HotelLifecycleStatus[] = ["active", "suspended", "pending_approval", "rejected", "archived"];
const ALL_STATUSES: readonly HotelLifecycleStatus[] = ["invited", "onboarding", "pending_approval", "active", "suspended", "archived", "rejected", "deleted"];
const ROLES: readonly AccountRole[] = ["super_admin", "platform_admin", "group_hotel_admin", "hotel_admin", "hotel_user", "corporate_user", "guest_user"];
const GROUP_STATUSES: readonly GroupStatus[] = ["pending_approval", "active", "suspended", "rejected", "archived"];
const TRACE = /^[A-Za-z0-9_-]{8,64}$/;

/** A placeholder no password can ever match; the credential side replaces it with the temporary password's hash. */
export const UNUSABLE_PASSWORD = "!unusable-until-the-temporary-password";

export interface MemHotelMeta {
  slug: string;
  city: string | null;
  state: string | null;
  gstin: string | null;
  timeZone: string;
  createdAt: Date;
  provisionedAt: Date | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  suspendedAt: Date | null;
  suspendReason: string | null;
  archivedAt: Date | null;
  archiveReason: string | null;
  restoreUntil: Date | null;
  statusBeforeArchive: "active" | "suspended" | "rejected" | null;
  lastActivityAt: Date | null;
  deletedAt: Date | null;
  /** platform 0196: ID pictures kept as an exact copy (absent = false). */
  idPhotoExact?: boolean;
}

interface MemGroup {
  id: string;
  name: string;
  slug: string;
  status: GroupStatus;
  adminUserId: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pin: string | null;
  phone: string | null;
  email: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  /** The most hotels the group may have (platform migration 0133); absent or null = no limit. */
  maxHotels?: number | null;
}

export interface PlatformConsoleData {
  hotels: Map<string, MemHotelMeta>;
  groups: MemGroup[];
  members: { groupId: string; hotelId: string; linkedBy: string | null; createdAt: Date }[];
  statusHistory: HotelStatusChange[];
  groupHistory: GroupHistoryRow[];
  audit: (PlatformAuditRow & { id: string })[];
  accountMeta: Map<string, { createdAt: Date; createdBy: string | null }>;
  submissions: {
    hotelId: string | null;
    groupId?: string | null;
    invitationId: string;
    payload: Record<string, unknown>;
    submittedAt: Date;
    status?: "pending" | "approved" | "rejected";
    adminUserId?: string;
    decidedAt?: Date;
  }[];
  invites: MemInvite[];
  links: MemLink[];
  defaultGstPercent: number;
  /** platform_settings rows by key (the defaults of migration 0108 are filled in by emptyPlatformConsoleData). */
  settings: Map<string, { value: unknown; updatedAt: Date; updatedBy: string | null; secret?: boolean }>;
  exports: (HotelExportRow & { fileRef: string; startedAt: Date })[];
  /** Nightly backup copies (0122); a failed run is kept too (status failed, no file). */
  backups: (HotelBackupRow & { status: "ready" | "failed"; errorCode: string | null; startedAt: Date })[];
  /** Tests: what each hotel's tables take on disk (P1); a hotel not in the map is "not measured". */
  storageBytes: Map<string, number>;
  deletions: { hotelId: string; hotelName: string; slug: string; schemaName: string; confirmSlug: string; exportId: string; deletedBy: string; reason: string | null; traceId: string | null; at: Date }[];
  /** P4: announcements and who dismissed which. */
  announcements: Omit<AnnouncementRow, "reads" | "createdByName">[];
  announcementReads: { announcementId: string; userId: string; at: Date }[];
  /** A hotel's own mail accounts (platform 0161). */
  hotelMail: HotelMailRow[];
  /** A group's own mail accounts (platform 0162). */
  groupMail: GroupMailRow[];
  /** TEST ONLY: the next audit write fails like a database error, to prove the action rolls back with it. */
  failAuditWrites?: boolean;
}

const emptyPlatformConsoleData = (): PlatformConsoleData => ({
  hotels: new Map(), groups: [], members: [], statusHistory: [], groupHistory: [], audit: [], accountMeta: new Map(), submissions: [], invites: [], links: [], defaultGstPercent: 5,
  settings: new Map<string, { value: unknown; updatedAt: Date; updatedBy: string | null; secret?: boolean }>([
    ["new_hotel.role_keys", { value: ["super_admin", "admin", "editor", "viewer"], updatedAt: new Date(0), updatedBy: null }],
    ["new_hotel.gst_percent", { value: 5, updatedAt: new Date(0), updatedBy: null }],
    ["new_hotel.time_zone", { value: "Asia/Kolkata", updatedAt: new Date(0), updatedBy: null }],
    ["mail.from_name", { value: "EasyHotelSolutions", updatedAt: new Date(0), updatedBy: null }],
    ["mail.from_email", { value: null, updatedAt: new Date(0), updatedBy: null }],
    ["mail.smtp_host", { value: null, updatedAt: new Date(0), updatedBy: null }],
    ["mail.smtp_port", { value: 587, updatedAt: new Date(0), updatedBy: null }],
    ["mail.smtp_security", { value: "starttls", updatedAt: new Date(0), updatedBy: null }],
    ["mail.smtp_user", { value: null, updatedAt: new Date(0), updatedBy: null }],
    ["mail.smtp_password", { value: null, updatedAt: new Date(0), updatedBy: null, secret: true }],
    ["mail.reply_to", { value: null, updatedAt: new Date(0), updatedBy: null }],
    ["mail.test_result", { value: null, updatedAt: new Date(0), updatedBy: null }],
  ]),
  exports: [], backups: [], storageBytes: new Map(), deletions: [], announcements: [], announcementReads: [], hotelMail: [], groupMail: [],
});

const clone = <T>(v: T): T => structuredClone(v);
const lower = (s: string | null | undefined): string => (s ?? "").toLowerCase();
const has = (hay: string, words: readonly string[]): boolean => words.every((w) => hay.includes(w));
const len = (s: string | null, min: number, max: number): boolean => s === null || (Array.from(s).length >= min && Array.from(s).length <= max);
const istMonth = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 7);
const check = (ok: boolean, name: string): void => {
  if (!ok) throw new RepoError("check", name);
};

function bindPlatformConsole(auth: AuthData, data: PlatformConsoleData): PlatformConsoleRepos {
  const metaOf = (id: string): MemHotelMeta => {
    const m = data.hotels.get(id);
    if (!m) throw new RepoError("check", "hotel without its platform row");
    return m;
  };
  const liveGroup = (id: string): MemGroup | undefined => data.groups.find((g) => g.id === id && g.deletedAt === null);
  const groupOfHotel = (hotelId: string): MemGroup | undefined => {
    const m = data.members.find((x) => x.hotelId === hotelId);
    return m ? liveGroup(m.groupId) : undefined;
  };
  const lockedNow = (u: AuthData["users"][number], now: Date): boolean => u.blockedAt !== null || (u.lockedUntil !== null && u.lockedUntil > now);

  /** Mirrors the hotels CHECKs of 0102 on the hotel as it stands. */
  function checkHotel(id: string): void {
    const h = auth.hotels.find((x) => x.id === id);
    const m = metaOf(id);
    const status = h?.status ?? "active";
    check(ALL_STATUSES.includes(status), "hotels_status_known");
    check(status !== "suspended" || m.suspendedAt !== null, "hotels_suspended_fields");
    check(status !== "rejected" || (m.rejectedAt !== null && m.rejectReason !== null), "hotels_rejected_fields");
    check(status !== "archived" || (m.archivedAt !== null && m.restoreUntil !== null && m.restoreUntil > m.archivedAt && m.statusBeforeArchive !== null), "hotels_archived_fields");
    check(status !== "deleted" || m.deletedAt !== null, "hotels_deleted_fields");
    check(!["active", "suspended"].includes(status) || m.provisionedAt !== null, "hotels_live_is_provisioned");
    check(!["invited", "onboarding", "pending_approval"].includes(status) || m.provisionedAt === null, "hotels_waiting_not_provisioned");
    check(len(m.suspendReason, 1, 500) && len(m.archiveReason, 1, 500) && len(m.rejectReason, 1, 500), "hotels_reason_length");
    check(m.statusBeforeArchive === null || ["active", "suspended", "rejected"].includes(m.statusBeforeArchive), "hotels_status_before_archive_check");
  }

  function hotelRow(id: string, now: Date): PlatformHotelRow | null {
    const h = auth.hotels.find((x) => x.id === id);
    const m = data.hotels.get(id);
    if (!h || !m || m.deletedAt !== null) return null;
    const status = h.status ?? "active";
    if (!LISTED.includes(status)) return null;
    const g = groupOfHotel(id);
    const admins = auth.memberships
      .filter((x) => x.hotelId === id)
      .map((x) => ({ x, u: auth.users.find((u) => u.id === x.userId && u.deletedAt === null) }))
      .filter((p) => p.u?.accountRole === "hotel_admin");
    return {
      id, name: h.name, slug: m.slug, city: m.city, state: m.state, gstin: m.gstin, timeZone: m.timeZone, status, createdAt: m.createdAt, provisionedAt: m.provisionedAt,
      submittedAt: m.submittedAt, approvedAt: m.approvedAt, rejectedAt: m.rejectedAt, rejectReason: m.rejectReason, suspendedAt: m.suspendedAt, suspendReason: m.suspendReason,
      archivedAt: m.archivedAt, archiveReason: m.archiveReason, restoreUntil: m.restoreUntil, statusBeforeArchive: m.statusBeforeArchive, lastActivityAt: m.lastActivityAt,
      groupId: g?.id ?? null, groupName: g?.name ?? null, invitationId: data.submissions.find((s) => s.hotelId === id)?.invitationId ?? null,
      adminCount: admins.length,
      lockedAdminCount: admins.filter((p) => p.u && !["pending_approval", "disabled"].includes(p.u.status) && p.x.status !== "disabled" && lockedNow(p.u, now)).length,
    };
  }

  function accountRow(id: string): PlatformAccountRow | null {
    const u = auth.users.find((x) => x.id === id && x.deletedAt === null);
    if (!u) return null;
    const mine = auth.memberships
      .filter((m) => m.userId === id)
      .filter((m) => {
        const h = auth.hotels.find((x) => x.id === m.hotelId);
        return h && h.status !== "deleted" && data.hotels.get(m.hotelId)?.deletedAt == null;
      });
    const m = mine.find((x) => x.isDefault) ?? mine[0];
    const h = m ? auth.hotels.find((x) => x.id === m.hotelId) : undefined;
    const hg = m ? groupOfHotel(m.hotelId) : undefined;
    const ag = data.groups.filter((g) => g.adminUserId === id && g.deletedAt === null).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    const g = hg ?? ag;
    return {
      id: u.id, username: u.username, email: u.email, mobile: u.mobile, displayName: u.displayName, accountRole: u.accountRole, status: u.status,
      memberDisabled: m?.status === "disabled", blocked: u.blockedAt !== null, lockedUntil: u.lockedUntil, lastLoginAt: u.lastLoginAt,
      lockedAt: u.blockedAt ?? auth.events.filter((e) => e.userId === u.id && e.event === "account_locked").reduce<Date | null>((acc, e) => (acc === null || e.at > acc ? e.at : acc), null),
      createdAt: data.accountMeta.get(u.id)?.createdAt ?? new Date(0),
      hotelId: h?.id ?? null, hotelName: h?.name ?? null, hotelStatus: h ? (h.status ?? "active") : null,
      groupId: g?.id ?? null, groupName: g?.name ?? null, groupAdminOf: ag ? { groupId: ag.id, groupName: ag.name } : null,
    };
  }

  function groupRow(g: MemGroup): PlatformGroupRow {
    const a = g.adminUserId ? auth.users.find((u) => u.id === g.adminUserId && u.deletedAt === null) : undefined;
    const ah = a && a.accountRole === "hotel_admin" ? accountRow(a.id) : null;
    return {
      id: g.id, name: g.name, slug: g.slug, status: g.status,
      admin: a ? { id: a.id, displayName: a.displayName, username: a.username, accountRole: a.accountRole, hotelId: ah?.hotelId ?? null, hotelName: ah?.hotelName ?? null } : null,
      hotelIds: data.members.filter((x) => x.groupId === g.id).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime()).map((x) => x.hotelId),
      createdAt: g.createdAt, legalName: g.legalName, gstin: g.gstin, address: g.address, city: g.city, state: g.state, pin: g.pin, phone: g.phone, email: g.email,
      invitationId: data.invites.filter((i) => i.groupId === g.id && i.type === "group").sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0]?.id ?? null,
      submittedAt: g.submittedAt, approvedAt: g.approvedAt, rejectedAt: g.rejectedAt, rejectReason: g.rejectReason,
    };
  }

  const hotels: PlatformHotelsRepo = {
    async list(filter, now) {
      return auth.hotels
        .map((h) => hotelRow(h.id, now))
        .filter((r): r is PlatformHotelRow => r !== null)
        .filter((r) => has(lower([r.name, r.slug, r.city, r.state, r.gstin, r.groupName].filter(Boolean).join(" ")), filter.words))
        .filter((r) => !filter.groupId || r.groupId === filter.groupId)
        .filter((r) => !filter.createdMonth || istMonth(r.createdAt) === filter.createdMonth)
        .sort((a, b) => (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : a.id < b.id ? -1 : 1))
        .map(clone);
    },
    async get(id, now) {
      const r = hotelRow(id, now);
      return r ? clone(r) : null;
    },
    async setLifecycle(id, patch) {
      const h = auth.hotels.find((x) => x.id === id);
      const m = data.hotels.get(id);
      if (!h || !m || m.deletedAt !== null) throw new RepoError("check", "no such hotel");
      h.status = patch.status;
      for (const key of ["suspendedAt", "suspendReason", "archivedAt", "archiveReason", "restoreUntil", "statusBeforeArchive", "approvedAt", "rejectedAt", "rejectReason"] as const) {
        if (patch[key] !== undefined) (m as unknown as Record<string, unknown>)[key] = patch[key];
      }
      checkHotel(id);
    },
    async addStatusHistory(row) {
      check(row.fromStatus !== row.toStatus, "hotel_status_history_is_a_change");
      check(row.toStatus !== "rejected" || row.reason !== null, "hotel_status_history_reject_reason");
      check(len(row.reason, 1, 500), "hotel_status_history_reason_check");
      check(row.traceId === null || TRACE.test(row.traceId), "hotel_status_history_trace_id_check");
      check(row.actorRole === null || ROLES.includes(row.actorRole), "hotel_status_history_actor_role_check");
      check(data.hotels.has(row.hotelId), "hotel_status_history_hotel_id_fkey");
      data.statusHistory.push(clone(row));
    },
    async endSessions(hotelId, now) {
      let n = 0;
      for (const s of auth.sessions) {
        if (s.hotelId === hotelId && s.revokedAt === null) {
          s.revokedAt = now;
          s.revokedReason = "admin";
          n += 1;
        }
      }
      return n;
    },
    async onboarding(hotelId) {
      const s = data.submissions.find((x) => x.hotelId === hotelId);
      return s ? clone({ invitationId: s.invitationId, payload: s.payload, submittedAt: s.submittedAt }) : null;
    },
    async invitationCounts(now) {
      const live = (id: string) => data.links.find((l) => l.invitationId === id && l.usedAt === null && l.revokedAt === null);
      return {
        open: data.invites.filter((i) => i.status === "pending" && (live(i.id)?.expiresAt ?? new Date(0)) > now).length,
        groupsWaiting: data.invites.filter((i) => i.type === "group" && (i.status === "pending" || i.status === "expired")).length,
      };
    },
    async slugTaken(slug) {
      return [...data.hotels.values()].some((m) => m.deletedAt === null && m.slug === slug);
    },
    async markDeleted(id, now) {
      const h = auth.hotels.find((x) => x.id === id);
      const m = data.hotels.get(id);
      if (!h || !m || m.deletedAt !== null) throw new RepoError("check", "no such hotel");
      h.status = "deleted";
      m.deletedAt = now;
      checkHotel(id);
    },
    async defaultGstPercent() {
      return Number(data.settings.get("new_hotel.gst_percent")?.value ?? data.defaultGstPercent);
    },
    async idPhotoExact(id) {
      const m = data.hotels.get(id);
      return Boolean(m && m.deletedAt === null && m.idPhotoExact);
    },
    async setIdPhotoExact(id, on) {
      const m = data.hotels.get(id);
      if (!m || m.deletedAt !== null) throw new RepoError("check", "no such hotel");
      m.idPhotoExact = on;
    },
  };

  const liveUser = (pred: (u: AuthData["users"][number]) => boolean): boolean => auth.users.some((u) => u.deletedAt === null && pred(u));

  const accounts: PlatformAccountsRepo = {
    async list(filter) {
      return auth.users
        .filter((u) => u.deletedAt === null && filter.accountRoles.includes(u.accountRole))
        .map((u) => accountRow(u.id))
        .filter((r): r is PlatformAccountRow => r !== null)
        .filter((r) => has(lower([r.displayName, r.username, r.email, r.mobile, r.hotelName, r.groupName, r.groupAdminOf?.groupName].filter(Boolean).join(" ")), filter.words))
        .filter((r) => !filter.hotelId || r.hotelId === filter.hotelId)
        .filter((r) => !filter.groupId || r.groupId === filter.groupId)
        .sort((a, b) => (lower(a.displayName) < lower(b.displayName) ? -1 : lower(a.displayName) > lower(b.displayName) ? 1 : a.id < b.id ? -1 : 1))
        .map(clone);
    },
    async get(id) {
      const r = accountRow(id);
      return r ? clone(r) : null;
    },
    usernameTaken: async (name) => liveUser((u) => u.username === name),
    emailTaken: async (email) => liveUser((u) => u.email === email),
    mobileTaken: async (mobile) => liveUser((u) => u.mobile === mobile),
    async hotelHasSuperAdmin(hotelId) {
      return auth.memberships.some((m) => {
        if (m.hotelId !== hotelId) return false;
        const u = auth.users.find((x) => x.id === m.userId && x.deletedAt === null);
        const role = u ? auth.roles.find((r) => r.id === (m.roleId ?? u.roleId)) : undefined;
        return role?.hotelId === null && role.key === "super_admin";
      });
    },
    async holdsOwnerRole(userId, hotelId) {
      return auth.memberships.some((m) => {
        if (m.hotelId !== hotelId || m.userId !== userId) return false;
        const u = auth.users.find((x) => x.id === m.userId && x.deletedAt === null);
        const role = u ? auth.roles.find((r) => r.id === (m.roleId ?? u.roleId)) : undefined;
        return role?.hotelId === null && role.key === "super_admin";
      });
    },
    async create(f, by, now) {
      const role = auth.roles.find((r) => r.hotelId === null && r.key === f.roleKey);
      if (!role) throw new RepoError("check", "no such built-in role");
      // the users CHECKs and live unique indexes (0003, 0006, 0105)
      check(/^[a-z0-9][a-z0-9._-]{2,63}$/.test(f.username), "users_username_check");
      check(f.email === f.email.toLowerCase() && f.email.length <= 254 && /^[^@\s]+@[^@\s]+$/.test(f.email), "users_email_check");
      check(/^\+91[6-9][0-9]{9}$/.test(f.mobile), "users_mobile_check");
      check(len(f.displayName, 1, 120), "users_display_name_check");
      check(ROLES.includes(f.accountRole), "users_account_role_known");
      if (liveUser((u) => u.username === f.username)) throw new RepoError("unique", "users_username_key");
      if (liveUser((u) => u.email === f.email)) throw new RepoError("unique", "users_email_key");
      if (liveUser((u) => u.mobile === f.mobile)) throw new RepoError("unique", "users_mobile_key");
      if (f.hotelId && !auth.hotels.some((h) => h.id === f.hotelId)) throw new RepoError("check", "user_hotels_hotel_id_fkey");
      const id = randomUUID();
      auth.users.push({
        id, username: f.username, email: f.email, mobile: f.mobile, displayName: f.displayName, passwordHash: UNUSABLE_PASSWORD, roleId: role.id, accountRole: f.accountRole,
        status: "invited", mustChangePassword: true, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null,
        codeRequired: false, lastLoginAt: null, deletedAt: null,
      });
      if (f.hotelId) auth.memberships.push({ userId: id, hotelId: f.hotelId, roleId: role.id, status: "active", isDefault: true, subject: null });
      data.accountMeta.set(id, { createdAt: now, createdBy: by });
      return id;
    },
    async setStatus(id, status, hotelId) {
      const u = auth.users.find((x) => x.id === id && x.deletedAt === null);
      if (!u) throw new RepoError("check", "no such user");
      u.status = status;
      if (status === "active" && hotelId) for (const m of auth.memberships) if (m.userId === id && m.hotelId === hotelId) m.status = "active";
    },
    async unlock(id) {
      const u = auth.users.find((x) => x.id === id);
      if (u) Object.assign(u, { failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null });
    },
    async endSessions(id, now) {
      let n = 0;
      for (const s of auth.sessions) {
        if (s.userId === id && s.revokedAt === null) {
          s.revokedAt = now;
          s.revokedReason = "admin";
          n += 1;
        }
      }
      return n;
    },
    activeSuperAdmins: async () => auth.users.filter((u) => u.deletedAt === null && u.accountRole === "super_admin" && u.status === "active").length,
    async closeOfHotel(hotelId, by, now) {
      void by;
      const alive = (id: string): boolean => {
        const meta = data.hotels.get(id);
        return !!meta && meta.deletedAt === null && auth.hotels.some((h) => h.id === id && h.status !== "deleted");
      };
      let n = 0;
      for (const u of auth.users) {
        if (u.deletedAt !== null || !["hotel_admin", "hotel_user"].includes(u.accountRole)) continue;
        const mine = auth.memberships.filter((m) => m.userId === u.id);
        if (!mine.some((m) => m.hotelId === hotelId) || mine.some((m) => m.hotelId !== hotelId && alive(m.hotelId))) continue;
        u.deletedAt = now;
        u.status = "disabled";
        for (const s of auth.sessions) if (s.userId === u.id && s.revokedAt === null) Object.assign(s, { revokedAt: now, revokedReason: "admin" });
        n += 1;
      }
      return n;
    },
  };

  const groups: PlatformGroupsRepo = {
    async list() {
      return data.groups
        .filter((g) => g.deletedAt === null)
        .sort((a, b) => (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : a.id < b.id ? -1 : 1))
        .map((g) => clone(groupRow(g)));
    },
    async get(id) {
      const g = liveGroup(id);
      return g ? clone(groupRow(g)) : null;
    },
    nameTaken: async (name) => data.groups.some((g) => g.deletedAt === null && lower(g.name) === lower(name)),
    slugTaken: async (slug) => data.groups.some((g) => g.deletedAt === null && g.slug === slug),
    async create(f, now) {
      check(len(f.name, 1, 200), "hotel_groups_name_check");
      check(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.slug) && f.slug.length <= 63, "hotel_groups_slug_check");
      if (data.groups.some((g) => g.deletedAt === null && g.slug === f.slug)) throw new RepoError("unique", "hotel_groups_slug_key");
      // hotel_groups_name_key: lower(name) among live groups that are not rejected
      if (data.groups.some((g) => g.deletedAt === null && g.status !== "rejected" && lower(g.name) === lower(f.name))) throw new RepoError("unique", "hotel_groups_name_key");
      const id = randomUUID();
      data.groups.push({
        id, name: f.name, slug: f.slug, status: "active", adminUserId: null, createdAt: now, deletedAt: null, legalName: null, gstin: null, address: null, city: null, state: null,
        pin: null, phone: null, email: null, submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null,
      });
      return id;
    },
    async groupOfHotel(hotelId) {
      const g = groupOfHotel(hotelId);
      return g ? { id: g.id, name: g.name } : null;
    },
    async link(groupId, hotelId, by, now) {
      if (!data.groups.some((g) => g.id === groupId)) throw new RepoError("check", "group_members_group_id_fkey");
      if (!data.hotels.has(hotelId)) throw new RepoError("check", "group_members_hotel_id_fkey");
      if (data.members.some((m) => m.hotelId === hotelId)) throw new RepoError("unique", "group_members_one_group_per_hotel_key");
      data.members.push({ groupId, hotelId, linkedBy: by, createdAt: now });
    },
    async unlink(groupId, hotelId) {
      const at = data.members.findIndex((m) => m.groupId === groupId && m.hotelId === hotelId);
      if (at < 0) return false;
      data.members.splice(at, 1);
      return true;
    },
    async setAdmin(groupId, userId) {
      const g = liveGroup(groupId);
      if (!g) throw new RepoError("check", "no such group");
      if (userId !== null && !auth.users.some((u) => u.id === userId)) throw new RepoError("check", "hotel_groups_admin_user_id_fkey");
      g.adminUserId = userId;
    },
    async setLifecycle(id, patch) {
      const g = liveGroup(id);
      if (!g) throw new RepoError("check", "no such group");
      check(GROUP_STATUSES.includes(patch.status), "hotel_groups_status_check");
      check(patch.status !== "rejected" || (patch.rejectReason ?? g.rejectReason) !== null, "hotel_groups_rejected_fields");
      g.status = patch.status;
      if (patch.approvedAt !== undefined) g.approvedAt = patch.approvedAt;
      if (patch.rejectedAt !== undefined) g.rejectedAt = patch.rejectedAt;
      if (patch.rejectReason !== undefined) g.rejectReason = patch.rejectReason;
    },
    async maxHotels(groupIds) {
      return new Map(data.groups.filter((g) => groupIds.includes(g.id) && typeof g.maxHotels === "number").map((g) => [g.id, g.maxHotels as number]));
    },
    async setMaxHotels(groupId, max) {
      const g = liveGroup(groupId);
      if (!g) throw new RepoError("check", "no such group");
      check(max === null || (Number.isInteger(max) && max >= 0 && max <= 10000), "hotel_groups_max_hotels_check");
      g.maxHotels = max;
      return true;
    },
    async countTowardLimit(groupId) {
      return data.members.filter((m) => {
        if (m.groupId !== groupId) return false;
        const status = auth.hotels.find((h) => h.id === m.hotelId)?.status;
        return data.hotels.get(m.hotelId)?.deletedAt == null && (status === "pending_approval" || status === "active" || status === "suspended");
      }).length;
    },
    async addHistory(row) {
      check(data.groups.some((g) => g.id === row.groupId), "group_history_group_id_fkey");
      check(!["hotel_linked", "hotel_unlinked"].includes(row.event) || row.hotelId !== null, "group_history_membership_names_hotel");
      check(row.event !== "admin_set" || row.adminUserId !== null, "group_history_admin_names_user");
      check(!["created", "submitted", "approved", "rejected", "suspended", "reactivated", "archived", "restored"].includes(row.event) || row.toStatus !== null, "group_history_status_events");
      check(row.event !== "rejected" || row.reason !== null, "group_history_reject_reason");
      check((row.fromStatus === null || GROUP_STATUSES.includes(row.fromStatus)) && (row.toStatus === null || GROUP_STATUSES.includes(row.toStatus)), "group_history_status_check");
      check(len(row.reason, 1, 500) && (row.traceId === null || TRACE.test(row.traceId)), "group_history_check");
      data.groupHistory.push(clone(row));
    },
  };

  const audit: PlatformAuditRepo = {
    async write(row) {
      if (data.failAuditWrites) throw new Error("audit write failed (test)");
      // the audit_log CHECKs (0005, 0107)
      check(len(row.action, 1, 80) && len(row.entity, 1, 80), "audit_log_action_entity_check");
      check(len(row.actorName, 1, 120) && len(row.targetLabel, 1, 200) && len(row.reason, 0, 500), "audit_log_text_check");
      check(row.userAgent === null || row.userAgent.length <= 400, "audit_log_user_agent_check");
      check(row.traceId === null || TRACE.test(row.traceId), "audit_log_trace_id_check");
      check(row.actorRole === null || ROLES.includes(row.actorRole), "audit_log_actor_role_check");
      check(row.result === "success" || row.result === "failed", "audit_log_result_check");
      check(row.hotelId === null || data.hotels.has(row.hotelId), "audit_log_hotel_id_fkey");
      check(row.groupId === null || data.groups.some((g) => g.id === row.groupId), "audit_log_group_id_fkey");
      // inside_hotel is true exactly when the row belongs to a visit (0107); the visit must exist
      check(row.visitId == null || auth.visits.some((v) => v.id === row.visitId), "audit_log_visit_id_fkey");
      const id = randomUUID();
      data.audit.push({ ...clone(row), id });
      return id;
    },
    async activity(filter, page) {
      const rows = data.audit
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a.result === "success" && (!filter.hotelId || a.hotelId === filter.hotelId) && (!filter.groupId || a.groupId === filter.groupId))
        .filter(({ a }) => {
          const hay = [a.actorName, a.action, a.entity, a.targetLabel, a.reason, a.hotelId ? auth.hotels.find((h) => h.id === a.hotelId)?.name : null, a.groupId ? data.groups.find((g) => g.id === a.groupId)?.name : null].filter(Boolean).join(" ").toLowerCase();
          return (filter.words ?? []).every((w) => hay.includes(w.toLowerCase()));
        })
        .sort((x, y) => y.a.at.getTime() - x.a.at.getTime() || y.i - x.i)
        .map(({ a }): PlatformActivityRow => ({
          id: a.id, at: a.at, actorName: a.actorName, action: a.action, entity: a.entity, entityId: a.entityId, hotelId: a.hotelId,
          hotelName: a.hotelId ? (auth.hotels.find((h) => h.id === a.hotelId)?.name ?? null) : null, groupId: a.groupId,
          groupName: a.groupId ? (data.groups.find((g) => g.id === a.groupId)?.name ?? null) : null, targetLabel: a.targetLabel, reason: a.reason,
        }));
      return { rows: clone(rows.slice(page.offset, page.offset + page.limit)), total: rows.length };
    },
  };

  // Enter hotel: the visits live in the sign-in data (the session resolver reads them); the rules are the trigger of 0106
  const STAFF: readonly AccountRole[] = ["super_admin", "platform_admin", "group_hotel_admin"];
  const visits: PlatformVisitsRepo = {
    async open(userId) {
      return clone(
        auth.visits
          .filter((v) => v.userId === userId && v.endedAt === null)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
          .map((v) => ({ id: v.id, userId: v.userId, hotelId: v.hotelId, hotelName: auth.hotels.find((h) => h.id === v.hotelId)?.name ?? "", sessionId: v.sessionId, reason: v.reason, startedAt: v.startedAt, expiresAt: v.expiresAt, access: v.access ?? "view" })),
      );
    },
    async start(f, now) {
      const user = auth.users.find((u) => u.id === f.userId && u.deletedAt === null);
      check(!!user && user.status === "active" && STAFF.includes(user.accountRole), "only active platform staff or a group admin can enter a hotel");
      const hotel = auth.hotels.find((h) => h.id === f.hotelId);
      const meta = data.hotels.get(f.hotelId);
      check(!!hotel && !!meta && meta.deletedAt === null && meta.provisionedAt !== null && ["active", "suspended"].includes(hotel.status ?? "active"), "only a live hotel can be entered");
      check(user?.accountRole !== "group_hotel_admin" || data.groups.some((g) => g.adminUserId === f.userId && g.status === "active" && data.members.some((m) => m.groupId === g.id && m.hotelId === f.hotelId)), "a group admin can enter only a hotel of their own group");
      // 0135: a group admin enters view only; a platform admin within the level and hotels the Super Admin gave them (no entry = view, all hotels)
      check(user?.accountRole !== "group_hotel_admin" || f.access === "view", "a group admin enters view only");
      if (user?.accountRole === "platform_admin") {
        const a = auth.adminAccess.find((x) => x.userId === f.userId);
        const level = a?.level ?? "view";
        check(level !== "none", "this platform admin may not enter hotels");
        check(!a || a.allHotels || a.hotelIds.includes(f.hotelId), "this hotel is outside the platform admin's hotels");
        check(f.access === "view" || level === "full", "this platform admin enters view only");
      }
      check(Array.from(f.reason.trim()).length >= 1 && Array.from(f.reason).length <= 500, "hotel_visits_reason_check");
      check(f.expiresAt > now && f.expiresAt.getTime() <= now.getTime() + 60 * 60_000, "hotel_visits_window");
      if (auth.visits.some((v) => v.userId === f.userId && v.endedAt === null)) throw new RepoError("unique", "hotel_visits_one_active_per_user_key");
      const id = randomUUID();
      auth.visits.push({ id, userId: f.userId, hotelId: f.hotelId, sessionId: f.sessionId, reason: f.reason, startedAt: now, expiresAt: f.expiresAt, endedAt: null, endedReason: null, endedBy: null, ip: f.ip, userAgent: f.userAgent, access: f.access, extendedFrom: f.extendedFrom ?? null });
      return id;
    },
    async end(id, reason, by, now) {
      const v = auth.visits.find((x) => x.id === id);
      if (!v || v.endedAt !== null) return;
      check(now >= v.startedAt, "hotel_visits_end_after_start");
      v.endedAt = now;
      v.endedReason = reason;
      v.endedBy = by;
    },
  };

  // ---- P5: the Super Admin's audit log, sign-in history, settings, exports and health
  const auditLog: PlatformAuditSearchRepo = {
    async search(filter, page) {
      const rows = data.audit
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => (!filter.action || a.action === filter.action) && (!filter.hotelId || a.hotelId === filter.hotelId) && (!filter.actor || a.actorName === filter.actor))
        .filter(({ a }) => (!filter.from || a.at >= filter.from) && (!filter.to || a.at < filter.to))
        .sort((x, y) => y.a.at.getTime() - x.a.at.getTime() || y.i - x.i)
        .map(({ a }): PlatformAuditEntryRow => ({
          id: a.id, at: a.at, actorName: a.actorName, action: a.action, entity: a.entity, entityId: a.entityId, hotelId: a.hotelId,
          hotelName: a.hotelId ? (auth.hotels.find((h) => h.id === a.hotelId)?.name ?? null) : null, groupId: a.groupId,
          groupName: a.groupId ? (data.groups.find((g) => g.id === a.groupId)?.name ?? null) : null, targetLabel: a.targetLabel, reason: a.reason,
          actorRole: a.actorRole, result: a.result, insideHotel: a.visitId != null, ip: a.ip, userAgent: a.userAgent,
        }));
      return { rows: clone(rows.slice(page.offset, page.offset + page.limit)), total: rows.length };
    },
    async actors() {
      return [...new Set(data.audit.map((a) => a.actorName))].sort((x, y) => (lower(x) < lower(y) ? -1 : lower(x) > lower(y) ? 1 : x < y ? -1 : 1));
    },
    async lastActors(action, hotelIds) {
      const out = new Map<string, string>();
      for (const a of [...data.audit].reverse()) if (a.action === action && a.result === "success" && a.hotelId && hotelIds.includes(a.hotelId) && !out.has(a.hotelId)) out.set(a.hotelId, a.actorName);
      return out;
    },
  };

  const SIGN_IN_EVENTS = ["login_success", "login_failed", "account_locked", "code_failed"];
  const signIns: PlatformSignInsRepo = {
    async recent(limit) {
      const out = auth.events
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => SIGN_IN_EVENTS.includes(e.event))
        .sort((x, y) => y.e.at.getTime() - x.e.at.getTime() || y.i - x.i)
        .slice(0, limit)
        .map(({ e, i }): SignInEvent => {
          const u = e.userId ? auth.users.find((x) => x.id === e.userId) : undefined;
          const row = u ? accountRow(u.id) : null;
          const eventHotel = e.hotelId ? auth.hotels.find((h) => h.id === e.hotelId)?.name : undefined;
          return {
            id: `ev-${i + 1}`, at: e.at, event: e.event as SignInEvent["event"], userId: u?.id ?? null, username: u?.username ?? null, name: u?.displayName ?? null, accountRole: u?.accountRole ?? null,
            hotelName: eventHotel ?? row?.hotelName ?? row?.groupAdminOf?.groupName ?? null, detail: (e.detail as Record<string, unknown> | null) ?? null, ip: e.ip ?? null, userAgent: e.userAgent ?? null,
          };
        });
      return clone(out);
    },
  };

  const settings: PlatformSettingsRepo = {
    async all() {
      return [...data.settings.entries()]
        .filter(([, s]) => !s.secret)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, s]): SettingRow => ({ key, value: clone(s.value), updatedAt: s.updatedAt, updatedBy: s.updatedBy, updatedByName: s.updatedBy ? (auth.users.find((u) => u.id === s.updatedBy)?.displayName ?? null) : null }));
    },
    async set(key, value, by, now, options) {
      // the known-values CHECK of 0108
      const v = value as unknown;
      check(key !== "new_hotel.role_keys" || (Array.isArray(v) && v.includes("super_admin")), "platform_settings_known_values");
      check(key !== "new_hotel.gst_percent" || [0, 5, 12, 18, 28].includes(v as number), "platform_settings_known_values");
      check(key !== "new_hotel.time_zone" || (typeof v === "string" && v.length >= 1 && v.length <= 64), "platform_settings_known_values");
      check(key !== "mail.from_name" || (typeof v === "string" && v.length >= 1 && v.length <= 120), "platform_settings_known_values");
      check(key !== "mail.from_email" || v === null || (typeof v === "string" && /^[^@\s]+@[^@\s]+$/.test(v)), "platform_settings_known_values");
      // the SMTP keys of 0123
      check(key !== "mail.smtp_host" || v === null || (typeof v === "string" && v.length >= 1 && v.length <= 253 && /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(v)), "platform_settings_known_values");
      check(key !== "mail.smtp_port" || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535), "platform_settings_known_values");
      check(key !== "mail.smtp_security" || (typeof v === "string" && ["starttls", "ssl", "none"].includes(v)), "platform_settings_known_values");
      check(key !== "mail.smtp_user" || v === null || (typeof v === "string" && v.length >= 1 && v.length <= 254 && !/[\u0000-\u001f\u007f]/.test(v)), "platform_settings_known_values");
      check(key !== "mail.smtp_password" || v === null || (typeof v === "string" && /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v) && v.length <= 2000), "platform_settings_known_values");
      check(key !== "mail.smtp_password" || options?.secret === true, "platform_settings_secret_keys");
      check(key !== "mail.reply_to" || v === null || (typeof v === "string" && v.length <= 254 && /^[^@\s]+@[^@\s]+$/.test(v)), "platform_settings_known_values");
      check(key !== "mail.test_result" || v === null || (typeof v === "object" && v !== null && "at" in v && "ok" in v && "message" in v), "platform_settings_known_values");
      // the security CHECK of 0192
      const minutesIn = (x: unknown, lo: number, hi: number): boolean => typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi;
      check(key !== "security.session_minutes" || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => minutesIn(x, 15, 43200))), "platform_settings_security_values");
      check(key !== "security.temp_password_minutes" || minutesIn(v, 5, 1440), "platform_settings_security_values");
      data.settings.set(key, { value: clone(v), updatedAt: now, updatedBy: by, ...(options?.secret ? { secret: true } : {}) });
      // the sign-in side reads the same platform_settings rows: one store in the database, mirrored here
      if (key === "security.session_minutes") auth.security = { ...auth.security, sessionMinutes: clone(v) };
      if (key === "security.temp_password_minutes") auth.security = { ...auth.security, tempPasswordMinutes: v };
    },
    async secretChangedAt(keys) {
      return new Map(keys.flatMap((k): [string, Date][] => { const s = data.settings.get(k); return s && s.secret && s.value !== null && s.value !== "" ? [[k, s.updatedAt]] : []; }));
    },
    async secrets(keys) {
      return new Map(keys.flatMap((k): [string, string | null][] => { const s = data.settings.get(k); return s && s.secret ? [[k, typeof s.value === "string" && s.value !== "" ? s.value : null]] : []; }));
    },
  };

  const exportsRepo: PlatformExportsRepo = {
    async readyOf(hotelIds) {
      const out = new Map<string, HotelExportRow>();
      for (const e of data.exports) if (hotelIds.includes(e.hotelId) && (!out.has(e.hotelId) || e.finishedAt >= (out.get(e.hotelId) as HotelExportRow).finishedAt)) out.set(e.hotelId, clone({ id: e.id, hotelId: e.hotelId, fileName: e.fileName, byteSize: e.byteSize, sha256: e.sha256, requestedBy: e.requestedBy, finishedAt: e.finishedAt }));
      return out;
    },
    async record(f) {
      check(/^[a-z0-9][a-z0-9._-]{0,199}$/.test(f.fileName) && /^[0-9a-f]{64}$/.test(f.sha256) && f.byteSize >= 0 && f.finishedAt >= f.startedAt, "hotel_exports_ready_fields");
      check(data.hotels.has(f.hotelId), "hotel_exports_hotel_id_fkey");
      const id = randomUUID();
      data.exports.push({ id, hotelId: f.hotelId, requestedBy: f.requestedBy, fileName: f.fileName, fileRef: f.fileRef, byteSize: f.byteSize, sha256: f.sha256, startedAt: f.startedAt, finishedAt: f.finishedAt });
      return id;
    },
    async recordDeletion(f) {
      // the rules of the deletion trigger (0102), whatever the service did
      const by = auth.users.find((u) => u.id === f.deletedBy && u.deletedAt === null);
      check(!!by && by.accountRole === "super_admin" && by.status === "active", "only an active Super Admin can delete a hotel for good");
      const h = auth.hotels.find((x) => x.id === f.hotelId);
      const m = data.hotels.get(f.hotelId);
      check(!!h && !!m && h.status === "archived" && m.deletedAt === null, "only an archived hotel can be deleted for good");
      check(!m || m.restoreUntil === null || m.restoreUntil <= f.at, "the archive grace period of this hotel is not over");
      check(!!m && f.slug === m.slug && f.confirmSlug === f.slug && f.schemaName === `hotel_${f.hotelId.replace(/-/g, "")}`, "the typed address does not match the hotel");
      check(data.exports.some((e) => e.id === f.exportId && e.hotelId === f.hotelId), "a finished export of this hotel is required before it is deleted for good");
      if (data.deletions.some((d) => d.hotelId === f.hotelId)) throw new RepoError("unique", "hotel_deletions_hotel_id_key");
      data.deletions.push(clone(f));
    },
    async schemaOf(hotelId) {
      return data.hotels.has(hotelId) ? `hotel_${hotelId.replace(/-/g, "")}` : null;
    },
  };

  const backups: PlatformBackupsRepo = {
    async latestOf(hotelIds) {
      const out = new Map<string, HotelBackupRow>();
      for (const b of data.backups) {
        if (b.status !== "ready" || !hotelIds.includes(b.hotelId)) continue;
        const have = out.get(b.hotelId);
        if (!have || b.finishedAt >= have.finishedAt) out.set(b.hotelId, rowOf(b));
      }
      return out;
    },
    async readyOf(hotelId) {
      return data.backups.filter((b) => b.status === "ready" && b.hotelId === hotelId).sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime()).map(rowOf);
    },
    async record(f) {
      check(data.hotels.has(f.hotelId), "hotel_backups_hotel_id_fkey");
      const id = randomUUID();
      if (f.status === "ready") {
        check(/^[a-z0-9][a-z0-9._-]{0,199}$/.test(f.fileName) && /^[0-9a-f]{64}$/.test(f.sha256) && f.byteSize >= 0 && f.tableCount >= 0 && f.rowCount >= 0, "hotel_backups_ready_fields");
        data.backups.push({ id, status: "ready", hotelId: f.hotelId, fileName: f.fileName, fileRef: f.fileRef, byteSize: f.byteSize, sha256: f.sha256, tableCount: f.tableCount, rowCount: f.rowCount, errorCode: null, startedAt: f.startedAt, finishedAt: f.finishedAt });
      } else {
        check(f.errorCode.length >= 1 && f.errorCode.length <= 80, "hotel_backups_failed_fields");
        data.backups.push({ id, status: "failed", hotelId: f.hotelId, fileName: "", fileRef: "", byteSize: 0, sha256: "", tableCount: 0, rowCount: 0, errorCode: f.errorCode, startedAt: f.startedAt, finishedAt: f.finishedAt });
      }
      return id;
    },
    async remove(id) {
      data.backups = data.backups.filter((b) => b.id !== id);
    },
  };
  const rowOf = (b: PlatformConsoleData["backups"][number]): HotelBackupRow => ({ id: b.id, hotelId: b.hotelId, fileName: b.fileName, fileRef: b.fileRef, byteSize: b.byteSize, sha256: b.sha256, tableCount: b.tableCount, rowCount: b.rowCount, finishedAt: b.finishedAt });

  const health: PlatformHealthRepo = {
    async storageBytes(hotelIds) {
      return new Map([...data.storageBytes].filter(([id]) => hotelIds.includes(id)));
    },
    async hotelsWithFailedMail(since) {
      const out = new Set<string>();
      for (const o of auth.outbox) {
        if (o.status !== "failed" || o.createdAt < since) continue;
        // a mail of the hotel's own sender (0118) names the hotel; a person's mail names the person, whose hotels count
        if (o.hotelId) out.add(o.hotelId);
        if (o.userId) for (const mm of auth.memberships) if (mm.userId === o.userId) out.add(mm.hotelId);
      }
      return out;
    },
    async ping() {
      return 1;
    },
  };

  const announcementOf = (a: PlatformConsoleData["announcements"][number]): AnnouncementRow => ({
    ...clone(a), createdByName: a.createdBy ? (auth.users.find((u) => u.id === a.createdBy)?.displayName ?? null) : null, reads: data.announcementReads.filter((r) => r.announcementId === a.id).length,
  });
  const announcements: PlatformAnnouncementsRepo = {
    async list() {
      // newest first; at the same instant the later insert wins (the database's uuidv7 ids order the same way)
      return data.announcements.map((a, i) => ({ a, i })).sort((x, y) => y.a.createdAt.getTime() - x.a.createdAt.getTime() || y.i - x.i).map(({ a }) => announcementOf(a));
    },
    async get(id) {
      const a = data.announcements.find((x) => x.id === id);
      return a ? announcementOf(a) : null;
    },
    async create(f, by, now) {
      check(f.title.length >= 1 && f.title.length <= 120, "announcements_title_check");
      check(f.body.length >= 1 && f.body.length <= 2000, "announcements_body_check");
      check(f.endsAt === null || f.endsAt > f.startsAt, "announcements_ends_after_start");
      const id = randomUUID();
      data.announcements.push({ id, title: f.title, body: f.body, audience: f.audience, important: f.important, startsAt: f.startsAt, endsAt: f.endsAt, endedAt: null, createdBy: by, createdAt: now });
      return id;
    },
    async end(id, now) {
      const a = data.announcements.find((x) => x.id === id);
      if (!a || a.endedAt !== null || (a.endsAt !== null && a.endsAt <= now)) return false;
      a.endedAt = now;
      return true;
    },
    async unreadFor(userId, audiences, now) {
      return data.announcements
        .filter((a) => a.endedAt === null && a.startsAt <= now && (a.endsAt === null || a.endsAt > now) && audiences.includes(a.audience))
        .filter((a) => !data.announcementReads.some((r) => r.announcementId === a.id && r.userId === userId))
        .map((a, i) => ({ a, i }))
        .sort((x, y) => x.a.startsAt.getTime() - y.a.startsAt.getTime() || x.i - y.i)
        .map(({ a }) => announcementOf(a));
    },
    async markRead(id, userId, now) {
      if (!data.announcements.some((a) => a.id === id)) throw new RepoError("check", "no such announcement");
      if (!data.announcementReads.some((r) => r.announcementId === id && r.userId === userId)) data.announcementReads.push({ announcementId: id, userId, at: now });
    },
  };

  const adminAccess: PlatformAdminAccessRepo = {
    async get(userId) {
      const a = auth.adminAccess.find((x) => x.userId === userId);
      return a ? { level: a.level, allHotels: a.allHotels, hotelIds: a.allHotels ? [] : [...a.hotelIds], reason: a.reason, updatedBy: a.updatedBy, updatedAt: a.updatedAt } : { level: "view", allHotels: true, hotelIds: [], reason: null, updatedBy: null, updatedAt: null };
    },
    async set(userId, access, by, now) {
      check(access.reason === null || (access.reason.trim().length >= 3 && access.reason.trim().length <= 300), "platform_admin_hotel_access_reason_check");
      for (const h of access.hotelIds) check(auth.hotels.some((x) => x.id === h), "platform_admin_hotel_access_hotels_hotel_id_fkey");
      const row = { userId, level: access.level, allHotels: access.allHotels, hotelIds: access.allHotels ? [] : [...new Set(access.hotelIds)], reason: access.reason, updatedBy: by, updatedAt: now };
      const i = auth.adminAccess.findIndex((x) => x.userId === userId);
      if (i >= 0) auth.adminAccess[i] = row;
      else auth.adminAccess.push(row);
      return true;
    },
  };

  const hotelMail: PlatformHotelMailRepo = {
    async get(hotelId) {
      const r = data.hotelMail.find((x) => x.hotelId === hotelId);
      return r ? clone(r) : null;
    },
    async all() {
      return data.hotelMail.map((r) => clone(r));
    },
    async save(hotelId, patch, _by, now) {
      let r = data.hotelMail.find((x) => x.hotelId === hotelId);
      if (!r) {
        r = { hotelId, sesRegion: null, sesUser: null, sesPassword: null, sesFrom: null, gmailUser: null, gmailPassword: null, fromName: null, replyTo: null, sesTest: null, gmailTest: null, updatedAt: now };
        data.hotelMail.push(r);
      }
      Object.assign(r, patch, { updatedAt: now });
    },
    async setTest(hotelId, which, result, now) {
      const r = data.hotelMail.find((x) => x.hotelId === hotelId);
      if (!r) return;
      if (which === "ses") r.sesTest = result;
      else r.gmailTest = result;
      r.updatedAt = now;
    },
  };
  const groupMail: PlatformGroupMailRepo = {
    async get(groupId) {
      const r = data.groupMail.find((x) => x.groupId === groupId);
      return r ? clone(r) : null;
    },
    async all() {
      return data.groupMail.map((r) => clone(r));
    },
    async save(groupId, patch, _by, now) {
      let r = data.groupMail.find((x) => x.groupId === groupId);
      if (!r) {
        r = { groupId, sesRegion: null, sesUser: null, sesPassword: null, sesFrom: null, gmailUser: null, gmailPassword: null, fromName: null, replyTo: null, sesTest: null, gmailTest: null, updatedAt: now };
        data.groupMail.push(r);
      }
      Object.assign(r, patch, { updatedAt: now });
    },
    async setTest(groupId, which, result, now) {
      const r = data.groupMail.find((x) => x.groupId === groupId);
      if (!r) return;
      if (which === "ses") r.sesTest = result;
      else r.gmailTest = result;
      r.updatedAt = now;
    },
  };
  return { hotels, accounts, groups, audit, auth: memoryAuthRepos(auth), ...bindInvitations(auth, data), visits, adminAccess, auditLog, signIns, settings, exports: exportsRepo, backups, health, announcements, hotelMail, groupMail };
}

/** A unit over the sign-in store (the same "platform" data as createMemoryAuth): one at a time, and a failed unit restores both data sets. */
export function createMemoryPlatformConsole(auth: { store: MemoryStore<AuthData> } = createMemoryAuth()): { unit: PlatformConsoleUnit; data: PlatformConsoleData } {
  const holder = { data: emptyPlatformConsoleData() };
  return {
    get data() {
      return holder.data;
    },
    unit: {
      run: <T>(work: (repos: PlatformConsoleRepos) => Promise<T>): Promise<T> =>
        auth.store.exclusive("platform", async (authData) => {
          const before = clone(holder.data);
          try {
            return await work(bindPlatformConsole(authData, holder.data));
          } catch (error) {
            holder.data = before;
            throw error;
          }
        }),
    },
  };
}

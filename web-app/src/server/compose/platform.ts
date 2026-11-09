import "server-only";
import { randomBytes } from "node:crypto";
import { getDatabase } from "../../db";
import { createArgon2Hasher } from "../auth/password";
import { getConfig } from "../config/env";
import { smtpSecretKeyOf } from "../mail/key";
import { getLogger } from "../logger";
import { parseHashKey } from "../crypto/hash";
import { createLocalProvisioner } from "../provisioner/local";
import { createMemoryProvisioner } from "../provisioner/memory";
import { createMemoryAuth } from "../repos/memory/auth";
import { createMemoryPlatformConsole } from "../repos/memory/platformConsole";
import { createPgPlatformConsoleUnit } from "../repos/postgres/platformConsole";
import { createCredentialService } from "../services/auth/credentialService";
import type { InviteDeps } from "../services/platform/context";
import { billingDefaults } from "./billing";
import { summarySession } from "./dailySummary";
import { istMoment, monthRange } from "../services/cash/ist";
import { createGroupService, type GroupService } from "../services/platform/groupService";
import { createHotelService, type HotelService } from "../services/platform/hotelService";
import { createInvitationService, type InvitationService } from "../services/platform/invitationService";
import { createStaffService, type StaffService } from "../services/platform/staffService";
import { createAnnouncementService, type AnnouncementService } from "../services/platform/announcementService";
import { createGroupMailService, createHotelMailService, type GroupMailService, type HotelMailService } from "../services/platform/hotelMailService";
import { createArchiveService, type ArchiveService } from "../services/platform/archiveService";
import { createAuditService, type AuditService } from "../services/platform/auditService";
import { createHealthService, type HealthService } from "../services/platform/healthService";
import { createSettingsService, type SettingsService } from "../services/platform/settingsService";
import { createSecurityService, type SecurityService } from "../services/platform/securityService";
import { forgetAllSessions } from "../services/auth/sessionResolver";
import { createMailUsageService, type MailUsageService } from "../services/platform/mailUsageService";
import { createIdentityService, type IdentityService } from "../services/platform/identityService";
import { createUserService, type UserService } from "../services/platform/userService";
import { createVisitService, type VisitService } from "../services/platform/visitService";
import { createGroupConsoleService, type GroupConsoleService } from "../services/platform/groupConsoleService";
import { createApiTokenService, type ApiTokenService } from "../services/platform/apiTokenService";
import { createMailSafetyService, type MailSafetyService } from "../services/platform/mailSafetyService";
import { getSessionResolver } from "./auth";
import { inboundAddress, inboundTopicArn } from "./mailInbound";

// The composition root of the Platform console (Platform Admin and Super Admin; docs/BACKEND.md section 14): PostgreSQL when DATABASE_URL and
// HMS_HASH_KEY are set, the in-memory double otherwise. The credential side works on the SAME transaction as the console action, so a temporary
// password, its mail and the audit row commit or roll back together. Building a hotel on approval goes through the provisioner (owner side).
interface Services {
  mailUsage: MailUsageService;
  identities: IdentityService;
  hotels: HotelService;
  groups: GroupService;
  invitations: InvitationService;
  users: UserService;
  staff: StaffService;
  audit: AuditService;
  settings: SettingsService;
  health: HealthService;
  archive: ArchiveService;
  visits: VisitService;
  /** The Group Hotel Admin console (routes under /group), built on the same units with the group-mode gate. */
  group: GroupConsoleService;
  /** P4: announcements to the hotels (the console writes, every hotel account reads). */
  announcements: AnnouncementService;
  /** A hotel's own mail accounts: Amazon SES and Google (Platform > Hotel mail, migration 0161). */
  hotelMail: HotelMailService;
  /** A group's own mail accounts: Amazon SES and Google (Platform > Hotel mail, groups; migration 0162). */
  groupMail: GroupMailService;
  /** API access keys (Platform settings > API access, migration 0129). */
  apiTokens: ApiTokenService;
  /** Deliverability: bounces, complaints, the suppression list and hotel holds (Platform settings > Mail; platform migration 0130). */
  mailSafety: MailSafetyService;
  /** Platform settings > Security (session time per user kind, temporary password time). A change drops this process's cached sessions, so it applies at their next request. */
  security: SecurityService;
}

let services: Services | null = null;

/** One error with its cause chain, as plain log fields (name, message, SQLSTATE code, first stack lines). */
function errorFields(error: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let e: unknown = error;
  for (let i = 0; i < 5 && e !== undefined && e !== null; i += 1) {
    const x = e as { name?: unknown; message?: unknown; code?: unknown; failure?: unknown; stack?: unknown; cause?: unknown };
    out.push({ name: String(x.name ?? typeof e), message: String(x.message ?? e), code: x.code ?? x.failure ?? null, stack: typeof x.stack === "string" ? x.stack.split("\n").slice(0, 6).join("\n") : null });
    e = x.cause;
  }
  return out;
}

const report = (message: string, error: unknown, traceId: string): void => getLogger().error(message, { traceId, causes: errorFields(error) });

function platformDeps(): InviteDeps {
  const config = getConfig();
  const hasher = createArgon2Hasher();
  const now = (): Date => new Date();
  const credentials: InviteDeps["credentials"] = (repos) => createCredentialService({ unit: { run: (work) => work(repos.auth) }, hasher, now });
  const publicUrl = config.HMS_PUBLIC_URL ?? "http://localhost:3000";
  const newToken = (): string => randomBytes(32).toString("base64url");
  // Enter hotel, Extend and Exit drop the session from the resolver's cache, so this process sees the visit on the next request
  const forgetSession = (sessionId: string): void => getSessionResolver().forgetSession(sessionId);
  if (config.DATABASE_URL && config.HMS_HASH_KEY) {
    return {
      unit: createPgPlatformConsoleUnit(getDatabase().pool), credentials, now, report, hasher, publicUrl, newToken, forgetSession,
      hashKey: parseHashKey(config.HMS_HASH_KEY), provisioner: createLocalProvisioner({ nodeEnv: config.NODE_ENV }),
      // P1: the month's guest bills per hotel, one figures query each through the hotel's own unit with the read-only summary view; a hotel that cannot be read is left out
      billsThisMonth: async (hotelIds, at) => {
        const month = monthRange(istMoment(at).date);
        const out = new Map<string, { count: number; billedPaise: number }>();
        for (const hotelId of hotelIds) {
          try {
            const f = await billingDefaults().unit.run(summarySession(hotelId), (repos) => repos.bills.figures(month.from, month.to));
            out.set(hotelId, { count: f.monthCount, billedPaise: Number(f.monthBilledPaise) });
          } catch {
            // the column stays empty for this hotel; the rest of the page is unaffected
          }
        }
        return out;
      },
    };
  }
  const auth = createMemoryAuth();
  const cons = createMemoryPlatformConsole(auth);
  return {
    unit: cons.unit, credentials, now, report, hasher, publicUrl, newToken, forgetSession, hashKey: randomBytes(32),
    provisioner: createMemoryProvisioner({ auth: () => auth.data(), console: () => cons.data, now }),
  };
}

/** A Group Hotel Admin reached for another group's record: a Critical security event (loaded on that event only). */
function tellSecurityOfCrossTenant(v: { userId: string; groupId: string; what: string }): void {
  void import("./security")
    .then((m) => m.getSecurity().events.record({ kind: "cross_hotel_attempt", summary: `A group admin asked for a ${v.what.replace("_", " ")} that belongs to another group`, detail: { userId: v.userId, groupId: v.groupId, what: v.what } }))
    .catch(() => undefined);
}

export function buildPlatformServices(deps: InviteDeps): Services {
  return { hotels: createHotelService(deps), groups: createGroupService(deps), invitations: createInvitationService(deps), users: createUserService(deps), staff: createStaffService(deps), audit: createAuditService(deps), mailUsage: createMailUsageService(deps), identities: createIdentityService(deps), settings: createSettingsService({ ...deps, smtp: { secretKey: smtpSecretKeyOf(getConfig()), envFrom: getConfig().SMTP_FROM }, mailboxReading: () => import("./conversations").then((m) => m.getPlatformConversations().readingLine()) }), health: createHealthService(deps), archive: createArchiveService(deps), visits: createVisitService(deps), group: createGroupConsoleService({ ...deps, onTenantViolation: deps.onTenantViolation ?? tellSecurityOfCrossTenant }), announcements: createAnnouncementService(deps), hotelMail: createHotelMailService({ ...deps, hotelMail: { secretKey: smtpSecretKeyOf(getConfig()), inbound: () => ({ address: inboundAddress(), topicSet: inboundTopicArn() !== null }), mailboxRegistry: { setHotelReading: (hotelId, on) => import("./conversations").then((m) => m.hotelMailboxRegistry().setHotelReading(hotelId, on)) } } }), groupMail: createGroupMailService({ ...deps, hotelMail: { secretKey: smtpSecretKeyOf(getConfig()), inbound: () => ({ address: inboundAddress(), topicSet: inboundTopicArn() !== null }) } }), apiTokens: createApiTokenService(deps), mailSafety: createMailSafetyService({ ...deps, webhookBase: getConfig().HMS_PUBLIC_URL ?? null }), security: createSecurityService({ ...deps, onChanged: forgetAllSessions }) };
}

let deps: InviteDeps | null = null;
const depsOf = (): InviteDeps => (deps ??= platformDeps());
const all = (): Services => (services ??= buildPlatformServices(depsOf()));
/** The platform console's unit (the hotel list) for jobs that run across hotels (the daily summary). */
export const getPlatformConsoleUnit = (): InviteDeps["unit"] => depsOf().unit;
/** The credential side the console uses for one unit (the invitation mail, an e-mail change): the Central tabs' Logins writes go through it. */
export const getPlatformCredentials = (): InviteDeps["credentials"] => depsOf().credentials;
export const getPlatformHotels = (): HotelService => all().hotels;
export const getPlatformGroups = (): GroupService => all().groups;
export const getPlatformInvitations = (): InvitationService => all().invitations;
export const getPlatformUsers = (): UserService => all().users;
export const getPlatformStaff = (): StaffService => all().staff;
export const getPlatformAudit = (): AuditService => all().audit;
export const getPlatformSettings = (): SettingsService => all().settings;
export const getPlatformMailUsage = (): MailUsageService => all().mailUsage;
export const getPlatformIdentities = (): IdentityService => all().identities;
export const getPlatformHealth = (): HealthService => all().health;
export const getPlatformArchive = (): ArchiveService => all().archive;
export const getPlatformVisits = (): VisitService => all().visits;
export const getPlatformAnnouncements = (): AnnouncementService => all().announcements;
export const getPlatformHotelMail = (): HotelMailService => all().hotelMail;
export const getPlatformGroupMail = (): GroupMailService => all().groupMail;
export const getGroupConsole = (): GroupConsoleService => all().group;
export const getPlatformApiTokens = (): ApiTokenService => all().apiTokens;
export const getPlatformMailSafety = (): MailSafetyService => all().mailSafety;
export const getPlatformSecurity = (): SecurityService => all().security;

/** Replaces the services (start-up code and tests). */
export function configurePlatform(next: Services | null): void {
  services = next;
}

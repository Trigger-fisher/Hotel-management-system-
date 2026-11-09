import "server-only";
import { isIP } from "node:net";
import type { PlatformActivityAction } from "@shared/dashboards/platform";
import { platformCopy } from "@shared/dashboards/platform";
import { isPortalAccount } from "../../auth/permissions";
import type { AccountRole, VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { requestMeta, type RequestMeta } from "../../http/meta";
import type { PlatformAuditRow, PlatformConsoleRepos, PlatformConsoleUnit } from "../../repos/platformConsole";

// Who may use the Platform console, and the one audit writer every console action goes through (BRIEF-BACKEND-PLATFORM rules 4 and 7).
// Only the ACCOUNT roles platform_admin and super_admin; a guest, corporate contact, hotel staff member or Group Hotel Admin gets 403, and a
// refused WRITE is kept in the audit trail as a failed row. Identity comes from the verified session, never from input.

export type PlatformRole = "platform_admin" | "super_admin";
const PLATFORM_ROLES: ReadonlySet<string> = new Set<PlatformRole>(["platform_admin", "super_admin"]);

/** What a console service knows about the request: trace id, address, browser (for the audit row). */
export interface PlatformMeta extends RequestMeta {
  userAgent: string | null;
}

/** The request facts for the audit row: a valid IP only (anything else is dropped, never stored), the user agent cut to 400 printable characters. */
export function platformMeta(request: Request, traceId: string): PlatformMeta {
  const base = requestMeta(request, traceId);
  const agent = (request.headers.get("user-agent") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 400);
  return { traceId, ip: base.ip && isIP(base.ip) ? base.ip : null, userAgent: agent === "" ? null : agent };
}

/** The signed-in platform person, as the audit row names them. */
export interface Actor {
  userId: string;
  role: PlatformRole | "group_hotel_admin";
  name: string;
  isSuper: boolean;
}

/** The account role check, from the verified session (before any data is read). */
function isPlatformStaff(session: Pick<VerifiedSession, "accountRole" | "scope">): boolean {
  return !isPortalAccount(session) && PLATFORM_ROLES.has(session.accountRole);
}

export interface AuditInput {
  /** The contract's action names, plus two the contract does not list yet (contract requests): a refused write inside a hotel, an audit-log export. */
  action: PlatformActivityAction | "hotel_write_refused" | "hotel_write_started" | "hotel_write" | "audit_exported" | "conversation_updated";
  entity: "hotel" | "group" | "user" | "invitation" | "platform";
  entityId: string | null;
  hotelId?: string | null;
  groupId?: string | null;
  targetLabel?: string | null;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** The Enter-hotel visit this belongs to (its start, its end, a refused write inside): the row is then marked inside_hotel. */
  visitId?: string | null;
}

const short = (s: string | null | undefined, max: number): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : Array.from(t).slice(0, max).join("");
};

export function auditRow(actor: { userId: string | null; name: string; role: AccountRole | null }, meta: PlatformMeta, input: AuditInput, result: "success" | "failed", at: Date): PlatformAuditRow {
  return {
    actorUserId: actor.userId, actorName: short(actor.name, 120) ?? "Unknown", actorRole: actor.role, action: input.action, entity: input.entity, entityId: input.entityId,
    hotelId: input.hotelId ?? null, groupId: input.groupId ?? null, targetLabel: short(input.targetLabel, 200), reason: short(input.reason, 500), result,
    before: input.before ?? null, after: input.after ?? null, ip: meta.ip, userAgent: meta.userAgent, traceId: meta.traceId, at, visitId: input.visitId ?? null,
  };
}

export interface Gate {
  /** The caller as a platform actor, re-read inside the unit (the account must still be an active Platform or Super Admin). */
  actor(repos: PlatformConsoleRepos, session: VerifiedSession): Promise<Actor>;
  /** 403 for anyone but Platform / Super Admin (reads: no audit row). */
  read(session: VerifiedSession): void;
  /** 403 for anyone but Platform / Super Admin; a refused write is audited as failed, in its own unit. */
  write(session: VerifiedSession, meta: PlatformMeta, input: AuditInput): Promise<void>;
  /** 403 for anyone but the Super Admin (a write refused this way is audited). */
  superWrite(session: VerifiedSession, meta: PlatformMeta, input: AuditInput): Promise<void>;
  superRead(session: VerifiedSession): void;
  /** Writes a failed audit row in its own unit and returns the error to throw. */
  refuse(session: VerifiedSession, meta: PlatformMeta, input: AuditInput, error: AppError): Promise<AppError>;
  /** Writes the success row in the caller's unit and returns the audit row's id. */
  audit(repos: PlatformConsoleRepos, actor: Actor, meta: PlatformMeta, input: AuditInput): Promise<string>;
}

/**
 * The gate of the Platform console (mode "platform": Platform and Super Admin) or of the Group Hotel Admin console (mode "group": only an active Group
 * Hotel Admin; never the Super-Admin-only actions). The group mode lets the same services serve the group console; WHICH records a group admin may touch
 * is the group console service's job (services/platform/groupConsoleService.ts), done before any of them is called.
 */
export function createGate(unit: PlatformConsoleUnit, now: () => Date, mode: "platform" | "group" = "platform"): Gate {
  const staff = (s: Pick<VerifiedSession, "accountRole" | "scope">): boolean => (mode === "group" ? !isPortalAccount(s) && s.accountRole === "group_hotel_admin" : isPlatformStaff(s));
  const roles: ReadonlySet<string> = mode === "group" ? new Set(["group_hotel_admin"]) : PLATFORM_ROLES;
  async function refuse(session: VerifiedSession, meta: PlatformMeta, input: AuditInput, error: AppError): Promise<AppError> {
    const write = (row: AuditInput) =>
      unit.run(async (repos) => {
        const who = await repos.accounts.get(session.userId);
        const name = session.token ? `API token: ${session.token.name}` : (who?.displayName ?? "Unknown");
        await repos.audit.write(auditRow({ userId: who ? session.userId : null, name, role: session.accountRole }, meta, { ...row, reason: error.message }, "failed", now()));
      });
    try {
      await write(input);
    } catch {
      // a refused attempt may name a hotel or group that does not exist: keep the row without those targets; the refusal itself always stands
      await write({ ...input, hotelId: null, groupId: null, entityId: null }).catch(() => undefined);
    }
    return error;
  }
  const forbidden = () => new AppError("FORBIDDEN");
  const superOnly = () => new AppError("FORBIDDEN", platformCopy.a8Errors.superOnly);
  return {
    async actor(repos, session) {
      const row = await repos.accounts.get(session.userId);
      // the session said platform staff; the account must still say so now (a role or status change takes effect at once)
      if (!row || row.status !== "active" || !roles.has(row.accountRole) || row.accountRole !== session.accountRole) throw forbidden();
      // a call made with an API access key is audited under the key's name, never as the Super Admin who made it (platform migration 0129)
      return { userId: row.id, role: row.accountRole as Actor["role"], name: session.token ? `API token: ${session.token.name}` : row.displayName, isSuper: row.accountRole === "super_admin" };
    },
    read(session) {
      if (!staff(session)) throw forbidden();
    },
    superRead(session) {
      if (!staff(session)) throw forbidden();
      if (session.accountRole !== "super_admin") throw superOnly();
    },
    async write(session, meta, input) {
      if (!staff(session)) throw await refuse(session, meta, input, forbidden());
    },
    async superWrite(session, meta, input) {
      if (!staff(session)) throw await refuse(session, meta, input, forbidden());
      if (session.accountRole !== "super_admin") throw await refuse(session, meta, input, superOnly());
    },
    refuse,
    async audit(repos, actor, meta, input) {
      return repos.audit.write(auditRow({ userId: actor.userId, name: actor.name, role: actor.role }, meta, input, "success", now()));
    },
  };
}

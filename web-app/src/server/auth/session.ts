import "server-only";
import type { Role } from "@shared/auth/types";
import type { Level } from "./levels";

/** The 8 account roles of ui-shared/auth/types.ts. The account role picks the DASHBOARD and, for guest and corporate accounts, the record scope. It never decides what a person may do in a hotel: the permission role does (roleKey, roleLevel) and the engine's snapshot. The platform owner has account role super_admin and is NOT the hotel's SuperAdmin; platform staff acting inside a hotel go through withHotelAs with an explicit, audited role.  the permission snapshot picks what the hotel screens allow. */
export type AccountRole = Role;

/** A guest or corporate contact is limited to their own records: the company or guest the account points at (user_hotels.subject_*). */
export interface RecordScope {
  kind: "company" | "guest";
  id: string;
}

/**
 * Who is calling and what they may do, as the server verified it. The hotel comes from here (the session row), never from the
 * request. `permissions` is the person's EFFECTIVE level per module/part key in THIS hotel, already built from the role, the
 * roles below it and the person's own grants and revokes (see permissions.ts); a key that is missing means no access.
 */
export interface VerifiedSession {
  readonly userId: string;
  /** The login name (platform.users.username), set by the real resolver; used to show the person their own sign-in name. */
  readonly username?: string;
  readonly hotelId: string;
  readonly accountRole: AccountRole;
  readonly roleId: string;
  /** The key and level of the person's permission ROLE in this hotel (roles.key, roles.level): Pallav's Viewer 1, Editor 2, Admin 3, SuperAdmin 4 and custom ones. This, not accountRole, decides "super admin" and "below my level". */
  readonly roleKey: string;
  readonly roleLevel: number;
  readonly permissions: Readonly<Record<string, Level>>;
  readonly sessionId: string;
  /** "web" = a browser (cookie) session: writes need the same-origin check. "token" = an API key (platform.api_tokens, `token` below): no cookie, so no same-origin check; the wrapper applies the key's own rules instead. */
  readonly client: "web" | "token";
  /** Present only for an API key (client "token"): which key, so the audit names it, the rate limit counts it and the wrapper enforces its level and scope. */
  readonly token?: { readonly id: string; readonly name: string; readonly level: "read" | "full" | "ai"; readonly scope: "platform" | "hotel" | "all"; readonly testMode: boolean; readonly callsPerMinute: number; /** The caller's address, and whether the key was never used from it before (the audit notes a new address). */ readonly ip: string | null; readonly newIp: boolean };
  /** Present only for guest and corporate accounts. */
  readonly scope?: RecordScope;
  /** The super admin has armed force mode for this session (Pallav ForceMode); only ever true for someone holding the ability system.force. */
  readonly forceMode?: boolean;
  /** When this session ends as things stand now (the idle expiry, never past lifeEndsAt). Set by the real resolver. */
  readonly expiresAt?: Date;
  /** The absolute end: the sign-in plus the time the Super Admin set for this user kind (Platform settings > Security). */
  readonly lifeEndsAt?: Date;
  /** The last vault re-check of this session (password or emailed code); a vault shows a secret only within RECHECK_MINUTES of it. */
  readonly recheckedAt?: Date;
  /** The person locked the screen (sessions.locked_at): every route not marked `whileLocked` answers 423 SCREEN_LOCKED until the password unlocks it. */
  readonly locked?: boolean;
  /**
   * Platform staff INSIDE a hotel (Enter hotel; BACKEND.md 14.7): set only by the session resolver while a visit is active. The hotel routes then see this
   * hotel with its SuperAdmin permission role, READ ONLY: the route wrapper refuses every write to a hotel route family while this is present.
   */
  /**
   * An Enter-hotel visit (platform staff inside a hotel). `access` (platform 0135): 'view' = read only (a READ ONLY transaction, the wrapper refuses writes); 'full' = writes
   * allowed within the wrapper's deny list, each audited. `by` is the visitor's account role (the limits differ: a platform admin may change no account or role).
   */
  readonly visit?: { readonly id: string; readonly hotelId: string; readonly hotelName: string; readonly expiresAt: Date; readonly access: "view" | "full"; readonly by: AccountRole };
}

/**
 * Finds the session of a request, or null when there is none or it is not valid. The real one reads the cookie or token; tests pass their own.
 * `fresh`: ask the database even when a copy of this session is still trusted in-process (the route wrapper does this once before refusing a platform
 * account that may have entered a hotel on another instance a moment ago). A resolver that has no cache ignores it.
 */
export type SessionResolver = (request: Request, options?: { fresh?: boolean }) => Promise<VerifiedSession | null>;

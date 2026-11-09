import "server-only";
import type { Page } from "@shared/dashboards/common";
import type { PasswordHasher } from "../../auth/password";
import type { HotelProvisioner } from "../../provisioner/port";
import type { Gate } from "./access";
import type { AdminCredentials } from "../auth/credentialPort";
import type { PlatformConsoleRepos, PlatformConsoleUnit } from "../../repos/platformConsole";

// What every console service is built from: the unit (one transaction on the platform schema), the credential side for ONE unit (so a temporary
// password, its mail and the audit row commit or roll back together), and the clock.
export interface ConsoleDeps {
  unit: PlatformConsoleUnit;
  /** The credential service working on THIS unit's sign-in tables (compose passes `{ run: (w) => w(repos.auth) }` to createCredentialService). */
  credentials: (repos: PlatformConsoleRepos) => AdminCredentials;
  now: () => Date;
  /** The gate these services use: the Platform console's own by default; the group console passes the group-mode gate (services/platform/access.ts). */
  gate?: Gate;
  /** Server-side error report for a failure the client only sees as a plain sentence (provisioner, export, drop). Never sent to the client. */
  report?: (message: string, error: unknown, traceId: string) => void;
  /** Drops a session from the session resolver's in-process cache (an Enter-hotel visit started, extended or ended must show on the very next request here). */
  forgetSession?: (sessionId: string) => void;
  /**
   * A Group Hotel Admin asked for a record that EXISTS but belongs to another group (a hotel, an invitation, a Hotel Admin). The screens never offer such an id, so this is a person
   * probing across tenants (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 7: Critical). An id that does not exist at all is not reported. Best effort; carries ids only.
   */
  onTenantViolation?: (violation: { userId: string; groupId: string; what: "hotel" | "invitation" | "hotel_admin" }) => void;
}

/** What invitations, the public onboarding form and approval need on top of the console's own: the token key, the public address, the password hasher, the provisioner. */
export interface InviteDeps extends ConsoleDeps {
  /** HMS_HASH_KEY: the invitation token is stored only as an HMAC under it. */
  hashKey: Buffer;
  /** Where people open the app (HMS_PUBLIC_URL); invitation links are built from it. */
  publicUrl: string;
  hasher: PasswordHasher;
  provisioner: HotelProvisioner;
  /** 256 random bits as text; tests fix it. */
  newToken: () => string;
  /** Platform health (P1): the guest bills each of these hotels made this calendar month (count, total); a hotel missing from the map was not readable. */
  billsThisMonth?: (hotelIds: readonly string[], at: Date) => Promise<Map<string, { count: number; billedPaise: number }>>;
}

export const words =(s: string | undefined): string[] => (s ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);

/** A page of an already filtered, already sorted list. */
export function paged<T>(all: readonly T[], page: number, pageSize: number): Page<T> {
  return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
}

export const byName = <T extends { name: string }>(x: T, y: T): number => x.name.localeCompare(y.name, "en");

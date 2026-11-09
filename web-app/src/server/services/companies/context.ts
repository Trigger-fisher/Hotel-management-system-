import "server-only";
import type { Catalog } from "../../auth/catalog";
import type { CentralProfilesUnit } from "../../repos/centralProfiles";
import type { CompaniesRepos, CustomerRecord } from "../../repos/companies";
import type { Unit } from "../../repos/types";
import type { PeopleDirectory, PlatformAudit } from "../cash/ports";

// What the companies services share: dependencies and a PORT to the platform (owned by the auth module, Worker A; ruled 2026-10-05).

/** A customer's guest-portal login lives on the PLATFORM (users + user_hotels.subject_id/kind), never on the customer row (Pallav keeps it there). */
export interface GuestAccounts {
  /** A new login with a temporary password emailed through the outbox (must change at first sign-in). `emailed`: false without an email. */
  issue(hotelId: string, customer: Pick<CustomerRecord, "id" | "name" | "email" | "mobile">): Promise<{ emailed: boolean }>;
  /** A new temporary password, emailed. */
  reset(hotelId: string, customer: Pick<CustomerRecord, "id" | "name" | "email" | "mobile">): Promise<{ emailed: boolean }>;
  /** When each customer last signed in to the portal. */
  lastLogins(hotelId: string, customerIds: readonly string[]): Promise<Map<string, Date>>;
}

export interface CompaniesDeps {
  unit: Unit<CompaniesRepos>;
  people: PeopleDirectory;
  audit: PlatformAudit;
  catalog: Catalog;
  now: () => Date;
  guestAccounts: GuestAccounts;
  /** The ONE common guest and company profile (platform 0132): staff screens show it and a save changes it. Absent, or a database before 0132 = the hotel's own record only. */
  central?: CentralProfilesUnit;
}

export const COMPANIES_LOG = "companies";

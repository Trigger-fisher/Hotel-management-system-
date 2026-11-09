import "server-only";
import { getMailQueue } from "./mailQueue";
import { createCatalog } from "../auth/catalog";
import { PERMISSION_CATALOG } from "../auth/catalog.generated";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createMemoryHotel } from "../repos/memory/frontOffice";
import { createPgHotelUnit } from "../repos/postgres/hotel";
import { createPgPeopleDirectory, createPgPlatformAudit } from "../repos/postgres/people";
import type { CompaniesRepos } from "../repos/companies";
import type { FrontOfficeRepos } from "../repos/frontOffice";
import type { PayrollCoreRepos } from "../repos/payrollCore";
import type { PayrollPayRepos } from "../repos/payrollPay";
import type { WebsiteRepos } from "../repos/website";
import type { Unit } from "../repos/types";
import { createAdvanceService, type AdvanceDeps, type AdvanceService } from "../services/billing/advanceService";
import { createBillService, type BillService } from "../services/billing/billService";
import type { PeopleDirectory, PlatformAudit } from "../services/cash/ports";

// The composition root of the billing module: which repositories, directory and clock the billing services really get. With DATABASE_URL set the PostgreSQL repositories (repos/postgres/hotel.ts)
// are used; without it the in-memory ones (nobody can sign in then, so every signed-in route answers 401). One file decides, no service or route knows.
let advances: AdvanceService | null = null;
let bills: BillService | null = null;
/** The mail queue is looked up when a mail is queued (tests swap it with configureMailQueue). */
const lazyMail: NonNullable<AdvanceDeps["mail"]> = { queue: (m) => getMailQueue().queue(m) };
let shared: (AdvanceDeps & { unit: Unit<FrontOfficeRepos & CompaniesRepos & PayrollCoreRepos & PayrollPayRepos & WebsiteRepos> }) | null = null;

/**
 * One set of dependencies (ONE in-memory store per hotel) for every billing AND front-office service: a bill, the advance it takes money
 * off, and the stay checked out into it live in the same hotel data and change in one unit.
 */
export function billingDefaults(): AdvanceDeps & { unit: Unit<FrontOfficeRepos & CompaniesRepos & PayrollCoreRepos & PayrollPayRepos & WebsiteRepos> } {
  if (shared) return shared;
  if (getConfig().DATABASE_URL) {
    const { withHotel, pool } = getDatabase();
    shared = { unit: createPgHotelUnit(withHotel), people: createPgPeopleDirectory(pool), audit: createPgPlatformAudit(pool), catalog: createCatalog(PERMISSION_CATALOG), now: () => new Date(), mail: lazyMail };
    return shared;
  }
  const people: PeopleDirectory = { get: async () => new Map() };
  const audit: PlatformAudit = { record: async () => undefined };
  shared = { unit: createMemoryHotel().unit, people, audit, catalog: createCatalog(PERMISSION_CATALOG), now: () => new Date(), mail: lazyMail };
  return shared;
}
const defaults = billingDefaults;

export function getBillingAdvances(): AdvanceService {
  advances ??= createAdvanceService(defaults());
  return advances;
}

/** Replaces the advance service (start-up code and tests). */
export function configureBillingAdvances(next: AdvanceService | null): void {
  advances = next;
}

export function getBillingBills(): BillService {
  bills ??= createBillService(defaults());
  return bills;
}

/** Replaces the bill service (start-up code and tests). */
export function configureBillingBills(next: BillService | null): void {
  bills = next;
}

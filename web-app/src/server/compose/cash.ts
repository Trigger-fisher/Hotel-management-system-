import "server-only";
import { getDatabase } from "../../db";
import { createCatalog } from "../auth/catalog";
import { PERMISSION_CATALOG } from "../auth/catalog.generated";
import { getConfig } from "../config/env";
import { createMemoryCash } from "../repos/memory/cashDeposit";
import { createPgCashUnit } from "../repos/postgres/cash";
import { createPgPeopleDirectory, createPgPlatformAudit } from "../repos/postgres/people";
import type { PeopleDirectory, PlatformAudit } from "../services/cash/ports";
import { createExpenseService, type ExpenseService } from "../services/cash/expenseService";
import { createLookupsService, type LookupsService } from "../services/cash/lookupsService";
import { createRevenueService, type RevenueDeps, type RevenueService } from "../services/cash/revenueService";

// The composition root of the cash module: which repositories, directory and clock the revenue service really gets. With DATABASE_URL set
// (npm run db:cli -- setup) they are the PostgreSQL ones; without it the in-memory ones (nobody can sign in then, so every signed-in route
// answers 401). Nothing else changes: a service or a route never knows which it has.
let service: RevenueService | null = null;
let expenses: ExpenseService | null = null;
let lookups: LookupsService | null = null;
let shared: RevenueDeps | null = null;

/** One set of dependencies (one in-memory store) shared by every cash service, so a deposit and an expense live in the same hotel data. */
function defaults(): RevenueDeps {
  if (shared) return shared;
  if (getConfig().DATABASE_URL) {
    const { withHotel, pool } = getDatabase();
    shared = { unit: createPgCashUnit(withHotel), people: createPgPeopleDirectory(pool), audit: createPgPlatformAudit(pool), catalog: createCatalog(PERMISSION_CATALOG), now: () => new Date() };
    return shared;
  }
  const people: PeopleDirectory = { get: async () => new Map() };
  const audit: PlatformAudit = { record: async () => undefined };
  shared = { unit: createMemoryCash().unit, people, audit, catalog: createCatalog(PERMISSION_CATALOG), now: () => new Date() };
  return shared;
}

/** The cash module's shared dependencies (its unit): the recycle bin's cash sources list deleted entries through it (compose/recycle.ts). */
export const cashDefaults = (): RevenueDeps => defaults();

export function getCashRevenue(): RevenueService {
  service ??= createRevenueService(defaults());
  return service;
}

export function getCashLookups(): LookupsService {
  lookups ??= createLookupsService(defaults());
  return lookups;
}

export function getCashExpenses(): ExpenseService {
  expenses ??= createExpenseService(defaults());
  return expenses;
}

/** Replaces the lookups service (tests). */
export function configureCashLookups(next: LookupsService | null): void {
  lookups = next;
}

/** Replaces the revenue service (start-up code and tests). */
export function configureCashRevenue(next: RevenueService | null): void {
  service = next;
}

/** Replaces the expense service (start-up code and tests). */
export function configureCashExpenses(next: ExpenseService | null): void {
  expenses = next;
}

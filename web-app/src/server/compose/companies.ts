import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createPgCentralProfilesUnit } from "../repos/postgres/centralProfiles";
import { getHashKey } from "../crypto";
import { createCompanyService, type CompanyService } from "../services/companies/companyService";
import type { GuestAccounts } from "../services/companies/context";
import { createCustomerService, type CustomerService } from "../services/companies/customerService";
import { createLedgerService, type LedgerService } from "../services/companies/ledgerService";
import { createMarketingService, type MarketingPorts, type MarketingService } from "../services/companies/marketingService";
import { getPlatformUnit } from "./auth";
import { billingDefaults } from "./billing";
import { campaignLimits } from "./mail";

// The composition root of the companies module: the SAME unit as billing and the front office (the ledger reads Bill Master in one
// transaction), the customers' own ID-number column, and the platform PORTS. Until the auth module implements it (Worker A, ruled),
// the guest-portal login is a stub that issues nothing (emailed: false). Email marketing talks to the platform outbox and users through
// the platform unit (one outbox row per address, the campaign's template name for its counts, the signed-in person's address for a test).
export const noGuestAccounts: GuestAccounts = {
  issue: async () => ({ emailed: false }),
  reset: async () => ({ emailed: false }),
  lastLogins: async () => new Map(),
};

function marketingPorts(): MarketingPorts {
  const platform = getPlatformUnit();
  return {
    enqueue: (hotelId, to, template, payload) => platform.run((r) => r.outbox.enqueue({ userId: null, hotelId, kind: "campaign", toEmail: to, template, payload: JSON.stringify(payload) }, new Date())),
    deliveries: (hotelId, templates) => platform.run((r) => r.outbox.countByTemplate(hotelId, templates)),
    emailOf: async (userId) => (await platform.run((r) => r.users.byId(userId)))?.email ?? null,
    publicUrl: getConfig().HMS_PUBLIC_URL ?? "http://localhost:3000",
    secret: () => getHashKey(),
    // the campaign engine (platform 0130): the suppression list, the hotel's hold, the running list, the mail service's pace
    suppressedAmong: (hotelId, emails) => platform.run((r) => r.mailSafety.suppressedAmong(hotelId, emails)),
    heldReason: async (hotelId) => {
      const hold = await platform.run((r) => r.mailSafety.hold(hotelId));
      return hold && hold.releasedAt === null ? hold.detail : null;
    },
    limits: (hotelId) => campaignLimits(hotelId),
    runs: {
      start: (hotelId, campaignId) => platform.run((r) => r.campaignRuns.start(hotelId, campaignId, new Date())),
      setState: (hotelId, campaignId, state) => platform.run((r) => r.campaignRuns.setState(hotelId, campaignId, state)),
      end: (hotelId, campaignId) => platform.run((r) => r.campaignRuns.end(hotelId, campaignId)),
    },
    cancelQueued: (hotelId, template) => platform.run((r) => r.outbox.cancelTemplate(hotelId, template)),
  };
}

let services: { companies: CompanyService; customers: CustomerService; marketing: MarketingService; ledger: LedgerService } | null = null;

function build() {
  // the ONE common guest and company profile (platform 0132): staff screens show it and saves keep it in step (each service falls back to the hotel's record without it)
  const central = getConfig().DATABASE_URL ? createPgCentralProfilesUnit(getDatabase().pool) : undefined;
  const deps = { ...billingDefaults(), guestAccounts: noGuestAccounts, central };
  const companies = createCompanyService(deps);
  const customers = createCustomerService(deps);
  return { companies, customers, marketing: createMarketingService(deps, marketingPorts()), ledger: createLedgerService(deps, companies) };
}

export const getCompanies = (): CompanyService => (services ??= build()).companies;
export const getCustomers = (): CustomerService => (services ??= build()).customers;
export const getMarketing = (): MarketingService => (services ??= build()).marketing;
export const getCompanyLedger = (): LedgerService => (services ??= build()).ledger;

/** Replaces the companies services (start-up code and tests). */
export function configureCompanies(next: typeof services): void {
  services = next;
}

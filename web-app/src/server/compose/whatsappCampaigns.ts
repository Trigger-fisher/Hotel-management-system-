import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { AppError } from "../errors";
import { pgBillingRepos } from "../repos/postgres/billing";
import { pgCampaignRuns, pgCampaignStore } from "../repos/postgres/whatsappCampaigns";
import { createPgUnit } from "../repos/postgres/unit";
import type { Unit } from "../repos/types";
import { createCampaignService, type CampaignRepos, type CampaignService } from "../services/whatsapp/campaignService";
import { createMemoryCampaignRuns, sweepCampaigns, type CampaignRunsStore, type SweepCampaignsResult } from "../whatsapp/campaignRunner";
import { createMemoryCampaignStore } from "../whatsapp/campaignStore";
import { billingDefaults } from "./billing";
import { getWhatsAppSender } from "./whatsappSend";
import { hotelAcceptedTerms } from "./whatsappTerms";

// The composition of a hotel's WhatsApp campaigns: the service for the screen, and the sweep step that sends the next few guests of every running campaign. The campaigns are rows of the hotel's own
// schema (hotel 0058); the list of running ones is on the platform (platform 0185). Without a database everything is in memory, with the same rules.
let service: CampaignService | null = null;
let unitOf: Unit<CampaignRepos> | null = null;
let runsOf: CampaignRunsStore | null = null;

function parts(): { unit: Unit<CampaignRepos>; runs: CampaignRunsStore } {
  if (unitOf && runsOf) return { unit: unitOf, runs: runsOf };
  const live = Boolean(getConfig().DATABASE_URL);
  if (live) {
    unitOf = createPgUnit(getDatabase().withHotel, (tx) => ({ campaigns: pgCampaignStore(tx), systemLogs: pgBillingRepos(tx).systemLogs }));
    runsOf = pgCampaignRuns(getDatabase().pool);
  } else {
    const memory = createMemoryCampaignStore();
    unitOf = {
      run: async (session, work) => {
        if (session.hotelId === "") throw new AppError("FORBIDDEN", "This account is not inside a hotel. Open a hotel first, or use the console.");
        return work({ campaigns: memory, systemLogs: { write: async () => undefined } as unknown as CampaignRepos["systemLogs"] });
      },
    };
    runsOf = createMemoryCampaignRuns();
  }
  return { unit: unitOf, runs: runsOf };
}

export function getWhatsAppCampaigns(): CampaignService {
  if (service) return service;
  const base = billingDefaults();
  const { unit, runs } = parts();
  service = createCampaignService({ unit, runs, people: base.people, catalog: base.catalog, now: base.now, termsAccepted: hotelAcceptedTerms });
  return service;
}

/** One turn of the sweep for campaigns: a few guests of each running campaign that is due. Zero when WhatsApp is not set up. Never throws (the sweep goes on without it). */
export async function runWhatsAppCampaigns(): Promise<SweepCampaignsResult> {
  const sender = getWhatsAppSender();
  if (!sender || !getConfig().DATABASE_URL) return { campaigns: 0, sent: 0 };
  const { unit, runs } = parts();
  return sweepCampaigns({ unit: unit as never, sender, runs }).catch(() => ({ campaigns: 0, sent: 0 }));
}

/** Replaces the service (start-up code and tests). */
export function configureWhatsAppCampaigns(next: CampaignService | null): void {
  service = next;
}

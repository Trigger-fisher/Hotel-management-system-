import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { AppError } from "../errors";
import { pgBillingRepos } from "../repos/postgres/billing";
import { memoryWaConsentRepo, pgWaConsentRepo } from "../repos/postgres/whatsappConsent";
import { createPgUnit } from "../repos/postgres/unit";
import type { Unit } from "../repos/types";
import { createConsentService, type ConsentRepos, type ConsentService } from "../services/whatsapp/consentService";
import { billingDefaults } from "./billing";

// The composition of the guest-consent service (Conversations > a WhatsApp chat > the guest's agreement). Without a database it keeps the answers in memory, with the same rules.
let service: ConsentService | null = null;

export function getWhatsAppConsent(): ConsentService {
  if (service) return service;
  const base = billingDefaults();
  const memory = memoryWaConsentRepo();
  const unit: Unit<ConsentRepos> = getConfig().DATABASE_URL
    ? createPgUnit(getDatabase().withHotel, (tx) => ({ consent: pgWaConsentRepo(tx), systemLogs: pgBillingRepos(tx).systemLogs }))
    : {
        run: async (session, work) => {
          if (session.hotelId === "") throw new AppError("FORBIDDEN", "This account is not inside a hotel. Open a hotel first, or use the console.");
          return work({ consent: memory, systemLogs: { write: async () => undefined } as unknown as ConsentRepos["systemLogs"] });
        },
      };
  service = createConsentService({ unit, people: base.people, catalog: base.catalog, now: base.now });
  return service;
}

/** Replaces the service (start-up code and tests). */
export function configureWhatsAppConsent(next: ConsentService | null): void {
  service = next;
}

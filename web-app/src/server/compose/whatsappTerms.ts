import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { AppError } from "../errors";
import { pgAdminRepos } from "../repos/postgres/admin";
import { pgBillingRepos } from "../repos/postgres/billing";
import { createPgUnit } from "../repos/postgres/unit";
import type { Unit } from "../repos/types";
import { createTermsService, type TermsRepos, type TermsService } from "../services/whatsapp/termsService";
import { termsAcceptanceOf, WA_TERMS_KEY } from "../whatsapp/terms";
import { billingDefaults } from "./billing";

// The composition of the WhatsApp terms of a hotel (Settings > WhatsApp). The acceptance is the hotel's own settings row. Without a database it is kept in memory, with the same rules.
let service: TermsService | null = null;

export function getWhatsAppTerms(): TermsService {
  if (service) return service;
  const base = billingDefaults();
  const memory = new Map<string, string | null>();
  const unit: Unit<TermsRepos> = getConfig().DATABASE_URL
    ? createPgUnit(getDatabase().withHotel, (tx) => ({ adminSettings: pgAdminRepos(tx).adminSettings, systemLogs: pgBillingRepos(tx).systemLogs }))
    : {
        run: async (session, work) => {
          if (session.hotelId === "") throw new AppError("FORBIDDEN", "This account is not inside a hotel. Open a hotel first, or use the console.");
          return work({
            adminSettings: {
              get: async (keys) => keys.filter((k) => memory.has(`${session.hotelId}:${k}`)).map((k) => ({ key: k, value: memory.get(`${session.hotelId}:${k}`) ?? null })),
              set: async (rows) => void rows.forEach((r) => memory.set(`${session.hotelId}:${r.key}`, r.value)),
            },
            systemLogs: { write: async () => undefined } as unknown as TermsRepos["systemLogs"],
          });
        },
      };
  service = createTermsService({ unit, people: base.people, catalog: base.catalog, now: base.now });
  return service;
}

/** Has this hotel's admin accepted the CURRENT terms? The sender's gate (compose/whatsappPlatformChat.ts). A hotel that cannot be read counts as not accepted. */
export async function hotelAcceptedTerms(hotelId: string): Promise<boolean> {
  if (!getConfig().DATABASE_URL) return true; // no database: nothing is sent anyway (the local demo)
  const rows = await getDatabase()
    .withHotel({ hotelId, readOnly: true }, (tx) => pgAdminRepos(tx).adminSettings.get([WA_TERMS_KEY]))
    .catch(() => []);
  return termsAcceptanceOf(rows[0]?.value) !== null;
}

/** Replaces the service (start-up code and tests). */
export function configureWhatsAppTerms(next: TermsService | null): void {
  service = next;
}

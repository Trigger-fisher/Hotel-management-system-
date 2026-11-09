import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createPgWaRulesStore } from "../repos/postgres/whatsappRules";
import { createMemoryWaRulesStore, createWaRulesService, type WaRulesService } from "../services/whatsapp/rulesService";
import { getPlatformConsoleUnit } from "./platform";

// The composition of the Rules screen's backend: PostgreSQL when DATABASE_URL and HMS_HASH_KEY are set (the same condition as the platform console, whose unit carries the settings and
// the audit), the in-memory double otherwise. Built on first use, so the build and the tests need no database.
let service: WaRulesService | undefined;

export function getWhatsAppRules(): WaRulesService {
  if (!service) {
    const c = getConfig();
    const store = c.DATABASE_URL && c.HMS_HASH_KEY ? createPgWaRulesStore(getDatabase().pool) : createMemoryWaRulesStore();
    service = createWaRulesService({ unit: getPlatformConsoleUnit(), store, now: () => new Date() });
  }
  return service;
}

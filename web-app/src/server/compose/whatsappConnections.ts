import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createMemoryLineAdminStore } from "../repos/memory/whatsappLines";
import { createPgLineAdminStore } from "../repos/postgres/whatsappLines";
import { createConnectionService, type ConnectionService } from "../services/whatsapp/connectionService";
import { whatsappConfig, whatsappConfigStatus } from "../whatsapp/config";
import { createGraphClient } from "../whatsapp/graph";
import { getPlatformConsoleUnit } from "./platform";
import { backupWhatsAppNow, verifyWhatsAppBackups } from "./whatsappBackup";
import { checkWhatsAppStorage } from "./whatsappMedia";

// The composition of the WhatsApp connection manager (plan part 28): the platform console's unit (the audit and the account check), the lines store on the shared pool (the in-memory double
// without a database) and the Graph client with the configured version. Built on first use, so the build and the tests need no database.
let service: ConnectionService | undefined;

export function getWhatsAppConnections(): ConnectionService {
  if (service) return service;
  const config = getConfig();
  const lines = config.DATABASE_URL && config.HMS_HASH_KEY ? createPgLineAdminStore(getDatabase().pool) : createMemoryLineAdminStore();
  service = createConnectionService({
    unit: getPlatformConsoleUnit(),
    lines,
    graph: () => createGraphClient({ graphVersion: whatsappConfig()?.graphVersion }),
    sealKey: () => whatsappConfig()?.sealKey ?? null,
    configStatus: () => whatsappConfigStatus(),
    publicUrl: () => getConfig().HMS_PUBLIC_URL ?? null,
    storage: { check: checkWhatsAppStorage },
    backup: { run: backupWhatsAppNow, verify: async () => verifyWhatsAppBackups() },
    now: () => new Date(),
  });
  return service;
}

/** Replaces the service (tests). */
export function configureWhatsAppConnections(next: ConnectionService | null): void {
  service = next ?? undefined;
}

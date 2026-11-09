import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { AppError } from "../errors";
import { createPgCentralConsoleUnit } from "../repos/postgres/centralConsole";
import { createCentralConsoleService } from "../services/platform/centralConsoleService";
import { createCentralWrites } from "../services/platform/centralWrites";
import { getGst } from "./gst";
import { getPlatformCredentials } from "./platform";

// The composition root of the Central tabs of the Platform console (contract ui-shared/dashboards/central.ts): the reads (Platform Admin and Super Admin) and the writes (Super Admin
// only) over the same unit, with the console's accounts and audit log on the same connection. Without a database there is nothing to list: every call answers 503 with a sentence.
export type CentralConsole = ReturnType<typeof createCentralConsoleService> & ReturnType<typeof createCentralWrites>;
let service: CentralConsole | null = null;

export function buildCentralConsole(unit: Parameters<typeof createCentralConsoleService>[0]["unit"], deps: Pick<Parameters<typeof createCentralWrites>[0], "credentials" | "gst">, now: () => Date = () => new Date()): CentralConsole {
  const reads = createCentralConsoleService({ unit, now });
  const writes = createCentralWrites({
    unit, now, credentials: deps.credentials, gst: deps.gst,
    detail: (session, tab, id) => reads.detail(session, tab, id),
  });
  return { ...reads, ...writes };
}

export function getCentralConsole(): CentralConsole {
  if (service) return service;
  if (!getConfig().DATABASE_URL) {
    const off = async (): Promise<never> => {
      throw new AppError("NETWORK_OFFLINE", "The Central tabs need the database.");
    };
    return new Proxy({}, { get: () => off }) as CentralConsole;
  }
  service = buildCentralConsole(createPgCentralConsoleUnit(getDatabase().pool), { credentials: getPlatformCredentials(), gst: { lookup: (s, g, o) => getGst().lookup(s, g, o) } });
  return service;
}

/** Replaces the service (tests). */
export function configureCentralConsole(next: CentralConsole | null): void {
  service = next;
}
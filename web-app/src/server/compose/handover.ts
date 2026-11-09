import "server-only";
import { getDatabase } from "../../db";
import { createCatalog } from "../auth/catalog";
import { PERMISSION_CATALOG } from "../auth/catalog.generated";
import { getConfig } from "../config/env";
import { createMemoryHandovers } from "../repos/memory/handovers";
import { createPgHandoverUnit } from "../repos/postgres/handovers";
import { createPgPeopleDirectory, createPgPlatformAudit } from "../repos/postgres/people";
import { createHandoverService, type HandoverDeps, type HandoverService } from "../services/handover/handoverService";

// The composition root of Shift Handover: PostgreSQL repositories when DATABASE_URL is set, the in-memory double otherwise (nobody can sign in then).
let service: HandoverService | null = null;
let shared: HandoverDeps | null = null;

export function handoverDefaults(): HandoverDeps {
  if (shared) return shared;
  if (getConfig().DATABASE_URL) {
    const { withHotel, pool } = getDatabase();
    shared = { unit: createPgHandoverUnit(withHotel), people: createPgPeopleDirectory(pool), audit: createPgPlatformAudit(pool), catalog: createCatalog(PERMISSION_CATALOG), now: () => new Date() };
    return shared;
  }
  shared = { unit: createMemoryHandovers().unit, people: { get: async () => new Map() }, audit: { record: async () => undefined }, catalog: createCatalog(PERMISSION_CATALOG), now: () => new Date() };
  return shared;
}

export function getHandovers(): HandoverService {
  service ??= createHandoverService(handoverDefaults());
  return service;
}

/** Replaces the handover service (start-up code and tests). */
export function configureHandovers(next: HandoverService | null): void {
  service = next;
}

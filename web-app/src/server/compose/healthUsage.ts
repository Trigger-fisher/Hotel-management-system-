import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createPgHealthUsageReader, type HealthUsageReader } from "../repos/postgres/healthUsage";
import { createHealthUsageService, type HealthUsageService } from "../services/systemAdmin/healthUsage";

// The composition root of GET /system/health/usage: the real reader when DATABASE_URL is set; without a database the same answer with no rows (every feature idle).
let service: HealthUsageService | null = null;

const emptyReader: HealthUsageReader = {
  usage: async () => ({ daily: [], users7: [], prev7: [], flows: [], faults: [] }),
  activity: async () => [],
  server: async () => ({ hotelDataBytes: null, dbConnections: null }),
};

/** Tests: use this service instead of the composed one (null puts the composition back). */
export function configureHealthUsage(s: HealthUsageService | null): void {
  service = s;
}

export function getHealthUsage(): HealthUsageService {
  if (service) return service;
  if (getConfig().DATABASE_URL) {
    const { withHotel, pool } = getDatabase();
    service = createHealthUsageService({ reader: createPgHealthUsageReader(withHotel), pool: () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }), now: () => new Date() });
  } else {
    service = createHealthUsageService({ reader: emptyReader, pool: () => null, now: () => new Date() });
  }
  return service;
}
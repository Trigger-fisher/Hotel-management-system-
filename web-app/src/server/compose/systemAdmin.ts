import "server-only";
import { statfs } from "node:fs/promises";
import { getDatabase } from "../../db";
import { createCatalog } from "../auth/catalog";
import { PERMISSION_CATALOG } from "../auth/catalog.generated";
import { getConfig } from "../config/env";
import { databaseRole, deployNotices } from "../ops/notices";
import { createMemorySystemAdmin } from "../repos/memory/systemAdmin";
import { createPgPeopleDirectory } from "../repos/postgres/people";
import { createPgSystemAdminUnit } from "../repos/postgres/systemAdmin";
import type { HealthProbes, SystemAdminDeps } from "../services/systemAdmin/context";
import { createHealthService, type HealthService } from "../services/systemAdmin/healthService";
import { createLogService, type LogService } from "../services/systemAdmin/logService";
import { createPayrollAdminService, type PayrollAdminService } from "../services/systemAdmin/payrollAdminService";

// The composition root of the system pages (System Log, Force Log, System Health, /health/deep) and the payroll administration (Payroll Master, Payroll
// Log): PostgreSQL repositories when DATABASE_URL is set, the in-memory double otherwise. The probes read the disk the app runs from and name the mail
// driver; neither ever returns a setting's value.
interface Services {
  logs: LogService;
  health: HealthService;
  payroll: PayrollAdminService;
}

let services: Services | null = null;

let loginSeen: string | null = null;
const serverProbes: HealthProbes = {
  async disk() {
    try {
      const s = await statfs(process.cwd());
      return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) };
    } catch {
      return null;
    }
  },
  // compose/mail.ts: the only sender the server has is the log driver (no SMTP sender is built yet)
  mailDriver: () => "log",
  // the database login is asked once it answers (it cannot change while the process runs); the photo storage notice follows the config
  async notices() {
    const config = getConfig();
    if (config.DATABASE_URL && loginSeen === null) loginSeen = await databaseRole(getDatabase().pool);
    return deployNotices(config, loginSeen);
  },
};

function defaults(): SystemAdminDeps {
  const catalog = createCatalog(PERMISSION_CATALOG);
  if (getConfig().DATABASE_URL) {
    const { withHotel, pool } = getDatabase();
    return { unit: createPgSystemAdminUnit(withHotel), people: createPgPeopleDirectory(pool), catalog, probes: serverProbes, now: () => new Date() };
  }
  return { unit: createMemorySystemAdmin().unit, people: { get: async () => new Map() }, catalog, probes: serverProbes, now: () => new Date() };
}

export function buildSystemAdminServices(deps: SystemAdminDeps): Services {
  return { logs: createLogService(deps), health: createHealthService(deps), payroll: createPayrollAdminService(deps) };
}

const all = (): Services => (services ??= buildSystemAdminServices(defaults()));
export const getSystemLogs = (): LogService => all().logs;
export const getSystemHealth = (): HealthService => all().health;
export const getPayrollAdmin = (): PayrollAdminService => all().payroll;

/** Replaces the services (start-up code and tests). */
export function configureSystemAdmin(next: Services | null): void {
  services = next;
}

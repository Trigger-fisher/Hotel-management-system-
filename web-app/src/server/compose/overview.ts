import "server-only";
import { createCatalog } from "../auth/catalog";
import { PERMISSION_CATALOG } from "../auth/catalog.generated";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createMemoryReports } from "../repos/memory/reports";
import { createPgReportsUnit } from "../repos/postgres/reports";
import { billingDefaults } from "./billing";
import type { ReportsUnit } from "../repos/reports";
import type { PeopleDirectory } from "../services/cash/ports";
import { createDashboardService, type DashboardService } from "../services/overview/dashboardService";
import { createReportService, type ReportService } from "../services/overview/reportService";

// The composition root of the Overview module: the Hotel dashboard and the accounts reports (Daily Report, Food Plan), read-only over the other modules' tables.
// With DATABASE_URL these are the PostgreSQL reads (repos/postgres/reports.ts); without it the in-memory double. Tests call configureOverview().
interface OverviewServices {
  reports: ReportService;
  dashboard: DashboardService;
}

let services: OverviewServices | null = null;
const catalog = createCatalog(PERMISSION_CATALOG);

function defaultUnit(): ReportsUnit {
  return getConfig().DATABASE_URL ? createPgReportsUnit(getDatabase().withHotel) : createMemoryReports().unit;
}

export function buildOverviewServices(unit: ReportsUnit = defaultUnit(), now: () => Date = () => new Date(), people: PeopleDirectory = billingDefaults().people): OverviewServices {
  return { reports: createReportService({ unit, catalog, now, header: (session) => billingDefaults().unit.run(session, (repos) => repos.hotelProfile.header()) }), dashboard: createDashboardService({ unit, people, catalog, now }) };
}

const all = (): OverviewServices => (services ??= buildOverviewServices());
export const getReports = (): ReportService => all().reports;
export const getHotelDashboard = (): DashboardService => all().dashboard;

/** Replaces the overview services (start-up code and tests). */
export function configureOverview(next: OverviewServices | null): void {
  services = next;
}

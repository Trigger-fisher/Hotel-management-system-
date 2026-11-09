import "server-only";
// ONE Unit over every repository of a hotel's database: billing, front office, companies, payroll, website and admin share the data, so a bill, the
// advance it takes money off and the stay checked out into it change in ONE transaction. The in-memory twin is bindHotelRepos (repos/memory/frontOffice.ts).
import type { WithHotel } from "../../../db/withHotel";
import type { AdminRepos } from "../admin";
import type { CompaniesRepos } from "../companies";
import type { FrontOfficeRepos } from "../frontOffice";
import type { PayrollCoreRepos } from "../payrollCore";
import type { PayrollPayRepos } from "../payrollPay";
import type { ReportsRepos } from "../reports";
import type { Unit } from "../types";
import type { WebsiteRepos } from "../website";
import { pgAdminRepos } from "./admin";
import { pgBillingRepos } from "./billing";
import { pgCompaniesRepos } from "./companies";
import { pgFrontOfficeRepos } from "./frontOffice";
import { pgPayrollCoreRepos } from "./payrollCore";
import { pgPayrollPayRepos } from "./payrollPay";
import { pgReportsRepos } from "./reports";
import { createPgUnit } from "./unit";
import { pgWebsiteRepos } from "./website";

// the reports' `reservations` (arrivalsToday) is the front office's own repository, which has that method, so the front office's spread comes after the reports'
export type HotelRepos = FrontOfficeRepos & CompaniesRepos & PayrollCoreRepos & PayrollPayRepos & WebsiteRepos & AdminRepos & ReportsRepos;

export function createPgHotelUnit(withHotel: WithHotel): Unit<HotelRepos> {
  return createPgUnit(withHotel, (tx, hotelId) => ({ ...pgReportsRepos(tx), ...pgBillingRepos(tx), ...pgFrontOfficeRepos(tx, hotelId), ...pgCompaniesRepos(tx, hotelId), ...pgPayrollCoreRepos(tx, hotelId), ...pgPayrollPayRepos(tx, hotelId), ...pgWebsiteRepos(tx), ...pgAdminRepos(tx) }));
}

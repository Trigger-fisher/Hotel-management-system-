// `?data=s08` (dev preview): Hotel Pallav's own scratch demo rows (dashboards/fixtures/s08-*.json) turned into the seeds the mocks start from.
// Mock-only: reached through ./index.ts, which the web app loads only through web-app/src/lib/api/mockLoader.ts.
import type { BillingFixtures } from '../dashboards/billing';
import { cashSeedFromFixtures, type CashFixtures } from '../dashboards/cash.fixtures';
import { companiesSeedFromFixtures } from '../dashboards/companies.fixtures';
import { frontOfficeStoreFromFixtures, type FrontOfficeFixtures } from '../dashboards/frontOffice.fixtures';
import { payrollSeedFromFixtures, type PayrollFixtures } from '../dashboards/payroll.fixtures';
import advances from '../dashboards/fixtures/s08-advances.json';
import attendanceEntries from '../dashboards/fixtures/s08-attendance_entries.json';
import attendanceMonths from '../dashboards/fixtures/s08-attendance_months.json';
import attendanceStatuses from '../dashboards/fixtures/s08-attendance_statuses.json';
import bills from '../dashboards/fixtures/s08-bills.json';
import bonuses from '../dashboards/fixtures/s08-bonus_incentives.json';
import companyRows from '../dashboards/fixtures/s08-companies.json';
import deductions from '../dashboards/fixtures/s08-deductions.json';
import employeeDeductions from '../dashboards/fixtures/s08-employee_deductions.json';
import mealPeriods from '../dashboards/fixtures/s08-employee_meal_periods.json';
import separations from '../dashboards/fixtures/s08-employee_separations.json';
import employees from '../dashboards/fixtures/s08-employees.json';
import categories from '../dashboards/fixtures/s08-expense_categories.json';
import experienceLetters from '../dashboards/fixtures/s08-experience_letters.json';
import depositsFood from '../dashboards/fixtures/s08-food_cash_deposits.json';
import withdrawalsFood from '../dashboards/fixtures/s08-food_cash_withdrawals.json';
import foodRates from '../dashboards/fixtures/s08-food_charge_rates.json';
import miscFood from '../dashboards/fixtures/s08-food_misc_expenses.json';
import depositsHotel from '../dashboards/fixtures/s08-hotel_cash_deposits.json';
import withdrawalsHotel from '../dashboards/fixtures/s08-hotel_cash_withdrawals.json';
import miscHotel from '../dashboards/fixtures/s08-hotel_misc_expenses.json';
import joiningLetters from '../dashboards/fixtures/s08-joining_letters.json';
import payrollAdvances from '../dashboards/fixtures/s08-payroll_advances.json';
import payrollCompanies from '../dashboards/fixtures/s08-payroll_companies.json';
import logs from '../dashboards/fixtures/s08-payroll_logs.json';
import masterItems from '../dashboards/fixtures/s08-payroll_master_items.json';
import charges from '../dashboards/fixtures/s08-pms_charges.json';
import reservations from '../dashboards/fixtures/s08-pms_reservations.json';
import rooms from '../dashboards/fixtures/s08-pms_rooms.json';
import stays from '../dashboards/fixtures/s08-pms_stays.json';
import salaryProcessingLines from '../dashboards/fixtures/s08-salary_processing_lines.json';
import salaryProcessings from '../dashboards/fixtures/s08-salary_processings.json';
import handovers from '../dashboards/fixtures/s08-shift_handovers.json';
import siteRooms from '../dashboards/fixtures/s08-site_rooms.json';
import staffAdvances from '../dashboards/fixtures/s08-staff_advances.json';
import users from '../dashboards/fixtures/s08-users.json';

/** The Billing mock's bills, advances and companies (billing/api.ts). */
export function s08BillingFixtures(): BillingFixtures {
  return { advances, bills, companies: companyRows } as unknown as BillingFixtures;
}

/** The Cash mock's deposits, withdrawals, expenses, staff advances and handovers (cash/api.ts). */
export function s08CashSeed() {
  return cashSeedFromFixtures({
    users, employees, depositsHotel, depositsFood, withdrawalsHotel, withdrawalsFood, miscHotel, miscFood, staffAdvances, categories, handovers,
  } as unknown as CashFixtures);
}

/** The Companies mock's profiles (companies/api.ts). */
export function s08CompaniesSeed() {
  return companiesSeedFromFixtures(companyRows as unknown as Record<string, unknown>[]);
}

/** The Front Office mock's store: rooms, stays, reservations, charges (frontOffice/api.ts hands it to loadFrontOfficeStore). */
export function s08FrontOfficeStore() {
  return frontOfficeStoreFromFixtures({ rooms, stays, reservations, charges, siteRooms, companies: companyRows } as unknown as FrontOfficeFixtures);
}

/** Both payroll mocks' seeds (payrollCore/api.ts; payrollPay reads the same ones, same ids). */
export function s08PayrollSeed() {
  return payrollSeedFromFixtures({
    companies: payrollCompanies, employees, deductions, employeeDeductions, attendanceStatuses, attendanceMonths, attendanceEntries, separations, masterItems,
    salaryProcessings, salaryProcessingLines, advances: payrollAdvances, bonuses, mealPeriods, foodRates, joiningLetters, experienceLetters, logs,
  } as unknown as PayrollFixtures);
}

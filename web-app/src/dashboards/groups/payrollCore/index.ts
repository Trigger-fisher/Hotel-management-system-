// Payroll (core) screens: company picker, companies, dashboard, staff, attendance, statuses, deductions, staff emails.
import type { ScreenMap } from '../../types';
import { PayrollAttendance } from './Attendance';
import { PayrollCompanies } from './Companies';
import { PayrollDashboardScreen } from './Dashboard';
import { PayrollDeductions } from './Deductions';
import { PayrollStaff } from './Staff';
import { PayrollStaffEmails } from './StaffEmails';
import { PayrollStatuses } from './Statuses';

export const screens: ScreenMap = {
  'hotel.payroll.home': PayrollCompanies,
  'hotel.payroll.companies': PayrollCompanies,
  'hotel.payroll.dashboard': PayrollDashboardScreen,
  'hotel.payroll.staff': PayrollStaff,
  'hotel.payroll.attendance': PayrollAttendance,
  'hotel.payroll.attendanceStatuses': PayrollStatuses,
  'hotel.payroll.deductions': PayrollDeductions,
  'hotel.payroll.staffEmails': PayrollStaffEmails,
};

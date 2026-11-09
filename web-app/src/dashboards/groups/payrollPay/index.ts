// Payroll (pay) screens: salary update, payments, slips, advances, bonus, meals, reports, letters, resignations, master, log.
import type { ScreenMap } from '../../types';
import { Advances } from './Advances';
import { Bonus } from './Bonus';
import { ExperienceLetter, JoiningLetter } from './Letters';
import { PayrollLog } from './Log';
import { Master } from './Master';
import { Meals } from './Meals';
import { MealPrice } from './MealPrice';
import { Payments } from './Payments';
import { MonthlyReport, PeriodReport } from './Reports';
import { Resignations } from './Resignations';
import { SalaryUpdate } from './SalaryUpdate';
import { Slips } from './Slips';

export const screens: ScreenMap = {
  'hotel.payroll.salaryUpdate': SalaryUpdate,
  'hotel.payroll.salaryPayments': Payments,
  'hotel.payroll.salarySlips': Slips,
  'hotel.payroll.advances': Advances,
  'hotel.payroll.bonus': Bonus,
  'hotel.payroll.meals': Meals,
  'hotel.payroll.mealPrice': MealPrice,
  'hotel.payroll.reports': MonthlyReport,
  'hotel.payroll.periodReport': PeriodReport,
  'hotel.payroll.joiningLetter': JoiningLetter,
  'hotel.payroll.experienceLetter': ExperienceLetter,
  'hotel.payroll.resignations': Resignations,
  'hotel.payroll.master': Master,
  'hotel.payroll.log': PayrollLog,
};

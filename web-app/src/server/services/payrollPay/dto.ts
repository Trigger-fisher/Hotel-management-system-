import "server-only";
import type { Advance, BonusEntry, PayEmployee, PaymentStatus, SalaryRecord } from "@shared/dashboards/payrollPay";
import { paiseToNumber } from "../../money/paise";
import type { EmployeeListRow, EmployeeRecord } from "../../repos/payrollCore";
import type { BonusRecord, PayrollAdvanceRecord, SalaryLineRecord, SalaryProcessingRecord } from "../../repos/payrollPay";
import { istMoment } from "../cash/ist";
import * as phone from "../payrollCore/phone";

// Records → the apps' shapes (ui-shared payrollPay.ts). Bank numbers are plain data and leave as stored (MJ). Spec: docs/specs/payroll-pay.md.

const n = paiseToNumber;
const ZERO = BigInt(0);
const pad = (x: number): string => String(x).padStart(2, "0");
export const periodOf = (p: { year: number; month: number }): string => `${p.year}-${pad(p.month)}`;
/** "YYYY-MM" → { year, month } */
const parsePeriod = (period: string): { year: number; month: number } => ({ year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)) });
/** The IST month an instant falls in (an advance or bonus belongs to the month of its date). */
export const monthOfInstant = (at: Date): { year: number; month: number } => parsePeriod(istMoment(at).date.slice(0, 7));

/** PHP number_format($x, 2): "1,250,000.00" (groups of three, as Pallav prints amounts in sentences). */
export function numberFormat(paise: bigint): string {
  const neg = paise < ZERO;
  const abs = neg ? -paise : paise;
  const whole = (abs / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${whole}.${String(abs % BigInt(100)).padStart(2, "0")}`;
}

export function payEmployee(e: EmployeeListRow | EmployeeRecord): PayEmployee {
  return {
    id: e.id,
    code: e.employeeCode,
    name: e.name,
    designation: e.designation,
    department: e.department ?? "",
    companyId: e.payrollCompanyId,
    joiningDate: e.joiningDate,
    isActive: e.isActive,
    salaryPaise: n(e.salaryPaise),
    dailyWorkingHours: Number(e.dailyWorkingHours),
    paymentMode: e.paymentMode,
    bankName: e.bankName ?? "",
    accountHolderName: e.accountHolderName ?? "",
    accountNumber: e.accountNumber ?? null,
    ifscCode: e.ifscCode ?? "",
    branchName: e.branchName ?? "",
    phone: phone.format(e.contactCountry, e.contactNumber),
  };
}

export function salaryRecord(p: SalaryProcessingRecord, lines: readonly SalaryLineRecord[], updatedBy: string | null): SalaryRecord {
  const mine = lines.filter((l) => l.salaryProcessingId === p.id);
  return {
    id: p.id,
    companyId: p.payrollCompanyId,
    employeeId: p.employeeId,
    employeeCode: p.employeeCode,
    employeeName: p.employeeName,
    designation: p.designation ?? "",
    period: periodOf(p),
    processedAt: p.processedAt.toISOString(),
    monthlySalaryPaise: n(p.monthlySalaryPaise),
    dailyWorkingHours: Number(p.dailyWorkingHours),
    daysInMonth: p.totalDaysInMonth,
    days: { p0: Number(p.days0), p25: Number(p.days25), p50: Number(p.days50), p75: Number(p.days75), p100: Number(p.days100) },
    payableDays: Number(p.totalPayableDays),
    otHours: Number(p.overtimeHours),
    dailySalaryPaise: n(p.dailySalaryPaise),
    hourlyRatePaise: n(p.hourlyRatePaise),
    attendanceSalaryPaise: n(p.attendanceSalaryPaise),
    otAmountPaise: n(p.overtimeAmountPaise),
    bonusPaise: n(p.bonusAmountPaise),
    incentivePaise: n(p.incentiveAmountPaise),
    deductions: mine.filter((l) => l.category === "Deduction").map((l) => ({ label: l.label, paise: n(l.amountPaise) })),
    lines: mine.map((l) => ({ category: l.category, label: l.label, type: l.deductionType, paise: n(l.amountPaise), pendingPaise: n(l.pendingAmountPaise) })),
    advanceRecoveryPaise: n(p.advanceDeductionPaise),
    pendingAdvancePaise: n(p.pendingAdvanceAmountPaise),
    netPaise: n(p.netSalaryPaise),
    paymentMode: p.paymentMode ?? "",
    bankName: p.bankName ?? "",
    accountNumber: p.accountNumber ?? null,
    ifscCode: p.ifscCode ?? "",
    branchName: p.branchName ?? "",
    paymentStatus: p.paymentStatus as PaymentStatus,
    paidPaise: n(p.paidAmountPaise),
    paidOn: p.paidAt,
    reference: p.paymentReference ?? "",
    remarks: p.paymentRemarks ?? "",
    paymentUpdatedBy: updatedBy,
    generationCount: p.generationCount,
    version: p.version,
  };
}

export function advanceDto(a: PayrollAdvanceRecord & { employeeName?: string | null; employeeCode?: string | null }, x: { locked: boolean; admin: boolean; createdBy: string }): Advance {
  const outstanding = a.amountPaise - a.recoveredAmountPaise;
  return {
    id: a.id,
    entryNo: String(a.entryNo),
    companyId: a.payrollCompanyId,
    employeeId: a.employeeId,
    employeeName: a.employeeName ?? "Removed employee",
    employeeCode: a.employeeCode ?? "",
    date: a.advanceDate.toISOString(),
    amountPaise: n(a.amountPaise),
    recoveryType: a.deductionType,
    instalmentPaise: n(a.deductionAmountPaise),
    recoveredPaise: n(a.recoveredAmountPaise),
    outstandingPaise: n(outstanding > ZERO ? outstanding : ZERO),
    isSettled: a.isSettled,
    isCarryForward: a.isCarryForward,
    locked: x.locked,
    canEdit: x.admin && !a.isCarryForward && !x.locked,
    canDelete: x.admin && !a.isCarryForward && !x.locked,
    remarks: a.remarks ?? "",
    createdBy: x.createdBy,
  };
}

export function bonusDto(b: BonusRecord & { employeeName?: string | null; employeeCode?: string | null }, x: { locked: boolean; admin: boolean }): BonusEntry {
  return {
    id: b.id,
    entryNo: String(b.entryNo),
    companyId: b.payrollCompanyId,
    employeeId: b.employeeId,
    employeeName: b.employeeName ?? "Removed employee",
    employeeCode: b.employeeCode ?? "",
    date: b.entryDate.toISOString(),
    type: b.type,
    amountPaise: n(b.amountPaise),
    remarks: b.remarks ?? "",
    locked: x.locked,
    canEdit: x.admin && !x.locked,
    canDelete: x.admin && !x.locked,
  };
}

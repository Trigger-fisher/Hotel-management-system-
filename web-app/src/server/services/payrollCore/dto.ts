import "server-only";
import type { AttendancePercentage, AttendanceStatus, Deduction, PayrollCompanyRow, StaffEmail } from "@shared/dashboards/payrollCore";
import { paiseToNumber } from "../../money/paise";
import type { AttendanceStatusRecord, DeductionRecord, PayrollCompanyRow as CompanyRowRecord, StaffEmailRecord } from "../../repos/payrollCore";

// Records → the apps' shapes (ui-shared payrollCore.ts). Bank numbers are plain data and leave as stored (MJ). Spec: docs/specs/payroll-core.md.

/** A send still open this long never finished (StaffEmail::STALE_AFTER_MINUTES). */
export const STALE_AFTER_MS = 5 * 60_000;

export const dtoDeduction = (d: DeductionRecord & { assignedCount?: number }): Deduction => ({
  id: d.id,
  companyId: d.payrollCompanyId,
  name: d.name,
  standardAmountPaise: paiseToNumber(d.amountPaise),
  isActive: d.isActive,
  assignedCount: d.assignedCount ?? 0,
});

export const dtoStatus = (s: AttendanceStatusRecord, used: number): AttendanceStatus => ({
  id: s.id,
  companyId: s.payrollCompanyId,
  name: s.name,
  shortcutKey: s.shortcutKey,
  color: s.color,
  attendancePercentage: s.attendancePercentage as AttendancePercentage,
  statusType: s.statusType,
  skipsFood: s.skipsFood,
  isActive: s.isActive,
  usedCount: used,
});

export function dtoCompany(c: CompanyRowRecord): PayrollCompanyRow {
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    ownerName: c.ownerName ?? "",
    mobileNumber: c.mobileNumber ?? "",
    email: c.email ?? "",
    address: c.address ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    pincode: c.pincode ?? "",
    panNumber: c.panNumber ?? "",
    tanNumber: c.tanNumber ?? "",
    pfRegistrationNumber: c.pfRegistrationNumber ?? "",
    esicRegistrationNumber: c.esicRegistrationNumber ?? "",
    professionalTaxRegistrationNumber: c.professionalTaxRegistrationNumber ?? "",
    authorizedPersonName: c.authorizedPersonName ?? "",
    authorizedDesignation: c.authorizedDesignation ?? "",
    authorizedMobile: c.authorizedMobile ?? "",
    authorizedEmail: c.authorizedEmail ?? "",
    bankName: c.bankName ?? "",
    branchName: c.branchName ?? "",
    accountNumber: c.accountNumber,
    ifscCode: c.ifscCode ?? "",
    isActive: c.isActive,
    staffCount: c.staffCount,
    activeStaffCount: c.activeStaffCount,
  };
}

/** StaffEmail::state (:39-46): a send still open after 5 minutes is "stalled". */
export function dtoStaffEmail(r: StaffEmailRecord, now: Date): StaffEmail {
  const stalled = r.status === "sending" && r.createdAt.getTime() < now.getTime() - STALE_AFTER_MS;
  return {
    id: r.id,
    companyId: r.payrollCompanyId,
    employeeId: r.employeeId ?? "",
    employeeName: r.employeeName,
    employeeCode: r.employeeCode ?? "",
    designation: r.designation ?? "",
    recipientName: r.recipientName,
    recipientEmail: r.recipientEmail ?? "",
    subject: r.subject ?? "",
    message: r.message ?? "",
    state: stalled ? "stalled" : r.status,
    error: r.error,
    sentBy: r.sentByName ?? "",
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    attachmentKb: r.attachmentBytes === null ? null : Math.round(r.attachmentBytes / 1024),
  };
}

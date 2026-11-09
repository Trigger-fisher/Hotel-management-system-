import "server-only";
import { amountInWords, formatDate, formatINR, formatMonth } from "@shared/dashboards/format";
import { balanceOf, grossOf, totalDeductionsOf, type DocBlock, type PayrollDoc, type PaymentMonth, type ReportResult, type SalaryRecord } from "@shared/dashboards/payrollPay";
import type { Employee } from "@shared/dashboards/payrollCore";
import type { Advance, BonusEntry, Separation } from "@shared/dashboards/payrollPay";
import type { VerifiedSession } from "../../auth/session";
import type { EmployeeService } from "../payrollCore/employeeService";
import { companyOrFail, type PayrollDeps } from "../payrollCore/context";
import type { AdjustmentService } from "./adjustmentService";
import type { LetterService } from "./letterService";
import type { PaymentService } from "./paymentService";

/** Pallav's salary slip (payroll/pdf/salary-slip.blade.php:239-240): bullets for all but the last four characters of the account number. */
export const slipAccount = (account: string | null): string => {
  const a = account ?? "";
  return a.length > 4 ? `${"•".repeat(a.length - 4)}${a.slice(-4)}` : a;
};
import type { SeparationService } from "./separationService";

// The payroll documents as the structured PayrollDoc the apps print AND the PDF renderer draws (MJ #22). Each is built from the SAME DTO the screen
// gets from the same service (the permission is that service's), with the company's own header. The wording is the apps' (ui-shared slipDoc and
// siblings), so a screen preview and the PDF read the same. Spec: docs/specs/documents.md.

interface DocumentFile {
  doc: PayrollDoc;
  filename: string;
}

export function slipDoc(r: SalaryRecord, head: Pick<PayrollDoc, "companyName" | "companyLine">): PayrollDoc {
  const gross = grossOf(r);
  const ded = totalDeductionsOf(r);
  const dedRows: string[][] = r.deductions.map((d) => [d.label, "Fixed", formatINR(d.paise)]);
  if (r.advanceRecoveryPaise > 0) dedRows.push(["Advance recovery", "From advances", formatINR(r.advanceRecoveryPaise)]);
  const payItems = [
    { label: "Method", value: r.paymentMode },
    { label: "Status", value: r.paymentStatus },
    { label: "Paid on", value: r.paidOn ? formatDate(r.paidOn) : "Not paid yet" },
  ];
  if (r.paymentMode === "Bank") payItems.push({ label: "Bank", value: r.bankName }, { label: "Branch", value: r.branchName }, { label: "Account", value: slipAccount(r.accountNumber) }, { label: "IFSC", value: r.ifscCode });
  if (r.reference) payItems.push({ label: "Reference", value: r.reference });
  const threeQuarter = r.days.p75 ? [{ label: "Three-quarter days (75%)", value: String(r.days.p75) }] : [];
  const quarter = r.days.p25 ? [{ label: "Quarter days (25%)", value: String(r.days.p25) }] : [];
  const blocks: DocBlock[] = [
    {
      kind: "kv",
      items: [
        { label: "Employee", value: r.employeeName },
        { label: "Employee ID", value: r.employeeCode },
        { label: "Designation", value: r.designation },
        { label: "Monthly CTC", value: formatINR(r.monthlySalaryPaise) },
        { label: "Working hours", value: `${r.dailyWorkingHours} hours a day` },
        { label: "Processed", value: formatDate(r.processedAt) },
      ],
    },
    {
      kind: "kv",
      title: "Attendance",
      items: [
        { label: "Days in month", value: String(r.daysInMonth) },
        { label: "Full days (100%)", value: String(r.days.p100) },
        ...threeQuarter,
        { label: "Half days (50%)", value: String(r.days.p50) },
        ...quarter,
        { label: "Unpaid days (0%)", value: String(r.days.p0) },
        { label: "Payable days", value: String(r.payableDays) },
        { label: "Overtime", value: `${r.otHours} hrs` },
      ],
    },
    {
      kind: "table",
      title: "Earnings",
      columns: [
        { header: "Component", align: "left" },
        { header: "Basis", align: "left" },
        { header: "Amount", align: "right" },
      ],
      rows: [
        ["Attendance salary", `${r.payableDays} of ${r.daysInMonth} days`, formatINR(r.attendanceSalaryPaise)],
        ["Overtime", `${r.otHours} hrs`, formatINR(r.otAmountPaise)],
        ...(r.bonusPaise ? [["Bonus", "This month", formatINR(r.bonusPaise)]] : []),
        ...(r.incentivePaise ? [["Incentive", "This month", formatINR(r.incentivePaise)]] : []),
      ],
      footer: ["Gross earnings (A)", "", formatINR(gross)],
    },
    {
      kind: "table",
      title: "Deductions",
      columns: [
        { header: "Component", align: "left" },
        { header: "Basis", align: "left" },
        { header: "Amount", align: "right" },
      ],
      rows: dedRows.length ? dedRows : [["No deductions this month", "", formatINR(0)]],
      footer: ["Total deductions (B)", "", formatINR(ded)],
    },
    { kind: "total", label: "Net payable salary (A - B)", value: formatINR(r.netPaise), words: amountInWords(r.netPaise) },
    ...(r.pendingAdvancePaise > 0 ? [{ kind: "para" as const, text: `Advance still to recover: ${formatINR(r.pendingAdvancePaise)}.` }] : []),
    { kind: "kv", title: "Payment details", items: payItems },
    { kind: "signatures", items: [{ name: "Employee", role: "Signature" }, { name: "Authorised signatory", role: head.companyName }] },
  ];
  return { ...head, title: "Salary Slip", subtitle: `Pay period ${formatMonth(r.period)}`, blocks };
}

export function registerDoc(m: PaymentMonth, head: Pick<PayrollDoc, "companyName" | "companyLine">): PayrollDoc {
  return {
    ...head,
    title: "Salary Payment Register",
    subtitle: formatMonth(m.period),
    blocks: [
      {
        kind: "table",
        columns: [
          { header: "Employee", align: "left" },
          { header: "Mode", align: "left" },
          { header: "Net salary", align: "right" },
          { header: "Paid", align: "right" },
          { header: "Balance", align: "right" },
          { header: "Paid on", align: "right" },
          { header: "Status", align: "left" },
        ],
        rows: [...m.rows]
          .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
          .map((r) => [`${r.employeeName} (${r.employeeCode})`, r.paymentMode, formatINR(r.netPaise), formatINR(r.paidPaise), formatINR(balanceOf(r)), r.paidOn ? formatDate(r.paidOn) : "-", r.paymentStatus]),
        footer: ["Total", "", formatINR(m.summary.netPaise), formatINR(m.summary.paidPaise), formatINR(m.summary.outstandingPaise), "", `${m.summary.fullyPaid} of ${m.summary.total} paid`],
      },
      { kind: "signatures", items: [{ name: "Prepared by", role: "Accounts" }, { name: "Approved by", role: "Authorised signatory" }] },
    ],
  };
}

export function reportDoc(title: string, subtitle: string, r: ReportResult, head: Pick<PayrollDoc, "companyName" | "companyLine">): PayrollDoc {
  const t = r.totals;
  const net: DocBlock[] =
    r.mealsBillPaise !== null
      ? [
          { kind: "kv", items: [{ label: "Net salary", value: formatINR(t.netPaise) }, { label: "Staff meals bill", value: formatINR(r.mealsBillPaise) }] },
          { kind: "total", label: "Grand total", value: formatINR(t.netPaise + r.mealsBillPaise), words: amountInWords(t.netPaise + r.mealsBillPaise) },
        ]
      : [{ kind: "total", label: "Net salary", value: formatINR(t.netPaise), words: amountInWords(t.netPaise) }];
  return {
    ...head,
    title,
    subtitle,
    blocks: [
      {
        kind: "table",
        columns: [
          { header: "Employee", align: "left" },
          { header: "Salary", align: "right" },
          { header: "Payable", align: "right" },
          { header: "Attendance", align: "right" },
          { header: "OT hrs", align: "right" },
          { header: "OT", align: "right" },
          { header: "Bonus + Inc.", align: "right" },
          { header: "Deductions", align: "right" },
          { header: "Advance", align: "right" },
          { header: "Net", align: "right" },
        ],
        rows: r.rows.map((x) => [
          `${x.employeeName} (${x.employeeCode})`,
          formatINR(x.monthlySalaryPaise),
          String(x.payableDays),
          formatINR(x.attendanceSalaryPaise),
          String(x.otHours),
          formatINR(x.otAmountPaise),
          formatINR(x.bonusPaise + x.incentivePaise),
          formatINR(x.deductions.reduce((s, d) => s + d.paise, 0)),
          formatINR(x.advanceRecoveryPaise),
          formatINR(x.netPaise),
        ]),
        footer: ["Total", formatINR(t.salaryPaise), String(t.payableDays), formatINR(t.attendancePaise), String(t.otHours), formatINR(t.otPaise), formatINR(t.bonusPaise + t.incentivePaise), formatINR(t.deductionsPaise), formatINR(t.advancePaise), formatINR(t.netPaise)],
      },
      ...net,
      { kind: "signatures", items: [{ name: "Prepared by", role: "Accounts" }, { name: "Approved by", role: "Authorised signatory" }] },
    ],
  };
}

/** Pallav's payroll.pdf.employee: the staff record sheet (also the staff-details email's attachment). Account and ID numbers print in full, as Pallav does. */
function employeeDoc(e: Employee, head: Pick<PayrollDoc, "companyName" | "companyLine">, signatory: { name: string; designation: string }, deductionNames: ReadonlyMap<string, string>): PayrollDoc {
  const mode = e.paymentMode;
  const blocks: DocBlock[] = [
    { kind: "kv", items: [{ label: "Name", value: e.name }, { label: "Designation", value: `${e.designation || "No designation"}${e.department ? ` · ${e.department}` : ""}` }, { label: "Status", value: e.isActive ? "Active" : "Inactive" }, { label: "Payment mode", value: mode }] },
    {
      kind: "kv",
      title: "Employment",
      items: [
        { label: "Employee ID", value: e.employeeCode },
        { label: "Joining date", value: e.joiningDate ? formatDate(e.joiningDate) : "-" },
        { label: "Monthly salary", value: formatINR(e.salaryPaise) },
        { label: "Working hours", value: `${e.dailyWorkingHours} hrs / day` },
        { label: "Shift", value: e.shift || "-" },
        { label: "Contact", value: e.display.contact || "-" },
        { label: "Address", value: e.address || "-" },
      ],
    },
    ...(e.responsibilities ? [{ kind: "heading" as const, text: "Responsibilities" }, { kind: "para" as const, text: e.responsibilities }] : []),
    ...(mode === "Bank"
      ? [{ kind: "kv" as const, title: "Bank details", items: [{ label: "Bank", value: e.bankName || "-" }, { label: "Account holder", value: e.accountHolderName || "-" }, { label: "Account no.", value: e.accountNumber || "-" }, { label: "IFSC", value: e.ifscCode || "-" }, { label: "Branch", value: e.branchName || "-" }] }]
      : []),
    { kind: "kv", title: "Identification", items: [{ label: "ID proof type", value: e.idProofType || "-" }, { label: "ID proof no.", value: e.idProofNumber || "-" }] },
  ];
  if (e.deductions.length > 0) {
    // a One Time deduction is taken once; a Monthly one recurs and is the per-cycle total
    const recurring = e.deductions.filter((d) => d.type === "Monthly");
    blocks.push({
      kind: "table",
      title: "Assigned deductions",
      columns: [
        { header: "Deduction", align: "left" },
        { header: "Type", align: "left" },
        { header: "Amount", align: "right" },
        { header: "Status", align: "left" },
      ],
      rows: e.deductions.map((d) => [deductionNames.get(d.deductionId) ?? "-", d.type, formatINR(d.amountPaise), d.type === "Monthly" ? "Recurring" : "One time"]),
      footer: ["Total per cycle", "", formatINR(recurring.reduce((t, d) => t + d.amountPaise, 0)), ""],
    });
  }
  blocks.push({ kind: "para", text: `Record maintained by ${head.companyName}. Figures reflect the employee master at the time of printing.` });
  blocks.push({ kind: "signatures", items: [{ name: signatory.name || "Authorised signatory", role: signatory.designation }] });
  return { ...head, title: "Employee Record", subtitle: e.employeeCode, blocks };
}

type Head = Pick<PayrollDoc, "companyName" | "companyLine">;
const monthOf = (date: string): string => date.slice(0, 7);

function advanceVoucherDoc(a: Advance, head: Head): PayrollDoc {
  return {
    ...head,
    title: "Advance Voucher",
    subtitle: a.entryNo,
    blocks: [
      {
        kind: "kv",
        items: [
          { label: "Employee", value: a.employeeName },
          { label: "Advance date", value: formatDate(a.date) },
          { label: "Recovery", value: a.recoveryType === "Monthly" ? `${formatINR(a.instalmentPaise)} per month` : "One time, from the next salary" },
          { label: "Status", value: a.isSettled ? "Settled" : "Open" },
          { label: "Recovered", value: formatINR(a.recoveredPaise) },
          { label: "Outstanding", value: formatINR(a.outstandingPaise) },
          { label: "Recorded by", value: a.createdBy },
        ],
      },
      ...(a.remarks ? [{ kind: "para" as const, text: `Instruction: ${a.remarks}` }] : []),
      { kind: "total", label: "Advance amount", value: formatINR(a.amountPaise), words: amountInWords(a.amountPaise) },
      { kind: "signatures", items: [{ name: "Received by", role: a.employeeName }, { name: "Authorised signatory", role: head.companyName }] },
    ],
  };
}

function bonusVoucherDoc(b: BonusEntry, head: Head): PayrollDoc {
  return {
    ...head,
    title: `${b.type} Voucher`,
    subtitle: b.entryNo,
    blocks: [
      { kind: "kv", items: [{ label: "Employee", value: b.employeeName }, { label: "Date", value: formatDate(b.date) }, { label: "Type", value: b.type }, { label: "Salary month", value: formatMonth(monthOf(b.date)) }] },
      ...(b.remarks ? [{ kind: "para" as const, text: `Instruction: ${b.remarks}` }] : []),
      { kind: "total", label: "Amount", value: formatINR(b.amountPaise), words: amountInWords(b.amountPaise) },
      { kind: "signatures", items: [{ name: "Authorised signatory", role: head.companyName }] },
    ],
  };
}

function separationRecordDoc(x: Separation, head: Head): PayrollDoc {
  return {
    ...head,
    title: "Separation Record",
    subtitle: x.entryNo,
    blocks: [
      {
        kind: "kv",
        items: [
          { label: "Employee", value: x.employeeName },
          { label: "Designation", value: x.designation },
          { label: "Exit type", value: x.type },
          { label: "Status", value: x.rejoinedOn ? `Rejoined ${formatDate(x.rejoinedOn)}` : x.status },
          { label: "Resignation date", value: formatDate(x.resignationDate) },
          { label: "Last working day", value: formatDate(x.lastWorkingDate) },
          { label: "Acceptance document", value: x.documentName ?? "None attached" },
          { label: "Recorded by", value: x.createdBy },
        ],
      },
      { kind: "para", text: `Reason: ${x.reason}` },
      ...(x.remarks ? [{ kind: "para" as const, text: `HR remarks: ${x.remarks}` }] : []),
      { kind: "signatures", items: [{ name: x.employeeName, role: "Employee" }, { name: "HR", role: head.companyName }] },
    ],
  };
}

export function createPayrollDocumentService(deps: PayrollDeps, parts: { payments: PaymentService; letters: LetterService; employees: EmployeeService; adjustments: AdjustmentService; separations: SeparationService }) {
  const { unit } = deps;
  const { payments, letters, employees, adjustments, separations } = parts;

  /** The company's own header: its name and address (as the letters print it). */
  async function head(session: VerifiedSession, companyId: string): Promise<Pick<PayrollDoc, "companyName" | "companyLine">> {
    return unit.run(session, async (repos) => {
      const c = await companyOrFail(repos, companyId);
      return { companyName: c.name, companyLine: [c.address, c.city, c.state, c.pincode].filter(Boolean).join(", ") };
    });
  }

  const file = (doc: PayrollDoc, name: string): DocumentFile => ({ doc, filename: name });

  return {
    async slip(session: VerifiedSession, companyId: string, id: string): Promise<DocumentFile> {
      const r = await payments.slip(session, companyId, id);
      return file(slipDoc(r, await head(session, companyId)), `salary-slip-${r.employeeCode}-${r.period}`);
    },
    async register(session: VerifiedSession, companyId: string, period?: string): Promise<DocumentFile> {
      const m = await payments.month(session, companyId, period);
      return file(registerDoc(m, await head(session, companyId)), `payment-register-${m.period}`);
    },
    async periodReport(session: VerifiedSession, companyId: string, q: { from: string; to: string; employeeId?: string }): Promise<DocumentFile> {
      const r = await payments.periodReport(session, companyId, q);
      return file(reportDoc("Period Salary Report", `${formatDate(q.from)} to ${formatDate(q.to)}`, r, await head(session, companyId)), `period-report-${q.from}-${q.to}`);
    },
    async monthlyReport(session: VerifiedSession, companyId: string, period?: string): Promise<DocumentFile> {
      const r = await payments.monthlyReport(session, companyId, period);
      return file(reportDoc("Monthly Salary Report", formatMonth(r.period), r, await head(session, companyId)), `monthly-report-${r.period}`);
    },
    async employee(session: VerifiedSession, companyId: string, id: string): Promise<DocumentFile> {
      const e = await employees.get(session, companyId, id);
      const extra = await unit.run(session, async (repos) => {
        const c = await companyOrFail(repos, companyId);
        const names = new Map((await repos.deductions.list(companyId)).map((d) => [d.id, d.name] as const));
        return { signatory: { name: c.authorizedPersonName ?? "", designation: c.authorizedDesignation ?? "" }, names };
      });
      return file(employeeDoc(e, await head(session, companyId), extra.signatory, extra.names), `employee-${e.employeeCode}`);
    },
    async advanceVoucher(session: VerifiedSession, companyId: string, id: string): Promise<DocumentFile> {
      const a = await adjustments.getAdvance(session, companyId, id);
      return file(advanceVoucherDoc(a, await head(session, companyId)), `advance-voucher-${a.entryNo}`);
    },
    async bonusVoucher(session: VerifiedSession, companyId: string, id: string): Promise<DocumentFile> {
      const b = await adjustments.getBonus(session, companyId, id);
      return file(bonusVoucherDoc(b, await head(session, companyId)), `${b.type.toLowerCase()}-voucher-${b.entryNo}`);
    },
    async separationRecord(session: VerifiedSession, companyId: string, id: string): Promise<DocumentFile> {
      const x = await separations.get(session, companyId, id);
      return file(separationRecordDoc(x, await head(session, companyId)), `separation-${x.entryNo}`);
    },
    async joiningLetter(session: VerifiedSession, companyId: string, employeeId: string): Promise<DocumentFile> {
      const d = await letters.joiningLetter(session, companyId, employeeId);
      return file(d, `joining-letter-${employeeId.slice(0, 8)}`);
    },
    async experienceLetter(session: VerifiedSession, companyId: string, separationId: string): Promise<DocumentFile> {
      const d = await letters.experienceLetter(session, companyId, separationId);
      return file(d, `experience-letter-${separationId.slice(0, 8)}`);
    },
  };
}

export type PayrollDocumentService = ReturnType<typeof createPayrollDocumentService>;

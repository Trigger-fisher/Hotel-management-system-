import "server-only";
import { createAttendanceService, type AttendanceService } from "../services/payrollCore/attendanceService";
import { createCompanyService, type PayrollCompanyService } from "../services/payrollCore/companyService";
import type { DocumentRenderer, PayrollDeps, PayrollMail } from "../services/payrollCore/context";
import { createEmployeeService, type EmployeeService } from "../services/payrollCore/employeeService";
import { createSetupService, type SetupService } from "../services/payrollCore/setupService";
import { createStaffEmailService, type StaffEmailService } from "../services/payrollCore/staffEmailService";
import { createAdjustmentService, type AdjustmentService } from "../services/payrollPay/adjustmentService";
import { createPayrollDocumentService, type PayrollDocumentService } from "../services/payrollPay/documentService";
import { getDocumentRenderer } from "../documents";
import { createLetterService, type LetterService } from "../services/payrollPay/letterService";
import { createMealsService, type MealsService } from "../services/payrollPay/mealsService";
import { createSeparationService, type SeparationService } from "../services/payrollPay/separationService";
import { createPayFigures, createPaymentService, type PaymentService } from "../services/payrollPay/paymentService";
import { createRevisionService, type RevisionService } from "../services/payrollPay/revisionService";
import { createSalaryRun } from "../services/payrollPay/salaryRun";
import { billingDefaults } from "./billing";

// The composition root of payroll core: the SAME hotel unit as billing, the front office and companies (one store per hotel), and the PORTS
// approved by Backend review. Until their owners implement them: payroll mail queues nothing (the send is
// recorded failed with Pallav's sentence), the PDF renderer answers "pending" (an open decision for MJ), and the salary run and pay figures
// come from payroll pay (task B6a: services/payrollPay).

const noPayrollMail: PayrollMail = { staffDetails: async () => ({ queued: false }), offerLetter: async () => ({ queued: false }) };

/**
 * The mail attachments, for real (MJ #22): the staff record sheet and the appointment letter rendered with the SENDER's permissions. The documents
 * service is read lazily (it is built from these same deps). The outbox worker renders again at send time from the kind and ids; nothing is stored.
 */
export const pdfRenderer: DocumentRenderer = {
  async render(kind, data, session) {
    if (!session) return { status: "pending" };
    const companyId = String(data.companyId);
    const employeeId = String(data.employeeId);
    const file = kind === "employee" ? await getPayrollDocuments().employee(session, companyId, employeeId) : await getPayrollDocuments().joiningLetter(session, companyId, employeeId);
    const out = await getDocumentRenderer().render("payrollDoc", file);
    return { status: "ready", bytes: out.bytes };
  },
};

function payrollDefaults(): PayrollDeps {
  const base = billingDefaults();
  // the salary run and the dashboard's pay half are payroll pay's (task B6a); they plug into core's ports here
  return { ...base, mail: noPayrollMail, renderer: pdfRenderer, salaryRun: createSalaryRun({ now: base.now }), payFigures: createPayFigures() };
}

interface PayrollServices {
  meals: MealsService;
  letters: LetterService;
  separations: SeparationService;
  revisions: RevisionService;
  payments: PaymentService;
  adjustments: AdjustmentService;
  documents: PayrollDocumentService;
  companies: PayrollCompanyService;
  employees: EmployeeService;
  attendance: AttendanceService;
  setup: SetupService;
  staffEmails: StaffEmailService;
}
let services: PayrollServices | null = null;

export function buildPayrollServices(deps: PayrollDeps): PayrollServices {
  const letters = createLetterService(deps);
  const employees = createEmployeeService(deps);
  const adjustments = createAdjustmentService(deps);
  const separations = createSeparationService(deps);
  const payments = createPaymentService(deps);
  return {
    meals: createMealsService(deps),
    letters,
    separations,
    revisions: createRevisionService(deps),
    payments,
    documents: createPayrollDocumentService(deps, { payments, letters, employees, adjustments, separations }),
    adjustments,
    companies: createCompanyService(deps),
    employees,
    attendance: createAttendanceService(deps),
    setup: createSetupService(deps),
    staffEmails: createStaffEmailService(deps),
  };
}

const all = (): PayrollServices => (services ??= buildPayrollServices(payrollDefaults()));
export const getPayrollCompanies = (): PayrollCompanyService => all().companies;
export const getPayrollEmployees = (): EmployeeService => all().employees;
export const getPayrollAttendance = (): AttendanceService => all().attendance;
export const getPayrollSetup = (): SetupService => all().setup;
export const getPayrollStaffEmails = (): StaffEmailService => all().staffEmails;
export const getPayrollMeals = (): MealsService => all().meals;
export const getPayrollLetters = (): LetterService => all().letters;
export const getPayrollSeparations = (): SeparationService => all().separations;
export const getPayrollRevisions = (): RevisionService => all().revisions;
export const getPayrollDocuments = (): PayrollDocumentService => all().documents;
export const getPayrollPayments = (): PaymentService => all().payments;
export const getPayrollAdjustments = (): AdjustmentService => all().adjustments;

/** Replaces the payroll services (start-up code and tests). */
export function configurePayroll(next: PayrollServices | null): void {
  services = next;
}

import "server-only";
import type { PayrollDoc } from "@shared/dashboards/payrollPay";
import type { AttentionItem, PayrollCompanyRow, PayrollDashboard } from "@shared/dashboards/payrollCore";
import type { Kpi } from "@shared/dashboards/common";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import { searchWords } from "../../validation/listQuery";
import type { PayrollCompanyFields } from "../../repos/payrollCore";
import { istMoment } from "../cash/ist";
import { companyOrFail, notFound, PART, PAYROLL_MODULE, payrollKit, requireAnyPayroll, type PayrollDeps } from "./context";
import { progressPercent } from "./attendanceService";
import { dtoCompany } from "./dto";
import type { CompanyBody } from "./schemas";
import { Rules } from "./validate";
import { payrollCompanyDoc } from "./companyDocument";

// The fixed payroll companies (Pallav PayrollController, PayrollCompanyController, FixedCompaniesTest) and the payroll dashboard
// (PayrollDashboardController). Companies are seeded at provisioning and never added, deleted, renamed or deactivated. Spec: §1, §8.

const ZERO = BigInt(0);

export function createCompanyService(deps: PayrollDeps) {
  const { unit, catalog, now, payFigures } = deps;
  const kit = payrollKit(deps);

  return {
    /** The listing in the fixed order, staff counted in ONE grouped count; nothing is created on a read (HMS, ruled). */
    async list(session: VerifiedSession, search?: string): Promise<PayrollCompanyRow[]> {
      requireAnyPayroll(session, catalog);
      const words = searchWords(search);
      return unit.run(session, async (repos) => (await repos.payrollCompanies.list({ words })).map((c) => dtoCompany(c)));
    },

    async get(session: VerifiedSession, companyId: string): Promise<PayrollCompanyRow> {
      requireAnyPayroll(session, catalog);
      return unit.run(session, async (repos) => {
        const c = await repos.payrollCompanies.row(companyId);
        if (!c) throw notFound();
        return dtoCompany(c);
      });
    },

    /** The company's details as the document the PDF draws: the SAME fields and permission as `get`. */
    async document(session: VerifiedSession, companyId: string): Promise<{ doc: PayrollDoc; filename: string }> {
      const c = await this.get(session, companyId);
      return { doc: payrollCompanyDoc(c), filename: `payroll-company-${c.code || c.name}` };
    },

    /** update (:39-63): the details only (name and code are fixed; a company is never deactivated). */
    async update(session: VerifiedSession, companyId: string, input: CompanyBody, meta: RequestMeta): Promise<PayrollCompanyRow> {
      requirePermission(session, catalog, PAYROLL_MODULE, "edit");
      const actor = await kit.actor(session);
      return unit.run(session, async (repos) => {
        const company = await repos.payrollCompanies.get(companyId, { forUpdate: true });
        if (!company) throw notFound();
        const v = new Rules();
        const req = (key: string, label: string, value: string, max: number) => v.max(key, label, v.required(key, label, value), max);
        const opt = (key: string, label: string, value: string, max: number) => v.text(key, label, value, max);
        const patch: Partial<PayrollCompanyFields> = {
          ownerName: opt("ownerName", "owner name", input.ownerName, 150),
          mobileNumber: req("mobileNumber", "mobile number", input.mobileNumber, 15),
          email: v.max("email", "email", v.email("email", "email", Rules.clean(input.email)), 254),
          address: req("address", "address", input.address, 255),
          city: req("city", "city", input.city, 100),
          state: req("state", "state", input.state, 100),
          pincode: opt("pincode", "pincode", input.pincode, 20),
          panNumber: opt("panNumber", "pan number", input.panNumber, 20),
          tanNumber: opt("tanNumber", "tan number", input.tanNumber, 20),
          pfRegistrationNumber: opt("pfRegistrationNumber", "pf registration number", input.pfRegistrationNumber, 50),
          esicRegistrationNumber: opt("esicRegistrationNumber", "esic registration number", input.esicRegistrationNumber, 50),
          professionalTaxRegistrationNumber: opt("professionalTaxRegistrationNumber", "professional tax registration number", input.professionalTaxRegistrationNumber, 50),
          authorizedPersonName: req("authorizedPersonName", "authorized person name", input.authorizedPersonName, 150),
          authorizedDesignation: req("authorizedDesignation", "authorized designation", input.authorizedDesignation, 100),
          authorizedMobile: opt("authorizedMobile", "authorized mobile", input.authorizedMobile, 15),
          authorizedEmail: v.max("authorizedEmail", "authorized email", v.email("authorizedEmail", "authorized email", Rules.clean(input.authorizedEmail)), 254),
          bankName: opt("bankName", "bank name", input.bankName, 150),
          branchName: opt("branchName", "branch name", input.branchName, 150),
        };
        // plain text (no encryption, as Pallav): absent = keep, "" = empty
        if (input.accountNumber !== undefined) {
          const number = opt("accountNumber", "account number", input.accountNumber, 50);
          patch.accountNumber = number;
        }
        const ifsc = opt("ifscCode", "ifsc code", input.ifscCode, 20);
        patch.ifscCode = ifsc;
        v.done();
        await repos.payrollCompanies.update(companyId, patch, session.userId);
        const row = (await repos.payrollCompanies.row(companyId))!;
        await kit.log({ repos, session, meta, actor, company }, { action: "updated", entity: "Company", summary: `Company updated: ${company.name} (${company.code})`, subject: { id: company.id, label: company.name }, details: { Code: company.code } });
        return dtoCompany(row);
      });
    },

    /** PayrollDashboardController::index (:16-60): setup checks from ONE query, counts as aggregates, the pay half from the B6 port. */
    async dashboard(session: VerifiedSession, companyId: string): Promise<PayrollDashboard> {
      requirePermission(session, catalog, PART.dashboard, "view");
      const today = istMoment(now()).date;
      const [year, month, day] = today.split("-").map(Number);
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const staff = await repos.employees.counts(companyId);
        // attendanceProgress (:62-80): against the days that have happened; a month never opened shows nothing filled (no row is made)
        const m = await repos.attendance.findMonth(companyId, year, month);
        const expected = staff.active * day;
        const filled = m && expected > 0 ? await repos.attendance.filledCount(m.id) : 0;
        const attendance = { filled, expected, percent: m && expected > 0 ? progressPercent(filled, expected) : 0, locked: m ? m.isLocked : false };
        const pay = payFigures ? await payFigures.figures(repos, companyId) : null;
        const net = pay?.netPaise ?? ZERO;
        const paid = pay?.paidPaise ?? ZERO;
        const outstanding = net > paid ? net - paid : ZERO;

        // attention (:89-176): setup gaps first, in Pallav's order and words
        const setup = await repos.payrollSetup.setup(companyId);
        const attention: AttentionItem[] = [];
        const add = (id: string, tone: AttentionItem["tone"], icon: string, text: string, action: string, viewId: string): void => void attention.push({ id, tone, icon, text, action, viewId });
        if (!setup.hasActiveStatus) add("statuses", "danger", "tag", "No attendance statuses yet - attendance cannot be recorded until there is at least one.", "Set them up", "hotel.payroll.attendanceStatuses");
        if (!setup.hasActiveStaff) add("staff", "danger", "users", "No staff on the payroll yet.", "Add someone", "hotel.payroll.staff");
        if (!setup.hasDeduction) add("deductions", "warning", "minus", "No deductions are configured, so none can be assigned to staff.", "Configure", "hotel.payroll.deductions");
        if (!setup.hasJoiningLetter) add("joining", "warning", "file", "No joining letter template, so letters cannot be issued.", "Write one", "hotel.payroll.joiningLetter");
        if (!setup.hasExperienceLetter) add("experience", "warning", "file", "No experience letter template, so leavers cannot be issued one.", "Write one", "hotel.payroll.experienceLetter");
        if (pay && pay.openPayments > 0) add("open", "warning", "wallet", `${pay.openPayments} salary ${pay.openPayments === 1 ? "payment is" : "payments are"} still open.`, "Settle them", "hotel.payroll.salaryPayments");
        if (pay && pay.failedPayments > 0) add("failed", "danger", "alert", `${pay.failedPayments} salary ${pay.failedPayments === 1 ? "payment" : "payments"} failed and need re-issuing.`, "Review", "hotel.payroll.salaryPayments");
        if (pay && pay.onNotice > 0) add("notice", "info", "logout", `${pay.onNotice} ${pay.onNotice === 1 ? "person is" : "people are"} working their notice period.`, "Open", "hotel.payroll.resignations");

        const kpis: Kpi[] = [
          { id: "staff", label: "Active staff", value: staff.active, kind: "count", trend: null, tone: "graphite", icon: "users", hint: `${staff.all - staff.active} former` },
          { id: "attendance", label: "Attendance filled", value: attendance.percent, kind: "percent", trend: null, tone: attendance.percent === 100 ? "success" : "info", icon: "calendar", hint: `${filled} of ${expected} days` },
          { id: "due", label: "Salary due", value: paiseToNumber(outstanding), kind: "money", trend: null, tone: outstanding > ZERO ? "warning" : "success", icon: "wallet", hint: pay?.payrollMonth ? `${pay.unpaidCount} of ${pay.payrollCount} unpaid` : "No salary processed yet" },
          { id: "advances", label: "Advances out", value: paiseToNumber(pay?.advanceOutstandingPaise ?? ZERO), kind: "money", trend: null, tone: "danger", icon: "arrowUp", hint: `${pay?.advanceOpen ?? 0} open` },
        ];
        const companyRow = (await repos.payrollCompanies.row(companyId))!;
        const { staffCount: _s, activeStaffCount: _a, ...plain } = dtoCompany(companyRow);
        void _s;
        void _a;
        return {
          company: plain,
          kpis,
          attendance,
          payrollMonth: pay?.payrollMonth ?? null,
          netPaise: paiseToNumber(net),
          paidPaise: paiseToNumber(paid),
          attention,
          recent: (pay?.recent ?? []).slice(0, 7).map((r, i) => ({ id: `r${i + 1}`, at: r.at, icon: r.icon, title: r.title, detail: r.detail })),
        };
      });
    },
  };
}

export type PayrollCompanyService = ReturnType<typeof createCompanyService>;

import "server-only";
import type { LookupItem, Page } from "@shared/dashboards/common";
import type { CreateEmployeeResult, Employee, EmployeeDeductionAssignment, PayrollOptions } from "@shared/dashboards/payrollCore";
import { canUseRecycleBin } from "../../auth/access";
import { canWriteAnything, requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import type { DeductionKind, EmployeeDeductionRecord, EmployeeFields, EmployeeListRow, EmployeeRecord, PayrollCompanyRecord } from "../../repos/payrollCore";
import { RepoError } from "../../repos/types";
import { isAdmin, isSuperAdmin } from "../cash/rules";
import { companyOrFail, conflict, notFound, PART, payrollKit, refuse, type PayrollDeps, type PayrollUnitRepos, type PayrollWrite } from "./context";
import { dtoDeduction } from "./dto";
import { BANK_MODE, choicesFrom } from "./masters";
import * as phone from "./phone";
import type { EmployeeBody } from "./schemas";
import { fieldError, Rules } from "./validate";

// Staff (Pallav EmployeeController, Models/Employee.php, PayrollRules, OfferLetterMailer). Spec: docs/specs/payroll-core.md §3-4. Account
// number, IFSC, ID proof number and emergency number are plain columns (MJ: plain data); a page carries none of them, the single read returns them
// in full. The appointment letter goes through the outbox.

const CODE_TAKEN = "This Employee ID is already used within the selected company.";
const EMAIL_TAKEN = "Another employee in this company already uses this email address.";

interface ValidEmployee {
  fields: EmployeeFields;
  assignments: { id?: string; deductionId: string; deductionType: DeductionKind; amountPaise: bigint }[];
}

export function createEmployeeService(deps: PayrollDeps) {
  const { unit, catalog, mail, renderer } = deps;
  const kit = payrollKit(deps);

  /** PayrollRules::canEdit (:13-26): can write, and the SuperAdmin, an Admin, or whoever added the person. */
  const canEdit = (session: VerifiedSession, e: { createdBy: string | null }): boolean =>
    canWriteAnything(session) && (isSuperAdmin(session) || isAdmin(session, catalog) || (e.createdBy !== null && e.createdBy === session.userId));
  /** PayrollRules::canDelete (:28-31) */
  const canDelete = (session: VerifiedSession): boolean => isSuperAdmin(session) || isAdmin(session, catalog);

  function dto(session: VerifiedSession, e: EmployeeListRow | EmployeeRecord, assigned: readonly EmployeeDeductionRecord[]): Employee {
    const record = e as Partial<EmployeeRecord>;
    const emergencyNumber = record.emergencyContactNumber ?? "";
    return {
      id: e.id,
      companyId: e.payrollCompanyId,
      name: e.name,
      dateOfBirth: e.dateOfBirth ?? "",
      gender: e.gender ?? "",
      contactNumber: e.contactNumber,
      contactCountry: e.contactCountry,
      email: e.email,
      address: e.address ?? "",
      nationality: e.nationality ?? "",
      countryAndPincode: e.countryAndPincode ?? "",
      emergencyContactName: e.emergencyContactName ?? "",
      emergencyContactRelation: e.emergencyContactRelation ?? "",
      emergencyContactNumber: emergencyNumber,
      emergencyContactCountry: e.emergencyContactCountry,
      employeeCode: e.employeeCode,
      designation: e.designation,
      department: e.department ?? "",
      shift: e.shift ?? "",
      joiningDate: e.joiningDate,
      dailyWorkingHours: Number(e.dailyWorkingHours),
      qualification: e.qualification ?? "",
      qualificationInstitution: e.qualificationInstitution ?? "",
      skills: e.skills ?? "",
      responsibilities: e.responsibilities ?? "",
      salaryPaise: paiseToNumber(e.salaryPaise),
      paymentMode: e.paymentMode,
      bankName: e.bankName ?? "",
      accountHolderName: e.accountHolderName ?? "",
      accountNumber: e.accountNumber ?? null,
      ifscCode: record.ifscCode ?? "",
      branchName: e.branchName ?? "",
      deductions: assigned.filter((a) => a.employeeId === e.id).map((a): EmployeeDeductionAssignment => ({ id: a.id, deductionId: a.deductionId, type: a.deductionType, amountPaise: paiseToNumber(a.amountPaise) })),
      idProofType: e.idProofType ?? "",
      idProofNumber: e.idProofNumber ?? null,
      resumeFileName: e.resumePath ? (e.resumePath.split("/").pop() ?? null) : null,
      isActive: e.isActive,
      canEdit: canEdit(session, e),
      canDelete: canDelete(session),
      createdAt: e.createdAt.toISOString(),
      display: { contact: phone.format(e.contactCountry, e.contactNumber), emergency: emergencyNumber ? phone.format(e.emergencyContactCountry, emergencyNumber) : "" },
    };
  }

  async function one(session: VerifiedSession, repos: PayrollUnitRepos, e: EmployeeRecord): Promise<Employee> {
    return dto(session, e, await repos.employeeDeductions.forEmployees([e.id]));
  }

  /** normalise() + rules() + messages() (:28-160). `existing` decides "absent = keep" for the numbers (absent = keep, empty = remove). */
  async function validated(repos: PayrollUnitRepos, company: PayrollCompanyRecord, input: EmployeeBody, existing: EmployeeRecord | null): Promise<ValidEmployee> {
    const v = new Rules();
    const masters = await repos.payrollMasters.activeMany(["gender", "salary_payment_mode"], company.id);
    const shifts = (await repos.optionLists.items("shift")).map((o) => o.value);

    // normalise (:140-166): each number to a dial code and national digits; nothing typed keeps a sensible country
    const numbers = (raw: string, selected: string): [string, string | null] => {
      if (Rules.clean(raw) === null) return [Rules.clean(selected) ?? phone.DEFAULT_DIAL, null];
      const [dial, national] = phone.normalise(raw, Rules.clean(selected));
      return [dial, national === "" ? null : national];
    };
    const [contactCountry, contactNumber] = numbers(input.contactNumber, input.contactCountry);
    const [emergencyCountry, emergencyNumber] = numbers(input.emergencyContactNumber, input.emergencyContactCountry);

    const employeeCode = v.max("employeeCode", "employee code", v.required("employeeCode", "employee code", input.employeeCode), 50);
    const name = v.max("name", "name", v.required("name", "name", input.name), 150);
    const designation = v.max("designation", "designation", v.required("designation", "designation", input.designation), 100);
    const department = v.text("department", "department", input.department, 100);
    const shift = v.text("shift", "shift", input.shift, 20);
    if (shifts.length > 0) v.oneOf("shift", "shift", shift, shifts);
    const responsibilities = Rules.clean(input.responsibilities);
    const joiningDate = v.date("joiningDate", "joining date", v.required("joiningDate", "joining date", input.joiningDate));
    v.atLeast("salaryPaise", "salary", input.salaryPaise, 0);
    v.atLeast("dailyWorkingHours", "daily working hours", input.dailyWorkingHours, 0.5);
    v.atMost("dailyWorkingHours", "daily working hours", input.dailyWorkingHours, 24);
    if (!phone.dials().includes(contactCountry)) v.fail("contactCountry", "The selected contact country is invalid.");
    if (contactNumber === null) v.fail("contactNumber", "A mobile number is needed.");
    else {
      const wrong = phone.check(contactCountry, contactNumber);
      if (wrong) v.fail("contactNumber", wrong);
    }
    const address = v.text("address", "address", input.address, 255);
    const emergencyContactName = v.text("emergencyContactName", "emergency contact name", input.emergencyContactName, 150);
    const emergencyContactRelation = v.text("emergencyContactRelation", "emergency contact relation", input.emergencyContactRelation, 60);
    if (!phone.dials().includes(emergencyCountry)) v.fail("emergencyContactCountry", "The selected emergency contact country is invalid.");
    if (emergencyNumber !== null) {
      const wrong = phone.check(emergencyCountry, emergencyNumber);
      if (wrong) v.fail("emergencyContactNumber", wrong);
    }
    const paymentMode = v.oneOf("paymentMode", "payment mode", v.required("paymentMode", "payment mode", input.paymentMode), choicesFrom(masters, "salary_payment_mode"));
    const bank = paymentMode === BANK_MODE;
    const ifRequired = (key: string, label: string, message: string, value: string | null, max: number): string | null => {
      if (bank && value === null) v.fail(key, message);
      return v.max(key, label, value, max);
    };
    const bankName = ifRequired("bankName", "bank name", "Bank name is required when the payment mode is Bank.", Rules.clean(input.bankName), 150);
    const accountHolderName = ifRequired("accountHolderName", "account holder name", "Account holder name is required when the payment mode is Bank.", Rules.clean(input.accountHolderName), 150);
    // write-only: absent = keep what is stored (it still counts as given for "required when Bank")
    const accountInput = input.accountNumber === undefined ? undefined : Rules.clean(input.accountNumber);
    const accountGiven = accountInput === undefined ? (existing?.accountNumber ? "kept" : null) : accountInput;
    if (bank && accountGiven === null) v.fail("accountNumber", "Account number is required when the payment mode is Bank.");
    if (accountInput) v.max("accountNumber", "account number", accountInput, 50);
    const ifscCode = ifRequired("ifscCode", "ifsc code", "IFSC code is required when the payment mode is Bank.", Rules.clean(input.ifscCode), 20);
    const branchName = v.text("branchName", "branch name", input.branchName, 150);
    const idProofType = v.text("idProofType", "id proof type", input.idProofType, 100);
    const idInput = input.idProofNumber === undefined ? undefined : v.text("idProofNumber", "id proof number", input.idProofNumber, 50);
    const email = v.max("email", "email", v.email("email", "email", v.required("email", "email", input.email, "An email address is needed - the appointment letter is sent to it.")), 254)?.toLowerCase() ?? null;
    const dateOfBirth = v.date("dateOfBirth", "date of birth", Rules.clean(input.dateOfBirth));
    const gender = v.oneOf("gender", "gender", v.text("gender", "gender", input.gender, 20), choicesFrom(masters, "gender"));
    const nationality = v.text("nationality", "nationality", input.nationality, 100);
    const countryAndPincode = v.text("countryAndPincode", "country and pincode", input.countryAndPincode, 100);
    const qualification = v.text("qualification", "qualification", input.qualification, 150);
    const qualificationInstitution = v.text("qualificationInstitution", "qualification institution", input.qualificationInstitution, 150);
    const skills = v.text("skills", "skills", input.skills, 2000);

    // deductions.*: the company's own (PayrollScope::belongsToCompany), One Time or Monthly, amount >= 0; a row with no deduction is skipped
    const wanted = input.deductions.map((d) => d.deductionId).filter(Boolean);
    const own = new Set(wanted.length ? await repos.deductions.ownIds(company.id, wanted) : []);
    const assignments: ValidEmployee["assignments"] = [];
    input.deductions.forEach((d, n) => {
      if (!d.deductionId) return;
      if (!own.has(d.deductionId)) v.fail(`deductions.${n}`, `The selected deductions.${n}.deduction id is invalid.`);
      const amount = d.amountPaise ?? 0;
      if (amount < 0) v.fail(`deductions.${n}`, `The deductions.${n}.amount field must be at least 0.`);
      assignments.push({ ...(d.id ? { id: d.id } : {}), deductionId: d.deductionId, deductionType: d.type ?? "Monthly", amountPaise: BigInt(Math.max(0, amount)) });
    });

    if (employeeCode && !v.has("employeeCode") && (await repos.employees.codeTaken(company.id, employeeCode, existing?.id))) v.fail("employeeCode", CODE_TAKEN);
    if (email && !v.has("email") && (await repos.employees.emailTaken(company.id, email, existing?.id))) v.fail("email", EMAIL_TAKEN);
    v.done();

    // plain text (no encryption, as Pallav): absent = keep what is stored
    const plainOrKeep = (given: string | null | undefined, stored: string | null | undefined): string | null => (given === undefined ? (stored ?? null) : given);
    return {
      fields: {
        employeeCode: employeeCode!,
        name: name!,
        designation: designation!,
        department,
        shift,
        responsibilities,
        joiningDate: joiningDate!,
        salaryPaise: BigInt(input.salaryPaise),
        dailyWorkingHours: input.dailyWorkingHours.toFixed(2),
        contactCountry,
        contactNumber: contactNumber!,
        address,
        emergencyContactName,
        emergencyContactRelation,
        emergencyContactCountry: emergencyCountry,
        emergencyContactNumber: emergencyNumber,
        paymentMode: paymentMode!,
        bankName,
        accountHolderName,
        accountNumber: plainOrKeep(accountInput, existing?.accountNumber),
        ifscCode,
        branchName,
        idProofType,
        idProofNumber: plainOrKeep(idInput, existing?.idProofNumber),
        email: email!,
        dateOfBirth,
        gender,
        nationality,
        countryAndPincode,
        qualification,
        qualificationInstitution,
        skills,
        photoPath: existing?.photoPath ?? null,
        idProofImagePath: existing?.idProofImagePath ?? null,
        idProofBackImagePath: existing?.idProofBackImagePath ?? null,
        resumePath: existing?.resumePath ?? null,
      },
      assignments,
    };
  }

  const uniqueFailed = (error: unknown): never => {
    if (error instanceof RepoError && error.kind === "unique") throw fieldError("employeeCode", CODE_TAKEN);
    throw error;
  };

  /** The details the log keeps (never a bank or ID number: they show as changed only). */
  const logFields = (f: EmployeeFields): Record<string, string | number | null> => ({
    "Employee ID": f.employeeCode,
    Name: f.name,
    Designation: f.designation,
    Department: f.department,
    "Joining date": f.joiningDate,
    Salary: (Number(f.salaryPaise) / 100).toFixed(2),
    Mobile: phone.format(f.contactCountry, f.contactNumber),
    Email: f.email,
    "Payment mode": f.paymentMode,
  });
  function changes(before: EmployeeRecord, after: EmployeeFields): Record<string, string | number | null> {
    const a = logFields(before);
    const b = logFields(after);
    const out: Record<string, string | number | null> = {};
    for (const k of Object.keys(b)) if (a[k] !== b[k]) out[k] = `${a[k] ?? ""} → ${b[k] ?? ""}`;
    if ((before.accountNumber ?? null) !== (after.accountNumber ?? null)) out["Account number"] = "changed";
    if ((before.idProofNumber ?? null) !== (after.idProofNumber ?? null)) out["ID proof number"] = "changed";
    return out;
  }

  /** OfferLetterMailer::send (:13-56), through the outbox (ruled). */
  async function offerLetter(w: PayrollWrite, e: EmployeeRecord): Promise<{ sent: boolean; message: string }> {
    let result: { sent: boolean; message: string };
    const file = `appointment-letter-${e.employeeCode}.pdf`;
    if (!e.email) result = { sent: false, message: "There is no email address on record, so the letter was not sent." };
    else if (!(await w.repos.payrollSetup.joiningTemplateActive(w.company.id))) result = { sent: false, message: "No active joining letter template is set up, so no letter was sent." };
    else {
      const pdf = await renderer.render("offer-letter", { employeeId: e.id, companyId: w.company.id }, w.session);
      const { queued } = await mail.offerLetter(w.session.hotelId, { employeeId: e.id, to: e.email, toName: e.name, subject: `Your appointment letter from ${w.company.name}`, attachment: { name: file, status: pdf.status } });
      result = queued
        ? { sent: true, message: `Appointment letter emailed to ${e.email}.` }
        : { sent: false, message: "The letter could not be emailed. Check the mail settings, or download it and send it yourself." };
    }
    const who = `${e.name} (${e.employeeCode})`;
    // PayrollLogger::email (:52-74)
    await kit.log(w, {
      action: "emailed",
      entity: "Email",
      status: result.sent ? "success" : "failed",
      summary: `${result.sent ? "" : "Not sent: "}Appointment letter for ${e.name}${e.email ? ` to ${e.email}` : ""}`,
      subject: { id: e.id, label: who },
      details: Object.fromEntries(
        Object.entries({ Email: "Appointment letter", Staff: who, "Sent to": e.name ? `${e.name} <${e.email}>` : e.email, Outcome: result.sent ? "Sent" : "Not sent", Message: result.message, Attachment: result.sent ? file : null }).filter(([, x]) => x !== null && x !== ""),
      ),
    });
    return result;
  }

  async function write<T>(session: VerifiedSession, companyId: string, meta: RequestMeta, work: (w: PayrollWrite) => Promise<T>): Promise<T> {
    const actor = await kit.actor(session);
    return unit.run(session, async (repos) => work({ repos, session, meta, actor, company: await companyOrFail(repos, companyId) }));
  }
  async function editable(w: PayrollWrite, id: string): Promise<EmployeeRecord> {
    const e = await w.repos.employees.get(w.company.id, id, { forUpdate: true });
    if (!e) throw notFound();
    return e;
  }

  return {
    canEdit,
    canDelete,

    /** index (:13-35): most recent joiner first; **HMS:** paged, searched; assignments of the page in ONE read. */
    async list(session: VerifiedSession, companyId: string, q: { search?: string; tab: "all" | "active" | "inactive"; deleted: boolean; page: number; pageSize: number }): Promise<Page<Employee>> {
      requirePermission(session, catalog, PART.staff, "view");
      if (q.deleted && !canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can open the recycle bin.");
      const words = (q.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const listed = await repos.employees.list(companyId, { words, active: q.tab === "all" ? undefined : q.tab === "active", deleted: q.deleted ? "only" : "no", sort: "joining", page: q.page, pageSize: q.pageSize });
        const assigned = await repos.employeeDeductions.forEmployees(listed.rows.map((r) => r.id));
        return { items: listed.rows.map((r) => dto(session, r, assigned)), total: listed.total, page: q.page, pageSize: q.pageSize };
      });
    },

    async get(session: VerifiedSession, companyId: string, id: string): Promise<Employee> {
      requirePermission(session, catalog, PART.staff, "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const e = await repos.employees.get(companyId, id);
        if (!e) throw notFound();
        return one(session, repos, e);
      });
    },

    /** The staff picker: ACTIVE people only (the advance, bonus and meals forms refuse inactive staff). */
    async lookup(session: VerifiedSession, companyId: string, q: { q: string; limit: number }): Promise<LookupItem[]> {
      requirePermission(session, catalog, PART.staff, "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        return (await repos.employees.lookup(companyId, { prefix: q.q, limit: Math.min(50, q.limit), active: true })).map((e) => ({ id: e.id, label: e.name, hint: e.employeeCode }));
      });
    },

    /** The staff form's choices (EmployeeController::index + PayrollMasters + Master Data `shift` + PhoneCountries). */
    async options(session: VerifiedSession, companyId: string): Promise<PayrollOptions> {
      requirePermission(session, catalog, PART.staff, "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const items = await repos.payrollMasters.activeMany(["gender", "designations", "departments", "salary_payment_mode", "id_proofs"], companyId);
        const deductions = await repos.deductions.list(companyId, { activeOnly: true });
        return {
          genders: choicesFrom(items, "gender"),
          designations: choicesFrom(items, "designations"),
          departments: choicesFrom(items, "departments"),
          shifts: (await repos.optionLists.items("shift")).map((o) => o.value),
          paymentModes: choicesFrom(items, "salary_payment_mode"),
          idProofTypes: choicesFrom(items, "id_proofs"),
          deductions: deductions.sort((a, b) => a.name.localeCompare(b.name)).map(dtoDeduction),
          phoneCountries: phone.phoneCountries(),
          hasJoiningTemplate: await repos.payrollSetup.joiningTemplateActive(companyId),
        };
      });
    },

    /** store (:162-190): the record and its deductions in one unit; the letter after, its outcome beside the record, never instead of it. */
    async create(session: VerifiedSession, companyId: string, input: EmployeeBody, meta: RequestMeta): Promise<CreateEmployeeResult> {
      requirePermission(session, catalog, PART.staff, "create");
      return write(session, companyId, meta, async (w) => {
        const v = await validated(w.repos, w.company, input, null);
        const e = await w.repos.employees.create(companyId, v.fields, session.userId).catch(uniqueFailed);
        await w.repos.employeeDeductions.sync(e.id, v.assignments, session.userId);
        await kit.log(w, { action: "created", entity: "Employee", summary: `Employee added: ${e.name} (${e.employeeCode})`, subject: { id: e.id, label: `${e.name} (${e.employeeCode})` }, details: logFields(e) });
        const letter = input.sendOfferLetter ? await offerLetter(w, e) : null;
        return { employee: await one(session, w.repos, e), letter };
      });
    },

    /** update (:206-243): PayrollRules::canEdit (ForceMode steps past it); editing never sends the letter. */
    async update(session: VerifiedSession, companyId: string, id: string, input: EmployeeBody, meta: RequestMeta): Promise<Employee> {
      requirePermission(session, catalog, PART.staff, "edit");
      return write(session, companyId, meta, async (w) => {
        const before = await editable(w, id);
        if (await kit.locked(!canEdit(session, before), "Not allowed to edit this staff record", w)) throw refuse("Only an Admin or whoever added this person can edit their record.");
        const v = await validated(w.repos, w.company, input, before);
        const e = await w.repos.employees.update(companyId, id, v.fields, session.userId).catch(uniqueFailed);
        await w.repos.employeeDeductions.sync(id, v.assignments, session.userId);
        const changed = changes(before, v.fields);
        // a save that changes nothing is not logged (PayrollLogTest)
        if (Object.keys(changed).length > 0) await kit.log(w, { action: "updated", entity: "Employee", summary: `Employee updated: ${e.name} (${e.employeeCode})`, subject: { id: e.id, label: `${e.name} (${e.employeeCode})` }, details: changed });
        return one(session, w.repos, e);
      });
    },

    /** destroy (:265-279): Admin or SuperAdmin, nothing depending on the person; to the recycle bin. */
    async remove(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, PART.staff, "full");
      return write(session, companyId, meta, async (w) => {
        const e = await editable(w, id);
        if (await kit.locked(!canDelete(session), "Only Admin users can delete a staff record", w)) throw refuse("Only an Admin can delete a staff record.");
        const blocker = await w.repos.employees.blockingDependency(id);
        if (await kit.locked(blocker !== null, `This employee is already used in ${blocker} and`, w)) {
          throw conflict(`This employee is already used in ${blocker} and cannot be deleted. Remove the dependent records first, or mark the employee Inactive.`);
        }
        await w.repos.employees.softDelete(companyId, id, session.userId);
        await kit.log(w, { action: "deleted", entity: "Employee", summary: `Employee deleted: ${e.name} (${e.employeeCode})`, subject: { id, label: `${e.name} (${e.employeeCode})` }, details: logFields(e) });
        return { id };
      });
    },

    /** Recycle bin: restore (the SuperAdmin; the employee ID must still be free among live staff). */
    async restore(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<Employee> {
      if (!canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can use the recycle bin.");
      return write(session, companyId, meta, async (w) => {
        const e = await w.repos.employees.get(companyId, id, { deleted: true, forUpdate: true });
        if (!e) throw notFound();
        if (await w.repos.employees.codeTaken(companyId, e.employeeCode)) throw fieldError("employeeCode", CODE_TAKEN);
        await w.repos.employees.restore(companyId, id).catch(uniqueFailed);
        await kit.log(w, { action: "updated", entity: "Employee", summary: `Employee restored: ${e.name} (${e.employeeCode})`, subject: { id, label: `${e.name} (${e.employeeCode})` }, details: null });
        return one(session, w.repos, { ...e, deletedAt: null, deletedBy: null });
      });
    },

    /** Recycle bin: removed for good; never while anything still names the person (the foreign keys would take attendance with it). */
    async purge(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ id: string }> {
      if (!canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can use the recycle bin.");
      return write(session, companyId, meta, async (w) => {
        const e = await w.repos.employees.get(companyId, id, { deleted: true, forUpdate: true });
        if (!e) throw notFound();
        const blocker = await w.repos.employees.blockingDependency(id, { purge: true });
        if (blocker) throw conflict(`This employee is already used in ${blocker} and cannot be deleted. Remove the dependent records first, or mark the employee Inactive.`);
        await w.repos.employees.purge(companyId, id);
        await kit.log(w, { action: "deleted", entity: "Employee", summary: `Employee removed for good: ${e.name} (${e.employeeCode})`, subject: { id, label: `${e.name} (${e.employeeCode})` }, details: null });
        return { id };
      });
    },

    /** toggleActive (:281-288) */
    async toggle(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<Employee> {
      requirePermission(session, catalog, PART.staff, "edit");
      return write(session, companyId, meta, async (w) => {
        const before = await editable(w, id);
        const e = await w.repos.employees.setActive(companyId, id, !before.isActive, session.userId);
        await kit.log(w, { action: "updated", entity: "Employee", summary: `Employee ${e.isActive ? "activated" : "deactivated"}: ${e.name} (${e.employeeCode})`, subject: { id, label: `${e.name} (${e.employeeCode})` }, details: { Active: e.isActive ? "Yes" : "No" } });
        return one(session, w.repos, e);
      });
    },

    /** sendOfferLetter (:192-199): sends (or re-sends) the appointment letter to someone already on the payroll. */
    async sendOfferLetter(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ sent: boolean; message: string }> {
      requirePermission(session, catalog, PART.staff, "edit");
      return write(session, companyId, meta, async (w) => {
        const e = await w.repos.employees.get(companyId, id);
        if (!e) throw notFound();
        // the outcome is the answer either way (Pallav flashes it); a failure is kept in the payroll log, so it is not thrown
        return offerLetter(w, e);
      });
    },
  };
}

export type EmployeeService = ReturnType<typeof createEmployeeService>;

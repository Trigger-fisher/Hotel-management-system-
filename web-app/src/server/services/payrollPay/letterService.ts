import "server-only";
import { letterSectionDefs, type DocBlock, type LetterKind, type LetterTemplate, type PayrollDoc } from "@shared/dashboards/payrollPay";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import type { LetterFields, LetterRecord } from "../../repos/payrollPay";
import { istMoment } from "../cash/ist";
import { companyOrFail, conflict, notFound, payrollKit, type PayrollDeps, type PayrollUnitRepos, type PayrollWrite } from "../payrollCore/context";
import { Rules } from "../payrollCore/validate";
import { longDate } from "./dates";
import { experienceValues, joiningValues, strtr } from "./letterText";
import { numberFormat } from "./dto";
import type { LetterBody } from "./schemas";

// The joining and experience letter templates (Pallav JoiningLetterController, ExperienceLetterController): ONE template per company and kind,
// hard-deleted, switched on or off; and the letters made from them, with the placeholders replaced. Spec: docs/specs/payroll-pay.md §12.
// HMS: a letter is returned as the structured document the apps print (PayrollDoc); the PDF renderer is the DocumentRenderer port.

const PART: Record<LetterKind, string> = { joining: "payroll.joining-letter", experience: "payroll.experience-letter" };
const NOUN: Record<LetterKind, string> = { joining: "Joining letter", experience: "Experience letter" };
/** The contract's section ids → the stored columns (closing and acceptance have a column of their own). */
const COLUMN: Record<LetterKind, Record<string, string>> = {
  joining: { introduction: "introduction_content", responsibilities: "roles_responsibilities", terms: "terms_conditions" },
  experience: { body: "body_content", conduct: "conduct_remarks" },
};

export function createLetterService(deps: PayrollDeps) {
  const { unit, catalog, now } = deps;
  const kit = payrollKit(deps);
  const today = (): string => istMoment(now()).date;

  async function write<T>(session: VerifiedSession, companyId: string, meta: RequestMeta, work: (w: PayrollWrite) => Promise<T>): Promise<T> {
    const actor = await kit.actor(session);
    return unit.run(session, async (repos) => work({ repos, session, meta, actor, company: await companyOrFail(repos, companyId) }));
  }

  /** The template as the apps get it: the signatory is the company's authorised person when the template uses it. */
  async function dto(repos: PayrollUnitRepos, companyId: string, l: LetterRecord): Promise<LetterTemplate> {
    const company = (await repos.payrollCompanies.get(companyId))!;
    const defs = letterSectionDefs[l.kind];
    const text = (id: string): string => {
      if (id === "closing") return l.closingMessage ?? "";
      if (id === "acceptance") return l.acceptanceContent ?? "";
      return l.sections[COLUMN[l.kind][id]] ?? "";
    };
    return {
      companyId,
      kind: l.kind,
      subject: l.subject ?? "",
      sections: defs.map((d) => ({ id: d.id, label: d.label, text: text(d.id) })),
      signatoryName: (l.useCompanySignatory ? company.authorizedPersonName : l.authorizedName) ?? "",
      signatoryDesignation: (l.useCompanySignatory ? company.authorizedDesignation : l.authorizedDesignation) ?? "",
      isActive: l.isActive,
      updatedAt: l.updatedAt.toISOString(),
    };
  }

  /** Paragraphs of a section, one per line. */
  const paras = (text: string, values: Record<string, string>): DocBlock[] =>
    strtr(text, values).split("\n").map((p): DocBlock => ({ kind: "para", text: p }));

  function document(l: LetterRecord, t: LetterTemplate, values: Record<string, string>, details: { label: string; value: string }[], to: string[], company: { name: string; address: string | null; city: string | null; state: string | null; pincode: string | null }): PayrollDoc {
    const blocks: DocBlock[] = [
      { kind: "kv", items: [{ label: "Date", value: longDate(today()) }, ...to.map((v, i) => ({ label: i === 0 ? "To" : "", value: v }))] },
      { kind: "heading", text: strtr(t.subject, values) },
    ];
    const body = t.sections.filter((x) => x.id !== "acceptance" && x.text.trim() !== "");
    for (const x of body.slice(0, 1)) blocks.push(...paras(x.text, values));
    blocks.push({ kind: "kv", title: l.kind === "joining" ? "Appointment details" : "Service record", items: details });
    for (const x of body.slice(1)) blocks.push(...paras(x.text, values));
    blocks.push({ kind: "signatures", items: [{ name: t.signatoryName || "Authorised signatory", role: `${t.signatoryDesignation || "For"} · ${company.name}` }] });
    const acceptance = t.sections.find((x) => x.id === "acceptance");
    if (acceptance && acceptance.text.trim() !== "") {
      blocks.push({ kind: "heading", text: strtr(l.acceptanceHeading ?? "Employee Acceptance", values) });
      blocks.push({ kind: "para", text: strtr(acceptance.text, values) });
      blocks.push({ kind: "signatures", items: [{ name: values["{EMPLOYEE_NAME}"] ?? "", role: "Employee signature and date" }] });
    }
    return {
      companyName: company.name,
      companyLine: [company.address, company.city, company.state, company.pincode].filter(Boolean).join(", "),
      title: l.kind === "joining" ? "Joining Letter" : "Experience Letter",
      subtitle: l.kind === "experience" ? "To whomsoever it may concern" : undefined,
      blocks,
    };
  }

  return {
    template: dto,

    /** index: this company's template (or none). */
    async get(session: VerifiedSession, companyId: string, kind: LetterKind): Promise<LetterTemplate | null> {
      requirePermission(session, catalog, PART[kind], "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const l = await repos.letters.get(companyId, kind);
        return l ? dto(repos, companyId, l) : null;
      });
    },

    /** save (:30-60 / :28-52): only one template per company; every field optional (Pallav's rules). */
    async save(session: VerifiedSession, companyId: string, kind: LetterKind, input: LetterBody, meta: RequestMeta): Promise<LetterTemplate> {
      requirePermission(session, catalog, PART[kind], "edit");
      return write(session, companyId, meta, async (w) => {
        const v = new Rules();
        const subject = v.text("subject", "subject", input.subject, 255);
        const name = v.text("signatoryName", "authorized name", input.signatoryName, 150);
        const designation = v.text("signatoryDesignation", "authorized designation", input.signatoryDesignation, 100);
        const defs = letterSectionDefs[kind];
        input.sections.forEach((s, i) => {
          if (!defs.some((d) => d.id === s.id)) v.fail(`sections.${i}.id`, `The selected sections.${i}.id is invalid.`);
        });
        v.done();
        const existing = await w.repos.letters.get(companyId, kind);
        const text = (id: string): string | null => {
          const given = input.sections.find((s) => s.id === id);
          return given ? Rules.clean(given.text) : null;
        };
        const sections: Record<string, string | null> = {};
        for (const [id, column] of Object.entries(COLUMN[kind])) sections[column] = text(id);
        const company = (await w.repos.payrollCompanies.get(companyId))!;
        // a signatory the same as the company's (or none given) uses the company's authorised person
        const useCompany = (name === null && designation === null) || (name === company.authorizedPersonName && designation === company.authorizedDesignation);
        const fields: LetterFields = {
          subject,
          sections,
          closingMessage: text("closing"),
          useCompanySignatory: useCompany,
          authorizedName: useCompany ? (existing?.authorizedName ?? null) : name,
          authorizedDesignation: useCompany ? (existing?.authorizedDesignation ?? null) : designation,
          authorizedClosingText: existing?.authorizedClosingText ?? null,
          acceptanceHeading: existing?.acceptanceHeading ?? null,
          acceptanceContent: kind === "joining" ? text("acceptance") : null,
          acceptanceClosingText: existing?.acceptanceClosingText ?? null,
        };
        const saved = await w.repos.letters.save(companyId, kind, fields, session.userId);
        await kit.log(w, { action: existing ? "updated" : "created", entity: NOUN[kind], summary: `${NOUN[kind]} template saved`, subject: { id: saved.id, label: NOUN[kind] }, details: { Subject: subject } });
        return dto(w.repos, companyId, saved);
      });
    },

    async toggle(session: VerifiedSession, companyId: string, kind: LetterKind, meta: RequestMeta): Promise<LetterTemplate> {
      requirePermission(session, catalog, PART[kind], "edit");
      return write(session, companyId, meta, async (w) => {
        const l = await w.repos.letters.get(companyId, kind);
        if (!l) throw notFound();
        const saved = await w.repos.letters.setActive(companyId, kind, !l.isActive, session.userId);
        await kit.log(w, { action: "updated", entity: NOUN[kind], summary: `${NOUN[kind]} template ${saved.isActive ? "switched on" : "switched off"}`, subject: { id: saved.id, label: NOUN[kind] }, details: { Active: saved.isActive ? "Yes" : "No" } });
        return dto(w.repos, companyId, saved);
      });
    },

    async remove(session: VerifiedSession, companyId: string, kind: LetterKind, meta: RequestMeta): Promise<{ kind: LetterKind }> {
      requirePermission(session, catalog, PART[kind], "full");
      return write(session, companyId, meta, async (w) => {
        if (!(await w.repos.letters.remove(companyId, kind))) throw notFound();
        await kit.log(w, { action: "deleted", entity: NOUN[kind], summary: `${NOUN[kind]} template deleted`, subject: null, details: null });
        return { kind };
      });
    },

    /** JoiningLetterController::generate (:85-92): 404 without a template (a switched-off one still prints, as Pallav). */
    async joiningLetter(session: VerifiedSession, companyId: string, employeeId: string): Promise<PayrollDoc> {
      requirePermission(session, catalog, PART.joining, "view");
      return unit.run(session, async (repos) => {
        const company = await companyOrFail(repos, companyId);
        const e = await repos.employees.get(companyId, employeeId);
        if (!e) throw notFound();
        const l = await repos.letters.get(companyId, "joining");
        if (!l) throw notFound("No joining letter template configured for this company.");
        const t = await dto(repos, companyId, l);
        const values = joiningValues(e, today());
        const hours = Number(e.dailyWorkingHours);
        return document(
          l,
          t,
          values,
          [
            { label: "Designation", value: e.designation || "-" },
            { label: "Department", value: e.department || "-" },
            { label: "Joining date", value: longDate(e.joiningDate) },
            { label: "Working hours", value: `${hours} hrs / day` },
            { label: "Monthly salary", value: `₹${numberFormat(e.salaryPaise)}` },
            { label: "Payment mode", value: e.paymentMode },
          ],
          [e.name, `Employee ID ${e.employeeCode}`, ...(e.address ? [e.address] : [])],
          company,
        );
      });
    },

    /** SeparationController::experienceLetter (:187-211): needs the template and a Relieved, not rejoined, person. */
    async experienceLetter(session: VerifiedSession, companyId: string, separationId: string): Promise<PayrollDoc> {
      requirePermission(session, catalog, "payroll.separation", "view");
      return unit.run(session, async (repos) => {
        const company = await companyOrFail(repos, companyId);
        const s = await repos.separations.get(companyId, separationId);
        if (!s) throw notFound();
        const e = await repos.employees.get(companyId, s.employeeId);
        const l = await repos.letters.get(companyId, "experience");
        if (!l) throw notFound("No experience letter template configured for this company.");
        if (!(s.status === "Relieved" && s.rejoinedAt === null)) throw conflict("An experience letter can only be issued once the employee is marked Relieved.");
        if (!e) throw notFound();
        const t = await dto(repos, companyId, l);
        const values = experienceValues(e, s.lastWorkingDate, today());
        return document(
          l,
          t,
          values,
          [
            { label: "Employee name", value: e.name },
            { label: "Employee ID", value: e.employeeCode },
            { label: "Designation", value: e.designation || "-" },
            { label: "Department", value: e.department || "-" },
            { label: "Date of joining", value: longDate(e.joiningDate) },
            { label: "Last working day", value: longDate(s.lastWorkingDate) },
            { label: "Total service", value: values["{DURATION}"] },
            { label: "Reason for leaving", value: s.separationType },
          ],
          ["To whomsoever it may concern"],
          company,
        );
      });
    },
  };
}

export type LetterService = ReturnType<typeof createLetterService>;

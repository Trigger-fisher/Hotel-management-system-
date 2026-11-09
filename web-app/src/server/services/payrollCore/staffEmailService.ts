import "server-only";
import type { Page } from "@shared/dashboards/common";
import type { EmailRecipient, SendStaffEmailsResult, StaffEmail, StaffEmailFeed, StaffEmailSummary } from "@shared/dashboards/payrollCore";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import type { EmployeeRecord, PayrollMasterItemRecord, StaffEmailRecord } from "../../repos/payrollCore";
import { istInstant, istMoment } from "../cash/ist";
import { companyOrFail, PART, payrollKit, type PayrollDeps, type PayrollUnitRepos, type PayrollWrite } from "./context";
import { dtoStaffEmail, STALE_AFTER_MS } from "./dto";
import type { StaffEmailSendBody } from "./schemas";
import { Rules } from "./validate";

// Staff emails (Pallav StaffEmailController, StaffShareMailer, PayrollLogger::email): a person's details mailed to an address the SuperAdmin
// keeps in Payroll Master. Each send is recorded "sending" FIRST, then handed to the outbox in the same unit (ruled); the outbox worker finishes
// the record (`complete`). Spec: docs/specs/payroll-core.md §7.

const NOT_LISTED = "That recipient is not on the list for this company. Ask the SuperAdmin to add it under Payroll Master.";
const MAIL_FAILED = "The details could not be emailed. Check the mail settings and try again.";
const subjectFor = (e: EmployeeRecord, companyName: string): string => `Staff details: ${e.name} (${companyName})`;
const sentMessage = (r: Pick<StaffEmailRecord, "employeeName" | "recipientName" | "recipientEmail">): string => `${r.employeeName}'s details emailed to ${r.recipientName} (${r.recipientEmail}).`;

export function createStaffEmailService(deps: PayrollDeps) {
  const { unit, catalog, now, mail, renderer } = deps;
  const kit = payrollKit(deps);
  const words = (s?: string): string[] => (s ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const staleBefore = (): Date => new Date(now().getTime() - STALE_AFTER_MS);

  async function summary(repos: PayrollUnitRepos, companyId: string): Promise<StaffEmailSummary> {
    const today = istMoment(now()).date;
    return repos.staffEmails.stats(companyId, { staleBefore: staleBefore(), todayFrom: istInstant(today, "00:00:00"), todayTo: new Date(istInstant(today, "23:59:59").getTime() + 999) });
  }
  const recipientOf = (r: PayrollMasterItemRecord): EmailRecipient => ({ id: r.id, name: r.label, email: r.value ?? "" });

  /** PayrollLogger::email (:52-74) for a staff-details send. */
  async function logSend(w: PayrollWrite, e: EmployeeRecord, recipient: PayrollMasterItemRecord | null, outcome: { sent: boolean; message: string }, attachment: string): Promise<void> {
    const who = `${e.name} (${e.employeeCode})`;
    await kit.log(w, {
      action: "emailed",
      entity: "Email",
      status: outcome.sent ? "success" : "failed",
      summary: `${outcome.sent ? "" : "Not sent: "}Staff details shared for ${e.name}${recipient?.value ? ` to ${recipient.value}` : ""}`,
      subject: { id: e.id, label: who },
      details: Object.fromEntries(
        Object.entries({
          Email: "Staff details shared",
          Staff: who,
          "Sent to": recipient?.label ? `${recipient.label} <${recipient.value}>` : (recipient?.value ?? null),
          Outcome: outcome.sent ? "Sent" : "Not sent",
          Message: outcome.message,
          "Shared by": w.actor?.name ?? "System",
          Attachment: outcome.sent ? attachment : null,
        }).filter(([, x]) => x !== null && x !== ""),
      ),
    });
  }

  return {
    /** index (:13-34): newest first, the filters and the numbers on top. */
    async list(session: VerifiedSession, companyId: string, q: { search?: string; status?: "sent" | "sending" | "failed"; from?: string; to?: string; page: number; pageSize: number }): Promise<{ page: Page<StaffEmail>; summary: StaffEmailSummary }> {
      requirePermission(session, catalog, PART.staff, "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const at = now();
        const listed = await repos.staffEmails.list(companyId, { words: words(q.search), status: q.status, from: q.from, to: q.to, page: q.page, pageSize: q.pageSize, staleBefore: staleBefore() });
        return { page: { items: listed.rows.map((r) => dtoStaffEmail(r, at)), total: listed.total, page: q.page, pageSize: q.pageSize }, summary: await summary(repos, companyId) };
      });
    },

    /** feed (:75-90): what changed since the page last looked (new records, at most 50, and the watched ones, at most 200). */
    async feed(session: VerifiedSession, companyId: string, q: { after: string; watch: string[] }): Promise<StaffEmailFeed> {
      requirePermission(session, catalog, PART.staff, "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const at = now();
        const rows = await repos.staffEmails.feed(companyId, { after: new Date(q.after), watch: q.watch.slice(0, 200), staleBefore: staleBefore() });
        return { items: rows.map((r) => dtoStaffEmail(r, at)), summary: await summary(repos, companyId) };
      });
    },

    /** PayrollMasters::active('share_emails'): shared, then the company's. */
    async recipients(session: VerifiedSession, companyId: string): Promise<EmailRecipient[]> {
      requirePermission(session, catalog, PART.staff, "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        return (await repos.payrollMasters.active("share_emails", companyId)).map(recipientOf);
      });
    },

    /** send (:33-68) through StaffShareMailer::send (:13-33): one record per person, written before the mail is queued. */
    async send(session: VerifiedSession, companyId: string, input: StaffEmailSendBody, meta: RequestMeta): Promise<SendStaffEmailsResult> {
      requirePermission(session, catalog, PART.staff, "create");
      const actor = await kit.actor(session);
      return unit.run(session, async (repos) => {
        const company = await companyOrFail(repos, companyId);
        const w: PayrollWrite = { repos, session, meta, actor, company };
        const v = new Rules();
        v.required("recipientId", "recipient", input.recipientId, "Choose who to send it to.");
        if (input.employeeIds.length === 0) v.fail("employeeIds", "Choose at least one member of staff.");
        const own = new Set(await repos.employees.ownIds(companyId, input.employeeIds));
        input.employeeIds.forEach((id, n) => {
          if (!own.has(id)) v.fail(`employeeIds.${n}`, `The selected employees.${n} is invalid.`);
        });
        v.done();
        const recipient = (await repos.payrollMasters.active("share_emails", companyId)).find((r) => r.id === input.recipientId && Boolean(r.value)) ?? null;
        const people = await repos.employees.getMany(companyId, [...new Set(input.employeeIds)]);
        const items: StaffEmailRecord[] = [];
        const outcomes: { sent: boolean; message: string }[] = [];
        for (const e of people) {
          const attachment = `employee-${e.employeeCode}.pdf`;
          const started = now().getTime();
          let record = await repos.staffEmails.open(companyId, {
            payrollCompanyId: companyId,
            employeeId: e.id,
            employeeName: e.name,
            employeeCode: e.employeeCode,
            designation: e.designation,
            recipientId: recipient?.id ?? null,
            recipientName: recipient?.label ?? null,
            recipientEmail: recipient?.value ?? null,
            subject: subjectFor(e, company.name),
            attachment,
            sentBy: session.userId,
            sentByName: actor?.name ?? "System",
            ipAddress: meta.ip,
            createdAt: now(),
          });
          let outcome: { sent: boolean; message: string };
          if (!recipient) {
            outcome = { sent: false, message: NOT_LISTED };
            record = await repos.staffEmails.finish(record.id, { status: "failed", message: NOT_LISTED, error: null, attachmentBytes: null, durationMs: now().getTime() - started });
          } else {
            const pdf = await renderer.render("employee", { employeeId: e.id, companyId }, session);
            const { queued } = await mail.staffDetails(session.hotelId, { recordId: record.id, to: recipient.value!, toName: recipient.label, subject: record.subject ?? "", attachment: { name: attachment, status: pdf.status }, sharedBy: actor?.name ?? "System" });
            if (queued) outcome = { sent: true, message: sentMessage(record) };
            else {
              outcome = { sent: false, message: MAIL_FAILED };
              record = await repos.staffEmails.finish(record.id, { status: "failed", message: MAIL_FAILED, error: "Mail: no outbox is configured for payroll mail.", attachmentBytes: null, durationMs: now().getTime() - started });
            }
          }
          await logSend(w, e, recipient, outcome, attachment);
          items.push(record);
          outcomes.push(outcome);
        }
        const queued = outcomes.filter((o) => o.sent).length;
        const at = now();
        return {
          queued,
          failed: outcomes.length - queued,
          message: outcomes.length === 1 ? outcomes[0].message : `${queued} of ${outcomes.length} sent.`,
          items: items.map((r) => dtoStaffEmail(r, at)),
        };
      });
    },

    /** The outbox worker's report on one send (StaffShareMailer::finish :92-110): the record becomes sent or failed. */
    async complete(hotelId: string, recordId: string, result: { sent: boolean; error: string | null; attachmentBytes: number | null; durationMs: number }): Promise<void> {
      await unit.run({ hotelId, userId: "system" }, async (repos) => {
        const r = await repos.staffEmails.get(recordId);
        // a record already finished (a retry of the worker) keeps its first outcome
        if (!r || r.status !== "sending") return;
        await repos.staffEmails.finish(recordId, {
          status: result.sent ? "sent" : "failed",
          message: result.sent ? sentMessage(r) : MAIL_FAILED,
          error: result.error,
          attachmentBytes: result.attachmentBytes,
          durationMs: result.durationMs,
        });
      });
    },
  };
}

export type StaffEmailService = ReturnType<typeof createStaffEmailService>;

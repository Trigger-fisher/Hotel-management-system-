import "server-only";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { DisputeKind, DisputeStatus, RazorpayBusiness, RazorpayDisputeRecord, RazorpayPaymentRecord, RazorpayUnit } from "../../repos/razorpay";
import type { PeopleDirectory, Person } from "../cash/ports";
import type { Catalog } from "../../auth/catalog";
import type { RequestMeta } from "../../http/meta";
import { logLine } from "../admin/context";
import type { MailQueue } from "../auth/mail";
import { requirePermission } from "../../auth/permissions";
import { oneHotel, type Memberships } from "../portal/multiHotel";

// Problems with online payments (MJ, 2 Nov 2026): a guest or a company raises a dispute, asks for a refund or asks a question about ONE of their own online payments; the hotel it was
// raised at answers it: any staff member of THAT hotel who may work on Bills (bills.bills: view to read, edit to answer), the Super Admin included. A hotel only ever sees its own. Rows are kept in razorpay_records (kind dispute). "Their own" is decided by the database, not by this code: a guest or company
// account reads and writes only the rows linked to its record (row-level security, migration 0054), so a payment that is not theirs is simply not found (404). Plain text only.

const PART = "bills.bills";
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;
/** Open problems on one payment at a time; more is a flood, not a problem. */
const MAX_OPEN_PER_PAYMENT = 3;
const RAISABLE = new Set(["captured", "refunded", "failed", "authorized"]);

export interface RazorpayDisputeDeps {
  unit: RazorpayUnit;
  people: PeopleDirectory;
  now: () => Date;
  catalog: Catalog;
  /** The hotel's own mail (kind notification): the person is emailed when the hotel answers. Absent = no email (the answer is still on their page). */
  mail?: MailQueue;
  /** The hotels a portal login is linked to; without it (tests) the session's own hotel and record are used. */
  memberships?: Memberships;
}

const field = (name: string, message: string): AppError => new AppError("VALIDATION_FAILED", message, { fields: { [name]: message } });
const text = (name: string, value: string, label: string, min: number, max: number): string => {
  const v = value.replace(/\r\n?/g, "\n").trim();
  if (v.length < min) throw field(name, `${label} is needed.`);
  if (v.length > max) throw field(name, `Keep ${label.toLowerCase()} under ${max.toLocaleString("en-IN")} characters.`);
  if (HTML_TAG.test(v)) throw field(name, "Plain text only: please remove the HTML tags.");
  return v;
};

const disputeView = (d: RazorpayDisputeRecord) => ({
  id: d.id,
  number: d.number,
  business: d.business,
  paymentId: d.paymentId,
  kind: d.kind,
  status: d.status,
  title: d.title,
  message: d.message,
  amountPaise: d.amountPaise,
  reply: d.reply,
  repliedAt: d.repliedAt ? d.repliedAt.toISOString() : null,
  repliedByName: d.repliedByName,
  createdAt: d.createdAt.toISOString(),
});

/** What a guest or a company sees of its own payment: the money and the state, never the raw Razorpay body, the fee or the notes. */
const paymentView = (p: RazorpayPaymentRecord) => ({
  paymentId: p.paymentId,
  business: p.business,
  status: p.status,
  method: p.method,
  amountPaise: p.amountPaise,
  amountRefundedPaise: p.amountRefundedPaise,
  description: p.description,
  paidAt: p.paidAt ? p.paidAt.toISOString() : null,
  createdAt: p.createdAt.toISOString(),
});

export function createRazorpayDisputeService(deps: RazorpayDisputeDeps) {
  const { unit, people, now, catalog } = deps;

  /**
   * The guest or company account (403 for anyone else) and the ONE hotel the call is for: `hotel` names it, or the login's first linked hotel when it is left out. The session
   * returned carries that hotel's record scope, which is what the database's row-level security reads.
   */
  const portal = async (session: VerifiedSession, hotel: string | undefined): Promise<{ session: VerifiedSession; scope: { kind: "guest" | "company"; id: string } }> => {
    const kind = session.accountRole === "guest_user" ? "guest" : session.accountRole === "corporate_user" ? "company" : null;
    if (kind === null) throw new AppError("FORBIDDEN");
    const one = await oneHotel(deps.memberships, session, kind, hotel);
    return { session: one.session, scope: { kind, id: one.session.scope?.id ?? "" } };
  };
  /** The person for a system-log line: the staff member, or "Guest" / "Company" for a portal login (the people directory only knows staff). */
  const whoOf = async (session: VerifiedSession, meta: RequestMeta, kind?: "guest" | "company") => {
    const staffer = kind ? undefined : (await people.get([session.userId])).get(session.userId);
    const actor: Person | undefined = kind ? { id: session.userId, name: kind === "guest" ? "Guest" : "Company", roleKey: kind, roleLevel: 0, deleted: false } : staffer;
    return { session, meta, actor };
  };

  return {
    /** The signed-in guest's or company's own online payments, newest first. */
    async myPayments(portalSession: VerifiedSession, q: { hotel?: string; status?: string; page: number; pageSize: number }) {
      const { session } = await portal(portalSession, q.hotel);
      return unit.run(session, async (repos) => {
        const found = await repos.disputes.listPayments({ status: q.status, page: q.page, pageSize: q.pageSize });
        return { items: found.items.map(paymentView), total: found.total, page: q.page, pageSize: q.pageSize };
      });
    },

    /** The signed-in guest's or company's own problems, newest first. */
    async mine(portalSession: VerifiedSession, q: { hotel?: string; status?: DisputeStatus | "all"; paymentId?: string; page: number; pageSize: number }) {
      const { session } = await portal(portalSession, q.hotel);
      return unit.run(session, async (repos) => {
        const found = await repos.disputes.list({ status: q.status, paymentId: q.paymentId, page: q.page, pageSize: q.pageSize });
        return { items: found.items.map(disputeView), total: found.total, page: q.page, pageSize: q.pageSize };
      });
    },

    /** Raise a problem with one of the person's own payments. 404 when the payment is not theirs (or not here). */
    async raise(portalSession: VerifiedSession, meta: RequestMeta, input: { hotel?: string; business: RazorpayBusiness; paymentId: string; kind: DisputeKind; title: string; message: string; amountPaise?: number | null }) {
      const { session, scope } = await portal(portalSession, input.hotel);
      const title = text("title", input.title, "A short title", 3, 120);
      const message = text("message", input.message, "Please tell us what went wrong", 5, 2000);
      return unit.run(session, async (repos) => {
        const payment = await repos.disputes.paymentOf(input.business, input.paymentId);
        if (!payment) throw new AppError("NOT_FOUND", "We could not find that payment.");
        if (!RAISABLE.has(payment.status)) throw new AppError("CONFLICT", "That payment has not been taken yet, so there is nothing to raise.");
        let amount: number | null = input.amountPaise ?? null;
        if (amount !== null) {
          if (input.kind === "question") throw field("amountPaise", "An amount is for a dispute or a refund request.");
          if (!Number.isSafeInteger(amount) || amount < 100) throw field("amountPaise", "The amount must be at least 1 rupee.");
          if (amount > payment.amountPaise - payment.amountRefundedPaise) throw field("amountPaise", "That is more than is left on this payment.");
        }
        if (input.kind === "refund_request" && amount === null) amount = payment.amountPaise - payment.amountRefundedPaise;
        const open = await repos.disputes.list({ status: "open", paymentId: payment.paymentId, page: 1, pageSize: 1 });
        if (open.total >= MAX_OPEN_PER_PAYMENT) throw new AppError("CONFLICT", "There are already open problems on this payment. Please wait for the hotel's answer.");
        const created = await repos.disputes.create({
          business: input.business,
          payment,
          kind: input.kind,
          title,
          message,
          amountPaise: amount,
          customerId: scope.kind === "guest" ? scope.id : null,
          companyId: scope.kind === "company" ? scope.id : null,
          byUserId: session.userId,
        });
        await repos.systemLogs.write(logLine(await whoOf(session, meta, scope.kind), "payments", {
          action: "created", entity: "Payment problem", summary: `${created.kind === "dispute" ? "Dispute" : created.kind === "refund_request" ? "Refund request" : "Question"} raised on payment ${payment.paymentId}`, subject: { id: created.id, label: created.number },
          details: { Payment: payment.paymentId, Kind: created.kind, ...(created.amountPaise ? { Amount: created.amountPaise / 100 } : {}) },
        }));
        return disputeView(created);
      });
    },

    /** The person takes a problem back while it is still waiting. */
    async withdraw(portalSession: VerifiedSession, meta: RequestMeta, id: string, hotel?: string) {
      const { session, scope } = await portal(portalSession, hotel);
      return unit.run(session, async (repos) => {
        const before = await repos.disputes.get(id, { forUpdate: true });
        if (!before) throw new AppError("NOT_FOUND");
        if (before.status !== "open") throw new AppError("CONFLICT", "The hotel has already answered this, so it cannot be taken back.");
        const done = await repos.disputes.withdraw(id);
        if (!done) throw new AppError("CONFLICT", "This problem has changed. Please look again.");
        await repos.systemLogs.write(logLine(await whoOf(session, meta, scope.kind), "payments", { action: "updated", entity: "Payment problem", summary: `Took back ${done.number}`, subject: { id: done.id, label: done.number }, details: { Payment: done.paymentId } }));
        return disputeView(done);
      });
    },

    /** The hotel's side: every problem raised at this hotel, the open ones by default. Needs Bills (view). */
    async list(session: VerifiedSession, q: { status?: DisputeStatus | "all"; paymentId?: string; page: number; pageSize: number }) {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const found = await repos.disputes.list(q);
        const open = q.status === "open" ? found.total : (await repos.disputes.list({ status: "open", page: 1, pageSize: 1 })).total;
        return { items: found.items.map(disputeView), total: found.total, page: q.page, pageSize: q.pageSize, openCount: open };
      });
    },

    /** Answer (a reply is needed) or close a problem. A closed or withdrawn one is not changed again (409). */
    async respond(session: VerifiedSession, meta: RequestMeta, id: string, input: { status: "answered" | "closed"; reply?: string | null }) {
      requirePermission(session, catalog, PART, "edit");
      const reply = (input.reply ?? "").trim() === "" ? null : text("reply", input.reply ?? "", "The answer", 2, 2000);
      if (input.status === "answered" && reply === null) throw field("reply", "Write the answer the guest will read.");
      const told: { to: { email: string; name: string }[]; hotelName: string; number: string; title: string; reply: string }[] = [];
      const view = await unit.run(session, async (repos) => {
        const before = await repos.disputes.get(id, { forUpdate: true });
        if (!before) throw new AppError("NOT_FOUND");
        if (before.status === "closed" || before.status === "withdrawn") throw new AppError("CONFLICT", `This problem is ${before.status}.`);
        const actor = (await people.get([session.userId])).get(session.userId);
        const done = await repos.disputes.respond(id, { status: input.status, reply, at: now(), by: { id: session.userId, name: actor?.name ?? "Hotel staff" } });
        if (!done) throw new AppError("CONFLICT", "This problem has changed. Please look again.");
        // the status and the length of the answer, never its words
        await repos.systemLogs.write(logLine({ session, meta, actor }, "payments", { action: "updated", entity: "Payment problem", summary: `${done.status === "answered" ? "Answered" : "Closed"} ${done.number}`, subject: { id: done.id, label: done.number }, details: { Payment: done.paymentId, Status: `was ${before.status}, became ${done.status}`, "Answer length": String((reply ?? "").length) } }));
        if (done.status === "answered" && done.reply) told.push({ to: await repos.disputes.addresseesOf(done), hotelName: await repos.disputes.hotelName(), number: done.number, title: done.title, reply: done.reply });
        return disputeView(done);
      });
      // after the commit, best effort: the answer is on the person's page whether or not the email goes
      const mail = deps.mail;
      if (mail) for (const t of told) await Promise.allSettled(t.to.map((a) => mail.queue({ kind: "notification", hotelId: session.hotelId, toEmail: a.email, payload: { name: a.name || "there", hotelName: t.hotelName, subject: t.title, message: t.reply, reference: t.number } })));
      return view;
    },
  };
}

export type RazorpayDisputeService = ReturnType<typeof createRazorpayDisputeService>;

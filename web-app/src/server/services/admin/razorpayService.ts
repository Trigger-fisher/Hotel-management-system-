import "server-only";
import { formatINR } from "@shared/dashboards/format";
import { isPlatformSetupSession, PLATFORM_SETS_UP } from "../../auth/secretSettings";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import { createRazorpayClient, paymentFromEntity, webhookSignatureOk, type FetchLike, type RazorpayClient, type RazorpayLink, type RazorpayRefund, type RazorpaySettlement } from "../../payments/razorpay";
import type { RazorpayBook, RazorpayPaymentRecord } from "../../repos/admin";
import { istMoment } from "../cash/ist";
import { actorOf, businessNamesOf, conflict, fieldError, logLine, notFound, type AdminDeps, type Who } from "./context";
import type { MailQueue } from "../auth/mail";
import { AppError } from "../../errors";
import { can } from "../../auth/permissions";
import { isSuperAdmin } from "../cash/rules";

// Online payments (Razorpay), the hotel's Super Admin only. Each business (hotel, food) has its own Razorpay account: its keys are saved through the Settings
// routes (razorpay_hotel.* and razorpay_food.*, secrets never returned). Money comes in by webhook (receiveWebhook, no session, signed with the business's webhook
// secret) and is kept in razorpay_records (kind payment). Refunds, payment links, settlements and "check this payment" are asked of Razorpay's API with the business's own keys.
// docs/BACKEND.md section 14c.

const BOOKS: readonly RazorpayBook[] = ["hotel", "food"];
const NOT_SET_UP = "Razorpay is not set up yet.";
const WEBHOOK_USER = "00000000-0000-4000-8000-0000000000e1";
const PAGE = 25;

interface RazorpaySetupDto {
  business: RazorpayBook;
  name: string;
  enabled: boolean;
  mode: "test" | "live";
  keyIdSet: boolean;
  keySecretSet: boolean;
  webhookSecretSet: boolean;
  /** Both keys saved and switched on. */
  ready: boolean;
}

export interface RazorpayPaymentDto {
  id: string;
  paymentId: string;
  orderId: string | null;
  description: string | null;
  business: RazorpayBook;
  method: string | null;
  email: string | null;
  contact: string | null;
  status: string;
  errorDescription: string | null;
  amountPaise: number;
  feePaise: number | null;
  taxPaise: number;
  amountRefundedPaise: number;
  lastEvent: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: Record<string, string>;
  payload: Record<string, unknown>;
}

interface RazorpayOverviewDto {
  setup: RazorpaySetupDto[];
  /** The address each Razorpay dashboard must call. */
  hooks: { key: RazorpayBook; name: string; url: string; ready: boolean; last: string | null }[];
  page: { items: RazorpayPaymentDto[]; total: number; page: number; pageSize: number };
  stats: { todayPaise: number; monthPaise: number; failed: number; refundedPaise: number; rejected: number };
  counts: Record<RazorpayBook, number>;
}

const dto = (p: RazorpayPaymentRecord): RazorpayPaymentDto => ({
  id: p.id, paymentId: p.paymentId, orderId: p.orderId, description: p.description, business: p.business, method: p.method, email: p.email, contact: p.contact, status: p.status, errorDescription: p.errorDescription,
  amountPaise: p.amountPaise, feePaise: p.feePaise, taxPaise: p.taxPaise ?? 0, amountRefundedPaise: p.amountRefundedPaise, lastEvent: p.lastEvent, paidAt: p.paidAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(), notes: p.notes, payload: p.payload && typeof p.payload === "object" ? (p.payload as Record<string, unknown>) : {},
});

const realFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}), signal: AbortSignal.timeout(20_000) });
  return { status: res.status, text: () => res.text() };
};

export function createRazorpayService(deps: AdminDeps & { publicUrl: string; fetch?: FetchLike; mail?: Pick<MailQueue, "queue"> }) {
  const { unit, now } = deps;
  const http = deps.fetch ?? realFetch;
  /** The SuperAdmin, or staff whose role has Bills (view to read the panel, edit to refund, make links and check a payment). Keys and settings stay the SuperAdmin's. */
  const needBills = (session: VerifiedSession, level: "view" | "edit"): void => {
    if (!isSuperAdmin(session) && !can(session, deps.catalog, "bills.bills", level)) throw new AppError("FORBIDDEN", "Not allowed to open Razorpay.");
  };
  const keys = BOOKS.flatMap((b) => ["enabled", "mode", "key_id", "key_secret", "webhook_secret"].map((k) => `razorpay_${b}.${k}`));
  const base = deps.publicUrl.replace(/\/+$/, "");
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });

  async function setupOf(session: Pick<VerifiedSession, "hotelId" | "userId" | "visit">): Promise<RazorpaySetupDto[]> {
    return unit.run(session, async (repos) => {
      const rows = new Map((await repos.adminSettings.get(keys)).map((r) => [r.key, r.value]));
      const header = await repos.hotelProfile.header();
      const filled = (k: string): boolean => (rows.get(k) ?? "").trim() !== "";
      return BOOKS.map((b) => {
        const enabled = ["1", "true", "yes", "on"].includes((rows.get(`razorpay_${b}.enabled`) ?? "").trim().toLowerCase());
        const keyIdSet = filled(`razorpay_${b}.key_id`);
        const keySecretSet = filled(`razorpay_${b}.key_secret`);
        return {
          business: b,
          name: b === "food" ? header.foodName : header.name,
          enabled,
          mode: (rows.get(`razorpay_${b}.mode`) ?? "test") === "live" ? ("live" as const) : ("test" as const),
          keyIdSet,
          keySecretSet,
          webhookSecretSet: filled(`razorpay_${b}.webhook_secret`),
          ready: enabled && keyIdSet && keySecretSet,
        };
      });
    });
  }

  /** The business's keys must be saved and switched on before anything is asked of Razorpay (the Set-up centre's Test asks before it is switched on). */
  async function clientOf(session: VerifiedSession, business: RazorpayBook, needOn = true): Promise<RazorpayClient> {
    const found = await unit.run(session, async (repos) => {
      const rows = new Map((await repos.adminSettings.get([`razorpay_${business}.enabled`, `razorpay_${business}.mode`, `razorpay_${business}.key_id`, `razorpay_${business}.key_secret`])).map((r) => [r.key, (r.value ?? "").trim()]));
      const on = ["1", "true", "yes", "on"].includes((rows.get(`razorpay_${business}.enabled`) ?? "").toLowerCase());
      return { on, mode: (rows.get(`razorpay_${business}.mode`) ?? "test") === "live" ? ("live" as const) : ("test" as const), keyId: rows.get(`razorpay_${business}.key_id`) ?? "", keySecret: rows.get(`razorpay_${business}.key_secret`) ?? "" };
    });
    if ((needOn && !found.on) || found.keyId === "" || found.keySecret === "") throw conflict(needOn ? NOT_SET_UP : "The Key ID or the Key secret is not saved yet.");
    // Test Mode first: real money moves only when the server is told live is allowed (HMS_RAZORPAY_LIVE=1), and a key must belong to the mode the hotel chose
    if (found.mode === "live" && session.visit !== undefined) throw conflict("Live payments cannot be used during a visit. Use Test Mode.");
    if (found.mode === "live" && process.env.HMS_RAZORPAY_LIVE !== "1") throw conflict("Live payments are switched off on this server. Use Test Mode.");
    if (!found.keyId.startsWith(found.mode === "live" ? "rzp_live_" : "rzp_test_")) throw conflict(`The Key ID is not a ${found.mode} key. Check Settings, Razorpay.`);
    return createRazorpayClient({ fetch: http, keys: { keyId: found.keyId, keySecret: found.keySecret } });
  }

  /**
   * A payment link's email, sent from the hotel's own mail (the hotel's name, the outbox, the hotel's sender) and not by Razorpay (MJ, 2 Nov 2026: it arrived "from Razorpay"). False when there
   * is no outbox here or no address; the caller then says it was not sent. SMS still goes through Razorpay, which is the only sender of it.
   */
  async function mailLink(session: VerifiedSession, business: RazorpayBook, link: { url: string; email: string | null; name: string | null; amountPaise: number; description: string }): Promise<boolean> {
    if (!deps.mail || !link.email || link.url === "") return false;
    const names = await unit.run(session, (repos) => businessNamesOf(repos));
    const amount = formatINR(link.amountPaise);
    await deps.mail.queue({ kind: "notification", hotelId: session.hotelId, toEmail: link.email, payload: { name: link.name || "there", hotelName: names[business], subject: `Please pay ${amount}`, message: `${amount}${link.description ? ` for ${link.description}` : ""}`, link: link.url, amountPaise: link.amountPaise, ...(link.description ? { forWhat: link.description } : {}) } });
    return true;
  }

  const storedPayment = (session: VerifiedSession, business: RazorpayBook, paymentId: string) => unit.run(session, (repos) => repos.razorpay.get(business, paymentId));

  return {
    /** The Razorpay screen: what is set up, the webhook addresses (with this hotel's id in them), the stored payments, and the totals. */
    async overview(session: VerifiedSession, q: { page: number; pageSize: number; business?: RazorpayBook; status?: string; method?: string; search?: string }): Promise<RazorpayOverviewDto> {
      needBills(session, "view");
      const setup = await setupOf(session);
      const at = istMoment(now());
      const todayFrom = new Date(`${at.date}T00:00:00+05:30`);
      const monthFrom = new Date(`${at.date.slice(0, 7)}-01T00:00:00+05:30`);
      const data = await unit.run(session, async (repos) => ({
        list: await repos.razorpay.list({ ...(q.business ? { business: q.business } : {}), ...(q.status ? { status: q.status } : {}), ...(q.method ? { method: q.method } : {}), ...(q.search ? { search: q.search } : {}), page: q.page, pageSize: q.pageSize }),
        stats: await repos.razorpay.stats(todayFrom, monthFrom),
        counts: await repos.razorpay.counts(),
        last: await repos.razorpay.lastEvent(),
      }));
      return {
        setup,
        hooks: setup.map((s) => ({ key: s.business, name: s.name, url: `${base}/api/v1/webhooks/razorpay/${session.hotelId}/${s.business}`, ready: s.webhookSecretSet, last: data.last[s.business]?.toISOString() ?? null })),
        page: { items: data.list.items.map(dto), total: data.list.total, page: q.page, pageSize: q.pageSize },
        stats: data.stats,
        counts: data.counts,
      };
    },

    /** The payment as HMS last kept it (webhook or last check): a read, nothing asked of Razorpay and nothing written. `paymentStatus` (POST .../status/refresh) does that. */
    async storedStatus(session: VerifiedSession, business: RazorpayBook, paymentId: string): Promise<{ payment: RazorpayPaymentDto; message: string }> {
      needBills(session, "view");
      const saved = await storedPayment(session, business, paymentId);
      if (!saved) throw notFound("This payment is not in HMS. Use Check with Razorpay first.");
      return { payment: dto(saved), message: `As last kept: the payment is ${saved.status}.` };
    },

    /** Ask Razorpay for the payment as it is now, keep what it says, and answer with the stored payment. Fixes a payment whose webhook never arrived. */
    async paymentStatus(session: VerifiedSession, business: RazorpayBook, paymentId: string): Promise<{ payment: RazorpayPaymentDto; message: string }> {
      needBills(session, "edit");
      const client = await clientOf(session, business);
      const entity = await client.payment(paymentId);
      const m = paymentFromEntity(entity, "checked");
      if (!m) throw notFound("Razorpay has no such payment.");
      const saved = await unit.run(session, (repos) => repos.razorpay.upsertPayment({ business, ...m, payload: entity }));
      return { payment: dto(saved), message: `Checked with Razorpay: the payment is ${saved.status}.` };
    },

    /** Refund all or part of a paid payment. The amount cannot be more than what is left; the reason goes to Razorpay with the refund and into the system log. */
    async refund(session: VerifiedSession, meta: RequestMeta, business: RazorpayBook, paymentId: string, input: { amountPaise: number; reason: string; note: string; instant: boolean }): Promise<{ refund: RazorpayRefund; payment: RazorpayPaymentDto; message: string }> {
      needBills(session, "edit");
      const w = await who(session, meta);
      const client = await clientOf(session, business);
      const before = await storedPayment(session, business, paymentId);
      if (!before) throw notFound("This payment is not in HMS. Use Check with Razorpay first.");
      if (before.status !== "captured") throw conflict(before.status === "refunded" ? "This payment is already fully refunded." : "Only a paid payment can be refunded.");
      const left = before.amountPaise - before.amountRefundedPaise;
      if (input.amountPaise > left) throw fieldError("amountPaise", `At most ${left / 100} rupees can still be refunded.`);
      // the same payment in the same state asking for the same amount is the same refund: a repeat after a timeout reaches Razorpay with the same key and is one refund
      const refund = await client.refund(paymentId, { ...input, by: w.actor?.name ?? "Super Admin", idempotencyKey: `hms-${paymentId}-${before.amountRefundedPaise}-${input.amountPaise}` });
      const saved = await unit.run(session, async (repos) => {
        const total = before.amountRefundedPaise + input.amountPaise;
        const next = await repos.razorpay.upsertPayment({
          business, paymentId, orderId: before.orderId, status: total >= before.amountPaise ? "refunded" : "captured", lastEvent: "refund.created", method: before.method, amountPaise: before.amountPaise,
          amountRefundedPaise: total, currency: "INR", feePaise: before.feePaise, taxPaise: before.taxPaise, email: before.email, contact: before.contact, description: before.description, errorCode: null, errorDescription: null,
          notes: before.notes, payload: before.payload, paidAt: before.paidAt, createdAt: before.createdAt,
        });
        // the refund is kept as a row of its own (the one razorpay_records table), so a part refund and the next one are each seen
        await repos.razorpay.recordRefund({ business, paymentId, refundId: refund.id, amountPaise: input.amountPaise, status: refund.status, speed: refund.speed, reason: input.reason.slice(0, 60), note: input.note === "" ? null : input.note.slice(0, 500), byUserId: session.userId });
        await repos.systemLogs.write(logLine(w, "payments", {
          action: "updated", entity: "Online payment", summary: `Refunded ${input.amountPaise / 100} rupees of payment ${paymentId} (${input.reason})`, subject: { id: next.id, label: paymentId },
          details: { Payment: paymentId, Refund: refund.id, Amount: input.amountPaise / 100, Reason: input.reason, Speed: input.instant ? "Instant" : "Normal", ...(input.note ? { Note: input.note } : {}) },
        }));
        return next;
      });
      return { refund, payment: dto(saved), message: `${input.amountPaise / 100} rupees are on their way back to the guest.` };
    },

    /** Refunds Razorpay has made for this business (newest first), with the reason and the person who gave it. */
    async refunds(session: VerifiedSession, business: RazorpayBook, page: number): Promise<{ items: (RazorpayRefund & { payer: string | null })[]; page: number }> {
      needBills(session, "view");
      const client = await clientOf(session, business);
      const list = await client.refunds(PAGE, (page - 1) * PAGE);
      const ids = [...new Set(list.map((r) => r.paymentId))];
      const known = ids.length === 0 ? [] : await unit.run(session, (repos) => repos.razorpay.getMany(business, ids));
      const payers = new Map(known.map((p) => [p.paymentId, p.contact ?? p.email ?? null]));
      return { items: list.map((r) => ({ ...r, payer: payers.get(r.paymentId) ?? null })), page };
    },

    /** Ask a guest to pay: a Razorpay payment link, sent by Razorpay on SMS and email if asked. The link can also be copied and shared by the hotel. */
    async createPaymentLink(session: VerifiedSession, meta: RequestMeta, input: { business: RazorpayBook; amountPaise: number; description: string; name: string; contact?: string; email?: string; validDays: number; sms: boolean; mail: boolean; companyId?: string; customerId?: string; billRef?: string }): Promise<{ link: RazorpayLink; message: string }> {
      needBills(session, "edit");
      const w = await who(session, meta);
      const client = await clientOf(session, input.business);
      if (input.sms && !input.contact) throw fieldError("contact", "Add the guest's phone number to send an SMS.");
      if (input.mail && !input.email) throw fieldError("email", "Add the guest's email to send it by email.");
      // a link made for a company or a guest of this hotel carries who it is for (and the bill), so the payment shows on that person's own page and settles that bill
      if (input.companyId && input.customerId) throw fieldError("companyId", "Choose a company or a guest, not both.");
      const party = input.companyId || input.customerId ? await unit.run(session, (repos) => repos.razorpay.partyNames({ companyId: input.companyId, customerId: input.customerId })) : null;
      if (input.companyId && party?.company == null) throw fieldError("companyId", "That company is not in this hotel.");
      if (input.customerId && party?.customer == null) throw fieldError("customerId", "That guest is not in this hotel.");
      const link = await client.createLink({
        amountPaise: input.amountPaise, description: input.description, business: input.business, name: input.name, contact: input.contact ?? null, email: input.email ?? null, validForSeconds: input.validDays * 86_400, sms: input.sms, mail: input.mail && !deps.mail,
        notes: { created_by: w.actor?.name ?? "Super Admin", ...(input.companyId ? { hms_company: input.companyId } : {}), ...(input.customerId ? { hms_customer: input.customerId } : {}), ...(input.billRef ? { hms_bill: input.billRef.slice(0, 60) } : {}) },
      });
      await unit.run(session, async (repos) => {
        await repos.razorpay.recordOrder({ business: input.business, ref: link.id, amountPaise: input.amountPaise, status: "created", description: input.description === "" ? null : input.description.slice(0, 255), url: link.url, billRef: input.billRef ?? null, companyId: input.companyId ?? null, customerId: input.customerId ?? null, byUserId: session.userId });
        await repos.systemLogs.write(logLine(w, "payments", { action: "created", entity: "Payment link", summary: `Made a payment link of ${input.amountPaise / 100} rupees for ${input.name}`, subject: null, details: { Link: link.id, Amount: input.amountPaise / 100, For: input.description, ...(party?.company ? { Company: party.company } : {}), ...(party?.customer ? { Guest: party.customer } : {}), ...(input.billRef ? { Bill: input.billRef } : {}) } }));
      });
      // best effort after the link exists: a mail that cannot be queued never loses the link (it can still be copied and shared)
      const emailed = input.mail && input.email ? await mailLink(session, input.business, { url: link.url, email: input.email, name: input.name, amountPaise: input.amountPaise, description: input.description }).catch(() => false) : false;
      return { link, message: input.mail && deps.mail ? (emailed ? "Payment link made and emailed from the hotel." : "Payment link made, but the email could not be sent. Copy the link and share it.") : "Payment link made." };
    },

    async paymentLinks(session: VerifiedSession, business: RazorpayBook, page: number): Promise<{ items: RazorpayLink[]; page: number }> {
      needBills(session, "view");
      const client = await clientOf(session, business);
      return { items: await client.links(PAGE, (page - 1) * PAGE), page };
    },

    async cancelPaymentLink(session: VerifiedSession, meta: RequestMeta, business: RazorpayBook, linkId: string): Promise<{ link: RazorpayLink; message: string }> {
      needBills(session, "edit");
      const w = await who(session, meta);
      const client = await clientOf(session, business);
      const link = await client.cancelLink(linkId);
      await unit.run(session, (repos) => repos.systemLogs.write(logLine(w, "payments", { action: "updated", entity: "Payment link", summary: `Cancelled payment link ${linkId}`, subject: null, details: { Link: linkId, ...(link.name ? { For: link.name } : {}) } })));
      return { link, message: "Link cancelled. The guest can no longer pay with it." };
    },

    async resendPaymentLink(session: VerifiedSession, business: RazorpayBook, linkId: string, medium: "sms" | "email"): Promise<{ message: string }> {
      needBills(session, "edit");
      const client = await clientOf(session, business);
      if (medium === "email" && deps.mail) {
        // from the hotel's own mail, like the first one
        const link = await client.link(linkId);
        if (link.status !== "created") throw conflict("This link can no longer be paid, so it is not sent again.");
        if (!link.email) throw fieldError("email", "This link has no email address.");
        if (!(await mailLink(session, business, { url: link.url, email: link.email, name: link.name, amountPaise: link.amountPaise, description: link.description }))) throw conflict("The email could not be sent.");
        return { message: "Sent again by email." };
      }
      await client.resendLink(linkId, medium);
      return { message: medium === "sms" ? "Sent again by SMS." : "Sent again by email." };
    },

    /** The Set-up centre only: the address each Razorpay dashboard must call, and when the last webhook call and the last paid payment arrived. Never a key. */
    async setupFacts(session: VerifiedSession): Promise<Record<RazorpayBook, { webhookUrl: string; lastWebhookAt: string | null; lastPaymentAt: string | null }>> {
      if (!isPlatformSetupSession(session)) throw new AppError("FORBIDDEN", PLATFORM_SETS_UP);
      const facts = await unit.run(session, async (repos) => {
        const last = await repos.razorpay.lastEvent();
        const paid = await Promise.all(BOOKS.map((b) => repos.razorpay.list({ business: b, status: "captured", page: 1, pageSize: 1 })));
        return { last, paid };
      });
      const out = {} as Record<RazorpayBook, { webhookUrl: string; lastWebhookAt: string | null; lastPaymentAt: string | null }>;
      BOOKS.forEach((b, i) => {
        const p = facts.paid[i].items[0];
        out[b] = { webhookUrl: `${base}/api/v1/webhooks/razorpay/${session.hotelId}/${b}`, lastWebhookAt: facts.last[b]?.toISOString() ?? null, lastPaymentAt: p ? (p.paidAt ?? p.createdAt).toISOString() : null };
      });
      return out;
    },

    /** The Set-up centre's Test: one read with the saved keys (the newest refund), nothing charged. Works before online payment is switched on for guests. */
    async testKeys(session: VerifiedSession, business: RazorpayBook): Promise<void> {
      if (!isPlatformSetupSession(session)) throw new AppError("FORBIDDEN", PLATFORM_SETS_UP);
      await (await clientOf(session, business, false)).refunds(1, 0);
    },

    /** Razorpay's payouts to the business's bank account, newest first. */
    async settlements(session: VerifiedSession, business: RazorpayBook, page: number): Promise<{ items: RazorpaySettlement[]; page: number }> {
      needBills(session, "view");
      const client = await clientOf(session, business);
      return { items: await client.settlements(PAGE, (page - 1) * PAGE), page };
    },

    /**
     * A call from Razorpay (no session; the address carries the hotel and the business). The raw body is checked against the business's webhook secret; every call is kept,
     * a wrong signature is kept as rejected and changes nothing, and a good one updates the payment it is about. An event Razorpay sends twice is kept once.
     */
    async receiveWebhook(input: { hotelId: string; business: RazorpayBook; rawBody: string; signature: string | null; eventId: string | null; ip: string | null }): Promise<{ accepted: boolean; reason?: string }> {
      const session = { hotelId: input.hotelId, userId: WEBHOOK_USER, visit: undefined };
      const secret = await unit.run(session, async (repos) => ((await repos.adminSettings.get([`razorpay_${input.business}.webhook_secret`]))[0]?.value ?? "").trim());
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(input.rawBody) as Record<string, unknown>;
      } catch {
        /* kept below as an event with no readable body */
      }
      const event = typeof body.event === "string" ? body.event : "unknown";
      const ok = webhookSignatureOk(input.rawBody, input.signature, secret);
      return unit.run(session, async (repos) => {
        if (!ok) {
          // kept as evidence, but WITHOUT the body and WITHOUT the event id: a forger must not use up a real event's id (the real call would then read as a repeat and be ignored), and must not fill the table with content
          await repos.razorpay.recordEvent({ business: input.business, eventId: null, event: /^[a-z_]+(\.[a-z_]+)*$/.test(event) ? event : "unknown", signatureOk: false, payload: null, ip: input.ip });
          return { accepted: false, reason: secret === "" ? "No webhook secret is saved for this business." : "The signature did not match." };
        }
        const fresh = await repos.razorpay.recordEvent({ business: input.business, eventId: input.eventId, event, signatureOk: true, payload: body, ip: input.ip });
        if (!fresh) return { accepted: true };
        const payload = (body.payload ?? {}) as Record<string, { entity?: unknown }>;
        const m = paymentFromEntity(payload.payment?.entity, event);
        if (m) await repos.razorpay.upsertPayment({ business: input.business, ...m, payload: payload.payment?.entity ?? null });
        // a refund (from HMS, or made in the Razorpay dashboard) is kept as its own row; an order or a payment link that was paid is marked paid
        const r = payload.refund?.entity as Record<string, unknown> | undefined;
        if (r && typeof r.id === "string" && typeof r.payment_id === "string" && Number.isSafeInteger(r.amount) && (r.amount as number) >= 100) {
          const notes = r.notes && typeof r.notes === "object" ? (r.notes as Record<string, unknown>) : {};
          await repos.razorpay.recordRefund({ business: input.business, paymentId: r.payment_id, refundId: r.id, amountPaise: r.amount as number, status: typeof r.status === "string" ? r.status : "processed", speed: typeof r.speed_processed === "string" ? r.speed_processed : typeof r.speed_requested === "string" ? r.speed_requested : null, reason: typeof notes.reason === "string" ? notes.reason.slice(0, 60) : null, note: null, byUserId: null });
        }
        const paidRef = event === "order.paid" ? (payload.order?.entity as { id?: unknown } | undefined)?.id : event === "payment_link.paid" ? (payload.payment_link?.entity as { id?: unknown } | undefined)?.id : undefined;
        if (typeof paidRef === "string") await repos.razorpay.markOrderPaid(input.business, paidRef);
        return { accepted: true };
      });
    },
  };
}

export type RazorpayService = ReturnType<typeof createRazorpayService>;

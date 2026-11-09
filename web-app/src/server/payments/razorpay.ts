import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../errors";

// Razorpay as the hotel's Super Admin uses it: a small client (basic auth with the business's own key pair), the webhook signature check and the mapping of
// a Razorpay payment to the row HMS keeps. Nothing here knows about hotels or sessions; the fetch is passed in so a test can answer instead of Razorpay.
// Razorpay API reference: https://razorpay.com/docs/api/

const BASE = "https://api.razorpay.com/v1";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;

export interface RazorpayKeys {
  keyId: string;
  keySecret: string;
}

export interface RazorpayRefund {
  id: string;
  paymentId: string;
  amountPaise: number;
  status: string;
  speed: string;
  reason: string | null;
  by: string | null;
  note: string | null;
  createdAt: string;
}

export interface RazorpayLink {
  id: string;
  url: string;
  status: "created" | "paid" | "partially_paid" | "expired" | "cancelled";
  amountPaise: number;
  description: string;
  name: string | null;
  contact: string | null;
  email: string | null;
  business: "hotel" | "food" | null;
  createdAt: string;
  expiresAt: string | null;
  paidAt: string | null;
}

export interface RazorpaySettlement {
  id: string;
  /** What reaches the bank, in paise. */
  amountPaise: number;
  feePaise: number;
  taxPaise: number;
  status: string;
  utr: string | null;
  createdAt: string;
}

export interface LinkRequest {
  amountPaise: number;
  description: string;
  business: "hotel" | "food";
  name: string;
  contact: string | null;
  email: string | null;
  /** Seconds from now until the link stops working. */
  validForSeconds: number;
  sms: boolean;
  mail: boolean;
  notes: Record<string, string>;
}

type Json = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const iso = (epochSeconds: unknown): string | null => (typeof epochSeconds === "number" && epochSeconds > 0 ? new Date(epochSeconds * 1000).toISOString() : null);
const notesOf = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Json)) if (typeof x === "string" || typeof x === "number") out[k] = String(x);
  return out;
};

/** Razorpay's X-Razorpay-Signature: HMAC-SHA256 of the raw body with the webhook secret, in hex. */
export function webhookSignatureOk(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || secret === "") return false;
  const want = createHmac("sha256", secret).update(rawBody).digest();
  const got = Buffer.from(signature.trim(), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The row HMS keeps for a Razorpay payment entity (a webhook's payload.payment.entity, or GET /payments/:id). Null when it is not a payment. */
export function paymentFromEntity(entity: unknown, event: string): {
  paymentId: string; orderId: string | null; status: string; method: string | null; amountPaise: number; amountRefundedPaise: number; currency: string; feePaise: number | null; taxPaise: number | null;
  email: string | null; contact: string | null; description: string | null; errorCode: string | null; errorDescription: string | null; notes: Record<string, string>; paidAt: Date | null; createdAt: Date | null; lastEvent: string;
} | null {
  if (!entity || typeof entity !== "object") return null;
  const e = entity as Json;
  const id = str(e.id);
  if (!id || !id.startsWith("pay_")) return null;
  const status = str(e.status) ?? "created";
  const created = iso(e.created_at);
  return {
    paymentId: id,
    orderId: str(e.order_id),
    status,
    method: str(e.method),
    amountPaise: num(e.amount),
    amountRefundedPaise: num(e.amount_refunded),
    currency: str(e.currency) ?? "INR",
    feePaise: typeof e.fee === "number" ? e.fee : null,
    taxPaise: typeof e.tax === "number" ? e.tax : null,
    email: str(e.email),
    contact: str(e.contact),
    description: str(e.description)?.slice(0, 255) ?? null,
    errorCode: str(e.error_code),
    errorDescription: str(e.error_description)?.slice(0, 255) ?? null,
    notes: notesOf(e.notes),
    paidAt: status === "captured" || status === "refunded" ? (created ? new Date(created) : null) : null,
    createdAt: created ? new Date(created) : null,
    lastEvent: event,
  };
}

const refundOf = (r: Json): RazorpayRefund => {
  const notes = notesOf(r.notes);
  return {
    id: String(r.id), paymentId: String(r.payment_id ?? ""), amountPaise: num(r.amount), status: str(r.status) ?? "pending", speed: str(r.speed_processed) ?? str(r.speed_requested) ?? "normal",
    reason: notes.reason ?? null, by: notes.by ?? null, note: notes.note ?? null, createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
};

const linkOf = (l: Json): RazorpayLink => {
  const customer = (l.customer ?? {}) as Json;
  const notes = notesOf(l.notes);
  const status = str(l.status);
  return {
    id: String(l.id), url: str(l.short_url) ?? "", status: status === "paid" || status === "partially_paid" || status === "expired" || status === "cancelled" ? status : "created", amountPaise: num(l.amount),
    description: str(l.description) ?? "", name: str(customer.name), contact: str(customer.contact), email: str(customer.email), business: notes.business === "food" ? "food" : notes.business === "hotel" ? "hotel" : null,
    createdAt: iso(l.created_at) ?? new Date(0).toISOString(), expiresAt: iso(l.expire_by), paidAt: iso(l.updated_at && status === "paid" ? l.updated_at : null),
  };
};

export function createRazorpayClient(opts: { fetch: FetchLike; keys: RazorpayKeys }) {
  const auth = `Basic ${Buffer.from(`${opts.keys.keyId}:${opts.keys.keySecret}`).toString("base64")}`;

  async function call(method: "GET" | "POST", path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Json> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await opts.fetch(`${BASE}${path}`, { method, headers: { authorization: auth, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch {
      throw new AppError("SERVER_ERROR", "Razorpay could not be reached. Try again in a minute.");
    }
    const text = await res.text();
    let json: Json = {};
    try {
      json = text ? (JSON.parse(text) as Json) : {};
    } catch {
      /* not JSON: handled by the status below */
    }
    if (res.status >= 200 && res.status < 300) return json;
    const err = (json.error ?? {}) as Json;
    const message = str(err.description) ?? "Razorpay refused the request.";
    if (res.status === 401) throw new AppError("CONFLICT", "Razorpay did not accept the saved keys. Check the Key ID and Key secret under Settings, Razorpay.");
    if (res.status === 404) throw new AppError("NOT_FOUND", message);
    if (res.status >= 500) throw new AppError("SERVER_ERROR", "Razorpay is having trouble right now. Try again in a minute.");
    throw new AppError("CONFLICT", message);
  }

  const items = (j: Json): Json[] => (Array.isArray(j.items) ? (j.items as Json[]) : []);

  return {
    /** Refund all or part of a payment. `speed` "optimum" is Razorpay's instant refund (an extra fee applies); "normal" takes 5 to 7 working days. */
    async refund(paymentId: string, input: { amountPaise: number; instant: boolean; reason: string; by: string; note: string; /** Razorpay's X-Refund-Idempotency: the same key for the same refund, so a repeat after a timeout is one refund and never two. */ idempotencyKey?: string }): Promise<RazorpayRefund> {
      const r = await call(
        "POST",
        `/payments/${encodeURIComponent(paymentId)}/refund`,
        {
          amount: input.amountPaise,
          speed: input.instant ? "optimum" : "normal",
          notes: { reason: input.reason.slice(0, 200), by: input.by.slice(0, 100), ...(input.note ? { note: input.note.slice(0, 200) } : {}) },
        },
        input.idempotencyKey && /^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey) ? { "x-refund-idempotency": input.idempotencyKey } : {},
      );
      return refundOf(r);
    },
    /** One payment as Razorpay reports it now. */
    async payment(paymentId: string): Promise<Json> {
      return call("GET", `/payments/${encodeURIComponent(paymentId)}`);
    },
    async refunds(count: number, skip: number): Promise<RazorpayRefund[]> {
      return items(await call("GET", `/refunds?count=${count}&skip=${skip}`)).map(refundOf);
    },
    async createLink(input: LinkRequest): Promise<RazorpayLink> {
      const l = await call("POST", "/payment_links", {
        amount: input.amountPaise,
        currency: "INR",
        description: input.description.slice(0, 2048) || "Payment",
        customer: { name: input.name, ...(input.contact ? { contact: input.contact } : {}), ...(input.email ? { email: input.email } : {}) },
        notify: { sms: input.sms && input.contact !== null, email: input.mail && input.email !== null },
        reminder_enable: true,
        expire_by: Math.floor(Date.now() / 1000) + Math.max(15 * 60, input.validForSeconds),
        notes: { ...input.notes, business: input.business },
      });
      return linkOf(l);
    },
    async links(count: number, skip: number): Promise<RazorpayLink[]> {
      return items(await call("GET", `/payment_links?count=${count}&skip=${skip}`) as Json).map(linkOf);
    },
    /** One payment link as Razorpay has it now (the address to send, the person it is for). */
    async link(linkId: string): Promise<RazorpayLink> {
      return linkOf(await call("GET", `/payment_links/${encodeURIComponent(linkId)}`));
    },
    async cancelLink(linkId: string): Promise<RazorpayLink> {
      return linkOf(await call("POST", `/payment_links/${encodeURIComponent(linkId)}/cancel`, {}));
    },
    async resendLink(linkId: string, medium: "sms" | "email"): Promise<void> {
      await call("POST", `/payment_links/${encodeURIComponent(linkId)}/notify_by/${medium}`, {});
    },
    async settlements(count: number, skip: number): Promise<RazorpaySettlement[]> {
      return items(await call("GET", `/settlements?count=${count}&skip=${skip}`)).map((s) => ({
        id: String(s.id), amountPaise: num(s.amount), feePaise: num(s.fees), taxPaise: num(s.tax), status: str(s.status) ?? "created", utr: str(s.utr), createdAt: iso(s.created_at) ?? new Date(0).toISOString(),
      }));
    },
  };
}

export type RazorpayClient = ReturnType<typeof createRazorpayClient>;

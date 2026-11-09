import "server-only";
import { z } from "zod";

// What the routes of "problems with online payments" accept. Text is trimmed and length-checked here and again, with the plain-text rule, in the service.
const hotel = z.string().trim().max(40).regex(/^[A-Za-z0-9-]*$/).optional();
const business = z.enum(["hotel", "food"]);
const paging = { page: z.coerce.number().int().min(1).max(1000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };

export const disputeRaiseBody = z.strictObject({
  hotel,
  business,
  paymentId: z.string().trim().regex(/^pay_[A-Za-z0-9]{1,40}$/, "That is not a payment number."),
  kind: z.enum(["dispute", "refund_request", "question"]),
  title: z.string().trim().max(120),
  message: z.string().trim().max(2000),
  amountPaise: z.number().int().min(100).max(1_000_000_000).nullable().optional(),
});
export const myPaymentsQuery = z.strictObject({ hotel, status: z.enum(["captured", "refunded", "failed", "authorized", "created"]).optional(), ...paging });
export const myProblemsQuery = z.strictObject({ hotel, status: z.enum(["open", "answered", "closed", "withdrawn", "all"]).default("all"), paymentId: z.string().trim().regex(/^pay_[A-Za-z0-9]{1,40}$/).optional(), ...paging });
export const withdrawQuery = z.strictObject({ hotel });
export const disputeListQuery = z.strictObject({ status: z.enum(["open", "answered", "closed", "withdrawn", "all"]).default("open"), paymentId: z.string().trim().regex(/^pay_[A-Za-z0-9]{1,40}$/).optional(), ...paging });
export const disputeRespondBody = z.strictObject({ status: z.enum(["answered", "closed"]), reply: z.string().trim().max(2000).nullable().optional() });

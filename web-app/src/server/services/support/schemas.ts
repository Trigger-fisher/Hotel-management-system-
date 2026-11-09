import "server-only";
import { z } from "zod";

// The hotel's customer-support desk inputs (Front Office > Guest messages). Strict and bounded.
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
export const supportListQuery = z.strictObject({
  status: z.enum(["open", "answered", "closed", "all"]).default("open"),
  search: z.string().trim().max(200).regex(NO_CONTROL).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).default(25),
});
export const supportRespondBody = z.strictObject({
  status: z.enum(["answered", "closed"]),
  reply: z.string().max(5000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/).nullable().optional(),
});
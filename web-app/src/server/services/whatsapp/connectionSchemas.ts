import "server-only";
import { z } from "zod";

// What the connection routes accept. Strict: an unknown key is refused before a service runs. The token is the only secret field; it is checked for shape and nothing else, and the
// refusal text never repeats it.
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const metaId = z.string().trim().regex(/^[0-9]{5,40}$/, "Use the digits Meta shows, 5 to 40 of them.");
const token = z.string().min(20).max(1000).regex(/^[^\s\u0000-\u001f\u007f]+$/, "A token has no spaces or line breaks.");

export const createLineBody = z.strictObject({
  kind: z.enum(["platform", "shared", "hotel", "group", "person"]),
  phoneNumberId: metaId,
  wabaId: metaId,
  token,
  hotelId: z.uuid().optional(),
  personId: z.uuid().optional(),
});

export const replaceTokenBody = z.strictObject({
  token,
  /** The line's name, typed to confirm (needed while the line is active). */
  confirm: z.string().trim().max(200).regex(NO_CONTROL).optional(),
});

export const disconnectBody = z.strictObject({
  confirm: z.string().trim().max(200).regex(NO_CONTROL),
});

export const testBody = z.strictObject({
  /** The operator's own phone, with its country code. */
  to: z.string().trim().min(8).max(24).regex(/^\+?[0-9 ()-]+$/, "Use digits, spaces and a leading +."),
});

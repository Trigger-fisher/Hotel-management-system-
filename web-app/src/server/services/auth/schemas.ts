import "server-only";
import { z } from "zod";

// The shapes the auth routes accept (ui-shared/auth-pallav). Strict and bounded; the rules (lengths Pallav sets, the password policy, the
// phone's device id) are checked by the service with Pallav's words.
const device = z.strictObject({
  platform: z.enum(["web"]),
  name: z.string().max(200),
});

/** Decision 55: the slug of the hotel whose website the person came from (`?hotel=<slug>`). Only a hint: the server applies it when the person is linked to that hotel. */
const entryHotel = z.string().max(63).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional();
export const signInBody = z.strictObject({ username: z.string().max(500), password: z.string().max(2000), device, entryHotel });
export const verifyCodeBody = z.strictObject({ challengeId: z.string().max(700), code: z.string().max(40), entryHotel });
export const challengeBody = z.strictObject({ challengeId: z.string().max(700) });
export const forgotBody = z.strictObject({ username: z.string().max(500) });
export const resetBody = z.strictObject({ challengeId: z.string().max(700), code: z.string().max(40), newPassword: z.string().max(2000) });
export const changeBody = z.strictObject({ changeToken: z.string().max(400), newPassword: z.string().max(2000), device });
export const unlockBody = z.strictObject({ password: z.string().max(2000) });

/** The vault re-check: the password, or the emailed code with the code row the send answered. */
export const recheckBody = z.strictObject({ password: z.string().max(2000) });
export const recheckCodeBody = z.strictObject({ challengeId: z.string().max(64), code: z.string().max(20) });

/** The "Set up your hotel" checklist as the screen holds it (the step keys are the screen's: letters and underscore, at most 20). */
export const hotelSetupBody = z.strictObject({
  steps: z
    .record(z.string().regex(/^[a-z][a-z0-9_]{0,29}$/), z.enum(["todo", "visited", "done", "skipped"]))
    .refine((v) => Object.keys(v).length <= 20, "Too many steps"),
  hidden: z.boolean(),
  finished: z.boolean(),
});

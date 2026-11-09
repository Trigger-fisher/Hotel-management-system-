import "server-only";
import { asPersonal, getPersonalConversations } from "@/server/compose/personalMailbox";
import { AppError } from "@/server/errors";
import { route } from "@/server/http/route";
import { mailFileBeginBody, mailFileReceiveBody } from "@/server/services/conversations/schemas";

// My mailbox (platform 0178, 0179): files for an email, the same endpoint as the hotel's /api/v1/conversations/files, for the signed-in staff login only. The files wait under the
// person's own login id and are removed an hour after the email goes (mail/files.ts). Nothing here is a stored email text.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: mailFileBeginBody,
  idempotency: "off",
  limits: [{ name: "conv-files", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body }) => ({ data: await getPersonalConversations().beginFile(asPersonal(session), body) }),
});

export const PUT = route({
  permission: "session",
  body: mailFileReceiveBody,
  idempotency: "off",
  maxBodyBytes: 36 * 1024 * 1024,
  limits: [{ name: "conv-files", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body }) => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.dataBase64)) throw new AppError("VALIDATION_FAILED", "That file could not be read. Add it again.");
    await getPersonalConversations().receiveFile(asPersonal(session), body.ref, new Uint8Array(Buffer.from(body.dataBase64, "base64")));
    return { data: { ok: true as const } };
  },
});

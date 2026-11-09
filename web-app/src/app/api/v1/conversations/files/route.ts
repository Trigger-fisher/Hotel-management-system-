import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { AppError } from "@/server/errors";
import { route } from "@/server/http/route";
import { mailFileBeginBody, mailFileReceiveBody } from "@/server/services/conversations/schemas";

// Files for an email (mail/files.ts, MJ 2 Nov 2026). POST: a file is about to be added; the answer is where to send it (an address that goes straight to the bucket, valid 15 minutes;
// a function on Vercel refuses a body over 4.5 MB). PUT: the file itself, only on a server with no bucket (a local disk). Conversations Edit. Nothing here is a stored email text.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: mailFileBeginBody,
  idempotency: "off",
  limits: [{ name: "conv-files", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body }) => ({ data: await getConversations().beginFile(session, body) }),
});

export const PUT = route({
  permission: "session",
  body: mailFileReceiveBody,
  idempotency: "off",
  maxBodyBytes: 36 * 1024 * 1024,
  limits: [{ name: "conv-files", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body }) => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.dataBase64)) throw new AppError("VALIDATION_FAILED", "That file could not be read. Add it again.");
    await getConversations().receiveFile(session, body.ref, new Uint8Array(Buffer.from(body.dataBase64, "base64")));
    return { data: { ok: true as const } };
  },
});

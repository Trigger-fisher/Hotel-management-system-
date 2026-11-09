import "server-only";
import { z } from "zod";
import { getAdminProfile } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// The signed-in person's OWN profile photo (platform migration 0131): any login (guest, company, staff). See it, add or replace it (a JPG, PNG or WebP, base64 in JSON, up to
// 10 MB, kept as WebP of at most 1 MB), remove it. Kept in the private profile-photo store, never on a public address. GET /profile carries `photoUrl` (null when there is none).
export const dynamic = "force-dynamic";

const putBody = z.strictObject({ fileName: z.string().max(300), dataBase64: z.string().max(15_000_000) });
const limit = { name: "profile-photo", max: 20, windowSeconds: 3600, by: "user" as const, message: "You have changed your photo many times in the last hour. Please wait a little and try again." };

export const GET = route({
  permission: "session",
  // never kept by the browser (the wrapper's no-store; security review round 2, L7): after sign-out on a shared computer, or once the photo is removed, nothing is left to
  // show from its cache. A photo is at most 1 MB of WebP (usually far less), so fetching it again is cheap.
  handler: async ({ session }) => {
    const file = await getAdminProfile().photo(session);
    return { data: null, binary: { bytes: file.bytes, contentType: file.contentType, filename: "profile-photo", disposition: "inline" as const } };
  },
});

export const PUT = route({
  permission: "session",
  body: putBody,
  maxBodyBytes: 15 * 1024 * 1024,
  limits: [limit],
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminProfile().putPhoto(session, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  limits: [limit],
  handler: async ({ session, request, traceId }) => ({ data: await getAdminProfile().removePhoto(session, requestMeta(request, traceId)) }),
});

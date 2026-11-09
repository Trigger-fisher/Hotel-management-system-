import "server-only";
import { canaryKey, getSecurity } from "@/server/compose/security";
import { getConfig } from "@/server/config/env";
import { edgeCountry } from "@/server/services/security/edge";
import { fakeEnvFile } from "@/server/services/security/honeypot";
import { AppError } from "@/server/errors";
import { clientAddress } from "@/server/http/clientAddress";
import { publicRoute } from "@/server/http/route";
import { TRAP_PATH_HEADER } from "@/lib/honeypotPaths";

// The decoy addresses (/wp-admin, /.env, /admin/.git ...) end here (src/proxy.ts rewrites them). A hit is a Warning (bots scan these daily); the caller sees a plain 404, except /.env, which serves a FAKE file whose key and link are honeytokens.
export const dynamic = "force-dynamic";

async function hit({ request, traceId }: { request: Request; traceId: string }): Promise<{ data: null; binary: { bytes: Uint8Array; contentType: string; filename: string } }> {
  const path = request.headers.get(TRAP_PATH_HEADER) ?? "";
  await getSecurity().events.record({
    kind: "honeypot_hit", summary: `Decoy address requested: ${request.method} ${path || "(unknown)"}`, ip: clientAddress(request), traceId,
    detail: { path, method: request.method, userAgent: request.headers.get("user-agent") ?? "", country: edgeCountry(request) },
  });
  // /.env is the one bait with content: a fake file whose API key and report link are honeytokens (opening the link or trying the key raises a Critical alert). Everything else is a plain 404.
  const key = canaryKey();
  if (key !== null && request.method === "GET" && path.toLowerCase() === "/.env") {
    return { data: null, binary: { bytes: new TextEncoder().encode(fakeEnvFile(key, getConfig().HMS_PUBLIC_URL)), contentType: "text/plain; charset=utf-8", filename: ".env" } };
  }
  throw new AppError("NOT_FOUND");
}

export const GET = publicRoute({ limits: [{ name: "trap", max: 30, windowSeconds: 60, by: "ip" }], handler: hit });
export const POST = publicRoute({ limits: [{ name: "trap", max: 30, windowSeconds: 60, by: "ip" }], handler: hit });
export const PUT = publicRoute({ limits: [{ name: "trap", max: 30, windowSeconds: 60, by: "ip" }], handler: hit });
export const PATCH = publicRoute({ limits: [{ name: "trap", max: 30, windowSeconds: 60, by: "ip" }], handler: hit });
export const DELETE = publicRoute({ limits: [{ name: "trap", max: 30, windowSeconds: 60, by: "ip" }], handler: hit });

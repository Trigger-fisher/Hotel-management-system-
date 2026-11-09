import "server-only";
import { getWebsiteSiteTemplates } from "@/server/compose/website";
import { AppError } from "@/server/errors";
import { publicRoute } from "@/server/http/route";
import { siteBuildParams } from "@/server/services/website/schemas";
import type { SiteBuildDto } from "@/server/services/website/siteTemplateService";

// The "Create hotel site" job reports here (website-templates/tools/report-build.mjs): building, then live or failed. No session: the proof is the signature.
//  - x-hms-timestamp (unix seconds) and x-hms-signature = sha256=HMAC-SHA256(SITE_BUILD_SECRET, "<timestamp>.<build id>.<raw body>"; the id is the one in the address). A report older than ten minutes, or signed with a
//    wrong key, is refused 403 before the body is read; a server with no SITE_BUILD_SECRET answers 404.
//  - A repeat of a report already taken answers 200 and changes nothing, so the job may retry safely.
export const dynamic = "force-dynamic";

const MAX_BYTES = 16 * 1024;

export const POST = publicRoute({
  params: siteBuildParams,
  idempotency: "off",
  limits: [{ name: "site-build-report", max: 120, windowSeconds: 60, by: "ip" }],
  handler: async ({ params, request }): Promise<{ data: { build: SiteBuildDto; repeated: boolean } }> => {
    if (Number(request.headers.get("content-length") ?? "0") > MAX_BYTES) throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Request is too large" } });
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BYTES) throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Request is too large" } });
    return { data: await getWebsiteSiteTemplates().receive(params.id, { timestamp: request.headers.get("x-hms-timestamp"), signature: request.headers.get("x-hms-signature"), body }) };
  },
});

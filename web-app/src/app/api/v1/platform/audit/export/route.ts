import "server-only";
import { getPlatformAudit } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { auditExportQuery } from "@/server/services/platform/schemas";

// The same filters as the audit list, as a CSV download (at most 50,000 rows). The export is itself an audit entry. Super Admin only. (docs/BACKEND.md 14.5)
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: auditExportQuery,
  handler: async ({ session, query, request, traceId }) => {
    const file = await getPlatformAudit().exportCsv(session, query, platformMeta(request, traceId));
    return { data: null, binary: { bytes: file.bytes, contentType: "text/csv; charset=utf-8", filename: file.filename, disposition: "attachment" } };
  },
});
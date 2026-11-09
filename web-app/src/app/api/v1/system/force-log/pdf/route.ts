import "server-only";
import { getSystemLogs } from "@/server/compose/systemAdmin";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { forceLogDoc } from "@/server/services/systemAdmin/logDocuments";
import { forceLogPdfQuery } from "@/server/services/systemAdmin/schemas";

// The printed Force Log (ForceLogController::pdf): the same filters as the page, at most 400 lines. SuperAdmin only.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route({
  permission: "session",
  query: forceLogPdfQuery,
  handler: async ({ session, query }) => {
    const { rows, truncated, hotelName } = await getSystemLogs().forceLogRows(session, query);
    const doc = await getDocumentRenderer().render("payrollDoc", { doc: forceLogDoc(hotelName, rows, truncated), filename: "force-log" });
    return { data: null, binary: { bytes: doc.bytes, contentType: "application/pdf", filename: doc.filename } };
  },
});

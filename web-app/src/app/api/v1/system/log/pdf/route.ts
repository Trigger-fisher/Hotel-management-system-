import "server-only";
import { getSystemLogs } from "@/server/compose/systemAdmin";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { systemLogDoc } from "@/server/services/systemAdmin/logDocuments";
import { systemLogPdfQuery } from "@/server/services/systemAdmin/schemas";

// The printed System Log (SystemLogController::pdf): the same filters as the page, at most 400 lines. SuperAdmin only.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route({
  permission: "session",
  query: systemLogPdfQuery,
  handler: async ({ session, query }) => {
    const { rows, truncated, hotelName } = await getSystemLogs().systemLogRows(session, query);
    const doc = await getDocumentRenderer().render("payrollDoc", { doc: systemLogDoc(hotelName, rows, truncated), filename: "system-log" });
    return { data: null, binary: { bytes: doc.bytes, contentType: "application/pdf", filename: doc.filename } };
  },
});

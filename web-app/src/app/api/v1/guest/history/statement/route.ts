import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { statementDoc } from "@/server/services/guest/guestDocuments";
import { guestStatementQuery } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The guest's statement as a PDF: charges and payments from `from` to `to` (YYYY-MM-DD, at most a year), one hotel or all (a hotel that cannot be reached is named on it).
// 30 documents in 10 minutes.
export const GET = route({
  permission: "session",
  query: guestStatementQuery,
  limits: [{ name: "guest-pdf", max: 30, windowSeconds: 600, by: "user", message: "You have opened many documents in a few minutes. Please wait a little and try again." }],
  handler: async ({ session, query }) => {
    const doc = await getDocumentRenderer().render("payrollDoc", statementDoc(await getGuestPortal().statementDocument(session, query)));
    return { data: null, binary: { bytes: doc.bytes, contentType: "application/pdf", filename: doc.filename } };
  },
});
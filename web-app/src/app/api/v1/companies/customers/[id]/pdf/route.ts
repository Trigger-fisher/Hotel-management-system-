import "server-only";
import { getCustomers } from "@/server/compose/companies";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A guest's profile as a PDF: the same fields and permission as the screen; the ID number is printed by its last four characters only.
export const GET = route({
  permission: { key: "companies", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => {
    const file = await getCustomers().profileDocument(session, params.id);
    const out = await getDocumentRenderer().render("payrollDoc", file);
    return { data: null, binary: { bytes: out.bytes, contentType: "application/pdf", filename: out.filename } };
  },
});

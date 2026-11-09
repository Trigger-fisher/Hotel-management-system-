import "server-only";
import { getBillingAdvances } from "@/server/compose/billing";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The advance receipt as a real PDF (MJ #22): the SAME data as the preview, same permission.
export const GET = route({
  permission: { key: "bills.advances", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => {
    const doc = await getDocumentRenderer().render("advance", await getBillingAdvances().preview(session, params.id));
    return { data: null, binary: { bytes: doc.bytes, contentType: "application/pdf", filename: doc.filename } };
  },
});

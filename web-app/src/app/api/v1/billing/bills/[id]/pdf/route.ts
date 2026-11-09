import "server-only";
import { getBillingBills } from "@/server/compose/billing";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The bill as a real PDF (MJ #22): the SAME data as the preview, same permission.
export const GET = route({
  permission: { key: "bills.bills", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => {
    const doc = await getDocumentRenderer().render("bill", await getBillingBills().preview(session, params.id));
    return { data: null, binary: { bytes: doc.bytes, contentType: "application/pdf", filename: doc.filename } };
  },
});

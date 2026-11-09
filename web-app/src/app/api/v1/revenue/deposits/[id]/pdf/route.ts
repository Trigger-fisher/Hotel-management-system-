import "server-only";
import { getCashReceipts } from "@/server/compose/cashReceipts";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The deposit's revenue receipt as a real PDF (MJ #22): the SAME data as the preview, same permission as the screen.
export const GET = route({
  permission: { key: "revenue", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => {
    const doc = await getDocumentRenderer().render("cashReceipt", await getCashReceipts().deposit(session, params.id));
    return { data: null, binary: { bytes: doc.bytes, contentType: "application/pdf", filename: doc.filename } };
  },
});

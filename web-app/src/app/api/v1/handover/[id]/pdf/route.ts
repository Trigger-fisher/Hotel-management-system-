import "server-only";
import { getHandovers } from "@/server/compose/handover";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The handover as a real PDF (Pallav ShiftHandoverController::view; MJ #22): the same receipt the screen previews, same permission as the screen.
export const GET = route({
  permission: { key: "handover", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => {
    const doc = await getDocumentRenderer().render("cashReceipt", await getHandovers().receipt(session, params.id));
    return { data: null, binary: { bytes: doc.bytes, contentType: "application/pdf", filename: doc.filename } };
  },
});

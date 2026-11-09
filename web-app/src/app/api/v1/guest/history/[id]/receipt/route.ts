import "server-only";
import { getBillingAdvances } from "@/server/compose/billing";
import { getGuestPortal } from "@/server/compose/portal";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";
import { paymentReceiptDoc } from "@/server/services/guest/guestDocuments";
import { guestHistoryParams } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The receipt for one line of the guest's payment history, as a PDF: an advance prints as the hotel's advance receipt; a payment on a bill as a simple receipt. 404 for anything
// that is not one of the guest's own payment lines. `?hotel=` names the hotel (required for a guest linked to several). 30 documents in 10 minutes.
export const GET = route({
  permission: "session",
  params: guestHistoryParams,
  query: hotelQuery,
  limits: [{ name: "guest-pdf", max: 30, windowSeconds: 600, by: "user", message: "You have opened many documents in a few minutes. Please wait a little and try again." }],
  handler: async ({ session, params, query }) => {
    const portal = getGuestPortal();
    const one = await portal.forAction(session, query.hotel);
    const found = await portal.receiptDocument(one, params.id);
    const doc =
      found.kind === "advance"
        ? await getDocumentRenderer().render("advance", await getBillingAdvances().previewForMail(one.hotelId, found.advanceId))
        : await getDocumentRenderer().render("payrollDoc", paymentReceiptDoc(found.receipt));
    return { data: null, binary: { bytes: doc.bytes, contentType: "application/pdf", filename: doc.filename } };
  },
});
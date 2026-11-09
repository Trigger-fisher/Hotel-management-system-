import "server-only";
import { getBillingBills } from "@/server/compose/billing";
import { getGuestPortal } from "@/server/compose/portal";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";
import { guestBillParams } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One of the guest's own issued bills as a PDF: the hotel's own print (the same data as Bills > Print). 404 for another guest's bill, 409 for the running stay bill.
// `?hotel=` names the bill's hotel (required for a guest linked to several). 30 documents in 10 minutes.
export const GET = route({
  permission: "session",
  params: guestBillParams,
  query: hotelQuery,
  limits: [{ name: "guest-pdf", max: 30, windowSeconds: 600, by: "user", message: "You have opened many documents in a few minutes. Please wait a little and try again." }],
  handler: async ({ session, params, query }) => {
    const portal = getGuestPortal();
    const one = await portal.forAction(session, query.hotel);
    const { billId } = await portal.billDocument(one, params.id);
    const doc = await getDocumentRenderer().render("bill", await getBillingBills().previewForMail(one.hotelId, billId));
    return { data: null, binary: { bytes: doc.bytes, contentType: "application/pdf", filename: doc.filename } };
  },
});
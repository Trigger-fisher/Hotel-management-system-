import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyProfileBody, hotelQuery } from "@/server/services/corporate/schemas";

export const dynamic = "force-dynamic";

// Decision 48: the company profile in ONE hotel (?hotel=, omitted = the first): the contact fields, and the prices set by the hotel (read-only, setByHotel: true).
export const GET = route({
  permission: "session",
  query: hotelQuery,
  handler: async ({ session, query }) => ({ data: await getCorporatePortal().companyProfile(session, query) }),
});

// The company changes its OWN contact details: once, in its ONE common profile (platform 0132; ?hotel= not needed), or, on a database before 0132, in the hotel named by ?hotel=
// (required then). The percentages are the hotel's: any of them in the body (or any unknown field) is a 422.
export const PUT = route({
  permission: "session",
  query: hotelQuery,
  body: companyProfileBody,
  idempotency: "off",
  handler: async ({ session, query, body, request, traceId }) => ({ data: await getCorporatePortal().updateCompanyProfile(session, query, body, requestMeta(request, traceId)) }),
});
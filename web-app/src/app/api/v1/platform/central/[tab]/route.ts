import "server-only";
import { getCentralConsole } from "@/server/compose/centralConsole";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { centralListParams, centralListQuery, looseBody, parseWrite, tabOfPath } from "@/server/services/platform/centralSchemas";
import { AppError } from "@/server/errors";

// Central tabs (logins, guests, companies, gst, gst-lookups). GET: one page of the platform's shared records (Platform Admin and Super Admin; a mobile and an email come masked; `deleted=1` lists
// the deleted ones). POST: create (Super Admin only; the GST lookups are read only). Never an API key, never a visit inside a hotel. Contract: ui-shared/dashboards/central.ts.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  params: centralListParams,
  query: centralListQuery,
  handler: async ({ session, params, query }) => ({ data: await getCentralConsole().list(session, tabOfPath(params.tab)!, { ...query, deleted: query.deleted === "1" }) }),
});

export const POST = route({
  permission: "session",
  params: centralListParams,
  body: looseBody,
  idempotency: "optional",
  limits: [{ name: "central-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }): Promise<{ status?: number; data: unknown }> => {
    const tab = tabOfPath(params.tab)!;
    const c = getCentralConsole();
    const meta = platformMeta(request, traceId);
    switch (tab) {
      case "logins": return { status: 201, data: await c.createLogin(session, parseWrite("create", tab, body), meta) };
      case "guests": return { status: 201, data: await c.createGuest(session, parseWrite("create", tab, body), meta) };
      case "companies": return { status: 201, data: await c.createCompany(session, parseWrite("create", tab, body), meta) };
      case "gst": return { status: 201, data: await c.createGst(session, parseWrite<{ gstin: string }>("create", tab, body).gstin, meta) };
      default: throw new AppError("FORBIDDEN", "The GST lookup log is read only.");
    }
  },
});
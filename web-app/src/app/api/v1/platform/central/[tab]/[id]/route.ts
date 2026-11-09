import "server-only";
import { getCentralConsole } from "@/server/compose/centralConsole";
import { AppError } from "@/server/errors";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { centralDetailParams, deleteBody, looseBody, parseWrite, tabOfPath } from "@/server/services/platform/centralSchemas";

// Central tabs: GET one record with every field its tab holds (a mobile and an email masked; Platform Admin and Super Admin). PATCH changes a login, guest profile or company profile; DELETE
// closes a login or hides a profile or GST record (the name typed out to confirm). Both Super Admin only, one audit line each. Never an API key, never a visit inside a hotel.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  params: centralDetailParams,
  handler: async ({ session, params }) => ({ data: await getCentralConsole().detail(session, tabOfPath(params.tab)!, params.id) }),
});

export const PATCH = route({
  permission: "session",
  params: centralDetailParams,
  body: looseBody,
  idempotency: "optional",
  limits: [{ name: "central-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }): Promise<{ status?: number; data: unknown }> => {
    const tab = tabOfPath(params.tab)!;
    const c = getCentralConsole();
    const meta = platformMeta(request, traceId);
    switch (tab) {
      case "logins": return { data: await c.updateLogin(session, params.id, parseWrite("patch", tab, body), meta) };
      case "guests": return { data: await c.updateGuest(session, params.id, parseWrite("patch", tab, body), meta) };
      case "companies": return { data: await c.updateCompany(session, params.id, parseWrite("patch", tab, body), meta) };
      default: throw new AppError("FORBIDDEN", "GST records are refreshed from the provider, not edited by hand.");
    }
  },
});

export const DELETE = route({
  permission: "session",
  params: centralDetailParams,
  body: deleteBody,
  idempotency: "optional",
  limits: [{ name: "central-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }): Promise<{ status?: number; data: unknown }> => {
    const tab = tabOfPath(params.tab)!;
    const c = getCentralConsole();
    const meta = platformMeta(request, traceId);
    switch (tab) {
      case "logins": return { data: await c.deleteLogin(session, params.id, body, meta) };
      case "guests": return { data: await c.deleteGuest(session, params.id, body, meta) };
      case "companies": return { data: await c.deleteCompany(session, params.id, body, meta) };
      case "gst": return { data: await c.deleteGst(session, params.id, body, meta) };
      default: throw new AppError("FORBIDDEN", "The GST lookup log is read only.");
    }
  },
});
import "server-only";
import { getCentralConsole } from "@/server/compose/centralConsole";
import { AppError } from "@/server/errors";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { centralActionParams, tabOfPath } from "@/server/services/platform/centralSchemas";

// Central tabs: POST `<tab>/<id>/restore` brings a deleted guest profile, company profile or GST record back; POST `<tab>/<id>/refresh` asks the GST provider again and replaces the record's
// fields (a logged lookup). Super Admin only, one audit line each. Never an API key, never a visit inside a hotel.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: centralActionParams,
  idempotency: "optional",
  limits: [{ name: "central-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }): Promise<{ data: unknown }> => {
    const tab = tabOfPath(params.tab)!;
    const c = getCentralConsole();
    const meta = platformMeta(request, traceId);
    if (params.action === "refresh") {
      if (tab !== "gst") throw new AppError("NOT_FOUND");
      return { data: await c.refreshGst(session, params.id, meta) };
    }
    switch (tab) {
      case "guests": return { data: await c.restoreGuest(session, params.id, meta) };
      case "companies": return { data: await c.restoreCompany(session, params.id, meta) };
      case "gst": return { data: await c.restoreGst(session, params.id, meta) };
      default: throw new AppError("NOT_FOUND");
    }
  },
});
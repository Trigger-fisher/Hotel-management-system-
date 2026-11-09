import "server-only";
import { z } from "zod";
import { getGst } from "@/server/compose/gst";
import { route } from "@/server/http/route";

// GST lookup (platform 0167): the free check of a GSTIN (state, PAN, check character), then the company from our saved records, then (once) from the GST lookup service, saved for every
// hotel. Anyone signed in; never an API key. Limited per person, because a call to the service can cost money.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  // `except`: the company being edited, so its own GSTIN is not "already in your hotel"
  query: z.strictObject({ gstin: z.string().max(40), except: z.uuid().optional() }),
  limits: [{ name: "gst-lookup", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, query }) => ({ data: await getGst().lookup(session, query.gstin, { except: query.except }) }),
});

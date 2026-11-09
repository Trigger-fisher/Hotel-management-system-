import "server-only";
import { z } from "zod";
import { getWebsiteOverview } from "@/server/compose/website";
import { route } from "@/server/http/route";

// The Website overview: enquiry counts for a financial year (?fy=2026 is 2026-27), today's and this week's arrivals, the latest enquiries, closed dates, the latest changes.
export const dynamic = "force-dynamic";

const overviewQuery = z.strictObject({ fy: z.coerce.number().int().min(1900).max(3000).optional() });

export const GET = route({
  permission: { key: "website", level: "view" },
  cache: "private, no-cache",
  query: overviewQuery,
  handler: async ({ session, query }) => ({ data: await getWebsiteOverview().overview(session, query.fy) }),
});
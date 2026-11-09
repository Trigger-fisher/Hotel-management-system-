import "server-only";
import { z } from "zod";
import { getProfileReview } from "@/server/compose/profileReview";
import { route } from "@/server/http/route";
import { searchParam } from "@/server/validation/listQuery";

// Super Admin: "Possible duplicates" of the one common guest and company profile (platform 0132): live profiles sharing a mobile or email (companies: GSTIN or email), oldest
// first, groups whose every pair was marked "not the same" left out. Read only. Contract: ui-shared/dashboards/profileReview.ts.
export const dynamic = "force-dynamic";

const query = z.strictObject({
  kind: z.enum(["guest", "company"]),
  search: searchParam,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().refine((n) => n === 10 || n === 25 || n === 50, "10, 25 or 50").default(25),
});

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query,
  handler: async ({ session, query: q }) => ({ data: await getProfileReview().duplicates(session, q) }),
});

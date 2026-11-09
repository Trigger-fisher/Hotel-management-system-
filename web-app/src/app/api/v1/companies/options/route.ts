import "server-only";
import { getCompanies } from "@/server/compose/companies";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The forms' lists from the hotel's data: ID proof types and contact roles (replaces the apps' constants).
export const GET = route({
  permission: { key: "companies", level: "view" },
  handler: async ({ session }) => ({ data: await getCompanies().options(session) }),
});

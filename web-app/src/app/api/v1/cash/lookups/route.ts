import "server-only";
import { getCashLookups } from "@/server/compose/cash";
import { route } from "@/server/http/route";

// The lists the Daily Cash forms are drawn from. Needs Revenue or Expenses view (checked by the service).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getCashLookups().get(session) }),
});

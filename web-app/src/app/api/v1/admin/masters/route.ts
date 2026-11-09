import "server-only";
import { getAdminMasters } from "@/server/compose/admin";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The lists down the left (a list that exists once per business is one entry).
export const GET = route({
  permission: { key: "masters", level: "view" },
  handler: async ({ session }) => ({ data: await getAdminMasters().rail(session) }),
});

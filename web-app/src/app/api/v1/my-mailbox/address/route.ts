import "server-only";
import { getPersonalMailbox } from "@/server/compose/personalMailbox";
import { route } from "@/server/http/route";

// My mailbox (platform 0179): the signed-in staff login's own mailbox address (<username>@<the platform sending domain>) and whether it is usable. Read only: the address follows the username,
// nothing is typed or connected. Session only: no API key, no visit, no guest or company login; the same answer from the hotel, group and platform dashboards.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  touch: false,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getPersonalMailbox().address(session) }),
});

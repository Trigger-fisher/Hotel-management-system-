import "server-only";
import { getSystemHealth } from "@/server/compose/systemAdmin";
import { route } from "@/server/http/route";

// Deep health for an Admin (anyone holding the `users` module, the cash rules' "admin"): database ping, disk, email set-up, backups, online payments and
// recent faults, run now and filed. Each check answers ok / warn / down and a sentence; never a secret or a setting's value.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "users", level: "view" },
  handler: async ({ session }) => ({ data: await getSystemHealth().deep(session) }),
});

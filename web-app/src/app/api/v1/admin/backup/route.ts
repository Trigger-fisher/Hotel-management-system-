import "server-only";
import { getAdminBackup } from "@/server/compose/admin";
import { route } from "@/server/http/route";

// Backup & Restore status: is Google Drive connected, when and how the last backup ended. SuperAdmin only (docs/BACKEND.md section 14b).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getAdminBackup().status(session) }),
});
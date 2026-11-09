import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { getCron } from "@/server/compose/cron";
import { publicRoute } from "@/server/http/route";

// The files of an email (mail/files.ts): removes the files whose email went an hour ago, and files that were never sent after a day. Vercel Cron once a day (the free plan allows no more; any scheduler can call it every hour);
// no session, Bearer CRON_SECRET as /cron/mail. The sweep also runs on its own when someone adds a file (at most every 10 minutes), so a quiet cron does not leave files behind.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = publicRoute({
  limits: [{ name: "cron", max: 60, windowSeconds: 60, by: "ip" }],
  handler: async ({ request }): Promise<{ data: { removed: number; folders: number } }> => {
    getCron().authorize(request);
    return { data: await getConversations().sweepFiles() };
  },
});

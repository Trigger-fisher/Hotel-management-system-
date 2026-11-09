import "server-only";
import { after } from "next/server";
import { CONVERSATIONS_MAX_HOPS, continueConversations, getCron } from "@/server/compose/cron";
import { publicRoute } from "@/server/http/route";
import type { CronConversationsRun } from "@/server/services/cron/cronService";

// Conversations' daily safety net (decision 66; Vercel Cron once a day at 01:00 UTC, or any scheduler; no session, Bearer CRON_SECRET as /cron/mail). First the 12-month
// purge of every provisioned hotel (C5, whatever its reading switch) and of the platform hub, then the mail check of every mailbox that was not checked for 6 hours (four at a
// time, each within the time left). A call that runs out of time answers `more: true` and hands the rest to a new call (`?detached=1` answers {accepted: true} at once).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Runs `work` after the answer has gone (next/server after()); outside a request (a test, a script) at once. */
function afterAnswer(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    void work();
  }
}

export const GET = publicRoute({
  limits: [{ name: "cron", max: 60, windowSeconds: 60, by: "ip" }],
  handler: async ({ request }): Promise<{ data: CronConversationsRun | { accepted: true } }> => {
    getCron().authorize(request);
    const params = new URL(request.url).searchParams;
    if (params.get("detached") === "1") {
      // how many calls handed the pass on so far: the chain stops after CONVERSATIONS_MAX_HOPS (a malformed value counts as the last hop)
      const hop = /^\d{1,4}$/.test(params.get("hop") ?? "") ? Number(params.get("hop")) : CONVERSATIONS_MAX_HOPS;
      afterAnswer(async () => {
        const run = await getCron().conversations().catch(() => null);
        if (run?.more) await continueConversations(hop);
      });
      return { data: { accepted: true as const } };
    }
    const data = await getCron().conversations();
    if (data.more) afterAnswer(continueConversations);
    return { data };
  },
});

import "server-only";
import { after } from "next/server";
import { continueDailySummary, getCron } from "@/server/compose/cron";
import { publicRoute } from "@/server/http/route";
import type { CronSummaryRun } from "@/server/services/cron/cronService";

// The owners' daily summary mails (Vercel Cron once a day at 21:00 IST, or any scheduler; no session): every active hotel whose Settings > Email names
// addresses gets one mail per address through its own mail server, at most once a day. Bearer CRON_SECRET as /cron/mail. Answers {hotels, queued, skipped, failed}.
// A call handles one BATCH of hotels (about 150, or 40 seconds: a function lives 60) and, when hotels are left, answers `more: true` and hands the rest to a new call
// (a request to this same route with `?detached=1`, which answers {accepted: true} at once and works in its own function time), so a pass over thousands of hotels
// finishes by itself; the cursor is kept in the platform settings and a later scheduled call continues from it if a link of the chain is lost.
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
  handler: async ({ request }): Promise<{ data: CronSummaryRun | { accepted: true } }> => {
    getCron().authorize(request);
    if (new URL(request.url).searchParams.get("detached") === "1") {
      afterAnswer(async () => {
        const run = await getCron().dailySummary().catch(() => null);
        if (run?.more) await continueDailySummary();
      });
      return { data: { accepted: true as const } };
    }
    const data = await getCron().dailySummary();
    if (data.more) afterAnswer(continueDailySummary);
    return { data };
  },
});

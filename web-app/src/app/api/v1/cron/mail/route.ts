import "server-only";
import { getCron } from "@/server/compose/cron";
import { publicRoute } from "@/server/http/route";

// The mail queue drained (HMS_MAIL_WORKER=cron: Vercel Cron every minute, or another scheduler, calls this; no session): batches of 50, 8 at a time, for up to
// 40 s. The request that queues a mail already runs a pass itself (compose/mail.ts), so this is the safety net. Bearer CRON_SECRET: none configured = 404,
// wrong = 401. Answers {sent, failed, remaining}.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = publicRoute({
  limits: [{ name: "cron", max: 60, windowSeconds: 60, by: "ip" }],
  handler: async ({ request }) => {
    getCron().authorize(request);
    return { data: await getCron().mail() };
  },
});

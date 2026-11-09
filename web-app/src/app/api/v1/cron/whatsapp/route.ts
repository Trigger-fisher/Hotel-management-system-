import "server-only";
import { getCron } from "@/server/compose/cron";
import { runWhatsAppSweep, sweepKeyMatches, type WhatsAppSweepResult } from "@/server/compose/whatsappProcessor";
import { publicRoute } from "@/server/http/route";

// WhatsApp's background lane (plan part 17; no session): process the saved events that are due, expire held "which hotel?" questions and purge old rows.
// The database scheduler (pg_cron) calls it every minute with WHATSAPP_SWEEP_KEY (a key that opens this route only); Vercel Cron calls it once a day as the backstop with CRON_SECRET like the other
// cron routes; it also runs after every webhook call. Safe to call at any time and as often as you like: an event is leased to one worker, so two calls never handle the same one.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = publicRoute({
  limits: [{ name: "cron", max: 120, windowSeconds: 60, by: "ip" }],
  handler: async ({ request }): Promise<{ data: WhatsAppSweepResult }> => {
    if (!sweepKeyMatches(request.headers.get("authorization"))) getCron().authorize(request);
    return { data: await runWhatsAppSweep() };
  },
});

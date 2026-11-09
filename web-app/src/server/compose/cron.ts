import "server-only";
import { getConfig } from "../config/env";
import { getLogger } from "../logger";
import { createCronService, type CronService } from "../services/cron/cronService";
import { getBackup } from "./backup";
import { getDailySummary } from "./dailySummary";
import { drainMailOnce } from "./mail";

// The composition root of the scheduled jobs (/api/v1/cron/*): CRON_SECRET from the environment and the mail queue's one pass.
let cron: CronService | null = null;

export function getCron(): CronService {
  cron ??= createCronService({
    secret: () => getConfig().CRON_SECRET,
    drainMail: drainMailOnce,
    dailySummary: () => getDailySummary().run(),
    backup: () => getBackup().run(),
    // Conversations (decision 66): loaded on the first call of its route only (the IMAP client and the hubs stay out of the other cron functions)
    conversations: () => import("./conversations").then((m) => m.runConversationsCron({ budgetMs: 40_000 })),
  });
  return cron;
}

/** At most this many calls hand the Conversations pass on (25 hotels a call: 5,000 hotels); the next scheduled call picks up what is left. */
export const CONVERSATIONS_MAX_HOPS = 200;

/** The rest of the Conversations pass in a new call (the pattern of continueDailySummary below); `hop` = how many calls handed it on so far. Never throws. */
export async function continueConversations(hop = 0): Promise<void> {
  const config = getConfig();
  const env = process.env;
  const next = Number.isInteger(hop) && hop >= 0 ? hop + 1 : CONVERSATIONS_MAX_HOPS;
  if (next >= CONVERSATIONS_MAX_HOPS) {
    getLogger().warn("conversations pass stopped handing on", { hops: next });
    return;
  }
  try {
    if (config.CRON_SECRET && env.VERCEL) {
      const host = config.HMS_PUBLIC_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : env.VERCEL_URL ? `https://${env.VERCEL_URL}` : `http://127.0.0.1:${env.PORT ?? "3000"}`);
      const r = await fetch(`${host.replace(/\/$/, "")}/api/v1/cron/conversations?detached=1&hop=${next}`, {
        headers: { authorization: `Bearer ${config.CRON_SECRET}`, ...(env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) },
      });
      await r.body?.cancel().catch(() => undefined);
      if (r.ok) return;
    }
    // in-process: passes one after another until nothing is left (bounded, so a fault can never loop forever)
    for (let i = 0; i < 20; i += 1) if (!(await getCron().conversations()).more) return;
  } catch (error) {
    getLogger().error("conversations pass could not continue", { error: error instanceof Error ? error.name : "unknown" });
  }
}

/** Replaces the cron service (tests). */
export function configureCron(next: CronService | null): void {
  cron = next;
}

/**
 * Hands the rest of the day's pass to a new call (a function lives 60 s, a pass over thousands of hotels needs several): a request to this app's own cron route with
 * the CRON_SECRET and `detached=1` (it answers at once and works in its own function time), else, with no self address (a PC, a VPS), the next call runs in-process.
 * Never throws; a call that cannot be started is picked up by the next scheduled call, which continues from the cursor.
 */
export async function continueDailySummary(): Promise<void> {
  const config = getConfig();
  const env = process.env;
  try {
    if (config.CRON_SECRET && env.VERCEL) {
      const host = config.HMS_PUBLIC_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : env.VERCEL_URL ? `https://${env.VERCEL_URL}` : `http://127.0.0.1:${env.PORT ?? "3000"}`);
      const r = await fetch(`${host.replace(/\/$/, "")}/api/v1/cron/daily-summary?detached=1`, {
        headers: { authorization: `Bearer ${config.CRON_SECRET}`, ...(env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) },
      });
      await r.body?.cancel().catch(() => undefined);
      if (r.ok) return;
    }
    // in-process: batches one after another until the pass is done (bounded, so a fault can never loop forever)
    for (let i = 0; i < 100; i += 1) if (!(await getCron().dailySummary()).more) return;
  } catch (error) {
    getLogger().error("daily summary could not continue", { error: error instanceof Error ? error.message : String(error) });
  }
}

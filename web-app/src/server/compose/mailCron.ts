import "server-only";
import { after } from "next/server";
import { getConfig } from "../config/env";
import { getLogger } from "../logger";
import { mailWake } from "../services/auth/mailWake";

// The mail worker's start on a serverless host (HMS_MAIL_WORKER=cron, what env.ts requires on Vercel), kept apart from compose/mail.ts on purpose: that module carries the
// whole sending side (nodemailer, the document renderer, the hotel mail router, billing) and the server start (src/instrumentation-node.ts) must not load it on every cold
// start. Here only the wake is wired: the request that queued a mail runs one drain right after it answered (next/server after()), loading compose/mail.ts at that moment;
// the scheduler calling GET /api/v1/cron/mail stays the safety net. In-process (a VPS, a PC) the full worker in compose/mail.ts is loaded and started instead.
let unsubscribe: (() => void) | undefined;
let inProcess: Promise<typeof import("./mail")> | undefined;

/** Starts the mail worker the way the configuration says. Idempotent. */
export async function startMailWorkerLazily(): Promise<void> {
  if (unsubscribe || inProcess) return;
  const config = getConfig();
  if (!config.DATABASE_URL || !config.HMS_HASH_KEY) return;
  if (config.HMS_MAIL_WORKER === "cron") {
    unsubscribe = mailWake.subscribe(() => {
      try {
        // a failed drain is left for the next one (the daily cron is the safety net), but its kind is logged: it used to vanish without a trace
        after(() => import("./mail").then((m) => m.drainMailOnce()).catch((e: unknown) => getLogger().error("mail drain after request failed", { error: e instanceof Error ? e.name : "Error" })));
      } catch {
        // outside a request (a script): the next cron call sends it
      }
    });
    return;
  }
  inProcess = import("./mail");
  (await inProcess).startMailWorker();
}

/** Stops what startMailWorkerLazily started (server stop). */
export function stopMailWorkerLazily(): void {
  unsubscribe?.();
  unsubscribe = undefined;
  const started = inProcess;
  inProcess = undefined;
  void started?.then((m) => m.stopMailWorker()).catch(() => undefined);
}

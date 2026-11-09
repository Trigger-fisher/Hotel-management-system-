// The server start on the Node runtime (loaded only from instrumentation.ts, never bundled for the edge).
// 1. The environment is checked at once: in production a missing or unsafe setting stops the server HERE, with the names (never the values) of what is
//    wrong, instead of failing on the first request. 2. Settings that start but leave something broken are WARNED (ops/notices.ts): photo storage on a
//    serverless host, and the database login when it is not hms_app (asked once with SELECT current_user; the name only, never the connection string; a one-time deploy
//    check, so it is skipped on Vercel where every cold start would otherwise open a connection to the far-away database before the first request). 3. The mail worker
//    starts (compose/mailCron.ts: on a serverless host only the wake is wired, the sending side is loaded by the first request that queues a mail). 4. A clean stop on
//    SIGTERM / SIGINT. This file stays thin on purpose: whatever it imports is loaded on every cold start of every function.
import { closeDatabase, getDatabase } from "./db";
import { startMailWorkerLazily, stopMailWorkerLazily } from "./server/compose/mailCron";
import { ConfigError, getConfig, type AppConfig } from "./server/config/env";
import { createShutdown } from "./server/ops/lifecycle";
import { APP_ROLE, databaseRole, deployNotices, roleNotice } from "./server/ops/notices";

export async function registerNode(): Promise<void> {
  let config: AppConfig;
  try {
    config = getConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\nThe server will not start. See docs/ENVIRONMENT.md.\n`);
      process.exit(1);
    }
    throw error;
  }
  const line = (level: "info" | "warn", message: string): void => void process.stdout.write(`${JSON.stringify({ level, message })}\n`);
  for (const notice of deployNotices(config, null)) line("warn", notice);
  if (config.DATABASE_URL && !config.VERCEL && process.env.NEXT_PHASE !== "phase-production-build") {
    void databaseRole(getDatabase().pool).then((role) => {
      if (role !== null && role !== APP_ROLE) line("warn", roleNotice(role));
    });
  }
  await startMailWorkerLazily();
  // the mail worker stops, the database pool is closed
  const stop = createShutdown({ stopWork: () => { stopMailWorkerLazily(); }, closeDatabase, log: (m) => line("info", m), exit: (code) => process.exit(code) });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => void stop(signal));
}

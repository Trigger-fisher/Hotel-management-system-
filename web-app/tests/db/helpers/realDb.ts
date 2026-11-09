// The real HMS PostgreSQL instance for the database suite (npm run test:db). Nothing here is a fake: it connects to the instance that
// `npm run db:cli -- setup` made, as hms_owner for set-up and as hms_app for everything the app does, both on the hms_test database.
// The URLs come from the env files (names PG_TEST_OWNER_URL and DATABASE_URL); a URL or password is never printed.
import path from "node:path";
import { createEnvStore } from "../../../../common/db/scripts/env-store";
import { connectPg, pgWithDatabase, type DbClient } from "../../../../common/db/scripts/pg-db";

export const TEST_DB = "hms_test";

const scriptEnv = createEnvStore(process.env.HMS_SCRIPT_ENV_FILE ?? path.join(__dirname, "..", "..", "..", "..", "common", "db", ".env.local"));
const appEnv = createEnvStore(process.env.HMS_APP_ENV_FILE ?? path.join(__dirname, "..", "..", "..", ".env.local"));

function need(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is missing: run  npm run db:cli -- setup  first`);
  return value;
}

export const ownerUrl = (): string => need(scriptEnv.get("PG_TEST_OWNER_URL"), "PG_TEST_OWNER_URL");
export const superUrl = (): string => pgWithDatabase(need(scriptEnv.get("PGSUPERUSER_URL"), "PGSUPERUSER_URL"), TEST_DB);
/** hms_app's login on the TEST database (the same password as DATABASE_URL). */
export const appUrl = (): string => pgWithDatabase(need(appEnv.get("DATABASE_URL"), "DATABASE_URL"), TEST_DB);

export const connectOwner = (): Promise<DbClient> => connectPg(ownerUrl());
export const connectApp = (): Promise<DbClient> => connectPg(appUrl());

/** The SQLSTATE a statement fails with (never the message, which may carry values); null when it succeeds. */
export async function sqlStateOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : "?";
  }
}

/** The constraint a failed statement names (a schema name, not a value). */
export async function constraintOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const constraint = (error as { constraint?: unknown }).constraint;
    return typeof constraint === "string" ? constraint : null;
  }
}

/** A short random tag for names that must not collide between runs. */
export const tag = (): string => Math.random().toString(36).slice(2, 10);

/**
 * The test database is shared by every session that runs the suites (and by `reset-test`): a file takes this lock in its first `before` and gives it
 * back in its last `after`, so two runs queue instead of wiping each other's hotels. A dedicated connection holds it (it is a session lock).
 */
export async function lockTestDatabase(): Promise<() => Promise<void>> {
  const holder = await connectOwner();
  // Waits at most 8 minutes for the lock (try, then sleep) instead of forever behind a stuck run; a file that then hangs is ended after 12 minutes,
  // so a failed file can never keep the lock (the lock belongs to the holder's session and goes when the process does).
  const deadline = Date.now() + 8 * 60_000;
  for (;;) {
    const got = await holder.query("SELECT pg_try_advisory_lock(7777) AS ok");
    if (got.rows[0].ok === true) break;
    if (Date.now() > deadline) {
      await holder.end();
      throw new Error("the test database lock (7777) stayed taken for 8 minutes");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  setTimeout(() => process.exit(1), 12 * 60_000).unref();
  return async () => {
    try {
      await holder.query("SELECT pg_advisory_unlock(7777)");
    } finally {
      await holder.end();
    }
  };
}

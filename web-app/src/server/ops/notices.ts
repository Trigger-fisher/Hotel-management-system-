import "server-only";
import { photoStorageUnavailable, type AppConfig } from "../config/env";
import type { PingPool } from "./lifecycle";

// Deployment warnings: settings that let the server start but leave something broken or unsafe. The server does NOT refuse to start for these (MJ); it
// says so loudly instead: one warn line at boot (src/instrumentation-node.ts) and the same sentences in System Health (`notices`). A sentence names a
// setting or a database login NAME, never a value (no connection string, no password).

/** The limited login the app is meant to connect as (db/ grants it only what the app needs). */
export const APP_ROLE = "hms_app";

export const PHOTO_STORAGE_NOTICE = "Photo storage is not set up on this server yet: uploads of photos are refused until MEDIA_DRIVER=s3 and the S3 settings are set.";
export const roleNotice = (role: string): string => `The app is connected to the database as ${role}, not ${APP_ROLE}: use the ${APP_ROLE} login in DATABASE_URL.`;

/** The notices for this configuration and the database login the app connects as (null = unknown: no database, or it did not answer). Pure. */
export function deployNotices(config: Pick<AppConfig, "VERCEL" | "MEDIA_DRIVER" | "DATABASE_URL">, role: string | null): string[] {
  const out: string[] = [];
  if (photoStorageUnavailable(config)) out.push(PHOTO_STORAGE_NOTICE);
  if (config.DATABASE_URL !== undefined && role !== null && role !== APP_ROLE) out.push(roleNotice(role));
  return out;
}

/** `SELECT current_user` on one pooled connection: the login's name, or null when the database does not answer. Never throws. */
export async function databaseRole(pool: PingPool): Promise<string | null> {
  try {
    const client = await pool.connect();
    try {
      const r = (await client.query("SELECT current_user AS role")) as { rows?: { role?: unknown }[] };
      const role = r.rows?.[0]?.role;
      return typeof role === "string" && role !== "" ? role : null;
    } finally {
      client.release();
    }
  } catch {
    return null;
  }
}

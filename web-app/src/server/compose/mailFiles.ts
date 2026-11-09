import "server-only";
import path from "node:path";
import { MAIL_FILES_KEEP_HOURS_DEFAULT, validMailFilesKeepHours } from "@shared/dashboards/mailFiles";
import { getConfig } from "../config/env";
import { getDatabase } from "../../db";
import { createMailFiles, type MailFiles } from "../mail/files";
import { createLocalObjects, createS3Objects } from "../media/s3Objects";

// Where the files of an email wait (mail/files.ts): the private bucket on a server with MEDIA_DRIVER=s3 (the browser uploads straight to it), the local disk when running on this machine,
// and nothing on a host whose disk does not last (Vercel without the bucket): there the service answers a plain sentence and no file is accepted.

let made: { files: MailFiles | null } | null = null;

/** The Super Admin's keep time (Platform settings > Email files), read at most once a minute. A missing or unreadable row is the default hour. */
let keep: { ms: number; at: number } | null = null;
async function keepAfterSendMs(): Promise<number> {
  const nowMs = Date.now();
  if (keep && nowMs - keep.at < 60_000) return keep.ms;
  let hours = MAIL_FILES_KEEP_HOURS_DEFAULT;
  if (getConfig().DATABASE_URL) {
    const client = await getDatabase().pool.connect();
    try {
      const rows = (await client.query("SELECT value FROM platform.platform_settings WHERE key = 'mail.files_keep_hours'")).rows as { value: unknown }[];
      if (validMailFilesKeepHours(rows[0]?.value)) hours = rows[0].value;
    } finally {
      client.release();
    }
  }
  keep = { ms: hours * 3_600_000, at: nowMs };
  return keep.ms;
}

export function getMailFiles(): MailFiles | null {
  if (made) return made.files;
  const config = getConfig();
  let files: MailFiles | null = null;
  const { S3_ENDPOINT: endpoint, S3_REGION: region, S3_BUCKET: bucket, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = config;
  if (config.MEDIA_DRIVER === "s3" && endpoint && region && bucket && accessKeyId && secretAccessKey) {
    files = createMailFiles(createS3Objects({ endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle: config.S3_FORCE_PATH_STYLE === "1" }), () => new Date(), { keepAfterSendMs });
  } else if (!config.VERCEL) {
    const media = config.HMS_MEDIA_DIR ?? path.join(process.cwd(), ".data", "media");
    files = createMailFiles(createLocalObjects(path.dirname(media)), () => new Date(), { keepAfterSendMs });
  }
  made = { files };
  return files;
}

/** Replaces the store of the files of an email (tests). */
export function configureMailFiles(next: MailFiles | null): void {
  made = { files: next };
}

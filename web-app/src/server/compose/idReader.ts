import "server-only";
import { createSharedPool, type SharedPool } from "../../db/pool";
import { getConfig, type AppConfig } from "../config/env";
import { readIntakeSettings } from "../intake/settings";
import { presignGetUrl } from "../intake/presign";
import { wrapJobKey } from "../intake/wrap";
import { createS3Objects } from "../media/s3Objects";
import { createIdReadService, type IdReadService, type ReaderBridge } from "../services/frontOffice/idReadService";
import type { IntakeJobState } from "../services/frontOffice/idReading";
import { billingDefaults } from "./billing";

/** The five bucket settings the intake pictures need are all present (the bucket the check-in photos already use). */
const s3Ready = (c: AppConfig): boolean => Boolean(c.S3_ENDPOINT && c.S3_REGION && c.S3_BUCKET && c.S3_ACCESS_KEY_ID && c.S3_SECRET_ACCESS_KEY);

// The ID reader bridge: the queue is the intake_jobs table of INTAKE_QUEUE_DATABASE_URL (common/db/migrations/platform/0197_intake_jobs.sql), the pictures wait in the private bucket
// under intake-quarantine/ for the worker's signed links. Not connected (a setting missing, or no bucket) means no bridge at all and the check-in is typed by hand.
const FOLDER = "intake-quarantine/";
const KEEP_MS = 30 * 60 * 1000;
const SWEEP_EVERY_MS = 5 * 60 * 1000;

let pool: SharedPool | null = null;
let service: IdReadService | null = null;
let swept = 0;

function createBridge(): ReaderBridge | null {
  const settings = readIntakeSettings();
  const config = getConfig();
  if (!settings || !s3Ready(config)) return null;
  const access = {
    endpoint: config.S3_ENDPOINT as string,
    region: config.S3_REGION as string,
    bucket: config.S3_BUCKET as string,
    accessKeyId: config.S3_ACCESS_KEY_ID as string,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY as string,
    forcePathStyle: config.S3_FORCE_PATH_STYLE === "1",
  };
  const objects = createS3Objects(access);
  const queue = (): SharedPool => (pool ??= createSharedPool({ databaseUrl: settings.queueUrl, max: 3, min: 0, pooled: /:6543\//.test(settings.queueUrl) }));
  const run = async (text: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
    const client = await queue().connect();
    try {
      return (await client.query(text, params)).rows as Record<string, unknown>[];
    } finally {
      client.release();
    }
  };
  const doubt = <T>(v: unknown): T | null => (v !== null && typeof v === "object" ? (v as T) : null);
  return {
    async insert(job) {
      await run(
        "INSERT INTO public.intake_jobs (id, hotel_id, status, download_url, upload_url, wrapped_key) VALUES ($1::uuid, $2::uuid, 'queued', $3, $4, $5)",
        [job.id, job.hotelId, job.downloadUrl, job.uploadUrl, job.wrappedKey],
      );
    },
    async states(hotelId, ids) {
      const rows = await run(
        "SELECT id, status, reason_code, message, document_type_read, fields, clarity FROM public.intake_jobs WHERE hotel_id = $1::uuid AND id = ANY($2::uuid[])",
        [hotelId, ids],
      );
      return rows.map(
        (r): IntakeJobState => ({
          id: String(r.id),
          status: String(r.status),
          reasonCode: typeof r.reason_code === "string" ? r.reason_code : null,
          message: typeof r.message === "string" ? r.message : null,
          documentType: doubt(r.document_type_read),
          fields: doubt(r.fields),
          clarity: doubt(r.clarity),
        }),
      );
    },
    put: (key, bytes) => objects.put(key, bytes),
    readUrl: (key, seconds) => presignGetUrl(access, key, seconds, new Date()),
    writeUrl: (key, seconds) => (objects.presignPut as (key: string, seconds: number) => string)(key, seconds),
    wrap: (hotelId) => wrapJobKey(settings.masterKey, hotelId),
    async sweep() {
      if (Date.now() - swept < SWEEP_EVERY_MS) return;
      swept = Date.now();
      try {
        const old = (await objects.list(FOLDER)).filter((o) => Date.now() - o.modified.getTime() > KEEP_MS).slice(0, 60);
        for (const o of old) await objects.remove(o.key).catch(() => undefined);
      } catch {
        // the next call tries again
      }
    },
  };
}

export function getIdReader(): IdReadService {
  service ??= createIdReadService({ ...billingDefaults(), bridge: createBridge() });
  return service;
}

/** Replaces the reader (tests). */
export function configureIdReader(next: IdReadService | null): void {
  service = next;
}

import "server-only";
import { createHash } from "node:crypto";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import type { RawObjects } from "../mail/files";
import { createS3Objects } from "../media/s3Objects";
import { createPlatformUnit } from "../repos/postgres/platformUnit";
import { whatsappConfig } from "../whatsapp/config";
import { createGraphClient } from "../whatsapp/graph";
import type { InboundMessage, SaveTarget } from "../whatsapp/inbound";
import { captureMedia, DEFAULT_MEDIA_POLICY, purgeOldMedia, type MediaPolicy, type MediaScope } from "../whatsapp/media";
import type { WaLine } from "../whatsapp/ports";
import { openToken } from "../whatsapp/seal";

// The composition of WhatsApp media (phase 4): the private bucket (the same one the website photos and the files of an email use; WhatsApp has its own folders in it: whatsapp/hotels/<hotel id>/ and
// whatsapp/platform/), and the step that downloads a guest's file on the line's own token and keeps it. Without a bucket nothing is kept and the chat says so.
let objects: { value: RawObjects | null } | null = null;

export function getWhatsAppObjects(): RawObjects | null {
  if (objects) return objects.value;
  const c = getConfig();
  const { S3_ENDPOINT: endpoint, S3_REGION: region, S3_BUCKET: bucket, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = c;
  objects = { value: endpoint && region && bucket && accessKeyId && secretAccessKey ? createS3Objects({ endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle: c.S3_FORCE_PATH_STYLE === "1" }) : null };
  return objects.value;
}

/** Replaces the bucket (tests). */
export function configureWhatsAppObjects(next: RawObjects | null): void {
  objects = { value: next };
}

const platformUnit = () => createPlatformUnit(getDatabase().pool, (db) => db);

/** The Super Admin's file size and keep times (Rules screen), with the defaults and bounds of the Rules service for a missing or odd value. Read at most every 30 seconds. */
let cached: { at: number; policy: MediaPolicy } | null = null;
export async function mediaPolicy(): Promise<MediaPolicy> {
  const nowMs = Date.now();
  if (cached && nowMs - cached.at < 30_000) return cached.policy;
  let policy = DEFAULT_MEDIA_POLICY;
  try {
    const rows = (await platformUnit().read((db) => db.query("SELECT key, value FROM platform.platform_settings WHERE key IN ('whatsapp.media_max_mb', 'whatsapp.media_keep_days', 'whatsapp.media_keep_days_platform')"))).rows;
    const v = new Map(rows.map((r) => [String(r.key), r.value]));
    const n = (key: string, lo: number, hi: number, fallback: number): number => {
      const x = v.get(key);
      return typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi ? x : fallback;
    };
    policy = { maxBytes: n("whatsapp.media_max_mb", 1, 50, 16) * 1024 * 1024, keepDaysHotel: n("whatsapp.media_keep_days", 1, 365, 30), keepDaysPlatform: n("whatsapp.media_keep_days_platform", 1, 365, 30) };
  } catch {
    // unreadable settings: the defaults, never a guest's file refused for that
  }
  cached = { at: nowMs, policy };
  return policy;
}

/** Which folder a message belongs to: the hotel's own; on the platform side the company number's shared folder, or, for a personal number, the folder of its owner's role. */
async function scopeOf(target: SaveTarget, line: WaLine): Promise<MediaScope> {
  if (target.kind === "hotel") return { kind: "hotel", hotelId: target.hotelId };
  if (line.kind !== "person") return { kind: "platform", folder: "platform" };
  const r = await platformUnit().read((db) =>
    db.query(
      `SELECT EXISTS (SELECT 1 FROM platform.super_admins s WHERE s.login_id = l.owner_login_id) AS super_admin,
              EXISTS (SELECT 1 FROM platform.platform_admins p WHERE p.login_id = l.owner_login_id) AS platform_admin
         FROM platform.whatsapp_lines l WHERE l.id = $1`,
      [line.id],
    ),
  );
  const row = r.rows[0];
  return { kind: "platform", folder: row?.super_admin === true ? "super-admin" : row?.platform_admin === true ? "platform-admin" : "platform" };
}
/** A name for the object that never comes from the guest: a hash of the line and the message id. */
export const mediaIdOf = (lineId: string, wamid: string): string => createHash("sha256").update(`${lineId}:${wamid}`).digest("hex").slice(0, 32);

/** The step the inbound path calls for a message with a file: downloads it, checks it, keeps it, and answers what to write into the message's media record. Never throws. */
export function createMediaCapturer(): { capture(target: SaveTarget, line: WaLine, message: InboundMessage): Promise<Record<string, unknown> | null> } {
  return {
    async capture(target, line, m) {
      const cfg = whatsappConfig();
      if (!cfg || !m.media) return null;
      try {
        const r = await createPlatformUnit(getDatabase().pool, (db) => db).read((db) => db.query("SELECT token_secret FROM platform.whatsapp_lines WHERE id = $1", [line.id]));
        if (!r.rows[0]) return null;
        const token = openToken(cfg.sealKey, String(r.rows[0].token_secret), line.phoneNumberId);
        const media = m.media as { kind?: unknown; id?: unknown; mime?: unknown };
        const policy = await mediaPolicy();
        const out = await captureMedia({ objects: getWhatsAppObjects(), graph: createGraphClient({ graphVersion: cfg.graphVersion }) }, { token, scope: await scopeOf(target, line), messageId: mediaIdOf(line.id, m.wamid), kind: String(media.kind ?? ""), mediaId: typeof media.id === "string" ? media.id : null, declaredMime: typeof media.mime === "string" ? media.mime : null, maxBytes: policy.maxBytes });
        return out.stored ? { stored: true, key: out.key, size: out.size, mime: out.mime, inline: out.inline } : { stored: false, reason: out.reason };
      } catch {
        return { stored: false, reason: "download_failed" };
      }
    },
  };
}

/**
 * "Can this server keep the guests' files?" The Console's check: one tiny test file is written to the WhatsApp folder of the bucket, its size read, its bytes read back and compared, and it is deleted.
 * The answer is a plain sentence; no key, address or bucket name is in it.
 */
export async function checkWhatsAppStorage(): Promise<{ ok: boolean; message: string }> {
  const o = getWhatsAppObjects();
  if (!o) return { ok: false, message: "File storage is not set up on this server (the S3 settings are missing), so guests' files are not kept." };
  const key = `whatsapp/_check/${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 16)}.txt`;
  const bytes = new TextEncoder().encode("hms storage check");
  try {
    await o.put(key, bytes);
    const size = await o.size(key);
    const back = await o.get(key);
    await o.remove(key);
    const gone = await o.size(key);
    if (size !== bytes.length || !back || new TextDecoder().decode(back) !== "hms storage check") return { ok: false, message: "The file storage accepted a test file but did not give the same bytes back." };
    if (gone !== null) return { ok: false, message: "The file storage did not delete the test file. Check the bucket's permissions." };
    return { ok: true, message: "File storage works: a test file was written, read back and deleted. Guests' files go to the hotel's own folder, and the Super Admin's and Platform Admin's to theirs." };
  } catch {
    await o.remove(key).catch(() => undefined);
    return { ok: false, message: "The file storage could not be reached or refused the test file. Check the S3 settings and the bucket's permissions." };
  }
}

/** The sweep's housekeeping: files older than the keep time leave the bucket. Zero without a bucket; never throws. */
export async function purgeWhatsAppMedia(now: Date): Promise<number> {
  const o = getWhatsAppObjects();
  if (!o) return 0;
  const p = await mediaPolicy();
  return purgeOldMedia(o, now, { hotel: p.keepDaysHotel, platform: p.keepDaysPlatform }).catch(() => 0);
}

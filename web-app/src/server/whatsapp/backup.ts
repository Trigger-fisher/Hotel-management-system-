import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { RawObjects } from "../mail/files";

// The encrypted backup of WhatsApp chats (phase 4). The nightly backup of the hotels' data deliberately leaves every conversation table out (their content is private), so WhatsApp has its own copy:
// ONE file per hotel per day, and one for the platform side, holding that scope's WhatsApp chats (messages, conversations, contacts and their phone handles), its message library, opt-outs, the month's
// counts, campaigns and the guests' agreements. The file is compressed, then encrypted with AES-256-GCM before it leaves the server (a key derived from HMS_HASH_KEY, or WHATSAPP_BACKUP_KEY), bound to its
// scope and day, so the bucket never holds a readable chat and a file copied to another name does not open. A guest's own files (photos and so on) are not copied: they already sit in the same private
// bucket, which keeps its own copies. Old copies are removed after the keep days the Super Admin sets. Nothing here logs content.
export const BACKUP_INFO = "hms-whatsapp-backup-v1";
export const BACKUP_PREFIX = "whatsapp-backups/";
const MAGIC = Buffer.from("HMSWAB1\n", "utf8");
export const BACKUP_KEEP_DAYS = 14;

/** The backup key: WHATSAPP_BACKUP_KEY (base64 of 32 bytes) when set, else derived from the server's hash key. */
export function backupKeyOf(hashKey: Buffer, override?: string | null): Buffer {
  const o = (override ?? "").trim();
  if (o !== "") {
    const k = Buffer.from(o, "base64");
    if (k.length === 32) return k;
  }
  return Buffer.from(hkdfSync("sha256", hashKey, Buffer.alloc(0), BACKUP_INFO, 32));
}

export type BackupScope = { kind: "hotel"; hotelId: string } | { kind: "platform" };
const scopeName = (s: BackupScope): string => (s.kind === "hotel" ? `hotels/${s.hotelId}` : "platform");
/** The day a copy belongs to, in India's time (the hotels' day). */
export const backupDay = (now: Date): string => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
export const backupKey = (s: BackupScope, day: string): string => `${BACKUP_PREFIX}${scopeName(s)}/${day}.ndjson.gz.enc`;
const aad = (s: BackupScope, day: string): Buffer => Buffer.from(`hms:whatsapp:backup:${scopeName(s)}:${day}`, "utf8");

/** compress, then encrypt: MAGIC + iv(12) + tag(16) + ciphertext. */
export function encryptBackup(key: Buffer, ndjson: string, scope: BackupScope, day: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(scope, day));
  const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(ndjson, "utf8"))), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

/** The ndjson of a copy, or throws "The backup could not be opened" (wrong key, another scope or day, or a damaged file). */
export function decryptBackup(key: Buffer, blob: Uint8Array, scope: BackupScope, day: string): string {
  const b = Buffer.from(blob);
  try {
    if (b.length < MAGIC.length + 28 || !b.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("format");
    const iv = b.subarray(MAGIC.length, MAGIC.length + 12);
    const tag = b.subarray(MAGIC.length + 12, MAGIC.length + 28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad(scope, day));
    decipher.setAuthTag(tag);
    return gunzipSync(Buffer.concat([decipher.update(b.subarray(MAGIC.length + 28)), decipher.final()])).toString("utf8");
  } catch {
    throw new Error("The backup could not be opened");
  }
}

/** Where the rows come from: the list of hotels with WhatsApp, and one scope's rows as ndjson (one JSON object per line: {"t": table, "r": row}). */
export interface BackupSource {
  hotelIds(): Promise<string[]>;
  exportScope(scope: BackupScope): Promise<string>;
}

export interface BackupRunDeps {
  source: BackupSource;
  objects: RawObjects;
  key: Buffer;
  now: Date;
  /** Days a copy is kept. */
  keepDays?: number;
  /** At most this many new copies in one call (a long list is done over several sweeps). */
  limit?: number;
}
export interface BackupRunResult {
  written: number;
  alreadyDone: number;
  removed: number;
  failed: number;
  /** Scopes that still have no copy for today after this call. */
  remaining: number;
}

/** One pass: a copy for every scope that has none today (up to the limit), then the copies past their keep days are removed. A scope that fails is counted and does not stop the others. */
export async function runBackup(deps: BackupRunDeps): Promise<BackupRunResult> {
  const day = backupDay(deps.now);
  const limit = deps.limit ?? 3;
  const scopes: BackupScope[] = [{ kind: "platform" }, ...(await deps.source.hotelIds()).map((hotelId): BackupScope => ({ kind: "hotel", hotelId }))];
  const out: BackupRunResult = { written: 0, alreadyDone: 0, removed: 0, failed: 0, remaining: 0 };
  for (const scope of scopes) {
    const key = backupKey(scope, day);
    if ((await deps.objects.size(key).catch(() => null)) !== null) {
      out.alreadyDone += 1;
      continue;
    }
    if (out.written + out.failed >= limit) {
      out.remaining += 1;
      continue;
    }
    try {
      const ndjson = await deps.source.exportScope(scope);
      await deps.objects.put(key, encryptBackup(deps.key, ndjson, scope, day));
      out.written += 1;
    } catch {
      out.failed += 1;
    }
  }
  const cutoff = deps.now.getTime() - (deps.keepDays ?? BACKUP_KEEP_DAYS) * 86_400_000;
  for (const o of await deps.objects.list(BACKUP_PREFIX).catch(() => [])) {
    if (o.modified.getTime() < cutoff) {
      await deps.objects.remove(o.key).catch(() => undefined);
      out.removed += 1;
    }
  }
  return out;
}

export interface BackupVerification {
  ok: boolean;
  /** Copies opened (the newest of each scope). */
  checked: number;
  lines: number;
  /** The newest day found, or null when there is none. */
  newestDay: string | null;
  /** One plain sentence. */
  message: string;
}

/** Opens the newest copy of every scope (decrypts, decompresses, counts the lines, checks the header) without restoring anything. */
export async function verifyBackups(deps: { objects: RawObjects; key: Buffer }): Promise<BackupVerification> {
  const all = await deps.objects.list(BACKUP_PREFIX);
  const newest = new Map<string, string>();
  for (const o of all) {
    const m = /^whatsapp-backups\/((?:hotels\/[0-9a-f-]{36})|platform)\/(\d{4}-\d{2}-\d{2})\.ndjson\.gz\.enc$/.exec(o.key);
    if (m && (newest.get(m[1]) ?? "") < m[2]) newest.set(m[1], m[2]);
  }
  if (newest.size === 0) return { ok: false, checked: 0, lines: 0, newestDay: null, message: "There is no WhatsApp backup yet. Use Back up now, or wait for the nightly copy (about 3 am India time)." };
  let lines = 0;
  let latest = "";
  for (const [name, day] of newest) {
    const scope: BackupScope = name === "platform" ? { kind: "platform" } : { kind: "hotel", hotelId: name.slice("hotels/".length) };
    const blob = await deps.objects.get(backupKey(scope, day));
    if (!blob) return { ok: false, checked: 0, lines, newestDay: null, message: "A backup file listed in the bucket could not be read." };
    try {
      const text = decryptBackup(deps.key, blob, scope, day);
      const rows = text.split("\n").filter((l) => l !== "");
      const header = JSON.parse(rows[0] ?? "{}") as { t?: string; scope?: string; day?: string };
      if (header.t !== "_header" || header.scope !== name || header.day !== day) throw new Error("header");
      lines += rows.length - 1;
    } catch {
      return { ok: false, checked: 0, lines, newestDay: null, message: "A backup could not be opened with this server's key (the key changed, or the file is damaged). Do not delete it: keep the old key until it is restored." };
    }
    if (day > latest) latest = day;
  }
  return { ok: true, checked: newest.size, lines, newestDay: latest, message: `${newest.size} backup${newest.size === 1 ? "" : "s"} opened and checked (the newest is from ${latest}, ${lines} rows in all). Nothing was changed.` };
}

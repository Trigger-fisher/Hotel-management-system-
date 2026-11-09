import "server-only";
import { getDatabase } from "../../db";
import type { SqlClient } from "../../db/types";
import { createPlatformUnit } from "../repos/postgres/platformUnit";
import { whatsappConfig } from "../whatsapp/config";
import { BACKUP_KEEP_DAYS, backupDay, backupKeyOf, runBackup, verifyBackups, type BackupRunResult, type BackupScope, type BackupSource, type BackupVerification } from "../whatsapp/backup";
import { getWhatsAppObjects } from "./whatsappMedia";

// The composition of the encrypted WhatsApp backup (whatsapp/backup.ts): the rows of one scope read page by page (read-only), the bucket, the key and the keep days the Super Admin sets (Rules screen).
const PAGE = 2000;
const platformUnit = () => createPlatformUnit(getDatabase().pool, (db) => db);

/** One table's rows as ndjson lines, 2000 at a time in id order. `where` may use the schema prefix `p`. */
async function dump(db: SqlClient, table: string, where: string, out: string[]): Promise<void> {
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const r = await db.query(`SELECT id, to_jsonb(t) AS r FROM ${table} t WHERE ${where} AND t.id > $1::uuid ORDER BY t.id LIMIT ${PAGE}`, [last]);
    for (const row of r.rows) out.push(JSON.stringify({ t: table.replace(/^platform\./, ""), r: row.r }));
    if (r.rows.length < PAGE) return;
    last = String(r.rows[r.rows.length - 1].id);
  }
}

/** The chats of one place: the WhatsApp messages, their conversations, contacts and phone handles (the same four tables on the platform side and in a hotel). */
async function chats(db: SqlClient, p: "" | "platform.", out: string[]): Promise<void> {
  const convs = `SELECT conversation_id FROM ${p}conv_messages WHERE channel = 'whatsapp'`;
  const contacts = `SELECT contact_id FROM ${p}conv_conversations WHERE id IN (${convs})`;
  await dump(db, `${p}conv_messages`, `t.channel = 'whatsapp'`, out);
  await dump(db, `${p}conv_conversations`, `t.id IN (${convs})`, out);
  await dump(db, `${p}conv_contacts`, `t.id IN (${contacts})`, out);
  await dump(db, `${p}conv_contact_handles`, `t.contact_id IN (${contacts})`, out);
}

export function createPgBackupSource(now: () => Date, db: () => Pick<ReturnType<typeof getDatabase>, "pool" | "withHotel"> = getDatabase): BackupSource {
  const platform = () => createPlatformUnit(db().pool, (x) => x);
  const header = (scope: BackupScope): string => JSON.stringify({ t: "_header", v: 1, scope: scope.kind === "hotel" ? `hotels/${scope.hotelId}` : "platform", day: backupDay(now()), at: now().toISOString() });
  return {
    async hotelIds() {
      const r = await platform().read((q) => q.query("SELECT DISTINCT lh.hotel_id FROM platform.whatsapp_line_hotels lh JOIN platform.hotels h ON h.id = lh.hotel_id WHERE h.deleted_at IS NULL ORDER BY lh.hotel_id"));
      return r.rows.map((x) => String(x.hotel_id));
    },
    async exportScope(scope) {
      const out: string[] = [header(scope)];
      if (scope.kind === "platform") {
        await platform().read((q) => chats(q, "platform.", out));
      } else {
        await db().withHotel({ hotelId: scope.hotelId, readOnly: true }, async (tx) => {
          await chats(tx, "", out);
          for (const table of ["wa_templates", "wa_optouts", "wa_usage", "wa_campaigns", "wa_campaign_recipients"]) await dump(tx, table, "true", out);
          // the guests' agreement to WhatsApp messages (who and when), not the rest of the guest record
          const consent = await tx.query("SELECT id, wa_consent_at, wa_consent_by FROM customers WHERE wa_consent_at IS NOT NULL ORDER BY id");
          for (const row of consent.rows) out.push(JSON.stringify({ t: "customer_consent", r: row }));
        });
      }
      return out.join("\n") + "\n";
    },
  };
}

/** The keep days of the copies (whatsapp.backup_keep_days, 1 to 365; 14 when missing). */
async function keepDays(): Promise<number> {
  try {
    const r = await platformUnit().read((db) => db.query("SELECT value FROM platform.platform_settings WHERE key = 'whatsapp.backup_keep_days'"));
    const v = r.rows[0]?.value;
    return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 365 ? v : BACKUP_KEEP_DAYS;
  } catch {
    return BACKUP_KEEP_DAYS;
  }
}

const NOT_READY = "WhatsApp backups need WhatsApp to be set up on the server and the file storage (S3) to be present.";
function parts(): { objects: NonNullable<ReturnType<typeof getWhatsAppObjects>>; key: Buffer } | null {
  const cfg = whatsappConfig();
  const objects = getWhatsAppObjects();
  return cfg && objects ? { objects, key: backupKeyOf(cfg.hashKey, process.env.WHATSAPP_BACKUP_KEY) } : null;
}

/** India's 3 am to 5 am: the nightly window of the sweep. */
export const inBackupWindow = (now: Date): boolean => [3, 4].includes(Number(new Date(now.getTime() + 330 * 60_000).toISOString().slice(11, 13)));

/** One pass of the backup (the nightly sweep calls it in the window with a small limit; the Console's "Back up now" with a bigger one). Never throws. */
export async function runWhatsAppBackup(now: Date, limit = 3): Promise<BackupRunResult | null> {
  const p = parts();
  if (!p) return null;
  return runBackup({ source: createPgBackupSource(() => now), objects: p.objects, key: p.key, now, limit, keepDays: await keepDays() }).catch(() => ({ written: 0, alreadyDone: 0, removed: 0, failed: 1, remaining: 0 }));
}

/** The Console's "Back up now": a pass for every scope that has no copy today, in one call (up to 10). Plain sentence back. */
export async function backupWhatsAppNow(): Promise<{ ok: boolean; message: string }> {
  const r = await runWhatsAppBackup(new Date(), 10);
  if (!r) return { ok: false, message: NOT_READY };
  if (r.failed > 0) return { ok: false, message: `${r.written} backup${r.written === 1 ? "" : "s"} written, ${r.failed} failed. Check the file storage and try again.` };
  return { ok: true, message: r.written === 0 && r.remaining === 0 ? "Every scope already has today's backup." : `${r.written} backup${r.written === 1 ? "" : "s"} written${r.alreadyDone ? `, ${r.alreadyDone} were already done today` : ""}${r.remaining ? `, ${r.remaining} more will follow in the next minutes` : ""}.` };
}

/** The Console's "Verify backups": opens the newest copy of every scope. */
export async function verifyWhatsAppBackups(): Promise<BackupVerification | { ok: false; message: string }> {
  const p = parts();
  if (!p) return { ok: false, message: NOT_READY };
  try {
    return await verifyBackups(p);
  } catch {
    return { ok: false, message: "The backups could not be read. Check the file storage." };
  }
}

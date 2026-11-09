import "server-only";
import type { ClientPool } from "../../../db/withHotel";
import type { CreateLineResult, LineAdminStore, LinePatch, LineRecord, WaQuality } from "../../services/whatsapp/connectionPorts";
import type { WaLineKind, WaLineStatus } from "../../whatsapp/ports";

// The PostgreSQL side of the connection manager (platform migration 0180). One statement per call, except create (the line and, for a hotel's own line, its attachment commit together).
// The sealed columns are read and written as sealed text only.
type Query = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;

async function session<T>(pool: ClientPool, work: (q: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  const onError = (): void => {
    broken = true;
  };
  client.on("error", onError);
  try {
    return await work((text, params) => client.query(text, params) as Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>);
  } finally {
    client.removeListener("error", onError);
    client.release(broken);
  }
}

// the person's name comes from the profile list (platform.users was retired by migration 0155; the same list the sign-in reads)
const SELECT = `SELECT l.*, u.display_name AS connected_by_name,
  (SELECT count(*)::int FROM platform.whatsapp_line_hotels h WHERE h.line_id = l.id AND h.valid_to IS NULL) AS hotels_attached
  FROM platform.whatsapp_lines l LEFT JOIN platform.login_profiles u ON u.login_id = l.connected_by`;

const when = (v: unknown): Date | null => (v instanceof Date ? v : v === null || v === undefined ? null : new Date(String(v)));
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function recordOf(r: Record<string, unknown>): LineRecord {
  return {
    id: String(r.id), kind: String(r.kind) as WaLineKind, phoneNumberId: String(r.phone_number_id), wabaId: String(r.waba_id), displayPhone: text(r.display_phone), displayName: text(r.display_name),
    status: String(r.status) as WaLineStatus, quality: String(r.quality) as WaQuality, ownerLoginId: text(r.owner_login_id), tokenSecret: String(r.token_secret), pinSecret: text(r.pin_secret),
    managed: r.managed === true, webhookSubscribed: r.webhook_subscribed === true, subscribedFields: Array.isArray(r.subscribed_fields) ? r.subscribed_fields.map(String) : [],
    lastEventAt: when(r.last_event_at), registered: r.registered === true, nameStatus: text(r.name_status), messagingTier: text(r.messaging_tier), tokenCheckedAt: when(r.token_checked_at),
    lastVerifiedAt: when(r.last_verified_at), lastErrorCode: text(r.last_error_code), lastErrorAt: when(r.last_error_at), tokenFailures: Number(r.token_failures ?? 0),
    connectedBy: text(r.connected_by), connectedByName: text(r.connected_by_name), connectedAt: when(r.connected_at), createdAt: when(r.created_at) ?? new Date(0), hotelsAttached: Number(r.hotels_attached ?? 0),
  };
}

/** Patch field to column. Every name here is fixed in code; a value always travels as a parameter. */
const COLUMNS: Readonly<Record<keyof LinePatch, string>> = {
  displayPhone: "display_phone", displayName: "display_name", status: "status", quality: "quality", tokenSecret: "token_secret", pinSecret: "pin_secret", webhookSubscribed: "webhook_subscribed",
  subscribedFields: "subscribed_fields", registered: "registered", nameStatus: "name_status", messagingTier: "messaging_tier", tokenCheckedAt: "token_checked_at", lastVerifiedAt: "last_verified_at",
  lastErrorCode: "last_error_code", lastErrorAt: "last_error_at", tokenFailures: "token_failures",
};

export function createPgLineAdminStore(pool: ClientPool): LineAdminStore {
  return {
    list: () => session(pool, async (q) => (await q(`${SELECT} ORDER BY l.created_at, l.id`)).rows.map(recordOf)),
    get: (id) =>
      session(pool, async (q) => {
        const r = await q(`${SELECT} WHERE l.id = $1`, [id]);
        return r.rows[0] ? recordOf(r.rows[0]) : null;
      }),
    create: (input) =>
      session(pool, async (q): Promise<CreateLineResult> => {
        await q("BEGIN");
        try {
          const ins = await q(
            "INSERT INTO platform.whatsapp_lines (kind, phone_number_id, waba_id, token_secret, owner_login_id, connected_by, connected_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
            [input.kind, input.phoneNumberId, input.wabaId, input.tokenSecret, input.ownerLoginId, input.connectedBy, input.at],
          );
          const id = String(ins.rows[0].id);
          // a hotel's own number belongs to that hotel from the start (the trigger fills `own` from the line's kind)
          if (input.kind === "hotel" && input.hotelId !== null) await q("INSERT INTO platform.whatsapp_line_hotels (line_id, hotel_id, state) VALUES ($1, $2, 'pending')", [id, input.hotelId]);
          await q("COMMIT");
          const r = await q(`${SELECT} WHERE l.id = $1`, [id]);
          return { ok: true, line: recordOf(r.rows[0]) };
        } catch (e) {
          await q("ROLLBACK").catch(() => undefined);
          const x = e as { code?: string; constraint?: string };
          if (x.code === "23505") {
            if (x.constraint === "whatsapp_lines_phone_number_id_key") return { ok: false, reason: "number_taken" };
            if (x.constraint === "whatsapp_lines_one_platform_key") return { ok: false, reason: "platform_exists" };
            if (x.constraint === "whatsapp_line_hotels_one_own_key") return { ok: false, reason: "hotel_has_own_line" };
          }
          throw e;
        }
      }),
    update: (id, patch, at) =>
      session(pool, async (q) => {
        const keys = (Object.keys(patch) as (keyof LinePatch)[]).filter((k) => patch[k] !== undefined);
        if (keys.length > 0) {
          const sets = keys.map((k, i) => `${COLUMNS[k]} = $${i + 3}`);
          const r = await q(`UPDATE platform.whatsapp_lines SET ${sets.join(", ")}, updated_at = $2 WHERE id = $1`, [id, at, ...keys.map((k) => patch[k])]);
          if ((r.rowCount ?? 0) === 0) return null;
        }
        const r = await q(`${SELECT} WHERE l.id = $1`, [id]);
        return r.rows[0] ? recordOf(r.rows[0]) : null;
      }),
    hotelExists: (hotelId) => session(pool, async (q) => (await q("SELECT 1 FROM platform.hotels WHERE id = $1", [hotelId])).rows.length > 0),
    loginExists: (loginId) => session(pool, async (q) => (await q("SELECT 1 FROM platform.logins WHERE id = $1 AND deleted_at IS NULL", [loginId])).rows.length > 0),
  };
}

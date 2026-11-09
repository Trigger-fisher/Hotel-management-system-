import "server-only";
import type { ClientPool } from "../../../db/withHotel";
import type { MoveState, MoveStore } from "../../whatsapp/move";

// The hotel's move to its own number on PostgreSQL (platform.whatsapp_line_hotels, the hotel's own row). One statement per call on the shared pool (hms_app).
type Q = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function one<T>(pool: ClientPool, work: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  const onError = (): void => {
    broken = true;
  };
  client.on("error", onError);
  try {
    return await work((text, params) => client.query(text, params) as ReturnType<Q>);
  } finally {
    client.removeListener("error", onError);
    client.release(broken);
  }
}

export function createPgMoveStore(pool: ClientPool): MoveStore {
  return {
    view: (hotelId) =>
      one(pool, async (q) => {
        if (!UUID.test(hotelId)) return null;
        const r = await q(
          `SELECT h.name, l.id AS line_id, l.display_phone, l.status AS line_status, own.state, own.transition_ends_at
             FROM platform.hotels h
             LEFT JOIN platform.whatsapp_line_hotels own ON own.hotel_id = h.id AND own.own AND own.valid_to IS NULL
             LEFT JOIN platform.whatsapp_lines l ON l.id = own.line_id
            WHERE h.id = $1 AND h.deleted_at IS NULL`,
          [hotelId],
        );
        const x = r.rows[0];
        if (!x) return null;
        return {
          hotelId,
          hotelName: String(x.name),
          ownLine: x.line_id ? { id: String(x.line_id), phone: x.display_phone ? String(x.display_phone) : null, status: String(x.line_status) } : null,
          state: x.line_id ? (String(x.state) as MoveState) : ("none" as MoveState),
          transitionEndsAt: x.transition_ends_at ? (x.transition_ends_at as Date) : null,
        };
      }),

    transitionDays: () =>
      one(pool, async (q) => {
        const r = await q("SELECT value FROM platform.platform_settings WHERE key = 'whatsapp.transition_days'");
        const v = Number(r.rows[0]?.value);
        return Number.isInteger(v) && v >= 1 && v <= 365 ? v : 30;
      }),

    setState: (hotelId, from, to, endsAt) =>
      one(pool, async (q) => {
        if (!UUID.test(hotelId)) return false;
        const r = await q("UPDATE platform.whatsapp_line_hotels SET state = $3, transition_ends_at = $4 WHERE hotel_id = $1 AND own AND valid_to IS NULL AND state = ANY($2::text[]) RETURNING id", [hotelId, [...from], to, to === "transition" ? endsAt : null]);
        return r.rows.length > 0;
      }),

    finishDue: (now) =>
      one(pool, async (q) => {
        const r = await q("UPDATE platform.whatsapp_line_hotels SET state = 'active', transition_ends_at = NULL WHERE own AND valid_to IS NULL AND state = 'transition' AND transition_ends_at <= $1 RETURNING id", [now.toISOString()]);
        return r.rows.length;
      }),
  };
}

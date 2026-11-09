import "server-only";
import type { ClientPool } from "../../../db/withHotel";
import type { WaLineKind, WaLineStatus } from "../../whatsapp/ports";
import type { RulesLine, WaRulesStore } from "../../services/whatsapp/rulesService";

// The PostgreSQL side of the Rules screen (platform migration 0180): the lines without their secrets, a line's pause, and a hotel's rules_override. One statement each, as hms_app.
// The settings (profiles, numbers, kill switch) are platform_settings rows and go through the console unit, not through here.
type Q = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
async function one<T>(pool: ClientPool, work: (query: Q) => Promise<T>): Promise<T> {
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

const lineOf = (r: Record<string, unknown>): RulesLine => ({ id: String(r.id), kind: String(r.kind) as WaLineKind, displayName: r.display_name === null || r.display_name === undefined ? null : String(r.display_name), status: String(r.status) as WaLineStatus, quality: String(r.quality) });
const COLS = "id, kind, display_name, status, quality";

export function createPgWaRulesStore(pool: ClientPool): WaRulesStore {
  return {
    lines: () => one(pool, async (q) => (await q(`SELECT ${COLS} FROM platform.whatsapp_lines ORDER BY created_at DESC, id`)).rows.map(lineOf)),
    line: (id) =>
      one(pool, async (q) => {
        const r = await q(`SELECT ${COLS} FROM platform.whatsapp_lines WHERE id = $1`, [id]);
        return r.rows[0] ? lineOf(r.rows[0]) : null;
      }),
    // only active or paused; a line that needs reconnecting or is banned is never moved by a switch
    setLineStatus: (id, status) =>
      one(pool, async (q) => {
        const r = await q("UPDATE platform.whatsapp_lines SET status = $2 WHERE id = $1 AND status IN ('test', 'active', 'paused') RETURNING id", [id, status]);
        return (r.rowCount ?? 0) > 0;
      }),
    hotelRows: (hotelId) =>
      one(pool, async (q) => {
        const r = await q(
          `SELECT lh.line_id, l.kind, lh.own, lh.rules_override FROM platform.whatsapp_line_hotels lh JOIN platform.whatsapp_lines l ON l.id = lh.line_id
            WHERE lh.hotel_id = $1 AND lh.valid_to IS NULL ORDER BY lh.own DESC, lh.created_at`,
          [hotelId],
        );
        return r.rows.map((x) => ({ lineId: String(x.line_id), lineKind: String(x.kind) as WaLineKind, own: x.own === true, override: typeof x.rules_override === "object" && x.rules_override !== null && !Array.isArray(x.rules_override) ? (x.rules_override as Record<string, unknown>) : {} }));
      }),
    setOverride: (hotelId, override) =>
      one(pool, async (q) => {
        const r = await q("UPDATE platform.whatsapp_line_hotels SET rules_override = $2::jsonb WHERE hotel_id = $1 AND valid_to IS NULL", [hotelId, JSON.stringify(override)]);
        return r.rowCount ?? 0;
      }),
  };
}

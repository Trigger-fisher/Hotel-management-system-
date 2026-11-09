import "server-only";
import type { ClientPool } from "../../../db/withHotel";
import type { AttachResult, CodeResult, LineHotelRow, LineHotelsStore } from "../../whatsapp/lineHotels";
import type { WaLineKind } from "../../whatsapp/ports";

// The PostgreSQL side of "hotels on a number" (platform migration 0180: whatsapp_line_hotels). One statement per call on the platform schema as hms_app. History is kept: detaching sets valid_to.
type Q = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;

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

const constraintOf = (e: unknown): string => String((e as { constraint?: unknown }).constraint ?? "");
const isUnique = (e: unknown): boolean => (e as { code?: unknown }).code === "23505";

export function createPgLineHotelsStore(pool: ClientPool): LineHotelsStore {
  return {
    lineKind: (id) =>
      one(pool, async (q) => {
        const r = await q("SELECT kind FROM platform.whatsapp_lines WHERE id = $1", [id]);
        return r.rows[0] ? (String(r.rows[0].kind) as WaLineKind) : null;
      }),
    hotelInfo: (id) =>
      one(pool, async (q) => {
        const r = await q("SELECT name, slug FROM platform.hotels WHERE id = $1 AND deleted_at IS NULL", [id]);
        return r.rows[0] ? { name: String(r.rows[0].name), slug: String(r.rows[0].slug) } : null;
      }),
    list: (lineId) =>
      one(pool, async (q) => {
        const r = await q(
          `SELECT lh.hotel_id, h.name, lh.hotel_code, lh.valid_from FROM platform.whatsapp_line_hotels lh JOIN platform.hotels h ON h.id = lh.hotel_id
           WHERE lh.line_id = $1 AND lh.valid_to IS NULL ORDER BY h.name`,
          [lineId],
        );
        return r.rows.map((x): LineHotelRow => ({ hotelId: String(x.hotel_id), hotelName: String(x.name), hotelCode: x.hotel_code === null ? null : String(x.hotel_code), since: x.valid_from instanceof Date ? x.valid_from : new Date(String(x.valid_from)) }));
      }),
    available: (lineId) =>
      one(pool, async (q) => {
        const r = await q(
          `SELECT h.id, h.name FROM platform.hotels h WHERE h.deleted_at IS NULL AND h.status IN ('active', 'suspended')
             AND NOT EXISTS (SELECT 1 FROM platform.whatsapp_line_hotels lh WHERE lh.line_id = $1 AND lh.hotel_id = h.id AND lh.valid_to IS NULL) ORDER BY h.name`,
          [lineId],
        );
        return r.rows.map((x) => ({ hotelId: String(x.id), hotelName: String(x.name) }));
      }),
    attach: (lineId, hotelId, code, at): Promise<AttachResult> =>
      one(pool, async (q) => {
        try {
          await q("INSERT INTO platform.whatsapp_line_hotels (line_id, hotel_id, hotel_code, valid_from) VALUES ($1, $2, $3, $4)", [lineId, hotelId, code, at]);
          return "ok" as const;
        } catch (e) {
          if (isUnique(e)) return constraintOf(e) === "whatsapp_line_hotels_code_key" ? ("code_taken" as const) : ("already" as const);
          if ((e as { code?: unknown }).code === "23503") return "no_hotel" as const;
          throw e;
        }
      }),
    detach: (lineId, hotelId, at) =>
      one(pool, async (q) => ((await q("UPDATE platform.whatsapp_line_hotels SET valid_to = $3 WHERE line_id = $1 AND hotel_id = $2 AND valid_to IS NULL", [lineId, hotelId, at])).rowCount ?? 0) > 0),
    setCode: (lineId, hotelId, code): Promise<CodeResult> =>
      one(pool, async (q) => {
        try {
          const r = await q("UPDATE platform.whatsapp_line_hotels SET hotel_code = $3 WHERE line_id = $1 AND hotel_id = $2 AND valid_to IS NULL", [lineId, hotelId, code]);
          return (r.rowCount ?? 0) > 0 ? ("ok" as const) : ("not_attached" as const);
        } catch (e) {
          if (isUnique(e)) return "code_taken" as const;
          throw e;
        }
      }),
  };
}

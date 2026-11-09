import "server-only";
// Room-service orders on PostgreSQL (repos/roomService.ts; the in-memory double repos/memory/roomService.ts is the reference). Values only through $n. The lines are read with their
// orders in one query per page. A guest's transaction sees only its own stays' orders through the row-level security of migration 0041.
import { toBigInt } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import { GUEST_CANCEL_KEY, type RoomOrderLineRecord, type RoomOrderRecord, type RoomOrderRow, type RoomOrderStatus, type RoomServiceRepo } from "../roomService";
import { asDate, asText, countTotal, guard, wordsCondition } from "./shared";

type Row = Record<string, unknown>;

const lineOf = (r: Row): RoomOrderLineRecord => ({ id: String(r.id), itemId: asText(r.item_id), name: String(r.name), qty: Number(r.qty), unitPricePaise: toBigInt(r.unit_price_paise), chargeId: asText(r.charge_id), sortOrder: Number(r.sort_order) });
const orderOf = (r: Row, lines: RoomOrderLineRecord[]): RoomOrderRecord => ({
  id: String(r.id),
  orderNo: String(r.order_no),
  stayId: asText(r.stay_id),
  tableLabel: asText(r.table_label),
  source: r.source === "staff" ? "staff" : "guest",
  status: r.status as RoomOrderStatus,
  scheduledFor: asDate(r.scheduled_for),
  note: asText(r.note),
  totalPaise: toBigInt(r.total_paise),
  placedBy: asText(r.placed_by),
  placedAt: asDate(r.placed_at) as Date,
  statusAt: asDate(r.status_at) as Date,
  statusBy: asText(r.status_by),
  statusByName: asText(r.status_by_name),
  cancelledByKind: (asText(r.cancelled_by_kind) as "guest" | "hotel" | null) ?? null,
  cancelReason: asText(r.cancel_reason),
  lines,
});

export function pgRoomServiceRepo(tx: TxClient): RoomServiceRepo {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  const linesFor = async (ids: readonly string[]): Promise<Map<string, RoomOrderLineRecord[]>> => {
    const out = new Map<string, RoomOrderLineRecord[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return out;
    for (const r of (await q("SELECT * FROM room_service_order_lines WHERE order_id = ANY($1::uuid[]) ORDER BY order_id, sort_order, id", [ids])).rows) out.get(String(r.order_id))?.push(lineOf(r));
    return out;
  };
  const withLines = async (rows: Row[]): Promise<RoomOrderRecord[]> => {
    const lines = await linesFor(rows.map((r) => String(r.id)));
    return rows.map((r) => orderOf(r, lines.get(String(r.id)) ?? []));
  };

  return {
    async create(input) {
      const r = await guard(
        q(
          `INSERT INTO room_service_orders (order_no, stay_id, scheduled_for, note, total_paise, placed_by, placed_at, status_at, status_by, table_label, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $6, $8, $9) RETURNING *`,
          [input.orderNo, input.stayId, input.scheduledFor ? input.scheduledFor.toISOString() : null, input.note, input.totalPaise.toString(), input.placedBy, input.placedAt.toISOString(), input.tableLabel ?? null, input.source ?? "guest"],
        ),
      );
      const id = String(r.rows[0].id);
      for (const l of input.lines) {
        await guard(q("INSERT INTO room_service_order_lines (order_id, item_id, name, qty, unit_price_paise, charge_id, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, l.itemId, l.name, l.qty, l.unitPricePaise.toString(), l.chargeId, l.sortOrder]));
      }
      return (await withLines(r.rows))[0];
    },
    async get(id, options) {
      const r = await q(`SELECT * FROM room_service_orders WHERE id = $1${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
      return r.rows[0] ? (await withLines(r.rows))[0] : null;
    },
    async forStays(stayIds) {
      if (stayIds.length === 0) return [];
      return withLines((await q("SELECT * FROM room_service_orders WHERE stay_id = ANY($1::uuid[]) ORDER BY placed_at DESC, id DESC", [stayIds])).rows);
    },
    async list(query) {
      const params: unknown[] = [];
      const parts: string[] = [];
      if (query.status === "open") parts.push("o.status NOT IN ('delivered', 'cancelled')");
      else if (query.status) {
        params.push(query.status);
        parts.push(`o.status = $${params.length}`);
      }
      if (query.source) {
        params.push(query.source);
        parts.push(`o.source = $${params.length}`);
      }
      parts.push(wordsCondition("concat_ws(' ', o.order_no, o.table_label, r.number, s.guest_name, (SELECT string_agg(l.name, ' ') FROM room_service_order_lines l WHERE l.order_id = o.id))", query.words, params));
      const where = parts.join(" AND ");
      const from = "FROM room_service_orders o LEFT JOIN pms_stays s ON s.id = o.stay_id LEFT JOIN pms_rooms r ON r.id = s.room_id";
      const total = await countTotal(tx, query, `SELECT COUNT(*) AS n ${from} WHERE ${where}`, params);
      params.push(query.pageSize, (query.page - 1) * query.pageSize);
      const order = query.status === "open" ? "o.placed_at ASC, o.id ASC" : "o.placed_at DESC, o.id DESC";
      const r = await q(`SELECT o.*, r.number AS room_number, s.guest_name AS stay_guest_name ${from} WHERE ${where} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      const orders = await withLines(r.rows);
      return { rows: orders.map((o, i): RoomOrderRow => ({ ...o, roomNumber: asText(r.rows[i].room_number), guestName: asText(r.rows[i].stay_guest_name) ?? "" })), total };
    },
    async setStatus(id, status, by, at, cancel) {
      const r = await guard(
        q("UPDATE room_service_orders SET status = $2, status_at = $3, status_by = $4, status_by_name = $5, cancelled_by_kind = $6, cancel_reason = $7 WHERE id = $1 RETURNING *", [
          id, status, at.toISOString(), by.id, by.name.slice(0, 150), cancel ? cancel.kind : null, cancel ? cancel.reason : null,
        ]),
      );
      return r.rows[0] ? (await withLines(r.rows))[0] : null;
    },
    async guestCancelMinutes() {
      const r = await q("SELECT value FROM app_settings WHERE key = $1", [GUEST_CANCEL_KEY]);
      const v = r.rows[0] ? Number(r.rows[0].value) : NaN;
      return Number.isFinite(v) ? v : null;
    },
    async setGuestCancelMinutes(minutes) {
      await q("INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [GUEST_CANCEL_KEY, String(minutes)]);
    },
  };
}

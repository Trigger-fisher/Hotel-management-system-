import "server-only";
import type { ClientPool } from "../../../db/withHotel";
import type { WaGuestHotel, WaHoldRow, WaHoldStore, WaHotelLineState, WaLineHotel, WaRoutingStore, WaSelection } from "../../whatsapp/routingPorts";

// The PostgreSQL side of shared-line routing (platform migrations 0180 and 0181): the stores routing.ts and holds.ts stand on. Platform schema only; no message text except the sealed payload
// of a hold, and a guest is only ever a keyed hash.
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

const date = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

export function createPgWhatsAppRoutingStore(pool: ClientPool): WaRoutingStore & { ownerHotelOf(lineId: string): Promise<string | null> } {
  return {
    guestHotels: (guestDigits) =>
      one(pool, async (q) => {
        // the central profile keeps an Indian mobile as +91 and ten digits; a number of another country has no central profile, so no candidates (the guest is asked)
        const r = await q(
          `SELECT gh.hotel_id, max(gh.wa_last_in_at) AS last_in, max(gh.wa_last_out_at) AS last_out
           FROM platform.guests g JOIN platform.guest_hotels gh ON gh.guest_id = g.id
           WHERE g.mobile = $1 AND g.merged_into IS NULL GROUP BY gh.hotel_id`,
          [`+${guestDigits}`],
        );
        return r.rows.map((x): WaGuestHotel => ({ hotelId: String(x.hotel_id), lastInAt: date(x.last_in), lastOutAt: date(x.last_out) }));
      }),

    lineHotels: (lineId) =>
      one(pool, async (q) => {
        // a hotel on the shared line is "shared" unless it has an own line: then that row's state (pending, transition, active) says how far the move is
        const r = await q(
          `SELECT lh.hotel_id, lh.hotel_code, own.state AS own_state,
                  coalesce(own.redirect_phone, lh.redirect_phone, nullif(regexp_replace(coalesce(ol.display_phone, ''), '[^0-9]', '', 'g'), '')) AS redirect_phone
           FROM platform.whatsapp_line_hotels lh
           LEFT JOIN platform.whatsapp_line_hotels own ON own.hotel_id = lh.hotel_id AND own.own AND own.valid_to IS NULL
           LEFT JOIN platform.whatsapp_lines ol ON ol.id = own.line_id
           WHERE lh.line_id = $1 AND lh.valid_to IS NULL AND NOT lh.own
             AND coalesce(lh.rules_override ->> 'hotel_paused', '') <> 'true'`,
          [lineId],
        );
        return r.rows.map(
          (x): WaLineHotel => ({
            hotelId: String(x.hotel_id),
            state: (x.own_state === null || x.own_state === undefined ? "shared" : String(x.own_state)) as WaHotelLineState,
            hotelCode: x.hotel_code === null ? null : String(x.hotel_code),
            redirectPhone: x.redirect_phone === null || x.redirect_phone === undefined ? null : String(x.redirect_phone),
          }),
        );
      }),

    messageOwner: (lineId, wamid) =>
      one(pool, async (q) => {
        const r = await q("SELECT hotel_id FROM platform.whatsapp_message_index WHERE line_id = $1 AND wamid = $2", [lineId, wamid]);
        return r.rows[0] ? { hotelId: r.rows[0].hotel_id === null ? null : String(r.rows[0].hotel_id) } : null;
      }),

    getSelection: (lineId, guestHash) =>
      one(pool, async (q) => {
        const r = await q("SELECT hotel_id, expires_at FROM platform.whatsapp_selections WHERE line_id = $1 AND guest_hash = $2", [lineId, guestHash]);
        return r.rows[0] ? ({ hotelId: String(r.rows[0].hotel_id), expiresAt: date(r.rows[0].expires_at) as Date } satisfies WaSelection) : null;
      }),

    saveSelection: (lineId, guestHash, selection) =>
      one(pool, async (q) => {
        await q(
          `INSERT INTO platform.whatsapp_selections (line_id, guest_hash, hotel_id, expires_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (line_id, guest_hash) DO UPDATE SET hotel_id = EXCLUDED.hotel_id, expires_at = EXCLUDED.expires_at`,
          [lineId, guestHash, selection.hotelId, selection.expiresAt],
        );
      }),

    /** The hotel that owns an own line (its current row), or null: an own line routes everything to it. */
    ownerHotelOf: (lineId) =>
      one(pool, async (q) => {
        const r = await q("SELECT hotel_id FROM platform.whatsapp_line_hotels WHERE line_id = $1 AND valid_to IS NULL ORDER BY valid_from DESC LIMIT 1", [lineId]);
        return r.rows[0] ? String(r.rows[0].hotel_id) : null;
      }),
  };
}

const holdOf = (r: Record<string, unknown>): WaHoldRow => ({
  id: String(r.id),
  lineId: String(r.line_id),
  guestHash: r.guest_hash as Buffer,
  payloadSecret: String(r.payload_secret),
  candidateHotels: (r.candidate_hotels as string[] | null) ?? [],
  questionWamid: r.question_wamid === null || r.question_wamid === undefined ? null : String(r.question_wamid),
  expiresAt: date(r.expires_at) as Date,
});
const HOLD_COLUMNS = "id, line_id, guest_hash, payload_secret, candidate_hotels, question_wamid, expires_at";

export function createPgWhatsAppHoldStore(pool: ClientPool): WaHoldStore {
  return {
    findByGuest: (lineId, guestHash) =>
      one(pool, async (q) => {
        const r = await q(`SELECT ${HOLD_COLUMNS} FROM platform.whatsapp_holds WHERE line_id = $1 AND guest_hash = $2`, [lineId, guestHash]);
        return r.rows[0] ? holdOf(r.rows[0]) : null;
      }),
    get: (id) =>
      one(pool, async (q) => {
        const r = await q(`SELECT ${HOLD_COLUMNS} FROM platform.whatsapp_holds WHERE id = $1`, [id]);
        return r.rows[0] ? holdOf(r.rows[0]) : null;
      }),
    insert: (row) =>
      one(pool, async (q) => {
        const r = await q(
          `INSERT INTO platform.whatsapp_holds (line_id, guest_hash, payload_secret, candidate_hotels, question_wamid, expires_at) VALUES ($1, $2, $3, $4::uuid[], $5, $6)
           RETURNING ${HOLD_COLUMNS}`,
          [row.lineId, row.guestHash, row.payloadSecret, row.candidateHotels, row.questionWamid, row.expiresAt],
        );
        return holdOf(r.rows[0]);
      }),
    updatePayload: (id, payloadSecret) =>
      one(pool, async (q) => {
        await q("UPDATE platform.whatsapp_holds SET payload_secret = $2 WHERE id = $1", [id, payloadSecret]);
      }),
    setQuestionWamid: (id, wamid) =>
      one(pool, async (q) => {
        await q("UPDATE platform.whatsapp_holds SET question_wamid = $2 WHERE id = $1", [id, wamid]);
      }),
    remove: (id) =>
      one(pool, async (q) => {
        await q("DELETE FROM platform.whatsapp_holds WHERE id = $1", [id]);
      }),
    removeExpired: (now) =>
      one(pool, async (q) => {
        const r = await q("DELETE FROM platform.whatsapp_holds WHERE expires_at <= $1", [now]);
        return r.rowCount ?? 0;
      }),
  };
}

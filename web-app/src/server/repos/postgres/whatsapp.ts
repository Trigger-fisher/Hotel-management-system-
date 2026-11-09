import "server-only";
import type { ClientPool } from "../../../db/withHotel";
import type { NewWaEvent, WaEventKind, WaEventRow, WaEventState, WaEventStore, WaLine, WaLineKind, WaLineStatus, WaLineStore } from "../../whatsapp/ports";

// The PostgreSQL side of the WhatsApp stores (platform migration 0180). Each call is one statement on the platform schema as hms_app; the one that must not hand the same event to two workers
// (claim) takes its rows with FOR UPDATE SKIP LOCKED inside the statement, so it needs no transaction around it.
async function one<T>(pool: ClientPool, work: (query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>) => Promise<T>): Promise<T> {
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

const lineOf = (r: Record<string, unknown>): WaLine => ({ id: String(r.id), kind: String(r.kind) as WaLineKind, phoneNumberId: String(r.phone_number_id), wabaId: String(r.waba_id), status: String(r.status) as WaLineStatus });

export function createPgWhatsAppLineStore(pool: ClientPool): WaLineStore {
  return {
    findById: (id) =>
      one(pool, async (q) => {
        const r = await q("SELECT id, kind, phone_number_id, waba_id, status FROM platform.whatsapp_lines WHERE id = $1", [id]);
        return r.rows[0] ? lineOf(r.rows[0]) : null;
      }),
    findByPhoneNumberId: (phoneNumberId) =>
      one(pool, async (q) => {
        const r = await q("SELECT id, kind, phone_number_id, waba_id, status FROM platform.whatsapp_lines WHERE phone_number_id = $1", [phoneNumberId]);
        return r.rows[0] ? lineOf(r.rows[0]) : null;
      }),
    findByWabaId: (wabaId) =>
      one(pool, async (q) => {
        const r = await q("SELECT id, kind, phone_number_id, waba_id, status FROM platform.whatsapp_lines WHERE waba_id = $1 AND status <> 'banned' ORDER BY created_at LIMIT 1", [wabaId]);
        return r.rows[0] ? lineOf(r.rows[0]) : null;
      }),
    touchEvent: (lineId, at) =>
      one(pool, async (q) => {
        await q("UPDATE platform.whatsapp_lines SET last_event_at = greatest(coalesce(last_event_at, $2::timestamptz), $2::timestamptz) WHERE id = $1", [lineId, at]);
      }),
  };
}

const eventOf = (r: Record<string, unknown>): WaEventRow => ({
  id: String(r.id),
  lineId: String(r.line_id),
  kind: String(r.kind) as WaEventKind,
  dedupeKey: String(r.dedupe_key),
  payloadSecret: r.payload_secret === null || r.payload_secret === undefined ? null : String(r.payload_secret),
  state: String(r.state) as WaEventState,
  attempts: Number(r.attempts),
  receivedAt: r.received_at instanceof Date ? r.received_at : new Date(String(r.received_at)),
});

const COLUMNS = "id, line_id, kind, dedupe_key, payload_secret, state, attempts, received_at";
// an event is due when it waits and its time has come, or a worker took it and its lease ran out (the worker died)
const DUE = "((state IN ('received', 'failed', 'parked') AND next_attempt_at <= $1::timestamptz) OR (state = 'processing' AND (locked_until IS NULL OR locked_until <= $1::timestamptz)))";

export function createPgWhatsAppEventStore(pool: ClientPool): WaEventStore {
  return {
    save: (events: readonly NewWaEvent[]) =>
      one(pool, async (q) => {
        if (events.length === 0) return { saved: [], duplicates: 0 };
        const r = await q(
          `INSERT INTO platform.whatsapp_events (line_id, kind, dedupe_key, payload_secret, received_at, next_attempt_at)
           SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $5::timestamptz[])
           ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
          [events.map((e) => e.lineId), events.map((e) => e.kind), events.map((e) => e.dedupeKey), events.map((e) => e.payloadSecret), events.map((e) => e.receivedAt)],
        );
        const saved = r.rows.map((x) => String(x.id));
        return { saved, duplicates: events.length - saved.length };
      }),
    claim: (now, limit, leaseSeconds) =>
      one(pool, async (q) => {
        const r = await q(
          `UPDATE platform.whatsapp_events SET state = 'processing', attempts = attempts + 1, locked_until = $1::timestamptz + make_interval(secs => $3)
           WHERE id IN (SELECT id FROM platform.whatsapp_events WHERE ${DUE} ORDER BY received_at LIMIT $2 FOR UPDATE SKIP LOCKED)
           RETURNING ${COLUMNS}`,
          [now, limit, leaseSeconds],
        );
        return r.rows.map(eventOf).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
      }),
    claimOne: (id, now, leaseSeconds) =>
      one(pool, async (q) => {
        const r = await q(
          `UPDATE platform.whatsapp_events SET state = 'processing', attempts = attempts + 1, locked_until = $1::timestamptz + make_interval(secs => $3)
           WHERE id = (SELECT id FROM platform.whatsapp_events WHERE id = $2 AND ${DUE} FOR UPDATE SKIP LOCKED)
           RETURNING ${COLUMNS}`,
          [now, id, leaseSeconds],
        );
        return r.rows[0] ? eventOf(r.rows[0]) : null;
      }),
    complete: (id, now) =>
      one(pool, async (q) => {
        await q("UPDATE platform.whatsapp_events SET state = 'done', payload_secret = NULL, locked_until = NULL, processed_at = $2 WHERE id = $1", [id, now]);
      }),
    fail: (id, code, retryAt, now) =>
      one(pool, async (q) => {
        await q(
          `UPDATE platform.whatsapp_events SET state = CASE WHEN $3::timestamptz IS NULL THEN 'dead' ELSE 'failed' END, last_error_code = $2, locked_until = NULL,
             next_attempt_at = coalesce($3::timestamptz, next_attempt_at), processed_at = CASE WHEN $3::timestamptz IS NULL THEN $4::timestamptz ELSE NULL END
           WHERE id = $1`,
          [id, code, retryAt, now],
        );
      }),
    park: (id, retryAt) =>
      one(pool, async (q) => {
        await q("UPDATE platform.whatsapp_events SET state = 'parked', locked_until = NULL, next_attempt_at = $2, attempts = greatest(attempts - 1, 0) WHERE id = $1", [id, retryAt]);
      }),
    purge: (now) =>
      one(pool, async (q) => {
        const done = await q("DELETE FROM platform.whatsapp_events WHERE state = 'done' AND processed_at < $1::timestamptz - interval '1 day'", [now]);
        const failed = await q("DELETE FROM platform.whatsapp_events WHERE state IN ('failed', 'dead') AND received_at < $1::timestamptz - interval '7 days'", [now]);
        return { done: done.rowCount ?? 0, failed: failed.rowCount ?? 0 };
      }),
  };
}

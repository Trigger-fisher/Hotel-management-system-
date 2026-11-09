import "server-only";
import type { WithHotel } from "../../../db/withHotel";
import type { IdempotencyStore } from "../../http/idempotency";

// The Idempotency-Key store on PostgreSQL (hotel table idempotency_keys, migration 0010): durable across restarts and shared by every server instance, so a
// retried create is replayed instead of repeated on a VPS and on a serverless host alike. Each call is its own short transaction of the hotel: the
// "in progress" marker is committed BEFORE the work starts, so a second request with the same key sees it. A marker older than two minutes is a crashed
// request and is dropped; a finished answer is kept 24 hours.
// PURGE: every keyed write also deletes the hotel's expired rows (at most 200 a time, by the expiry index), and `db:cli purge-idempotency` sweeps every hotel.
// PRIVACY: an answer that carries a guest's details is never stored whole: for the check-in, the guest-details edit and the ID photo only {id, version} is
// kept, so a replay confirms the stay and its version and nothing else.
const TTL_HOURS = 24;
const STUCK_MINUTES = 2;
const PURGE_BATCH = 200;

/** Paths whose answers hold personal data (the stay with its guest, ID number, address, members): replayed as ids only. */
const IDS_ONLY_PATHS = /^\/api\/v1\/front-office\/stays(\/[^/]+\/(guest-details|id-photo))?$/;

/** What is kept of an answer: the whole body, except for the paths above. */
export function storedBody(path: string, body: unknown): unknown {
  if (!IDS_ONLY_PATHS.test(path)) return body ?? null;
  const data = (body as { data?: { id?: unknown; version?: unknown } } | null)?.data;
  return { data: { id: data?.id ?? null, version: data?.version ?? null } };
}

export function createPgIdempotencyStore(withHotel: WithHotel): IdempotencyStore {
  return {
    async begin(scope, hash, info) {
      return withHotel({ hotelId: scope.hotelId }, async (tx) => {
        // the hotel's expired rows go (bounded), so no answer outlives its 24 hours for long
        await tx.query("DELETE FROM idempotency_keys WHERE id IN (SELECT id FROM idempotency_keys WHERE expires_at <= now() ORDER BY expires_at LIMIT $1)", [PURGE_BATCH]);
        // an entry of this key that is a marker left by a request that died goes too
        await tx.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND status = 'in_progress' AND created_at < now() - make_interval(mins => $3)", [scope.userId, scope.key, STUCK_MINUTES]);
        const made = await tx.query(
          `INSERT INTO idempotency_keys (user_id, key, method, path, request_hash, expires_at) VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))
           ON CONFLICT (user_id, key) DO NOTHING RETURNING id`,
          [scope.userId, scope.key, info?.method ?? "POST", (info?.path ?? "/").slice(0, 255), hash, TTL_HOURS],
        );
        if (made.rows.length > 0) return { state: "new" as const };
        const r = await tx.query("SELECT request_hash, status, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2", [scope.userId, scope.key]);
        const row = r.rows[0];
        if (!row) return { state: "in_progress" as const };
        if (String(row.request_hash) !== hash) return { state: "mismatch" as const };
        if (row.status !== "completed") return { state: "in_progress" as const };
        return { state: "replay" as const, status: Number(row.response_status), body: row.response_body };
      });
    },
    async complete(scope, answer) {
      await withHotel({ hotelId: scope.hotelId }, async (tx) => {
        const path = String((await tx.query("SELECT path FROM idempotency_keys WHERE user_id = $1 AND key = $2", [scope.userId, scope.key])).rows[0]?.path ?? "");
        await tx.query("UPDATE idempotency_keys SET status = 'completed', response_status = $3, response_body = $4::jsonb WHERE user_id = $1 AND key = $2", [scope.userId, scope.key, answer.status, JSON.stringify(storedBody(path, answer.body))]);
      });
    },
    async abandon(scope) {
      await withHotel({ hotelId: scope.hotelId }, async (tx) => {
        await tx.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND status = 'in_progress'", [scope.userId, scope.key]);
      });
    },
  };
}

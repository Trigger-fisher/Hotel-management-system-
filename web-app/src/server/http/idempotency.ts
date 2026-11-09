import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * Idempotency-Key handling (A10). A client that retries a create (a dropped connection, a double tap) sends the same key; the
 * first answer is stored and replayed instead of creating a second booking or payment. One entry per (person, key).
 * The PostgreSQL implementation is the hotel table idempotency_keys (0010_idempotency.sql); the in-memory one below is the double.
 */
type IdempotencyStart =
  | { state: "new" }
  | { state: "replay"; status: number; body: unknown }
  | { state: "mismatch" }
  | { state: "in_progress" };

export interface IdempotencyStore {
  /** Claims the key for this request, or says what already happened with it. */
  begin(scope: { userId: string; hotelId: string; key: string }, requestHash: string, info?: { method: string; path: string }): Promise<IdempotencyStart>;
  /** Stores the answer so the next try with the same key and request replays it. */
  complete(scope: { userId: string; hotelId: string; key: string }, answer: { status: number; body: unknown }): Promise<void>;
  /** The request failed: let the client try again with the same key. */
  abandon(scope: { userId: string; hotelId: string; key: string }): Promise<void>;
}

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const IDEMPOTENCY_KEY_SHAPE = /^[A-Za-z0-9_-]{8,128}$/;
const TTL_MS = 24 * 60 * 60 * 1000;

/** JSON with sorted keys, so the same request always hashes the same however the client ordered its fields. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The fingerprint of a request: method, path and the canonical body, so the same key on another endpoint or with another body is "different". With the
 * server key it is an HMAC-SHA256 (what the app stores: a body that holds a password, like a password change, must not leave a plain SHA-256 behind that
 * could be guessed offline); without it a plain SHA-256 (the in-memory double and tests).
 */
export function requestHash(method: string, pathname: string, body: unknown, key?: Buffer): string {
  const material = `${method}\n${pathname}\n${canonicalJson(body ?? null)}`;
  return key ? createHmac("sha256", key).update("hms:idempotency:").update(material).digest("hex") : createHash("sha256").update(material).digest("hex");
}
interface Entry {
  hash: string;
  answer?: { status: number; body: unknown };
  expiresAt: number;
}

export function createMemoryIdempotencyStore(now: () => number = Date.now): IdempotencyStore & { size(): number } {
  const entries = new Map<string, Entry>();
  const id = (s: { userId: string; hotelId: string; key: string }): string => `${s.hotelId}|${s.userId}|${s.key}`;
  return {
    size: () => entries.size,
    async begin(scope, hash) {
      const existing = entries.get(id(scope));
      if (existing && existing.expiresAt > now()) {
        if (existing.hash !== hash) return { state: "mismatch" };
        return existing.answer ? { state: "replay", status: existing.answer.status, body: existing.answer.body } : { state: "in_progress" };
      }
      entries.set(id(scope), { hash, expiresAt: now() + TTL_MS });
      return { state: "new" };
    },
    async complete(scope, answer) {
      const entry = entries.get(id(scope));
      if (entry) entry.answer = answer;
    },
    async abandon(scope) {
      const entry = entries.get(id(scope));
      if (entry && !entry.answer) entries.delete(id(scope));
    },
  };
}

import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createMemoryIdempotencyStore, type IdempotencyStore } from "../http/idempotency";
import { createPgIdempotencyStore } from "../repos/postgres/idempotency";

// The Idempotency-Key store the routes use: the hotel's table in PostgreSQL when a database is configured (durable, shared by every server instance),
// in memory otherwise (the local demo and tests).
let store: IdempotencyStore | null = null;

export function getIdempotencyStore(): IdempotencyStore {
  store ??= getConfig().DATABASE_URL ? createPgIdempotencyStore(getDatabase().withHotel) : createMemoryIdempotencyStore();
  return store;
}
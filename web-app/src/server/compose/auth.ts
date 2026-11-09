import "server-only";
import { createCatalog } from "../auth/catalog";
import { PERMISSION_CATALOG } from "../auth/catalog.generated";
import { getDatabase } from "../../db";
import { createArgon2Hasher } from "../auth/password";
import { getConfig } from "../config/env";
import { getHashKey } from "../crypto";
import { createMemoryRateLimitStore, type RateLimitStore } from "../http/limits";
import type { PlatformUnit } from "../repos/auth";
import { createMemoryAuth } from "../repos/memory/auth";
import { createPgPlatformUnit, createPgRateLimitStore } from "../repos/postgres/auth";
import { createAuthService, type AuthService } from "../services/auth/authService";
import { cachedFoodName } from "../services/auth/foodName";
import { createSessionResolver } from "../services/auth/sessionResolver";
import { edgeCountry } from "../services/security/edge";
import { honeyKeyLabel } from "../services/security/honeypot";

// The composition root of sign-in: which repositories, hasher, keys and counters the login service and the session resolver really get.
// With DATABASE_URL and HMS_HASH_KEY set (npm run db:cli -- setup) these are the PostgreSQL repositories and the platform.rate_limits counters;
// without them the in-memory doubles (nobody can sign in: there are no users). Tests call configureAuth() with their own world.
interface AuthParts {
  unit: PlatformUnit;
  rateLimits: RateLimitStore;
  resolver: ReturnType<typeof createSessionResolver>;
  service: AuthService;
}

let parts: AuthParts | null = null;
let basics: { unit: PlatformUnit; rateLimits: RateLimitStore } | null = null;
/** ONE resolver per process (its session cache and in-flight reads are only worth something when every route and the shell seed share them). */
let resolver: ReturnType<typeof createSessionResolver> | null = null;
const catalog = createCatalog(PERMISSION_CATALOG);

function basicParts(): { unit: PlatformUnit; rateLimits: RateLimitStore } {
  if (basics) return basics;
  // the real database when it is configured (DATABASE_URL and HMS_HASH_KEY, both made by `npm run db:cli -- setup`); the in-memory double otherwise
  const config = getConfig();
  if (config.DATABASE_URL && config.HMS_HASH_KEY) {
    const { pool } = getDatabase();
    basics = { unit: createPgPlatformUnit(pool), rateLimits: createPgRateLimitStore(pool, getHashKey()) };
  } else {
    basics = { unit: createMemoryAuth().unit, rateLimits: createMemoryRateLimitStore() };
  }
  return basics;
}

/** The session resolver and the counters never need the keys, so they exist from the first request; the login service needs HMS_HASH_KEY and is built on its first use. */
/** The platform unit of work (PostgreSQL when the database is configured): for the mail worker. */
export function getPlatformUnit(): PlatformUnit {
  return parts ? parts.unit : basicParts().unit;
}

export function getSessionResolver(): ReturnType<typeof createSessionResolver> {
  if (parts) return parts.resolver;
  return (resolver ??= createSessionResolver({
    unit: basicParts().unit, catalog, now: () => new Date(), hashKey: getHashKey,
    honeyKeyLabel: (key, presented) => honeyKeyLabel(key, presented),
    edgeCountry,
    // a planted fake key was tried: Critical. Loaded on that one event only.
    onHoneyKey: (use) => void import("./security").then((m) => m.getSecurity().events.record({ kind: "honeytoken_used", summary: `A fake API key planted as bait was used (${use.label})`, ip: use.ip, detail: { label: use.label, country: use.country } })).catch(() => undefined),
  }));
}

export function getRateLimits(): RateLimitStore {
  return parts ? parts.rateLimits : basicParts().rateLimits;
}

export function getAuthService(): AuthService {
  if (parts) return parts.service;
  const { unit, rateLimits } = basicParts();
  const config = getConfig();
  // the hotel's food name is a read in the hotel's own schema (its own transaction): kept per hotel for a minute (services/auth/foodName.ts), forgotten when the setting is saved
  const foodName =
    config.DATABASE_URL && config.HMS_HASH_KEY
      ? (hotelId: string): Promise<string | null> =>
          cachedFoodName(hotelId, async (id) => {
            const r = await getDatabase().withHotel({ hotelId: id }, (tx) => tx.query("SELECT COALESCE(NULLIF(btrim((SELECT value FROM app_settings WHERE key = 'general.food_name')), ''), (SELECT name FROM payroll_companies WHERE code = 'PF01')) AS value"));
            const v = r.rows[0]?.value;
            return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
          })
      : undefined;
  const service = createAuthService({ unit, catalog, hasher: createArgon2Hasher(), hashKey: getHashKey(), rateLimits, now: () => new Date(), foodName, publicUrl: getConfig().HMS_PUBLIC_URL ?? "http://localhost:3000",
    // five wrong passwords lock an account: a Warning for the security layer. Loaded on the first lock only, so the sign-in route's cold start does not carry it.
    onAccountLocked: (e) => import("./security").then((m) => void m.getSecurity().events.record({ kind: "failed_login_burst", summary: `An account was locked after ${5} wrong passwords (${e.via}, ${e.minutes} min)`, ip: e.ip, traceId: e.traceId, detail: { userId: e.userId, accountRole: e.accountRole, via: e.via, minutes: e.minutes } })),
  });
  parts = { unit, rateLimits, resolver: getSessionResolver(), service };
  return service;
}

/** Replaces everything (start-up code and tests). */
export function configureAuth(next: AuthParts | null): void {
  parts = next;
  resolver = next?.resolver ?? null;
  if (next === null) basics = null;
}

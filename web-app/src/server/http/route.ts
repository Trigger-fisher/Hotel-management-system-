import "server-only";
import { after } from "next/server";
import { createCatalog } from "../auth/catalog";
import { PERMISSION_CATALOG } from "../auth/catalog.generated";
import { getRateLimits, getSessionResolver } from "../compose/auth";
import { getConfig } from "../config/env";
import { getHashKey } from "../crypto";
import { getLogger } from "../logger";
import { getIdempotencyStore } from "../compose/idempotency";
import { mailWake } from "../services/auth/mailWake";
import { createRouteFactory, type RouteDeps } from "./wrapper";

// The routes' door into the wrapper. The session resolver, the rate-limit counters and the throttled-session touch come from compose/auth.ts
// (in-memory until the PostgreSQL repositories exist, so nobody can sign in yet); configureRoutes() replaces them for tests. Route files
// import `route` / `publicRoute` from here and export nothing else (checked by tests/server/layers.test.ts).
let configured: RouteDeps | null = null;

let platformModule: Promise<typeof import("../compose/platform")> | undefined;
const platform = (): Promise<typeof import("../compose/platform")> => (platformModule ??= import("../compose/platform"));

function deps(): RouteDeps {
  configured ??= {
    resolveSession: (request, options) => {
      // any signed-in request also wakes the mail queue, at most once a minute: on Vercel a mail to retry would otherwise wait for the daily cron
      mailWake.nudge();
      return getSessionResolver().resolveSession(request, options);
    },
    touchSession: (session) => getSessionResolver().touchSession(session),
    accessOf: (session) => getSessionResolver().accessOf(session),
    endedReason: (request) => getSessionResolver().endedReason(request),
    // after the answer (after-response work); outside a request scope (scripts, tests) at once. Its failure never reaches the answer.
    defer: (work) => {
      try {
        after(() => work().catch(() => undefined));
      } catch {
        void work().catch(() => undefined);
      }
    },
    // a call made with an API access key: its writes, refusals and first use from a new address go to the platform audit as "API token: <name>".
    // compose/platform (and through it the admin, daily-summary and mail graphs) is loaded the first time one of these runs (an API key or a visit), not when a route file
    // is: every ordinary function's cold start stays free of it.
    onTokenEvent: (session, request, traceId, event) => platform().then((m) => m.getPlatformApiTokens().recordEvent(session, request, traceId, event)),
    onVisitWriteRefused: (session, request, traceId) => platform().then((m) => m.getPlatformVisits().recordRefusedWrite(session, request, traceId)),
    onVisitWriteIntent: (session, request, traceId) => platform().then((m) => m.getPlatformVisits().recordIntent(session, request, traceId)),
    onVisitWrite: (session, request, traceId, status) => platform().then((m) => m.getPlatformVisits().recordWrite(session, request, traceId, status)),
    get rateLimits() {
      return getRateLimits();
    },
    catalog: createCatalog(PERMISSION_CATALOG),
    get idempotency() {
      return getIdempotencyStore();
    },
    // the stored request hash is an HMAC under the server key (a body with a password must leave nothing guessable)
    idempotencyKey: () => (getConfig().HMS_HASH_KEY ? getHashKey() : undefined),
    logger: getLogger(),
  };
  return configured;
}

/** Replaces the wrapper's dependencies (the app's start-up code, and tests). */
export function configureRoutes(next: RouteDeps | null): void {
  configured = next;
}

const factory = createRouteFactory(deps);
export const route = factory.route;
export const publicRoute = factory.publicRoute;

import "server-only";
import type { z } from "zod";
import type { Catalog } from "../auth/catalog";
import type { Level } from "../auth/levels";
import { isPortalAccount, requirePermission } from "../auth/permissions";
import type { SessionResolver, VerifiedSession } from "../auth/session";
import { AppError } from "../errors";
import type { Logger } from "../logger/logger";
import { parseInput } from "../validation/zodErrors";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_KEY_SHAPE, requestHash, type IdempotencyStore } from "./idempotency";
import { createMemoryRateLimitStore, effectiveMax, type RateLimit, type RateLimitStore } from "./limits";
import { jsonError, jsonOk, jsonOkRevalidated } from "./respond";
import { TRACE_HEADER, traceIdFromRequest } from "./trace";
import { runInTestMode } from "../runtime/testMode";
import { tokenCallVerdict } from "../auth/apiTokens";
import { clientAddress } from "./clientAddress";
import { isHotelWrite, visitWriteVerdict } from "./visitAccess";

// THE route wrapper (A14). Every route file exports only what this builds, so the order of the checks is the same everywhere:
//   trace id -> session (401) -> permission (403) -> same-origin check for cookie sessions on writes (403)
//   -> strict, bounded parsing of params, query and body (422) -> Idempotency-Key (replay / 422 / 409)
//   -> the handler -> the { data } envelope, or the one error body; no-store on everything.
// A route never builds a Response, reads a header or catches an error itself.

export interface RouteDeps {
  resolveSession: SessionResolver;
  catalog: Catalog;
  idempotency: IdempotencyStore;
  logger: Logger;
  /** Counters for `limits`. Optional: without it a route that declares limits is not throttled (tests of other things need not care). */
  rateLimits?: RateLimitStore;
  /** The caller's address for `limits` with by: "ip". Default: the entry of x-forwarded-for that the trusted proxy added (http/clientAddress.ts), else "unknown". */
  clientIp?: (request: Request) => string;
  /** Moves a web session's idle window forward on real activity (not for a route marked touch: false). */
  touchSession?: (session: VerifiedSession) => Promise<void>;
  /** Runs work after the answer has been sent (next/server after()); without it the work is awaited before the handler, as before. The touch goes through it. */
  defer?: (work: () => Promise<void>) => void;
  /** The access record the session was resolved from (sessionResolver accessOf), for routes that answer the session itself; the wrapper does not use it. */
  accessOf?: (session: VerifiedSession) => import("../repos/auth").AccessRecord | null;
  /**
   * An API access key was used (session.client "token"): the audit row "API token: <name>" for every write (with its answer's status), a call the key's rules refused, and the first
   * use from a new address. Best effort: its failure never changes the answer.
   */
  onTokenEvent?: (session: VerifiedSession, request: Request, traceId: string, event: { kind: "write"; status: number } | { kind: "refused"; why: string } | { kind: "new_ip" }) => Promise<void>;
  /** Why a refused session cookie's session is over (replaced by a sign-in on another device, ended by an admin), so the 401 names it. Without it: SESSION_EXPIRED. */
  endedReason?: (request: Request) => Promise<"SESSION_REPLACED" | "SESSION_REVOKED" | "SESSION_EXPIRED" | null>;
  /** Records (audit, failed) a write that the read-only guard refused for platform staff inside a hotel. Best effort: its failure never changes the answer. */
  onVisitWriteRefused?: (session: VerifiedSession, request: Request, traceId: string) => Promise<void>;
  /** Records (platform audit "hotel_write_started") the INTENT of a hotel write inside a FULL visit BEFORE the work: who, hotel, route, time. If it cannot be written the write is not made (fail closed). */
  onVisitWriteIntent?: (session: VerifiedSession, request: Request, traceId: string) => Promise<void>;
  /** Records (platform audit "hotel_write") a hotel write made inside a FULL visit, with its answer's status, AFTER the work (same trace id as the intent row). Best effort: its failure never changes the answer. */
  onVisitWrite?: (session: VerifiedSession, request: Request, traceId: string, status: number) => Promise<void>;
  /** The server key the stored request hash is keyed with (HMAC): a body that holds a password must not leave a plain, guessable hash behind. Without it: plain SHA-256 (tests). */
  idempotencyKey?: () => Buffer | undefined;
}

type Schema = z.ZodType;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
/**
 * On Vercel (process.env.VERCEL set) a function refuses a request body above 4.5 MB before it runs; every route is capped a little below that, so a route
 * that declares more still works up to the cap, and a body over the cap gets one clear 413 sentence (code VALIDATION_FAILED) instead of a host error page.
 * Base64 makes a file a third bigger, so about 3 MB of photo fits. Elsewhere (a VPS, local) nothing changes.
 */
export const VERCEL_MAX_BODY_BYTES = 4_400_000;
export const HOST_BODY_TOO_BIG = "This upload is too big for the web host: at most about 3 MB per photo.";
class HostBodyTooLarge extends AppError {}
/** An answer slower than this is logged (the speed budget: reads 150 ms, writes 300 ms at p95). */
const SLOW_REQUEST_MS = 500;
/** How long finding the session took, per request (the `auth` part of Server-Timing). */
const authTime = new WeakMap<Request, number>();

interface RouteContext<S extends VerifiedSession | null, P, Q, B> {
  request: Request;
  traceId: string;
  session: S;
  params: P;
  query: Q;
  body: B;
  /**
   * Registers work that must still happen when this request ends in an error (a wrong-code counter, a lock): it runs after the
   * handler failed, in its own try, and its own failure is only logged. Nothing registered runs on success.
   */
  failAfterCommit(work: () => Promise<void>): void;
  /** Forgets this request's count on one of the route's `limits` (Pallav clears the sign-in counter after a good sign-in: RateLimiter::clear). */
  clearLimit(name: string): Promise<void>;
}

interface RouteResult<T> {
  data: T;
  /** 201 for a create. Default 200. */
  status?: number;
  /** Extra response headers (Set-Cookie for the session cookie). */
  headers?: readonly (readonly [string, string])[];
  /** A file instead of the JSON envelope (a PDF): `data` is ignored. Served inline, never cached, with the same trace id header. */
  binary?: { bytes: Uint8Array; contentType: string; filename: string; /** Default inline (a PDF opens in the browser); a CSV export is an attachment. */ disposition?: "inline" | "attachment" };
  /** An event stream (text/event-stream) instead of the JSON envelope: never cached, never compressed or buffered on the way (live Email and WhatsApp). */
  eventStream?: ReadableStream<Uint8Array>;
}

interface BaseDefinition<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined> {
  params?: P;
  query?: Q;
  body?: B;
  /** The largest body accepted, in bytes. Default 256 KB. */
  maxBodyBytes?: number;
  /** "required": a write without Idempotency-Key is refused. Default "optional" for writes with a body, "off" for reads. */
  idempotency?: "off" | "optional" | "required";
  /** Throttles, like Pallav's throttle:N,M middleware. Counted before the handler runs; over the limit is 429 RATE_LIMITED with Retry-After. */
  limits?: readonly RateLimit[];
  /** false: a real request that must NOT extend the web session's idle window (GET /auth/session, so polling cannot keep a session alive). Default true. */
  touch?: boolean;
  /** true: answers while the person's screen is locked (the session check, unlock, sign-out). Every other signed-in route answers 423 SCREEN_LOCKED then. */
  whileLocked?: boolean;
}

type Out<S extends Schema | undefined> = S extends Schema ? z.output<S> : undefined;

interface AuthedDefinition<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, T> extends BaseDefinition<P, Q, B> {
  /** A module or part key ("revenue.hotel") and the lowest level that may call this route. */
  permission: { key: string; level: Level } | "session";
  /** Cache-Control for a successful GET answer of a signed-in route: only ever `private, ...` (the browser's own cache, never a shared one). Default no-store. */
  cache?: `private${string}`;
  handler(ctx: RouteContext<VerifiedSession, Out<P>, Out<Q>, Out<B>>): Promise<RouteResult<T>>;
}

interface PublicDefinition<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, T> extends BaseDefinition<P, Q, B> {
  /**
   * Decision 55: a route a hotel's own website may call from the browser. Given the request's Origin and the route params, says whether that origin is one of the
   * hotel's registered domains. Then the answer carries the CORS headers (`Vary: Origin`), a cross-site POST is allowed, and an OPTIONS request is a preflight.
   * Any other origin gets no CORS headers and a cross-site POST stays 403. No credentials are ever allowed.
   */
  cors?: (origin: string, params: Record<string, string | string[]>) => Promise<boolean>;
  /** Cache-Control for a successful GET answer (a public answer the edge may keep). Errors and every other route stay no-store. */
  cache?: string;
  handler(ctx: RouteContext<null, Out<P>, Out<Q>, Out<B>>): Promise<RouteResult<T>>;
}

type RouteHandler = (request: Request, context?: { params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]> }) => Promise<Response>;

/** Same-origin check for cookie (web) sessions on writes: a cross-site form post or script cannot ride the person's cookie. */
function assertSameOrigin(request: Request): void {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new AppError("FORBIDDEN");
    }
    if (originHost !== host) throw new AppError("FORBIDDEN");
    return;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return;
  throw new AppError("FORBIDDEN");
}

/** Public writes: a request that says it comes from another site (Origin on another host, or Sec-Fetch-Site cross-site) is refused; one that says nothing (an app) passes. */
function assertNotCrossSite(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new AppError("FORBIDDEN");
    }
    if (originHost !== host) throw new AppError("FORBIDDEN");
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new AppError("FORBIDDEN");
}

function readQuery(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    // a repeated name is ambiguous (which one counts?), so it is refused instead of guessed
    if (Object.hasOwn(out, key)) throw new AppError("VALIDATION_FAILED", undefined, { fields: { [key]: "Given more than once" } });
    out[key] = value;
  }
  return out;
}

/** The body limit of a route: its own (default 256 KB), capped on Vercel; `host` = the Vercel cap is the one that applies. */
function bodyLimit(declared: number | undefined): { max: number; host: boolean } {
  const own = declared ?? DEFAULT_MAX_BODY_BYTES;
  return process.env.VERCEL && own > VERCEL_MAX_BODY_BYTES ? { max: VERCEL_MAX_BODY_BYTES, host: true } : { max: own, host: false };
}

async function readBody(request: Request, limit: { max: number; host: boolean }): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Send JSON (content-type: application/json)" } });
  const tooLarge = (): AppError => (limit.host ? new HostBodyTooLarge("VALIDATION_FAILED", HOST_BODY_TOO_BIG, { fields: { _: HOST_BODY_TOO_BIG } }) : new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Request is too large" } }));
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit.max) throw tooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > limit.max) throw tooLarge();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Not valid JSON" } });
  }
}

const defaultIp = (request: Request): string => clientAddress(request) ?? "unknown";

function limitKey(d: RouteDeps, request: Request, limit: RateLimit, session: VerifiedSession | null): string {
  const who = limit.by === "user" ? session?.userId : limit.by === "session" ? session?.sessionId : (d.clientIp ?? defaultIp)(request);
  if (!who) throw new AppError("SERVER_ERROR", "A route limit needs a person or session but there is none");
  return `${limit.name}|${limit.by}|${who}`;
}

/**
 * Counts the request against each declared limit; the first one (in the declared order) over its max refuses with RATE_LIMITED and the seconds to wait. The counters are
 * kept at the same time (one wait for the database, not one per limit: sign-in has two); a request refused by one limit is therefore still counted by the others.
 */
async function applyLimits(d: RouteDeps, request: Request, limits: readonly RateLimit[] | undefined, session: VerifiedSession | null, traceId: string): Promise<void> {
  if (!limits || limits.length === 0) return;
  const store = (d.rateLimits ??= createMemoryRateLimitStore());
  const hits = await Promise.all(limits.map((limit) => store.hit(limitKey(d, request, limit, session), limit.windowSeconds)));
  for (const [i, limit] of limits.entries()) {
    const hit = hits[i];
    if (hit.count > effectiveMax(limit, (d.clientIp ?? defaultIp)(request))) {
      d.logger.warn("request throttled", { traceId, limit: limit.name, by: limit.by });
      throw new AppError("RATE_LIMITED", limit.message, { retryAfterSeconds: hit.resetInSeconds });
    }
  }
}

export function createRouteFactory(deps: RouteDeps | (() => RouteDeps)) {
  const getDeps = typeof deps === "function" ? deps : () => deps;

  async function execute<S extends VerifiedSession | null, T>(
    request: Request,
    context: Parameters<RouteHandler>[1],
    definition: BaseDefinition<Schema | undefined, Schema | undefined, Schema | undefined> & {
      access: "public" | { key: string; level: Level } | "session";
      cors?: PublicDefinition<undefined, undefined, undefined, T>["cors"];
      cache?: string;
      handler(ctx: RouteContext<S, never, never, never>): Promise<RouteResult<T>>;
    },
  ): Promise<Response> {
    const d = getDeps();
    let corsOrigin: string | null = null;
    /** The CORS headers (when the origin is a registered domain) and the cache header of a good public GET. */
    const decorate = (response: Response): Response => {
      if (corsOrigin !== null) {
        response.headers.set("access-control-allow-origin", corsOrigin);
        response.headers.append("vary", "Origin");
        if (request.method.toUpperCase() === "OPTIONS") {
          response.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
          response.headers.set("access-control-allow-headers", "Content-Type");
          response.headers.set("access-control-max-age", "600");
        }
      }
      if (definition.cache && (response.status === 200 || response.status === 304) && request.method.toUpperCase() === "GET") response.headers.set("cache-control", definition.cache);
      return response;
    };
    const traceId = traceIdFromRequest(request);
    const failureWork: (() => Promise<void>)[] = [];
    let claim: { userId: string; hotelId: string; key: string } | null = null;
    // an API access key's call (session.client "token"): kept outside the try, so a failed write is audited too
    let keyCall: VerifiedSession | null = null;
    let keyRefused = false;
    // a hotel write inside a FULL visit (platform 0135): kept outside the try, so a failed one is in the platform log too
    let visitWrite: VerifiedSession | null = null;
    const visitEvent = async (status: number): Promise<void> => {
      if (!visitWrite) return;
      try {
        await d.onVisitWrite?.(visitWrite, request, traceId, status);
      } catch (error) {
        d.logger.error("could not record a write inside a hotel", { traceId, cause: error instanceof Error ? error.name : "unknown" });
      }
    };
    const keyEvent = async (event: Parameters<NonNullable<RouteDeps["onTokenEvent"]>>[3]): Promise<void> => {
      if (!keyCall) return;
      try {
        await d.onTokenEvent?.(keyCall, request, traceId, event);
      } catch (error) {
        d.logger.error("could not record an API key event", { traceId, kind: event.kind, cause: error instanceof Error ? error.name : "unknown" });
      }
    };
    try {
      // 1. who is calling (a public route is throttled first: there is nobody to identify yet)
      let session: VerifiedSession | null = null;
      if (definition.access === "public") await applyLimits(d, request, definition.limits, null, traceId);
      const origin = request.headers.get("origin");
      if (definition.access === "public" && definition.cors && origin !== null) {
        try {
          if (await definition.cors(origin, (await context?.params) ?? {})) corsOrigin = origin;
        } catch {
          corsOrigin = null;
        }
      }
      if (definition.access !== "public") {
        const authStarted = performance.now();
        session = await d.resolveSession(request);
        if (!session) throw new AppError((d.endedReason ? await d.endedReason(request).catch(() => null) : null) ?? "SESSION_EXPIRED");
        // (a platform, super or group account is never served from the resolver's cache, so an Enter-hotel visit opened or ended a moment ago on another
        // instance is already in this session: the checks below see the visit, its hotel and its read-only rule, or the 403)
        authTime.set(request, performance.now() - authStarted);
        // a locked screen is locked on the server: a reload, a new tab or a script gets nothing but the lock until the password is given
        if (session.locked && definition.whileLocked !== true) throw new AppError("SCREEN_LOCKED");
        // 1a. an API access key: its own rules before anything else (the deny list, its scope, read vs full), its own per-minute limit, and a first use from a new address noted
        if (session.client === "token" && session.token) {
          keyCall = session;
          const verdict = tokenCallVerdict(session.token, request.method, new URL(request.url).pathname);
          if (!verdict.allowed) {
            keyRefused = true;
            await keyEvent({ kind: "refused", why: verdict.why });
            throw new AppError("FORBIDDEN", verdict.why);
          }
          await applyLimits(d, request, [{ name: "api-token", max: session.token.callsPerMinute, windowSeconds: 60, by: "session" }], session, traceId);
          if (session.token.newIp) await keyEvent({ kind: "new_ip" });
        }
        // 1b. platform staff INSIDE a hotel (Enter hotel): a view visit writes nothing in the hotel, a full visit (platform 0135) everything but the deny lists;
        // refused here, before anything else looks at it (BACKEND.md 14.7). Not the screens' job: this holds for any client. Console, sign-in/out and profile always write.
        const visitVerdict = session.visit ? visitWriteVerdict(session, request.method, new URL(request.url).pathname) : null;
        if (session.visit && visitVerdict && !visitVerdict.allowed) {
          const refused = new AppError("FORBIDDEN", visitVerdict.why);
          try {
            await d.onVisitWriteRefused?.(session, request, traceId);
          } catch (error) {
            d.logger.error("could not record a refused write inside a hotel", { traceId, cause: error instanceof Error ? error.name : "unknown" });
          }
          throw refused;
        }
        if (session.visit && isHotelWrite(request.method, new URL(request.url).pathname)) visitWrite = session;
        // 2. may they. A guest or company portal account never reaches a hotel module, whatever grants its role or overrides carry (user kinds are never mixed)
        if (definition.access !== "session" && isPortalAccount(session)) throw new AppError("FORBIDDEN", "Guest and company accounts open only their own portal.");
        if (definition.access !== "session") requirePermission(session, d.catalog, definition.access.key, definition.access.level);
        // a module route belongs to a hotel: an account with none (a Group Hotel Admin or platform staff outside a visit) gets a plain 403, never a database error
        if (definition.access !== "session" && session.hotelId === "") throw new AppError("FORBIDDEN", "This account is not inside a hotel. Open a hotel first, or use the console.");
        await applyLimits(d, request, definition.limits, session, traceId);
        // the idle-window touch is a write the answer need not wait for: after the answer when the host allows it, in line otherwise (tests)
        if (definition.touch !== false && d.touchSession) {
          const who = session;
          const touch = (): Promise<void> => d.touchSession!(who);
          if (d.defer) d.defer(touch);
          else await touch();
        }
      }
      const method = request.method.toUpperCase();
      const unsafe = !SAFE_METHODS.has(method);
      // 3. cookie sessions must come from our own pages when they write
      if (unsafe && session?.client === "web") assertSameOrigin(request);
      // a public write (sign-in) has no session to protect yet, but a login CSRF still plants an attacker's session: refuse a cross-site one
      if (unsafe && !session && corsOrigin === null) assertNotCrossSite(request);

      // 4. strict, bounded input
      const params = definition.params ? parseInput(definition.params, await context?.params) : undefined;
      const query = definition.query ? parseInput(definition.query, readQuery(request)) : undefined;
      let rawBody: unknown;
      const body = definition.body ? parseInput(definition.body, (rawBody = await readBody(request, bodyLimit(definition.maxBodyBytes)))) : undefined;

      // 5. Idempotency-Key
      const mode = definition.idempotency ?? (unsafe && definition.body ? "optional" : "off");
      const key = request.headers.get(IDEMPOTENCY_HEADER);
      if (mode !== "off" && unsafe) {
        if (key === null && mode === "required") throw new AppError("VALIDATION_FAILED", undefined, { fields: { "Idempotency-Key": "Required" } });
        if (key !== null) {
          if (!IDEMPOTENCY_KEY_SHAPE.test(key)) throw new AppError("VALIDATION_FAILED", undefined, { fields: { "Idempotency-Key": "Not valid" } });
          if (!session) throw new AppError("VALIDATION_FAILED", undefined, { fields: { "Idempotency-Key": "Not allowed on a public route" } });
          // the keys live in a HOTEL table (idempotency_keys): an account with no hotel (Super Admin / platform staff in the console, a Group Hotel Admin outside a visit) has no table
          // to keep one in, and opening a hotel with "" is refused. The console's writes are plain updates of settings and records, so the key is checked for its shape and then not kept.
          if (session.hotelId !== "") {
            const scope = { userId: session.userId, hotelId: session.hotelId, key };
            const start = await d.idempotency.begin(scope, requestHash(method, new URL(request.url).pathname, rawBody, d.idempotencyKey?.()), { method, path: new URL(request.url).pathname });
            if (start.state === "mismatch") throw new AppError("IDEMPOTENCY_KEY_REUSED");
            if (start.state === "in_progress") throw new AppError("REQUEST_IN_PROGRESS");
            if (start.state === "replay") {
              return Response.json(start.body, { status: start.status, headers: { "cache-control": "no-store", [TRACE_HEADER]: traceId, "idempotent-replayed": "true" } });
            }
            claim = scope;
          }
        }
      }

      // 5b. a hotel write inside a FULL visit is written to the platform log BEFORE it is done (the intent: who, hotel, route, time; the row after the work then says how it ended, with
      // the same trace id), so a crash in the middle cannot lose it. A row that cannot be written means the change is not made (security review round 3, R3-8).
      if (visitWrite && d.onVisitWriteIntent) {
        try {
          await d.onVisitWriteIntent(visitWrite, request, traceId);
        } catch (error) {
          d.logger.error("could not record the intent of a write inside a hotel: the write was not made", { traceId, cause: error instanceof Error ? error.name : "unknown" });
          throw new AppError("SERVER_ERROR");
        }
      }

      // 6. the work (a key in test mode: inside the test-mode context, so no real mail; runtime/testMode.ts)
      const work = () =>
        definition.handler({
          request,
          traceId,
          session: session as S,
          params: params as never,
          query: query as never,
          body: body as never,
          failAfterCommit: (job) => void failureWork.push(job),
          clearLimit: async (name) => {
            const limit = definition.limits?.find((l) => l.name === name);
            if (limit && d.rateLimits) await d.rateLimits.reset(limitKey(d, request, limit, session));
          },
        });
      const result = session?.token?.testMode ? await runInTestMode(session.token.name, work) : await work();
      // every write made with a key is in the audit trail as "API token: <name>"
      if (keyCall && unsafe) await keyEvent({ kind: "write", status: result.status ?? 200 });
      await visitEvent(result.status ?? 200);
      if (result.eventStream) {
        return new Response(result.eventStream, {
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-store, no-transform", "x-accel-buffering": "no", "x-content-type-options": "nosniff", [TRACE_HEADER]: traceId },
        });
      }
      if (result.binary) {
        // a document is never replayed from the idempotency store: only a write claims a key
        const safeName = result.binary.filename.replace(/[^A-Za-z0-9._-]/g, "-");
        return decorate(new Response(result.binary.bytes as BodyInit, {
          status: 200,
          headers: { "content-type": result.binary.contentType, "content-disposition": `${result.binary.disposition ?? "inline"}; filename="${safeName}"`, "content-length": String(result.binary.bytes.byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff", [TRACE_HEADER]: traceId },
        }));
      }
      // a GET that may be kept by the browser (`cache`) carries an ETag and answers 304 to a matching If-None-Match (T2); a GET never holds an idempotency claim
      const response = definition.cache && (result.status ?? 200) === 200 && request.method.toUpperCase() === "GET" && !claim
        ? jsonOkRevalidated(result.data, traceId, request.headers.get("if-none-match"), result.headers)
        : jsonOk(result.data, traceId, result.status ?? 200, result.headers);
      if (claim) {
        await d.idempotency.complete(claim, { status: response.status, body: { data: result.data } });
        claim = null;
      }
      return decorate(response);
    } catch (error) {
      if (claim) {
        try {
          await d.idempotency.abandon(claim);
        } catch (abandonError) {
          d.logger.error("idempotency key could not be released", { traceId, cause: abandonError });
        }
      }
      for (const work of failureWork) {
        try {
          await work();
        } catch (workError) {
          d.logger.error("work after a failed request did not complete", { traceId, cause: workError });
        }
      }
      const response = jsonError(error, traceId, d.logger);
      // a write made with a key that failed is audited too (a call its rules refused already was)
      if (keyCall && !keyRefused && !SAFE_METHODS.has(request.method.toUpperCase())) await keyEvent({ kind: "write", status: response.status });
      await visitEvent(response.status);
      // the host's body cap: the same error body, with the status that says what happened (413 Content Too Large)
      return decorate(error instanceof HostBodyTooLarge ? new Response(response.body, { status: 413, headers: response.headers }) : response);
    }
  }

  /** Server time of every answer: a `Server-Timing: app;dur=<ms>` header (read by the speed scripts and the browser's network panel) and a log line when slow. */
  async function timed(request: Request, run: () => Promise<Response>): Promise<Response> {
    const started = performance.now();
    const response = await run();
    const ms = Math.round((performance.now() - started) * 10) / 10;
    const auth = authTime.get(request);
    response.headers.set("server-timing", `app;dur=${ms}${auth === undefined ? "" : `, auth;dur=${Math.round(auth * 10) / 10}`}`);
    if (ms >= SLOW_REQUEST_MS) getDeps().logger.warn("slow request", { traceId: response.headers.get(TRACE_HEADER), method: request.method, path: new URL(request.url).pathname, ms, status: response.status });
    return response;
  }

  return {
    /** A route for a signed-in person. `permission` is the module/part key and lowest level, or "session" for any signed-in person. */
    route<P extends Schema | undefined = undefined, Q extends Schema | undefined = undefined, B extends Schema | undefined = undefined, T = unknown>(
      definition: AuthedDefinition<P, Q, B, T>,
    ): RouteHandler {
      return (request, context) => timed(request, () => execute(request, context, { ...definition, access: definition.permission } as never));
    },
    /** A route anyone may call (health, sign-in). It never sees a session. */
    publicRoute<P extends Schema | undefined = undefined, Q extends Schema | undefined = undefined, B extends Schema | undefined = undefined, T = unknown>(
      definition: PublicDefinition<P, Q, B, T>,
    ): RouteHandler {
      return (request, context) => timed(request, () => execute(request, context, { ...definition, access: "public" } as never));
    },
  };
}

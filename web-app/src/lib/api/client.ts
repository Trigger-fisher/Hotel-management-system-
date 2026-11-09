// The one HTTP layer between the web app and /api/v1. Every adapter goes through `http()` (raw) or `dash()` (the dashboards' DashResult).
// Rules (docs/API.md "How a route is built", docs/ERROR_HANDLING.md):
//  - same-origin fetch with the cookie session (httpOnly `__Host-hms_session`), no token in script;
//  - success is `{ data }`, failure is `{ error: { code, message, traceId, details } }`; nothing here ever throws;
//  - every write carries an Idempotency-Key (a retry of the same action reuses its key, a new action gets a new one);
//  - 401 ends the session: listeners (the sign-in flow) are told once and the screen returns to sign-in;
//  - 429 keeps `Retry-After`; a network failure is NETWORK_OFFLINE when the browser says offline, else SERVER_ERROR;
//  - a `dash` GET is remembered for 20 s in this tab (getCache.ts); every write and every 401 forget it; `fresh: true` reads the server.
import type { DashError, DashErrorCode, DashResult } from '@shared/dashboards/common';

import { clearGetCache, rememberGet } from './getCache';
import { emitScreenLocked, emitSessionEnded } from './sessionEvents';

export const API_BASE = '/api/v1';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RawError {
  status: number;
  code: string;
  message: string;
  traceId: string;
  details?: { fields?: Record<string, string>; currentVersion?: number; retryAfterSeconds?: number; attemptsLeft?: number; reason?: string };
}

export type Raw<T> = { ok: true; data: T; status: number; replayed: boolean } | { ok: false; error: RawError };

export interface RequestOptions {
  /** Query string. Undefined, null and empty values are left out; a repeated name is never sent (the server refuses it). */
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  /** Extra request headers (the sign-in forms' Turnstile token). */
  headers?: Record<string, string>;
  /** Reuse this key to retry the same action; omitted, a fresh one is made for every write. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** false: send no Idempotency-Key (the auth routes are not idempotent). */
  idempotent?: boolean;
  /** Auth screens answer 401 themselves (a wrong password is a 401): do not end the session for it. */
  keepSessionOn401?: boolean;
  /** GET through `dash`: read the server, not the 20 s memory of answers (getCache.ts). For the polls that must see the latest (a run's state, a PC's heartbeat). */
  fresh?: boolean;
}

const KEY_CHARS = /[^A-Za-z0-9_-]/g;

/** 8 to 128 of A-Z a-z 0-9 _ -  (what the server accepts). */
export function newIdempotencyKey(): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `k-${id}`.replace(KEY_CHARS, '-').slice(0, 128);
}

export function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function fail(status: number, code: string, message: string, traceId = 'no-trace', details?: RawError['details']): Raw<never> {
  return { ok: false, error: { status, code, message, traceId, ...(details ? { details } : {}) } };
}

function isEnvelope(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** One request, one answer. Never throws. */
export async function http<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<Raw<T>> {
  if (offline()) return fail(0, 'NETWORK_OFFLINE', 'NETWORK_OFFLINE');
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (method !== 'GET' && opts.idempotent !== false) headers['Idempotency-Key'] = opts.idempotencyKey ?? newIdempotencyKey();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${buildQuery(opts.query)}`, { method, headers, body, credentials: 'same-origin', cache: 'no-store', signal: opts.signal });
  } catch (e) {
    // a write that may or may not have reached the server: the next read asks the server
    if (method !== 'GET') clearGetCache();
    if (e instanceof DOMException && e.name === 'AbortError') return fail(0, 'ABORTED', 'ABORTED');
    return fail(0, offline() ? 'NETWORK_OFFLINE' : 'SERVER_ERROR', offline() ? 'NETWORK_OFFLINE' : 'SERVER_ERROR');
  }

  // After a write (whatever its answer) the remembered GET answers may be out of date; after a 401 nothing of the session may stay in memory.
  if (method !== 'GET' || res.status === 401) clearGetCache();
  const traceId = res.headers.get('x-trace-id') ?? 'no-trace';
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON: handled below */
  }

  if (res.ok && isEnvelope(json) && 'data' in json) {
    return { ok: true, data: json.data as T, status: res.status, replayed: res.headers.get('idempotent-replayed') === 'true' };
  }

  const e = isEnvelope(json) && isEnvelope(json.error) ? json.error : null;
  const details = e && isEnvelope(e.details) ? (e.details as RawError['details']) : undefined;
  const retry = Number(res.headers.get('retry-after'));
  const merged = Number.isFinite(retry) && retry > 0 ? { ...details, retryAfterSeconds: details?.retryAfterSeconds ?? retry } : details;
  const code = e && typeof e.code === 'string' ? e.code : res.status === 401 ? 'SESSION_EXPIRED' : 'SERVER_ERROR';
  const message = e && typeof e.message === 'string' ? e.message : code;
  const error = fail(res.status, code, message, e && typeof e.traceId === 'string' ? e.traceId : traceId, merged);
  if (res.status === 401 && !opts.keepSessionOn401) emitSessionEnded(code);
  if (res.status === 423 && code === 'SCREEN_LOCKED') emitScreenLocked();
  return error;
}

/* ------------------------------------------------------------------ the dashboards' result shape */

const DASH_CODES = new Set<string>(['NOT_FOUND', 'FORBIDDEN', 'VALIDATION_FAILED', 'CONFLICT', 'NETWORK_OFFLINE', 'SERVER_ERROR', 'SESSION_EXPIRED', 'RATE_LIMITED', 'REQUEST_IN_PROGRESS', 'IDEMPOTENCY_KEY_REUSED']);

/** The server's code when the dashboards know it; otherwise the nearest one for the HTTP status (SESSION_REPLACED is a 401, so SESSION_EXPIRED). */
function dashCode(status: number, code: string): DashErrorCode {
  if (DASH_CODES.has(code)) return code as DashErrorCode;
  if (status === 401) return 'SESSION_EXPIRED';
  if (status === 403 || status === 423) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422 || status === 400) return 'VALIDATION_FAILED';
  if (status === 429) return 'RATE_LIMITED';
  return 'SERVER_ERROR';
}

/** The server's error as the dashboards' DashError, 1:1 on the code; the server's sentence stays in `message` (serverSentence()). */
export function toDashError(e: RawError): DashError {
  const code = dashCode(e.status, e.code);
  const d = e.details;
  const details: NonNullable<DashError['details']> = {};
  if (d?.fields) details.fields = d.fields;
  if (d?.currentVersion !== undefined) details.currentVersion = d.currentVersion;
  if (d?.retryAfterSeconds !== undefined) details.retryAfterSeconds = d.retryAfterSeconds;
  if (typeof d?.reason === 'string') details.reason = d.reason;
  if (e.code !== code) details.serverCode = e.code;
  return { code, message: e.message || code, traceId: e.traceId, ...(Object.keys(details).length ? { details } : {}) };
}

async function dashOnce<T>(method: Method, path: string, opts: RequestOptions): Promise<DashResult<T>> {
  const r = await http<T>(method, path, opts);
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: toDashError(r.error) };
}

/**
 * `http()` as a DashResult, for the module adapters. A GET is remembered for 20 s under its full address (getCache.ts), and identical GETs in flight
 * share one request; `fresh: true` and a GET with its own `signal` (a typeahead that cancels) always ask the server.
 */
export function dash<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<DashResult<T>> {
  if (method !== 'GET' || opts.fresh || opts.signal) return dashOnce<T>(method, path, opts);
  return rememberGet<T>(`${path}${buildQuery(opts.query)}`, () => dashOnce<T>(method, path, opts));
}

/** `http()` mapped over its data (the server sends one shape, the screen wants another). */
export async function dashMap<T, U>(method: Method, path: string, opts: RequestOptions, map: (data: T) => U): Promise<DashResult<U>> {
  const r = await dash<T>(method, path, opts);
  return r.ok ? { ok: true, data: map(r.data) } : r;
}

export const get = <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal, opts: Pick<RequestOptions, 'fresh'> = {}) => dash<T>('GET', path, { query, signal, ...opts });
export const post = <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) => dash<T>('POST', path, { ...opts, body });
export const patch = <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) => dash<T>('PATCH', path, { ...opts, body });
export const put = <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) => dash<T>('PUT', path, { ...opts, body });
export const del = <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) => dash<T>('DELETE', path, { ...opts, body });

// Which API the app talks to: the real /api/v1 server or the in-memory mocks of ui-shared.
//   NEXT_PUBLIC_API=real | mock   (default: real in production builds, mock in development)
// The /dev previews and the tests always use the mocks; `?api=mock` or `?api=real` in the address overrides it for the rest of that browser tab.
// Every module picks its API once, at load, through `chooseApi(real, mock)`.
import { setDefaultMockLatency } from '@shared/dashboards/common';
import { setVisitReadOnly } from '@shared/dashboards/features';

export type ApiMode = 'real' | 'mock';

// The local demo build (docs/UI.md) is for clicking through: mock answers take 40 ms, not the 500 ms that shows the skeletons in development.
if (process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO === '1') setDefaultMockLatency(40);

const TAB_KEY = 'hms-api-mode';

/** `?api=` is remembered for the tab: the sign-in flow rewrites the address to `/`, and groups that load later must still see the same choice. */
function tabMode(asked: string | null): ApiMode | null {
  try {
    if (asked === 'mock' || asked === 'real') {
      sessionStorage.setItem(TAB_KEY, asked);
      return asked;
    }
    const kept = sessionStorage.getItem(TAB_KEY);
    return kept === 'mock' || kept === 'real' ? kept : null;
  } catch {
    // private window or storage blocked: only the address counts
    return asked === 'mock' || asked === 'real' ? asked : null;
  }
}

export function apiMode(): ApiMode {
  // A normal production build never serves the mock, not even for `?api=mock` or a remembered tab choice.
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO !== '1') return 'real';
  if (typeof location !== 'undefined') {
    if (location.pathname.startsWith('/dev/')) return 'mock';
    const kept = tabMode(new URLSearchParams(location.search).get('api'));
    if (kept) return kept;
  }
  const env = process.env.NEXT_PUBLIC_API;
  if (env === 'real' || env === 'mock') return env;
  // NEXT_PUBLIC_HMS_LOCAL_DEMO=1 is the one build-time flag that keeps the mock in a local production build (docs/UI.md, "Local demo build").
  return process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO !== '1' ? 'real' : 'mock';
}

// ---- Read-only view (docs/UI.md section 5): a hotel entered from the Platform console ----
// While it is on, every WRITE method of a hotel module's api answers a FORBIDDEN result at once, without calling the server or the mock;
// reads go through. The shell (RoleDashboard) turns it on and off. Checked at CALL time: the api objects are made once, at module load.

let readOnlyMessage: string | null = null;

/** Turns the read-only view on (with the sentence the refused calls carry) or off (null). */
export function setReadOnlyView(message: string | null): void {
  readOnlyMessage = message;
  setVisitReadOnly(message !== null);
}

/** The read-only sentence while the view is on, else null. */
export function readOnlyView(): string | null {
  return readOnlyMessage;
}

/**
 * A method name that changes data (taken from the method names of ui-shared/dashboards/*.ts and lib/api/adapters/*.ts): the verb is the
 * first camelCase word, so `createBill`, `checkIn`, `undoRefund` are writes and `getBill`, `listRooms`, `checkGstin`, `lookupCompanies` are not.
 * Anything not on the list (get, list, search, suggest, lookup, preview, view, export, validate, check..., options, ledger...) is a read.
 */
const WRITE_METHOD =
  /^(activate|add|apply|approve|archive|assign|block|book|bulk|bump|cancel|change|checkIn|checkOut|clear|close|confirm|connect|convert|create|deactivate|decline|delete|disable|disconnect|email|enable|extend|generate|google|import|invite|lock|log|make|mark|move|pay|place|post|process|purge|push|reactivate|record|refund|regenerate|reject|rejoin|remove|rename|reopen|reorder|reset|resend|resolve|restore|reverse|revise|revoke|run|save|seed|send|set|settle|start|stop|submit|suspend|sync|toggle|transfer|unblock|undo|unlock|update|upload|void|write)(?=[A-Z0-9_]|$)/;
/** Local, synchronous helpers that look like writes but only tell the mock who is working: never refused. Also the banner's "Extend 60 minutes": it is the visit's own call (the server decides). */
const NEVER_REFUSED = new Set(['setActor', 'subscribe', 'extendHotelVisit', 'extendMemberHotel']);

export function isWriteMethod(name: string): boolean {
  return !NEVER_REFUSED.has(name) && WRITE_METHOD.test(name);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** The api object seen through the read-only rule: write methods are refused while `readOnlyView()` is on. */
function guarded<T>(api: T): T {
  if (!isPlainObject(api)) return api;
  const wrapped = new Map<PropertyKey, unknown>();
  return new Proxy(api, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function' || typeof key !== 'string' || !isWriteMethod(key)) return value;
      // One wrapper per method, so a method passed around (or used as a hook dependency) keeps its identity.
      let fn = wrapped.get(key);
      if (!fn) {
        fn = function (this: unknown, ...args: unknown[]) {
          const message = readOnlyMessage;
          if (message !== null) return Promise.resolve({ ok: false, error: { code: 'FORBIDDEN', message, traceId: 'read-only' } });
          return (value as (...a: unknown[]) => unknown).apply(this, args);
        };
        wrapped.set(key, fn);
      }
      return fn;
    },
  }) as T;
}

/**
 * `real()` and `mock()` are called lazily: only the chosen one runs. A hotel module's api is guarded by the read-only view (above);
 * pass `{ guard: false }` for an api that is not hotel business data (sign-in, the person's own preferences, search).
 */
export function chooseApi<T>(real: () => T, mock: () => T, options: { guard?: boolean } = {}): T {
  const api = apiMode() === 'real' ? real() : slowedMock(mock());
  return options.guard === false ? api : guarded(api);
}

/**
 * Dev only: `sessionStorage['hms-mock-latency'] = '600'` makes EVERY mock answer wait that many extra milliseconds, like a real server would (tools/refresh-metrics.mjs
 * uses it to measure how a refresh feels). Read at call time; nothing happens without the key, and never in a production build.
 */
function slowedMock<T>(api: T): T {
  if (process.env.NODE_ENV === 'production' || !isPlainObject(api)) return api;
  const wrapped = new Map<PropertyKey, unknown>();
  return new Proxy(api, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function' || typeof key !== 'string') return value;
      let fn = wrapped.get(key);
      if (!fn) {
        fn = function (this: unknown, ...args: unknown[]) {
          const result = (value as (...a: unknown[]) => unknown).apply(this, args);
          let ms = 0;
          try {
            ms = Number(sessionStorage.getItem('hms-mock-latency')) || 0;
          } catch {
            ms = 0;
          }
          if (ms <= 0 || !result || typeof (result as { then?: unknown }).then !== 'function') return result;
          return new Promise((resolve, reject) => setTimeout(() => (result as Promise<unknown>).then(resolve, reject), ms));
        };
        wrapped.set(key, fn);
      }
      return fn;
    },
  }) as T;
}

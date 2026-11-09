// The one door to the in-memory mocks (ui-shared/mocks): every `groups/*/api.ts` builds its mock through `loadMocks()`, so the mock
// factories, their seeds and the demo fixtures are a separate chunk that only a dev build or the local demo build
// (NEXT_PUBLIC_HMS_LOCAL_DEMO=1, docs/UI.md) contains. A normal production build folds the condition below to false, so the dynamic
// import is dead code and Next emits no mock chunk at all (apiMode() in ./mode.ts never asks for a mock there anyway).
// App code never imports `@shared/mocks` or a `*.mock.ts` file directly: only this file, the api.ts files (through it) and src/app/dev/**.
import type * as Mocks from '@shared/mocks';

export type MockModule = typeof Mocks;

/** The mock module, loaded once. Rejects in a normal production build (there is no mock to load). */
export function loadMocks(): Promise<MockModule> {
  // Both parts are literal so Next inlines them: keep the expression exactly like this (same gate as lib/auth/api.ts and next.config.ts).
  return process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO === '1'
    ? import('@shared/mocks')
    : Promise.reject(new Error('This build has no mock APIs.'));
}

type AnyFn = (...args: unknown[]) => unknown;

/**
 * A stand-in for a mock api object that is still loading. Every method can be called at once: before the mock has loaded the call waits
 * for it and then runs (methods already return Promises, so callers notice nothing); afterwards it goes straight through.
 * The few synchronous methods of the mocks (setActor, resetToSeed: both return nothing) are queued the same way and run, in call order,
 * as soon as the mock is there. One wrapper per method name, so a method passed around keeps its identity.
 */
export function lazyMock<T extends object>(load: () => Promise<T>): T {
  let real: T | null = null;
  const ready = load().then((r) => {
    real = r;
    return r;
  });
  // A failed load surfaces on the calls that wait for it; this only keeps it from being reported twice as unhandled.
  ready.catch(() => {});
  const wrappers = new Map<string, AnyFn>();
  return new Proxy({} as T, {
    get(_target, key) {
      if (real) {
        const value = Reflect.get(real, key) as unknown;
        if (typeof value !== 'function') return value;
      }
      // Not a thenable (awaiting the api object must not wait on a "then" method), and no symbol lookups before load.
      if (typeof key !== 'string' || key === 'then') return undefined;
      let fn = wrappers.get(key);
      if (!fn) {
        fn = (...args: unknown[]) => {
          if (real) return (Reflect.get(real, key) as AnyFn).apply(real, args);
          return ready.then((r) => (Reflect.get(r, key) as AnyFn).apply(r, args));
        };
        wrappers.set(key, fn);
      }
      return fn;
    },
  });
}

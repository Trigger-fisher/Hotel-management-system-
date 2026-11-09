// Demo only (dev and local-demo builds): makes every call of a portal mock answer "not linked" or "inactive", so both friendly pages can be seen without a server.
// In the browser console: window.__portalState = 'notLinked' (or 'inactive'), then open any portal page; delete window.__portalState to go back.
import type { DashError } from './common';
import { portalCopy, type PortalKind } from './portalState';

export function withPortalDemo<T extends object>(api: T, portal: PortalKind): T {
  return new Proxy(api, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      const demo = (globalThis as { __portalState?: string }).__portalState;
      if (typeof value !== 'function' || (demo !== 'notLinked' && demo !== 'inactive')) return value;
      const inactive = demo === 'inactive';
      const error: DashError = {
        code: 'CONFLICT',
        message: inactive ? portalCopy.fallback.inactive : portalCopy.fallback[portal],
        traceId: 'mock-portal-state',
        details: { serverCode: inactive ? 'PORTAL_INACTIVE' : 'PORTAL_NOT_LINKED', fields: { portal } },
      };
      return () => Promise.resolve({ ok: false as const, error });
    },
  });
}

// Helpers every Platform console section adapter shares (lib/api/adapters/platform.ts assembles the sections; docs/sessions/reports/PLATFORM-REAL-WIRING.md).
// Errors pass through untouched: client.ts already turns the server's { error } into the contract's DashError (code 1:1, serverCode kept).
import type { PlatformApi } from '@shared/dashboards/platform';

export type { PlatformApi };
export { notYet } from '../notYet';
export { pick, snapPageSize } from '../payrollShared';

/** One path segment (an id, a slug, a token): always encoded. */
export const seg = (s: string): string => encodeURIComponent(s);

/** Platform console routes live under /api/v1/platform (client.ts adds /api/v1). */
export const platformPath = (...parts: string[]): string => `/platform${parts.map((p) => `/${seg(p)}`).join('')}`;

/** A date-time for the contract: the server's ISO string (or Date-serialised string) as UTC ISO, null kept as null. */
export function iso(x: string | null | undefined): string | null {
  if (x === null || x === undefined || x === '') return null;
  const t = Date.parse(x);
  return Number.isFinite(t) ? new Date(t).toISOString() : x;
}

/** A search box value for a query string: trimmed, empty left out. */
export const searchWord = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t ? t : undefined;
};

/** A boolean query flag sent only when true ("true"); false and absent mean the server's default. */
export const trueFlag = (b: boolean | undefined): 'true' | undefined => (b ? 'true' : undefined);

/** 'all' (the screens' "no filter") is not sent: the server's default is all. */
export const filterValue = <T extends string>(v: T | 'all' | undefined): T | undefined => (v === undefined || v === 'all' ? undefined : (v as T));

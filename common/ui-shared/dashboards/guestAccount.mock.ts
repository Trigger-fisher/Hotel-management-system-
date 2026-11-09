// The in-memory mock of guestAccount.ts (dev and local-demo builds only): the demo guest's own sign-in history, newest first, with a failed attempt among them.
import type { DashResult, MockClock } from './common';
import { mockCall, mockError, ok } from './common';
import type { GuestSignIn, GuestSignInList } from './guestAccount';

const hoursAgo = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();
const SEED: GuestSignIn[] = [
  { id: 'si-1', at: hoursAgo(0.2), ok: true, device: 'Chrome on Android', ip: '49.36.12.8', ended: false },
  { id: 'si-2', at: hoursAgo(26), ok: true, device: 'Safari on iPhone', ip: '49.36.12.8', ended: true },
  { id: 'si-3', at: hoursAgo(27), ok: false, device: 'Safari on iPhone', ip: '49.36.12.8', ended: true },
  { id: 'si-4', at: hoursAgo(120), ok: true, device: 'Chrome on Windows', ip: '103.21.44.190', ended: true },
];

export function createGuestAccountMock(clock: MockClock = {}) {
  return {
    /** GET /guest/sign-ins: the guest's own sign-ins, newest first; pageSize 10, 25 or 50. */
    signIns(q: { page?: number; pageSize?: number } = {}): Promise<DashResult<GuestSignInList>> {
      return mockCall(() => {
        const pageSize = q.pageSize ?? 25;
        if (![10, 25, 50].includes(pageSize)) return mockError('VALIDATION_FAILED', { pageSize: 'Choose 10, 25 or 50 rows.' });
        const page = Math.max(1, q.page ?? 1);
        return ok({ items: SEED.slice((page - 1) * pageSize, page * pageSize), total: SEED.length, page, pageSize, totals: { all: SEED.length, success: SEED.filter((s) => s.ok).length, failed: SEED.filter((s) => !s.ok).length } });
      }, clock);
    },
  };
}
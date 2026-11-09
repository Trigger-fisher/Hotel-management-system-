'use client';

// The vault re-check (MJ, 5 Nov 2026): the password again, or a 6-digit code emailed now; good for 5 minutes. The real server keeps it on the session
// (/api/v1/auth/recheck); the demo keeps it in this tab and takes the demo password or the demo code.
import type { DashResult } from '@shared/dashboards/common';
import { RECHECK_MINUTES } from '@shared/dashboards/security';

import * as client from '@/lib/api/client';
import { chooseApi } from '@/lib/api/mode';
import { tr } from '@/lib/i18n/language';

export interface Rechecked {
  rechecked: true;
  validUntil: string;
}
export interface RecheckCodeSent {
  challengeId: string;
  maskedEmail: string;
  resendAfterSeconds: number;
}
export interface RecheckApi {
  password(password: string): Promise<DashResult<Rechecked>>;
  sendCode(): Promise<DashResult<RecheckCodeSent>>;
  code(challengeId: string, code: string): Promise<DashResult<Rechecked>>;
}

export const RECHECK_REASON = 'recheck_required';

/** Does this refusal ask for a re-check? */
export const needsRecheck = (r: DashResult<unknown>): boolean => !r.ok && r.error.code === 'FORBIDDEN' && r.error.details?.reason === RECHECK_REASON;

let demoUntil = 0;
/** Demo only: is this tab re-checked now? The demo vaults ask it before a Show, as the server does. */
export function demoRechecked(): boolean {
  return Date.now() < demoUntil;
}
export function demoRecheckRefusal<T>(): DashResult<T> {
  return { ok: false, error: { code: 'FORBIDDEN', message: 'Confirm it is you to see this.', traceId: 'mock', details: { reason: RECHECK_REASON } } };
}

function mockRecheck(): RecheckApi {
  const done = (): DashResult<Rechecked> => {
    demoUntil = Date.now() + RECHECK_MINUTES * 60_000;
    return { ok: true, data: { rechecked: true, validUntil: new Date(demoUntil).toISOString() } };
  };
  const wrong = (field: string, text: string): DashResult<Rechecked> => ({ ok: false, error: { code: 'VALIDATION_FAILED', message: text, traceId: 'mock', details: { fields: { [field]: text } } } });
  return {
    async password(password) {
      const { PALLAV_DEMO_PASSWORD } = await import('@shared/auth-pallav/mock');
      return password === PALLAV_DEMO_PASSWORD ? done() : wrong('password', 'That password is not right. Try again.');
    },
    async sendCode() {
      return { ok: true, data: { challengeId: 'demo-recheck', maskedEmail: tr('your email'), resendAfterSeconds: 30 } };
    },
    async code(_challengeId, code) {
      const { PALLAV_DEMO_CODE } = await import('@shared/auth-pallav/mock');
      return code.replace(/\s/g, '') === PALLAV_DEMO_CODE ? done() : wrong('code', 'That code is not right. Check your latest email.');
    },
  };
}

// a wrong password or code answers 401: it must not sign the person out
const AUTH_CALL = { idempotent: false, keepSessionOn401: true } as const;

export const recheckApi: RecheckApi = chooseApi<RecheckApi>(
  () => ({
    password: (password) => client.post<Rechecked>('/auth/recheck', { password }, AUTH_CALL),
    sendCode: () => client.post<RecheckCodeSent>('/auth/recheck/code', undefined, AUTH_CALL),
    code: (challengeId, code) => client.post<Rechecked>('/auth/recheck/code/verify', { challengeId, code }, AUTH_CALL),
  }),
  mockRecheck,
);

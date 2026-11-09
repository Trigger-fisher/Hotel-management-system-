'use client';

// Platform settings > Sign-in security (MJ, 5 Nov 2026): the real server answers /api/v1/platform/security (Super Admin only); the demo keeps the values in this tab.
import type { DashResult } from '@shared/dashboards/common';
import {
  SESSION_KINDS, SESSION_MINUTES_DEFAULT, TEMP_PASSWORD_MINUTES_DEFAULT, validSessionMinutes, validTempPasswordMinutes,
  type SecuritySettings, type SecuritySettingsInput,
} from '@shared/dashboards/security';

import * as client from '@/lib/api/client';
import { chooseApi } from '@/lib/api/mode';

export interface SecurityApi {
  get(): Promise<DashResult<SecuritySettings>>;
  update(input: SecuritySettingsInput): Promise<DashResult<SecuritySettings>>;
}

function mockSecurity(): SecurityApi {
  let current: SecuritySettings = { sessionMinutes: { ...SESSION_MINUTES_DEFAULT }, tempPasswordMinutes: TEMP_PASSWORD_MINUTES_DEFAULT, updatedAt: null, updatedBy: null };
  return {
    async get() {
      return { ok: true, data: current };
    },
    async update(input) {
      const fields: Record<string, string> = {};
      for (const k of SESSION_KINDS) {
        const v = input.sessionMinutes?.[k];
        if (v !== undefined && !validSessionMinutes(v)) fields[`sessionMinutes.${k}`] = 'Choose a time from 15 minutes to 30 days.';
      }
      if (input.tempPasswordMinutes !== undefined && !validTempPasswordMinutes(input.tempPasswordMinutes)) fields.tempPasswordMinutes = 'Choose a time from 5 minutes to 24 hours.';
      if (Object.keys(fields).length) return { ok: false, error: { code: 'VALIDATION_FAILED', message: Object.values(fields)[0], traceId: 'mock', details: { fields } } };
      current = {
        sessionMinutes: { ...current.sessionMinutes, ...input.sessionMinutes } as SecuritySettings['sessionMinutes'],
        tempPasswordMinutes: input.tempPasswordMinutes ?? current.tempPasswordMinutes,
        updatedAt: new Date().toISOString(),
        updatedBy: 'You',
      };
      return { ok: true, data: current };
    },
  };
}

export const securityApi: SecurityApi = chooseApi<SecurityApi>(
  () => ({
    get: () => client.get<SecuritySettings>('/platform/security', undefined, undefined, { fresh: true }),
    update: (input) => client.put<SecuritySettings>('/platform/security', input),
  }),
  mockSecurity,
);

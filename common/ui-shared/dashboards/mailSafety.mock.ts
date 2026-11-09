// Bounces and holds in the mock preview: one held demo hotel and a few suppressed addresses, so the screen can be looked at; every action works on this in-memory copy only.
// The webhook addresses here are made up (the real ones carry the server's secret key), so the screen and Replace key can be looked at.
import type { DashResult } from './common';
import type { MailHold, MailSafetyApi, MailSafetyView, MailSuppression } from './mailSafety';
import { MAIL_SAFETY_LIMITS } from './mailSafety';

const ok = <T>(data: T): Promise<DashResult<T>> => Promise.resolve({ ok: true, data });
const fail = <T>(code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED', message: string): Promise<DashResult<T>> => Promise.resolve({ ok: false, error: { code, message, traceId: 'mock' } } as DashResult<T>);

export function createMailSafetyMock(): MailSafetyApi {
  const holds: MailHold[] = [
    { hotelId: 'h-2', hotelName: 'Sunrise Residency, Surat', held: true, reason: 'bounces', detail: 'bounces 7.5% of 400 mails in 7 days (limit 5%)', heldAt: '2026-10-17T09:30:00.000Z', heldByName: null, releasedAt: null, releasedByName: null, releaseReason: null },
    { hotelId: 'h-3', hotelName: 'Lakeview Inn, Udaipur', held: false, reason: 'manual', detail: 'A guest complained by phone', heldAt: '2026-10-10T06:00:00.000Z', heldByName: 'Sonal Super', releasedAt: '2026-10-11T05:00:00.000Z', releasedByName: 'Sonal Super', releaseReason: 'List cleaned by the hotel' },
  ];
  let suppressions: MailSuppression[] = [
    { id: 's-1', email: 'old.guest@example.com', hotelId: null, hotelName: null, reason: 'bounce', source: 'ses', detail: 'Permanent/General', createdAt: '2026-10-17T09:20:00.000Z', createdByName: null },
    { id: 's-2', email: 'travel.desk@example.in', hotelId: 'h-2', hotelName: 'Sunrise Residency, Surat', reason: 'complaint', source: 'brevo', detail: 'spam', createdAt: '2026-10-16T12:00:00.000Z', createdByName: null },
    { id: 's-3', email: 'do.not.mail@example.org', hotelId: null, hotelName: null, reason: 'manual', source: 'manual', detail: null, createdAt: '2026-10-12T08:00:00.000Z', createdByName: 'Sonal Super' },
  ];
  let next = 4;
  const previousKeyUntil: MailSafetyView['previousKeyUntil'] = { ses: null, brevo: null };
  const view = (search = ''): MailSafetyView => ({
    ready: true,
    holds: holds.map((h) => ({ ...h })).sort((a, b) => Number(b.held) - Number(a.held)),
    suppressions: suppressions.filter((s) => s.email.includes(search.trim().toLowerCase())).slice(0, MAIL_SAFETY_LIMITS.pageSize),
    nextCursor: null,
    webhooks: { ses: 'https://demo.easyhotelsolutions.in/api/v1/public/mail-events/ses/k7Qm2xVd9LpR4tYw', brevo: 'https://demo.easyhotelsolutions.in/api/v1/public/mail-events/brevo/Zb3nH8cJ5sGf1uKa' },
    previousKeyUntil: { ...previousKeyUntil },
    snsTopicArn: 'arn:aws:sns:ap-south-1:123456789012:hms-mail-reports',
    limits: { windowDays: 7, minSent: 200, bounceRatePct: 5, complaintMinSent: 1000, complaintRatePct: 0.1 },
  });
  return {
    view: (query = {}) => ok(view(query.search)),
    suppress: ({ email, hotelId }) => {
      const e = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return fail('VALIDATION_FAILED', 'Enter an email address.');
      if (suppressions.some((s) => s.email === e && s.hotelId === hotelId)) return ok({ suppressed: false });
      suppressions = [{ id: `s-${next++}`, email: e, hotelId, hotelName: hotelId ? hotelId : null, reason: 'manual', source: 'manual', detail: null, createdAt: new Date().toISOString(), createdByName: 'You' }, ...suppressions];
      return ok({ suppressed: true });
    },
    unsuppress: (id) => {
      if (!suppressions.some((s) => s.id === id)) return fail('NOT_FOUND', 'Not found.');
      suppressions = suppressions.filter((s) => s.id !== id);
      return ok({ removed: true });
    },
    hold: (hotelId, reason) => {
      const h = holds.find((x) => x.hotelId === hotelId);
      if (h?.held) return fail('CONFLICT', "This hotel's campaign mail is already held.");
      const row: MailHold = { hotelId, hotelName: h?.hotelName ?? hotelId, held: true, reason: 'manual', detail: reason, heldAt: new Date().toISOString(), heldByName: 'You', releasedAt: null, releasedByName: null, releaseReason: null };
      if (h) Object.assign(h, row);
      else holds.push(row);
      return ok({ held: true });
    },
    release: (hotelId, reason) => {
      const h = holds.find((x) => x.hotelId === hotelId && x.held);
      if (!h) return fail('CONFLICT', "This hotel's campaign mail is not held.");
      Object.assign(h, { held: false, releasedAt: new Date().toISOString(), releasedByName: 'You', releaseReason: reason });
      return ok({ released: true });
    },
    rotateKey: (provider) => {
      const previousUntil = new Date(Date.now() + 24 * 3_600_000).toISOString();
      previousKeyUntil[provider] = previousUntil;
      return ok({ provider, previousUntil });
    },
  };
}

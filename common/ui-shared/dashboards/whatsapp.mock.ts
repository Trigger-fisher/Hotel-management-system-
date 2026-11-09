// WhatsApp's SAMPLE data for the design (decision 66, A7; docs/plans/WHATSAPP-PLAN-2026-10-24.md section 7): a connected number, approved and waiting templates,
// the automatic messages and this month's counts, for the hotel and for the platform. Only the mock reads it (the dev previews and the local demo build); the live
// site answers WHATSAPP_NOT_CONNECTED until the Meta integration exists. The dev switch `window.__convWhatsApp = 'off'` shows the not-connected screens on the mock too.
import { mockCall, mockError, ok, type DashResult, type MockClock } from './common';
import {
  checkMessagesSettings,
  defaultMessagesSettings,
  messagesSettingsCopy,
  WHATSAPP_AUTOMATIC_KEYS,
  WHATSAPP_NOT_CONNECTED,
  type MessagesSettings,
  type MessagesSettingsApi,
  type MessagesSettingsInput,
  type WhatsAppAutomaticKey,
  type WhatsAppHotelRow,
  type WhatsAppSettings,
  type WhatsAppTemplate,
} from './whatsapp';

/** `window.__convWhatsApp = 'off'` in the browser console: the mock behaves like the live site (not connected). Read at call time. */
export function mockWhatsAppOff(): boolean {
  return (globalThis as { __convWhatsApp?: unknown }).__convWhatsApp === 'off';
}

export const SAMPLE_TEMPLATES: WhatsAppTemplate[] = [
  {
    id: 'wt-welcome',
    name: 'check_in_welcome',
    category: 'utility',
    language: 'en',
    status: 'approved',
    text: 'Welcome to {{1}}, {{2}}! Your room {{3}} is ready. Reply here if you need anything during your stay.',
    variables: [
      { index: 1, label: 'Hotel name', source: 'hotel_name' },
      { index: 2, label: 'Guest name', source: 'guest_name' },
      { index: 3, label: 'Room', source: 'room' },
    ],
  },
  {
    id: 'wt-booking',
    name: 'booking_confirmed',
    category: 'utility',
    language: 'en',
    status: 'approved',
    text: 'Hello {{1}}, your booking at {{2}} is confirmed for {{3}} to {{4}}. We look forward to seeing you.',
    variables: [
      { index: 1, label: 'Guest name', source: 'guest_name' },
      { index: 2, label: 'Hotel name', source: 'hotel_name' },
      { index: 3, label: 'Check-in', source: 'check_in' },
      { index: 4, label: 'Check-out', source: 'check_out' },
    ],
  },
  {
    id: 'wt-followup',
    name: 'follow_up',
    category: 'utility',
    language: 'en',
    status: 'approved',
    text: 'Hello {{1}}, this is the front desk of {{2}}. We are replying to your message: {{3}}',
    variables: [
      { index: 1, label: 'Guest name', source: 'guest_name' },
      { index: 2, label: 'Hotel name', source: 'hotel_name' },
      { index: 3, label: 'Your message' },
    ],
  },
  {
    id: 'wt-offer',
    name: 'festive_offer',
    category: 'marketing',
    language: 'en',
    status: 'pending',
    text: 'Diwali at {{1}}: 15% off on stays of two nights or more. Reply BOOK to reserve.',
    variables: [{ index: 1, label: 'Hotel name', source: 'hotel_name' }],
  },
  {
    id: 'wt-thanks',
    name: 'check_out_thanks',
    category: 'utility',
    language: 'en',
    status: 'rejected',
    text: 'Thank you for staying with us, {{1}}. Rate us 5 stars!',
    variables: [{ index: 1, label: 'Guest name', source: 'guest_name' }],
  },
];

export function sampleWhatsAppSettings(scope: 'hotel' | 'platform', now: number): WhatsAppSettings {
  const day = 86_400_000;
  return {
    connected: true,
    available: true,
    number: scope === 'hotel' ? '+91 98250 11223' : '+91 79 4000 1234',
    displayName: scope === 'hotel' ? 'Hotel Sunrise' : 'EasyHotelSolutions',
    displayNameStatus: 'approved',
    quality: 'green',
    connectedAt: new Date(now - 40 * day).toISOString(),
    lastSentAt: new Date(now - 25 * 60_000).toISOString(),
    lastReceivedAt: new Date(now - 12 * 60_000).toISOString(),
    templates: SAMPLE_TEMPLATES.map((t) => ({ ...t, variables: t.variables.map((v) => ({ ...v })) })),
    automatic: scope === 'hotel'
      ? [
          { key: 'booking_confirmed', on: true, templateId: 'wt-booking' },
          { key: 'check_in_welcome', on: true, templateId: 'wt-welcome' },
          { key: 'bill_link', on: false },
          { key: 'check_out_thanks', on: false, templateId: 'wt-thanks' },
          { key: 'advance_received', on: false },
        ]
      : [],
    month: scope === 'hotel' ? { templates: 46, free: 212, received: 238 } : { templates: 4, free: 18, received: 21 },
  };
}

export const SAMPLE_WHATSAPP_HOTELS: WhatsAppHotelRow[] = [
  { hotelId: 'h-1', hotelName: 'Hotel Sunrise, Rajkot', connected: true, number: '+91 98250 11223', quality: 'green', monthTemplates: 46, monthMessages: 450 },
  { hotelId: 'h-2', hotelName: 'Hotel Lakeview, Udaipur', connected: true, number: '+91 99090 44556', quality: 'yellow', monthTemplates: 12, monthMessages: 96 },
  { hotelId: 'h-3', hotelName: 'Sea Breeze Resort, Diu', connected: false, number: null, quality: 'unknown', monthTemplates: 0, monthMessages: 0 },
];

/** The WhatsApp settings of one hub (hotel or platform) in the mock: read, and switch an automatic message on or off. */
export function createWhatsAppSettingsMock(scope: 'hotel' | 'platform', clock: MockClock & { now?: () => number } = {}) {
  const now = clock.now ?? (() => Date.now());
  let settings = sampleWhatsAppSettings(scope, now());
  const copy = (s: WhatsAppSettings): WhatsAppSettings => ({ ...s, templates: s.templates.map((t) => ({ ...t, variables: t.variables.map((v) => ({ ...v })) })), automatic: s.automatic.map((a) => ({ ...a })), ...(s.month ? { month: { ...s.month } } : {}) });
  return {
    /** The settings as the screens read them now (not connected while the dev switch is off). */
    current(): WhatsAppSettings {
      return mockWhatsAppOff() ? copy(WHATSAPP_NOT_CONNECTED) : copy(settings);
    },
    get(): Promise<DashResult<WhatsAppSettings>> {
      return mockCall(() => ok(this.current()), clock);
    },
    setAutomatic(key: WhatsAppAutomaticKey, on: boolean): Promise<DashResult<WhatsAppSettings>> {
      return mockCall(() => {
        if (mockWhatsAppOff()) return mockError('CONFLICT', undefined, { message: 'WhatsApp is not connected yet.' });
        if (!WHATSAPP_AUTOMATIC_KEYS.includes(key)) return mockError('VALIDATION_FAILED', { key: 'Choose an automatic message.' });
        settings = { ...settings, automatic: settings.automatic.map((a) => (a.key === key ? { ...a, on } : a)) };
        return ok(copy(settings));
      }, clock);
    },
    hotels(): Promise<DashResult<WhatsAppHotelRow[]>> {
      return mockCall(() => ok(mockWhatsAppOff() ? [] : SAMPLE_WHATSAPP_HOTELS.map((h) => ({ ...h }))), clock);
    },
  };
}

/** Hotel settings > Messages in the mock: the starting values with the sample templates picked, a save with the version check, and a test send. */
export function createMessagesSettingsMock(clock: MockClock & { now?: () => number; who?: () => string | null } = {}): MessagesSettingsApi {
  const now = clock.now ?? (() => Date.now());
  const picked: Record<string, string> = { booking_confirmation: 'wt-booking', welcome: 'wt-welcome', review_ask: 'wt-thanks' };
  const start = defaultMessagesSettings();
  let settings: MessagesSettings = { ...start, automatic: start.automatic.map((r) => ({ ...r, templateId: picked[r.key] ?? null })) };
  const copy = (s: MessagesSettings): MessagesSettings => ({ ...s, automatic: s.automatic.map((r) => ({ ...r })) });
  return {
    getMessagesSettings() {
      return mockCall(() => ok(copy(settings)), clock);
    },
    saveMessagesSettings(input: MessagesSettingsInput) {
      return mockCall(() => {
        if (input.version !== settings.version) return mockError('CONFLICT', undefined, { currentVersion: settings.version });
        const errors = checkMessagesSettings(input);
        if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
        settings = {
          version: settings.version + 1,
          automatic: input.automatic.map((r) => ({ key: r.key, on: r.on, channel: r.channel, language: r.language, templateId: r.templateId })),
          quietFrom: input.quietFrom,
          quietTo: input.quietTo,
          fallbackEmail: input.fallbackEmail,
          stopWhenPaid: input.stopWhenPaid,
          consentOnly: input.consentOnly,
          testPhone: input.testPhone.trim(),
          savedBy: clock.who?.() ?? null,
          savedAt: new Date(now()).toISOString(),
        };
        return ok({ settings: copy(settings), message: messagesSettingsCopy.saved });
      }, clock);
    },
    testSendMessage(phone: string) {
      return mockCall(() => {
        const errors = checkMessagesSettings({ ...settings, testPhone: phone || ' ' });
        if (errors.testPhone) return mockError('VALIDATION_FAILED', { testPhone: errors.testPhone });
        return ok({ message: messagesSettingsCopy.test.sent(phone.trim()) });
      }, clock);
    },
  };
}

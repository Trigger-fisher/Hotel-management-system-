'use client';

// Hotel settings > Messages: the ui-shared store in demo mode. The live server has no route for these settings yet (the on/off of the rows it
// already keeps goes through conversationsApi.setWhatsAppAutomatic), so there they are kept for the session and the screen says so.
import { checkMessagesSettings, defaultMessagesSettings, messagesSettingsCopy, whatsappCopy, type MessagesSettings, type MessagesSettingsApi } from '@shared/dashboards/whatsapp';

import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

let actor: string | null = null;
/** Who is saving, for the "Last saved by" line (the server will read the session). */
export function setMessagesActor(name: string): void {
  actor = name;
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const copy = (s: MessagesSettings): MessagesSettings => ({ ...s, automatic: s.automatic.map((r) => ({ ...r })) });

function sessionOnly(): MessagesSettingsApi {
  let settings = defaultMessagesSettings();
  return {
    getMessagesSettings: async () => ({ ok: true, data: copy(settings) }),
    saveMessagesSettings: async (input) => {
      if (input.version !== settings.version) return { ok: false, error: { code: 'CONFLICT', message: 'CONFLICT', traceId: 'client', details: { currentVersion: settings.version } } };
      const fields = checkMessagesSettings(input);
      if (Object.keys(fields).length) return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'VALIDATION_FAILED', traceId: 'client', details: { fields } } };
      settings = { ...copy(input as MessagesSettings), version: input.version + 1, testPhone: input.testPhone.trim(), savedBy: actor, savedAt: new Date().toISOString() };
      return { ok: true, data: { settings: copy(settings), message: messagesSettingsCopy.saved } };
    },
    testSendMessage: async () => ({ ok: false, error: { code: 'CONFLICT', message: whatsappCopy.notAvailableWrite, traceId: 'client' } }),
  };
}

export const messagesApi: MessagesSettingsApi = chooseApi<MessagesSettingsApi>(sessionOnly, () =>
  lazyMock(async () => (await loadMocks()).createMessagesSettingsMock({ offline, who: () => actor })),
);

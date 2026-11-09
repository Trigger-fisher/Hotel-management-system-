'use client';

// The Conversations hubs (decision 66): the hotel's (/api/v1/conversations), the platform's (/api/v1/platform/conversations) and the platform mailbox card,
// each the real server or the mock (lib/api/mode.ts, loaded through lib/api/mockLoader.ts). One object per hub for the whole tab, so the badge, the page and
// Settings > WhatsApp read the same store. `setActor` tells the mock who is working; the real adapter ignores it (the server reads the session).
import type { HmsUser } from '@shared/auth-pallav/types';
import type { ConversationsApi, ConvScope, PersonalAddressView, PersonalMailboxApi, PlatformMailboxApi } from '@shared/dashboards/conversations';

import { createHttpConversationsApi, createHttpPersonalMailboxApi, createHttpPlatformMailboxApi } from '@/lib/api/adapters/conversations';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi, isWriteMethod } from '@/lib/api/mode';

import { emitConvLive } from './live';

/** Who is working, for the mock only: the id decides "Mine" and "my" notes, the role and grants what the person may do. */
export interface ConvActor {
  id: string;
  name: string;
  role?: string;
  grants?: Readonly<Record<string, string>> | null;
  visit?: boolean;
}

export type ConversationsClientApi = ConversationsApi & { setActor(actor: ConvActor): void };

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
/** Writes that change no conversation (who is working, a mail check, a file being added, the quick replies and WhatsApp's automatic switches). */
const NOT_A_CHANGE = new Set(['setActor', 'syncMail', 'addEmailFile', 'addQuickReply', 'updateQuickReply', 'deleteQuickReply', 'setWhatsAppAutomatic']);

/**
 * The demo's side of live Email and WhatsApp: a change the mock makes by itself (a tick, a guest writing) and every change made through it go on the same bus the server's
 * stream feeds (ids only), so the demo behaves as the live site does.
 */
function liveMock(scope: ConvScope, make: (onChange: (ids: string[]) => void) => ConversationsClientApi): ConversationsClientApi {
  const api = make((ids) => emitConvLive({ scope, ids, what: 'message' }));
  const wrapped = new Map<string, unknown>();
  return new Proxy(api, {
    get(target, key) {
      const value = Reflect.get(target, key) as unknown;
      if (typeof key !== 'string' || typeof value !== 'function' || !isWriteMethod(key) || NOT_A_CHANGE.has(key)) return value;
      let fn = wrapped.get(key);
      if (!fn) {
        fn = async (...args: unknown[]) => {
          const r = (await (Reflect.get(target, key) as (...a: unknown[]) => Promise<{ ok?: boolean }>).apply(target, args)) as { ok?: boolean };
          if (r?.ok) emitConvLive({ scope, ids: typeof args[0] === 'string' ? [args[0]] : Array.isArray(args[0]) ? (args[0] as unknown[]).filter((x): x is string => typeof x === 'string') : [] });
          return r;
        };
        wrapped.set(key, fn);
      }
      return fn;
    },
  });
}

export const conversationsApi: ConversationsClientApi = chooseApi<ConversationsClientApi>(
  () => ({ ...createHttpConversationsApi('/conversations'), setActor: () => {} }),
  () => liveMock('hotel', (onChange) => lazyMock(async () => (await loadMocks()).createConversationsMock({ scope: 'hotel', offline, onChange }))),
);

export const platformConversationsApi: ConversationsClientApi = chooseApi<ConversationsClientApi>(
  () => ({ ...createHttpConversationsApi('/platform/conversations'), setActor: () => {} }),
  () => liveMock('platform', (onChange) => lazyMock(async () => (await loadMocks()).createConversationsMock({ scope: 'platform', offline, onChange }))),
);

/** A group's own inbox (platform 0166): the Group Admin's; the mock is the hotel's. */
export const groupConversationsApi: ConversationsClientApi = chooseApi<ConversationsClientApi>(
  () => ({ ...createHttpConversationsApi('/group/conversations'), setActor: () => {} }),
  () => liveMock('group', (onChange) => lazyMock(async () => (await loadMocks()).createConversationsMock({ scope: 'hotel', offline, onChange }))),
);

/** The mock's own address of the signed-in person: the address strip and the mailbox list show the same one. */
const MOCK_PERSONAL_ADDRESS = 'you@mail.example.in';

/** My mailbox (platform 0178, 0179): a staff login's own mailbox on the SES domain, the hotel's page over the personal API (the same path from every dashboard); the mock is the hotel's sample sent to the person's own address. */
export const personalConversationsApi: ConversationsClientApi = chooseApi<ConversationsClientApi>(
  () => ({ ...createHttpConversationsApi('/my-mailbox/mail'), setActor: () => {} }),
  () => liveMock('personal', (onChange) => lazyMock(async () => (await loadMocks()).createConversationsMock({ scope: 'hotel', offline, mailboxAddress: MOCK_PERSONAL_ADDRESS, onChange }))),
);

function mockPersonalMailbox(): PersonalMailboxApi {
  return { getAddress: async () => ({ ok: true as const, data: { address: MOCK_PERSONAL_ADDRESS, usable: true, reason: 'ok' as const, message: null } satisfies PersonalAddressView }) };
}
export const personalMailboxApi: PersonalMailboxApi = chooseApi<PersonalMailboxApi>(createHttpPersonalMailboxApi, mockPersonalMailbox);
export const platformMailboxApi: PlatformMailboxApi = chooseApi<PlatformMailboxApi>(createHttpPlatformMailboxApi, () => lazyMock(async () => (await loadMocks()).createPlatformMailboxMock({ offline })));

export const convApiFor = (scope: ConvScope): ConversationsClientApi => (scope === 'platform' ? platformConversationsApi : scope === 'group' ? groupConversationsApi : scope === 'personal' ? personalConversationsApi : conversationsApi);

/** Tells the mock who is working (no-op on the real server). */
export function setConvActor(scope: ConvScope, user: Pick<HmsUser, 'id' | 'displayName' | 'role' | 'grants'>, visit = false): void {
  convApiFor(scope).setActor({ id: user.id, name: user.displayName, role: user.role, grants: user.grants ?? null, visit });
}

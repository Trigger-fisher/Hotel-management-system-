'use client';

// The Group console's api: one object per signed-in group admin. Mock: the group console mock (ui-shared/dashboards/groupConsole.ts) over the
// platform console's store, with the platform actor set to this group admin (so the platform mock scopes everything to the group). Real: the
// /api/v1/group/* adapter (lib/api/adapters/group.ts), which the read-only guard of the shell also covers.
// The group console mock is loaded through lib/api/mockLoader.ts.
import type { GroupConsoleApi } from '@shared/dashboards/groupConsole';
import { MOCK_GROUPADMIN_GROUP_ID } from '@shared/dashboards/platform';
import { createHttpGroupApi } from '@/lib/api/adapters/group';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { apiMode, chooseApi } from '@/lib/api/mode';

import type { ScreenProps } from '../../types';
import { platformApi } from '../platform/api';
import { asActor } from '../platform/enter';

const groupMock = (groupId?: string): GroupConsoleApi =>
  lazyMock(async () => (await loadMocks()).createGroupConsoleMock(platformApi, groupId));

const real = chooseApi<GroupConsoleApi>(createHttpGroupApi, () => groupMock());
const mocks = new Map<string, GroupConsoleApi>();

/** The id of the group this person runs (mock: the signed-in user's group, else Sunrise Group). */
const myGroupId = (user: ScreenProps['user']): string => user.group?.id ?? MOCK_GROUPADMIN_GROUP_ID;

/** The console api for this group admin. Call it inside an effect or handler (it sets the mock's actor). */
export function groupApiFor(user: ScreenProps['user']): GroupConsoleApi {
  if (apiMode() !== 'mock') return real;
  asActor(user);
  const gid = myGroupId(user);
  let m = mocks.get(gid);
  if (!m) {
    m = groupMock(gid);
    mocks.set(gid, m);
  }
  return m;
}

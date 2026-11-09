'use client';

// The room-service menu store: the real /api/v1/admin/menu or the in-memory mock (lib/api/mode.ts), loaded through lib/api/mockLoader.ts.
import { createRoomMenuRealApi } from '@/lib/api/adapters/roomMenu';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

export const roomMenuApi = chooseApi(
  () => createRoomMenuRealApi(),
  () => lazyMock(async () => (await loadMocks()).createRoomMenuMockApi()),
);

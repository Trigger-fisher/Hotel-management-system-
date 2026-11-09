// The room-service menu over the real server: /api/v1/admin/menu (docs/BACKEND.md, "Room-service menu and ordering").
import type { RoomMenuApi, RoomMenuGroup, RoomMenuItem } from '@shared/dashboards/roomMenu';

import * as api from '../client';

const enc = encodeURIComponent;

export function createRoomMenuRealApi(): RoomMenuApi {
  return {
    list: () => api.get<RoomMenuGroup[]>('/admin/menu'),
    create: (group, input) => api.post<RoomMenuItem>('/admin/menu/items', { group, name: input.name, note: input.note, pricePaise: input.pricePaise, available: input.available }),
    update: (id, input) => api.patch<RoomMenuItem>(`/admin/menu/items/${enc(id)}`, { name: input.name, note: input.note, pricePaise: input.pricePaise, available: input.available }),
    remove: (id) => api.del<{ id: string; message: string }>(`/admin/menu/items/${enc(id)}`),
    move: (id, direction) => api.post<{ id: string; moved: boolean }>(`/admin/menu/items/${enc(id)}/move`, { direction }),
  };
}

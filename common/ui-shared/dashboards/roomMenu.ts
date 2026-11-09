// The room-service menu the hotel serves (Administration > Master Data > "Room service menu"; the guest reads it through guest.ts getMenu).
// Server: GET /admin/menu, POST /admin/menu/items, PATCH|DELETE /admin/menu/items/{id}, POST /admin/menu/items/{id}/move (docs/BACKEND.md,
// "Room-service menu and ordering"). Module `masters`: view reads, edit changes. Three fixed groups; the hotel adds, prices, switches off and orders items.
import type { DashResult } from './common';
import type { MenuGroupId } from './guest';

export interface RoomMenuItem {
  id: string;
  name: string;
  note: string | null;
  pricePaise: number;
  /** false = the guest still sees it, greyed out. */
  available: boolean;
  sortOrder: number;
  /** Round 3 (hotel migrations 0041, 0043): the hotel's own category (null = the group's), the veg mark, whether a photo is kept (roomMenuPhotoPath). */
  category?: string | null;
  veg?: 'yes' | 'no' | 'unknown';
  hasPhoto?: boolean;
}

export interface RoomMenuGroup {
  id: MenuGroupId;
  label: string;
  icon: string;
  business: 'hotel' | 'food';
  kind: 'food' | 'laundry' | 'service';
  hint: string;
  items: RoomMenuItem[];
}

/** Field errors of a save: name (required, up to 120, unique in its group), note (up to 200), pricePaise (0 to 99,99,999.99 rupees). */
export interface RoomMenuItemInput {
  name: string;
  note: string;
  pricePaise: number;
  available: boolean;
  /** Left out = unchanged; '' or null = the group's own name. At most 60 characters. */
  category?: string | null;
  veg?: 'yes' | 'no' | 'unknown';
}

/**
 * A menu item's photo (Master Data, module masters): GET it (view), PUT { fileName, dataBase64 } to add or replace it (edit; JPG, PNG or WebP up to 10 MB, kept as WebP of at
 * most 1 MB), DELETE to remove it (edit). Answers { id, hasPhoto }.
 */
export const roomMenuPhotoPath = (itemId: string): string => `/api/v1/admin/menu/items/${encodeURIComponent(itemId)}/photo`;
export const ROOM_MENU_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export const roomMenuCopy = {
  rail: 'Room service menu',
  railHint: 'What a staying guest can order to the room',
  search: 'Search the menu…',
  add: 'Add item',
  edit: 'Edit',
  remove: 'Remove',
  moveUp: 'Move up',
  moveDown: 'Move down',
  empty: 'Nothing on this list yet.',
  emptyHint: 'Add the first item. Guests see it as soon as you save.',
  off: 'Switched off',
  on: 'On the menu',
  offHint: 'The guest sees it greyed out and cannot order it.',
  fields: { name: 'Name', note: 'Note', price: 'Price (₹)', available: 'Guests can order it', group: 'List' },
  placeholders: { name: 'e.g. Paneer butter masala', note: 'e.g. Serves one, 20 minutes' },
  hint: 'Prices are before GST; the check-out bill adds GST. Removing an item changes no bill: orders already placed keep their own text and price.',
  addTitle: (group: string) => `Add to ${group}`,
  editTitle: (name: string) => `Edit ${name}`,
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  added: (name: string) => `${name} is on the menu.`,
  removeTitle: (name: string) => `Remove ${name}?`,
  removeBody: 'Orders already placed are not changed.',
  removeConfirm: 'Remove',
  unavailable: 'Not available right now.',
} as const;

export interface RoomMenuApi {
  list(): Promise<DashResult<RoomMenuGroup[]>>;
  create(group: MenuGroupId, input: RoomMenuItemInput): Promise<DashResult<RoomMenuItem>>;
  update(id: string, input: RoomMenuItemInput): Promise<DashResult<RoomMenuItem>>;
  remove(id: string): Promise<DashResult<{ id: string; message: string }>>;
  move(id: string, direction: 'up' | 'down'): Promise<DashResult<{ id: string; moved: boolean }>>;
  /** Mock only (the real screens PUT/DELETE roomMenuPhotoPath): marks the demo item as having a photo or not. */
  setPhoto?(id: string, has: boolean): Promise<DashResult<{ id: string; hasPhoto: boolean }>>;
}

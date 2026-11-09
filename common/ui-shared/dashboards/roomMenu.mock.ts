// The in-memory mock of roomMenu.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import type { MenuGroupId } from './guest';
import { type DashResult, ok, mockError } from './common';
import type { RoomMenuApi, RoomMenuGroup, RoomMenuItem, RoomMenuItemInput } from './roomMenu';

const GROUPS: Omit<RoomMenuGroup, 'items'>[] = [
  { id: 'restaurant', label: 'Restaurant', icon: 'cup-hot', business: 'food', kind: 'food', hint: 'Food and drinks from the kitchen' },
  // MJ, 26 Oct 2026: room service is food to the room only, so the Laundry and Room service lists are gone (guest.ts ORDERABLE_MENU_GROUPS).
];

/** Mock only: two small inline pictures for the demo menu (a plate and a glass), so the photo states show without any file. */
const svgPhoto = (bg: string, fg: string, shape: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="${bg}"/>${shape.replace(/FG/g, fg)}</svg>`)}`;
export const MOCK_MENU_PHOTOS = {
  plate: svgPhoto('#f6e7d8', '#c0392b', '<circle cx="160" cy="100" r="70" fill="#fff"/><circle cx="160" cy="100" r="48" fill="FG" opacity="0.85"/>'),
  glass: svgPhoto('#e3f2ec', '#1e8449', '<path d="M125 40h70l-10 120h-50z" fill="#fff"/><path d="M131 80h58l-6 76h-46z" fill="FG" opacity="0.7"/>'),
} as const;
type Veg = 'yes' | 'no' | 'unknown';
/** [group, name, note, price, category, veg, has a photo] */
const SEED: [MenuGroupId, string, string | null, number, string | null, Veg, boolean][] = [
  ['restaurant', 'Paneer tikka', 'Six pieces', 26000, 'Starters', 'yes', true],
  ['restaurant', 'Chicken 65', null, 31000, 'Starters', 'no', false],
  ['restaurant', 'Paneer butter masala', 'Serves one', 28000, 'Mains', 'yes', false],
  ['restaurant', 'Veg thali', null, 32000, 'Mains', 'yes', true],
  ['restaurant', 'Masala chai', 'Two cups', 6000, 'Drinks', 'yes', false],
  ['restaurant', 'Fresh lime soda', null, 9000, 'Drinks', 'yes', false],
];

/** The mock keeps the menu in memory, so a change shows on the next list. */
export function createRoomMenuMockApi(): RoomMenuApi {
  let n = 0;
  let items: (RoomMenuItem & { group: MenuGroupId })[] = SEED.map(([group, name, note, pricePaise, category, veg, hasPhoto], i) => ({ id: `rm-${++n}`, group, name, note, pricePaise, available: true, sortOrder: i, category, veg, hasPhoto }));
  const call = <T>(fn: () => DashResult<T>): Promise<DashResult<T>> => new Promise((resolve) => setTimeout(() => resolve(fn()), 80));
  const view = (i: RoomMenuItem & { group: MenuGroupId }): RoomMenuItem => ({ id: i.id, name: i.name, note: i.note, pricePaise: i.pricePaise, available: i.available, sortOrder: i.sortOrder, category: i.category ?? null, veg: i.veg ?? 'unknown', hasPhoto: i.hasPhoto ?? false });

  function check(input: RoomMenuItemInput, group: MenuGroupId, selfId: string | null): Record<string, string> {
    const f: Record<string, string> = {};
    const name = input.name.trim();
    if (!name) f.name = 'Enter the name of the item.';
    else if (Array.from(name).length > 120) f.name = 'Keep the name under 120 characters.';
    else if (items.some((x) => x.group === group && x.id !== selfId && x.name.toLowerCase() === name.toLowerCase())) f.name = 'That item is already on this list.';
    if (Array.from(input.note.trim()).length > 200) f.note = 'Keep the note under 200 characters.';
    if (!Number.isInteger(input.pricePaise) || input.pricePaise < 0 || input.pricePaise > 999_999_999) f.pricePaise = 'Enter a price between 0 and 99,99,999.99 rupees.';
    if (input.category && Array.from(input.category.trim()).length > 60) f.category = 'Keep the category under 60 characters.';
    return f;
  }

  return {
    list: () => call(() => ok(GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.id).sort((a, b) => a.sortOrder - b.sortOrder).map(view) })))),
    create: (group, input) =>
      call(() => {
        const f = check(input, group, null);
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const item = { id: `rm-${++n}`, group, name: input.name.trim(), note: input.note.trim() || null, pricePaise: input.pricePaise, available: input.available, sortOrder: items.length, category: (input.category ?? '').trim() || null, veg: input.veg ?? ('unknown' as const), hasPhoto: false };
        items = [...items, item];
        return ok(view(item));
      }),
    update: (id, input) =>
      call(() => {
        const cur = items.find((i) => i.id === id);
        if (!cur) return mockError('NOT_FOUND');
        const f = check(input, cur.group, id);
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        Object.assign(cur, { name: input.name.trim(), note: input.note.trim() || null, pricePaise: input.pricePaise, available: input.available, ...(input.category !== undefined ? { category: (input.category ?? '').trim() || null } : {}), ...(input.veg !== undefined ? { veg: input.veg } : {}) });
        return ok(view(cur));
      }),
    remove: (id) =>
      call(() => {
        const cur = items.find((i) => i.id === id);
        if (!cur) return mockError('NOT_FOUND');
        items = items.filter((i) => i.id !== id);
        return ok({ id, message: `"${cur.name}" was removed from the menu. Orders already placed are not changed.` });
      }),
    /** Mock of PUT/DELETE roomMenuPhotoPath(id): marks the item as having a photo, or not (the file itself is not kept). */
    setPhoto: (id: string, has: boolean) =>
      call(() => {
        const cur = items.find((i) => i.id === id);
        if (!cur) return mockError('NOT_FOUND');
        cur.hasPhoto = has;
        return ok({ id, hasPhoto: has });
      }),
    move: (id, direction) =>
      call(() => {
        const cur = items.find((i) => i.id === id);
        if (!cur) return mockError('NOT_FOUND');
        const mates = items.filter((i) => i.group === cur.group).sort((a, b) => a.sortOrder - b.sortOrder);
        const at = mates.findIndex((i) => i.id === id);
        const other = mates[direction === 'up' ? at - 1 : at + 1];
        if (!other) return ok<{ id: string; moved: boolean }>({ id, moved: false });
        [cur.sortOrder, other.sortOrder] = [other.sortOrder, cur.sortOrder];
        return ok<{ id: string; moved: boolean }>({ id, moved: true });
      }),
  };
}

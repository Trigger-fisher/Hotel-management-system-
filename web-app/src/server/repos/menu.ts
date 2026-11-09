import "server-only";

// The room-service menu (migration 0020, table menu_items): what an in-house guest can order to the room and what the hotel edits under Master Data. Three
// fixed groups (their label, icon, business and kind are the app's, in services/menu/groups.ts); the hotel owns the items. Removing marks the item
// deleted: an order that was placed keeps the text and price it was made with (a stay charge), so nothing points at an item.
export type MenuGroupKey = "restaurant" | "laundry" | "service";

export interface MenuItemRecord {
  id: string;
  group: MenuGroupKey;
  name: string;
  note: string | null;
  pricePaise: bigint;
  available: boolean;
  sortOrder: number;
  /** Round 3 (hotel migrations 0041 and 0043): the hotel's own category (null = the group's), the veg mark and the stored photo name (null = none). Optional for older callers. */
  category?: string | null;
  veg?: MenuVeg;
  imageFile?: string | null;
}

export type MenuVeg = "yes" | "no" | "unknown";

interface MenuItemFields {
  name: string;
  note: string | null;
  pricePaise: bigint;
  available: boolean;
  /** Left out = unchanged (an older caller that does not send them). */
  category?: string | null;
  veg?: MenuVeg;
}

export interface MenuRepo {
  /** Every item, by group, then order, then name. */
  list(): Promise<MenuItemRecord[]>;
  get(id: string): Promise<MenuItemRecord | null>;
  /** Added at the end of its group. A name already in the group (any case) is a RepoError("unique"). */
  create(group: MenuGroupKey, fields: MenuItemFields): Promise<MenuItemRecord>;
  update(id: string, fields: MenuItemFields): Promise<MenuItemRecord | null>;
  /** false when there was no such item. */
  remove(id: string): Promise<boolean>;
  /** Sets (or with null clears) the item's stored photo name; answers the item as it was BEFORE (so the caller can remove the old file), null when there is no such item. */
  setImage(id: string, imageFile: string | null): Promise<MenuItemRecord | null>;
  /** Swaps places with the neighbour inside its group; false at an end or when there is no such item. */
  swap(id: string, direction: "up" | "down"): Promise<boolean>;
}

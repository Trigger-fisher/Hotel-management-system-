import "server-only";
import type { MenuGroupKey } from "../../repos/menu";

// The three fixed groups of the room-service menu and what each one means for the bill: the guest portal shows them (ui-shared MenuGroup) and an order
// becomes stay charges of the category named here, which the check-out puts on the hotel or the food side (services/frontOffice: food and room_service are
// the food business's, laundry the hotel's). The hotel edits only the items.
export const MENU_GROUPS: Record<MenuGroupKey, { label: string; icon: string; business: "hotel" | "food"; kind: "food" | "laundry" | "service"; hint: string; category: "food" | "laundry" | "room_service" }> = {
  restaurant: { label: "Restaurant", icon: "utensils", business: "food", kind: "food", hint: "Cooked to order.", category: "food" },
  laundry: { label: "Laundry", icon: "tag", business: "hotel", kind: "laundry", hint: "Back in 24 hours.", category: "laundry" },
  service: { label: "Room service", icon: "inbox", business: "food", kind: "service", hint: "Day and night.", category: "room_service" },
};
export const MENU_GROUP_KEYS = Object.keys(MENU_GROUPS) as MenuGroupKey[];
/** MJ, 26 Oct 2026: room service is food to the room only. Guests see and order only these groups, and staff edit only these lists; laundry and service
 *  items already saved stay in the table but are neither shown nor accepted (ui-shared ORDERABLE_MENU_GROUPS). */
export const ORDERABLE_GROUP_KEYS: readonly MenuGroupKey[] = ["restaurant"];
export const isOrderableGroup = (key: MenuGroupKey): boolean => ORDERABLE_GROUP_KEYS.includes(key);
/** Most of one item in one order (ui-shared MAX_ITEM_QTY). */
export const MAX_ITEM_QTY = 20;
/** What the screen shows as the time until the order arrives. */
export const ORDER_ETA_MINUTES = 25;

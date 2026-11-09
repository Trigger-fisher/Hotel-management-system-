import "server-only";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import type { MenuGroupKey, MenuItemRecord } from "../../repos/menu";
import { RepoError } from "../../repos/types";
import { MENU_GROUPS, ORDERABLE_GROUP_KEYS, isOrderableGroup } from "../menu/groups";
import { actorOf, fieldError, logLine, notFound, type AdminDeps, type Who } from "./context";
import type { MenuItemBody } from "./schemas";
import { matchWords } from "../../validation/listQuery";

// The room-service menu the hotel serves (Master Data; module `masters`: view to read, edit to change and delete). HMS design, no Pallav equivalent: three
// fixed groups (restaurant, laundry, room service) with items the hotel adds, prices (whole paise), switches off (a guest sees it greyed out) and orders.
// What an order does is in services/guest (stay charges). Removing an item changes no bill: a placed order carries its own text and price.

const PART = "masters";
const MAX_NAME = 120;
const MAX_NOTE = 200;
/** 9,999,999.99 rupees in paise. */
const MAX_PRICE_PAISE = 999_999_999;

interface MenuItemDto {
  id: string;
  name: string;
  note: string | null;
  pricePaise: number;
  available: boolean;
  sortOrder: number;
  /** Round 3: the hotel's own category (null = the group's), the veg mark, and whether a photo is kept (GET /admin/menu/items/{id}/photo). */
  category: string | null;
  veg: "yes" | "no" | "unknown";
  hasPhoto: boolean;
}
interface MenuGroupDto {
  id: MenuGroupKey;
  label: string;
  icon: string;
  business: "hotel" | "food";
  kind: "food" | "laundry" | "service";
  hint: string;
  items: MenuItemDto[];
}

const dto = (i: MenuItemRecord): MenuItemDto => ({ id: i.id, name: i.name, note: i.note, pricePaise: paiseToNumber(i.pricePaise), available: i.available, sortOrder: i.sortOrder, category: i.category ?? null, veg: i.veg ?? "unknown", hasPhoto: Boolean(i.imageFile) });
const MAX_CATEGORY = 60;

export function createMenuService(deps: AdminDeps) {
  const { unit, catalog, audit } = deps;
  const audited = (session: VerifiedSession, action: string, what: string): Promise<void> => audit.record({ action, userId: session.userId, hotelId: session.hotelId, details: { item: what } });
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });

  /** The fields as the hotel typed them, checked: a name (trimmed, up to 120 characters), a note (optional), a price in whole paise. */
  function fieldsOf(input: Pick<MenuItemBody, "name" | "note" | "pricePaise" | "available" | "category" | "veg">) {
    const name = input.name.trim();
    if (name === "") throw fieldError("name", "Enter the name of the item.");
    if (Array.from(name).length > MAX_NAME) throw fieldError("name", `Keep the name under ${MAX_NAME} characters.`);
    const note = (input.note ?? "").trim();
    if (Array.from(note).length > MAX_NOTE) throw fieldError("note", `Keep the note under ${MAX_NOTE} characters.`);
    if (!Number.isInteger(input.pricePaise) || input.pricePaise < 0 || input.pricePaise > MAX_PRICE_PAISE) throw fieldError("pricePaise", "Enter a price between 0 and 99,99,999.99 rupees.");
    const category = input.category === undefined ? undefined : (input.category ?? "").replace(/\s+/g, " ").trim();
    if (category !== undefined && Array.from(category).length > MAX_CATEGORY) throw fieldError("category", `Keep the category under ${MAX_CATEGORY} characters.`);
    return { name, note: note === "" ? null : note, pricePaise: BigInt(input.pricePaise), available: input.available, category: category === undefined ? undefined : category === "" ? null : category, veg: input.veg };
  }
  const clash = (e: unknown): never => {
    if (e instanceof RepoError && e.kind === "unique") throw fieldError("name", "That item is already on this list.");
    throw e;
  };

  return {
    /** The whole menu: the orderable groups (food only, MJ 26 Oct 2026), each with its items in the hotel's order. */
    async list(session: VerifiedSession, search?: string): Promise<MenuGroupDto[]> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const items = await repos.menuItems.list();
        return ORDERABLE_GROUP_KEYS.map((key) => ({ id: key, ...pick(key), items: matchWords(items.filter((i) => i.group === key).map(dto), search, (i) => [i.name, i.note]) }));
      });
    },

    async create(session: VerifiedSession, input: MenuItemBody, meta: RequestMeta): Promise<MenuItemDto> {
      requirePermission(session, catalog, PART, "edit");
      if (!isOrderableGroup(input.group)) throw fieldError("group", "Room service is food to the room only. Add the item to the Restaurant list.");
      const f = fieldsOf(input);
      const w = await who(session, meta);
      const made = await unit.run(session, async (repos) => {
        const item = await repos.menuItems.create(input.group, f).catch(clash);
        await repos.systemLogs.write(logLine(w, "masters", { action: "created", entity: "Room service menu", summary: `Added Room service menu item: ${item.name}`, subject: { id: item.id, label: item.name }, details: { Group: MENU_GROUPS[item.group].label, Price: paiseToNumber(item.pricePaise) } }));
        return item;
      });
      await audited(session, "master.menu_item_created", `${MENU_GROUPS[made.group].label}: ${made.name}`);
      return dto(made);
    },

    async update(session: VerifiedSession, id: string, input: Omit<MenuItemBody, "group">, meta: RequestMeta): Promise<MenuItemDto> {
      requirePermission(session, catalog, PART, "edit");
      const f = fieldsOf(input);
      const w = await who(session, meta);
      const saved = await unit.run(session, async (repos) => {
        const before = await repos.menuItems.get(id);
        if (!before) throw notFound();
        const item = (await repos.menuItems.update(id, f).catch(clash)) as MenuItemRecord | null;
        if (!item) throw notFound();
        const changed = (["name", "note", "pricePaise", "available", "category", "veg"] as const).filter((k) => String(before[k] ?? "") !== String(item[k] ?? ""));
        if (changed.length > 0) await repos.systemLogs.write(logLine(w, "masters", { action: "updated", entity: "Room service menu", summary: `Changed Room service menu item: ${item.name}`, subject: { id: item.id, label: item.name }, details: { Changed: changed.join(", ") } }));
        return item;
      });
      await audited(session, "master.menu_item_updated", `${MENU_GROUPS[saved.group].label}: ${saved.name}`);
      return dto(saved);
    },

    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      const gone = await unit.run(session, async (repos) => {
        const item = await repos.menuItems.get(id);
        if (!item) throw notFound();
        await repos.menuItems.remove(id);
        await repos.systemLogs.write(logLine(w, "masters", { action: "deleted", entity: "Room service menu", summary: `Removed Room service menu item: ${item.name}`, subject: { id: item.id, label: item.name }, details: { Group: MENU_GROUPS[item.group].label } }));
        return item;
      });
      await audited(session, "master.menu_item_deleted", `${MENU_GROUPS[gone.group].label}: ${gone.name}`);
      return { id, message: `"${gone.name}" was removed from the menu. Orders already placed are not changed.` };
    },

    /** Swaps places with the neighbour in its group; at an end nothing happens (moved: false). */
    async move(session: VerifiedSession, id: string, direction: "up" | "down"): Promise<{ id: string; moved: boolean }> {
      requirePermission(session, catalog, PART, "edit");
      return unit.run(session, async (repos) => {
        if (!(await repos.menuItems.get(id))) throw notFound();
        return { id, moved: await repos.menuItems.swap(id, direction) };
      });
    },
  };

  function pick(key: MenuGroupKey): Omit<MenuGroupDto, "id" | "items"> {
    const g = MENU_GROUPS[key];
    return { label: g.label, icon: g.icon, business: g.business, kind: g.kind, hint: g.hint };
  }
}

export type MenuService = ReturnType<typeof createMenuService>;
void AppError;

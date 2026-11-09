import "server-only";
import { randomUUID } from "node:crypto";
import { mayChangeGuestCancelWindow } from "@shared/dashboards/roomService";
import type { Catalog } from "../../auth/catalog";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { PortalRepos } from "../../repos/portal";
import type { RoomOrderStatus } from "../../repos/roomService";
import type { Unit } from "../../repos/types";
import type { PeopleDirectory, Person } from "../cash/ports";
import { createdEntry, updatedEntry, type LogContext } from "../cash/syslog";
import { istDate } from "../frontOffice/rules";
import { MAX_ITEM_QTY, MENU_GROUPS, isOrderableGroup } from "../menu/groups";
import { paiseToNumber } from "../../money/paise";
import type { ChargeRecord } from "../../repos/frontOffice";
import { ALREADY_DELIVERED, cancelInUnit, canMoveTo, CANCEL_REASON_MAX, cancellableUntil, guestCancelMinutesOf, MAX_GUEST_CANCEL_MINUTES, orderView } from "./rules";

const TABLE_COUNT = 12;

// The hotel's side of room service (Front Office > Room service orders, the Guest Desk; guest portal round 3, decision 61, rebuilt on main). The kitchen's queue (open orders,
// oldest first) and the full list; moving an order forward; cancelling it with a reason until it is delivered (its charges come off the room bill in the same unit, the guest sees
// "Cancelled by the hotel: <reason>"); and the guest cancel window (Settings for room service: 0 to 60 minutes, default 5). Permissions are the In House part (pms.stays):
// view to read, edit to move or cancel, full to change the window; a Hotel User never changes the window (MJ, 5 Nov 2026). Every change writes one system-log line.

const PART = "pms.stays";
const LOG_MODULE = "front-office";
const REASON_NEEDED = "Say why the order is cancelled (the guest sees it).";
const NOT_FORWARD = "That step is not possible from where the order is now.";
const WINDOW_ADMIN_ONLY = "Only the Hotel Admin can change how long guests may cancel their orders.";

export interface DeskDeps {
  unit: Unit<PortalRepos>;
  people: PeopleDirectory;
  catalog: Catalog;
  now: () => Date;
}

const words = (s: string | undefined): string[] => (s ?? "").toLowerCase().split(/\s+/).filter(Boolean);

export function createRoomServiceDesk(deps: DeskDeps) {
  const { unit, people, catalog, now } = deps;
  const logCtx = (session: VerifiedSession, meta: RequestMeta, actor: Person | undefined): LogContext => ({ userId: session.userId, userName: actor?.name ?? "System", ip: meta.ip, traceId: meta.traceId });
  const actor = async (session: VerifiedSession) => (await people.get([session.userId])).get(session.userId);

  return {
    /** What staff need to take an order: the menu that can be ordered now, the tables, and the in-house guests' rooms. */
    async pos(session: VerifiedSession) {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const menu = (await repos.menuItems.list()).filter((m) => isOrderableGroup(m.group) && m.available);
        const stays = await repos.stays.list({ view: "in_house", page: 1, pageSize: 100 });
        const rooms = new Map((await repos.rooms.all()).map((r) => [r.id, r.number]));
        return {
          menu: menu.map((m) => ({ id: m.id, name: m.name, category: m.category ?? MENU_GROUPS[m.group].label, veg: m.veg ?? "unknown", pricePaise: paiseToNumber(m.pricePaise) })),
          tables: Array.from({ length: TABLE_COUNT }, (_, i) => String(i + 1)),
          rooms: stays.rows.map((s) => ({ stayId: s.id, roomNumber: rooms.get(s.roomId) ?? "", guestName: s.guestName })).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })),
        };
      });
    },

    /**
     * Takes an order for staff: for a restaurant table (no stay; billed at the table) or for the room of an in-house stay (each line is charged to the stay, exactly as a guest's
     * order is). It starts at "placed" and goes through the same kitchen steps. The server checks the menu, the stay and the quantities; staff are not held to the guests' cancel window.
     */
    async place(session: VerifiedSession, input: { kind: "table" | "room"; table?: string; stayId?: string; qty: Record<string, number>; note: string }, meta: RequestMeta) {
      requirePermission(session, catalog, PART, "edit");
      const refuse = (field: string, message: string): never => {
        throw new AppError("VALIDATION_FAILED", message, { fields: { [field]: message } });
      };
      const table = (input.table ?? "").replace(/\s+/g, " ").trim();
      if (input.kind === "table" && table === "") refuse("table", "Choose the table.");
      if (input.kind === "room" && !input.stayId) refuse("stayId", "Choose the room.");
      const wanted = Object.entries(input.qty).filter(([, q]) => q > 0);
      if (wanted.length === 0) refuse("cart", "Add at least one item.");
      return unit.run(session, async (repos) => {
        const menu = (await repos.menuItems.list()).filter((m) => isOrderableGroup(m.group));
        const lines = wanted.map(([id, qty]) => {
          const item = menu.find((m) => m.id === id);
          if (!item || !item.available || qty > MAX_ITEM_QTY) return refuse("cart", "One of the items is not on the menu now. Remove it and try again.");
          return { item, qty };
        });
        const at = now();
        const who = await actor(session);
        const stay = input.kind === "room" ? await repos.stays.get(input.stayId as string, { forUpdate: true }) : null;
        if (input.kind === "room" && (!stay || stay.status !== "in_house")) throw new AppError("CONFLICT", "That guest is not staying now, so nothing can be charged to the room.", { fields: { stayId: "That guest is not staying now." } });
        const made: ChargeRecord[] = [];
        if (stay) {
          const day = istDate(at);
          for (const { item, qty } of lines) {
            const g = MENU_GROUPS[item.group];
            made.push(await repos.charges.create({ stayId: stay.id, chargeDate: day, category: g.category, side: g.business, description: `Order: ${item.name}`.slice(0, 255), quantity: `${qty}.00`, unitPricePaise: item.pricePaise, amountPaise: item.pricePaise * BigInt(qty), createdBy: session.userId }));
          }
        }
        const subtotal = lines.reduce((t, l) => t + l.item.pricePaise * BigInt(l.qty), BigInt(0));
        const orderNo = `O-${randomUUID().replace(/-/g, "").slice(-6).toUpperCase()}`;
        const note = input.note.trim() === "" ? null : input.note.trim().slice(0, 500);
        const order = await repos.roomService.create({
          orderNo,
          stayId: stay ? stay.id : null,
          tableLabel: stay ? null : table.slice(0, 40),
          source: "staff",
          scheduledFor: null,
          note,
          totalPaise: subtotal,
          placedBy: session.userId,
          placedAt: at,
          lines: lines.map((l, i) => ({ itemId: l.item.id, name: l.item.name.slice(0, 120), qty: l.qty, unitPricePaise: l.item.pricePaise, chargeId: made[i]?.id ?? null, sortOrder: i })),
        });
        const where = stay ? `room ${(await repos.rooms.get(stay.roomId))?.number ?? ""}`.trim() : `table ${table}`;
        await repos.systemLogs.write({
          ...createdEntry(logCtx(session, meta, who), "Room service order", { id: order.id, label: `${orderNo} - ${where}` }, { Items: lines.map((l) => `${l.item.name} x ${l.qty}`).join(", "), Note: note ?? undefined }, LOG_MODULE),
          summary: `${who?.name ?? "Staff"} took order ${orderNo} for ${where}`.slice(0, 500),
        });
        return { ...orderView(order), roomNumber: stay ? (await repos.rooms.get(stay.roomId))?.number ?? null : null, guestName: stay ? stay.guestName : "", tableLabel: order.tableLabel, source: order.source, cancellableUntil: null, statusByName: null };
      });
    },

    /** The orders: `open` (the default, the kitchen's queue, oldest first), one status, or `all` (newest first); words in the order number, room, guest or items. */
    async list(session: VerifiedSession, q: { status: RoomOrderStatus | "open" | "all"; source?: "guest" | "staff"; search?: string; page: number; pageSize: number }) {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const found = await repos.roomService.list({ status: q.status === "all" ? undefined : q.status, source: q.source, words: words(q.search), page: q.page, pageSize: q.pageSize });
        const openOf = async (source: "guest" | "staff") => (await repos.roomService.list({ status: "open", source, page: 1, pageSize: 1 })).total;
        const openByPart = { guest: await openOf("guest"), staff: await openOf("staff") };
        const minutes = await guestCancelMinutesOf(repos);
        const at = now();
        return {
          items: found.rows.map((o) => ({ ...orderView(o), roomNumber: o.roomNumber, guestName: o.guestName, statusByName: o.statusByName, cancelReason: o.cancelReason, tableLabel: o.tableLabel, source: o.source, cancellableUntil: o.source === "guest" ? cancellableUntil(o, minutes, at) : null })),
          total: found.total,
          page: q.page,
          pageSize: q.pageSize,
          openCount: openByPart.guest + openByPart.staff,
          openByPart,
          guestCancelMinutes: minutes,
        };
      });
    },

    /** Moves an order forward (placed -> accepted -> preparing -> on_the_way -> delivered; a step may be skipped). Back, out of delivered or out of cancelled is 409. */
    async setStatus(session: VerifiedSession, id: string, status: Exclude<RoomOrderStatus, "cancelled" | "placed">, meta: RequestMeta) {
      requirePermission(session, catalog, PART, "edit");
      return unit.run(session, async (repos) => {
        const order = await repos.roomService.get(id, { forUpdate: true });
        if (!order) throw new AppError("NOT_FOUND");
        if (order.status === status) return orderView(order);
        if (!canMoveTo(order.status, status)) throw new AppError("CONFLICT", NOT_FORWARD, { fields: { status: NOT_FORWARD } });
        const who = await actor(session);
        const done = (await repos.roomService.setStatus(id, status, { id: session.userId, name: who?.name ?? "Staff" }, now())) ?? order;
        await repos.systemLogs.write(updatedEntry(logCtx(session, meta, who), "Room service order", { id: order.id, label: order.orderNo }, { Status: order.status }, { Status: status }, LOG_MODULE));
        return orderView(done);
      });
    },

    /** Cancels an order until it is delivered, with a reason the guest sees; its charges come off the room bill. Twice answers the cancelled order again. */
    async cancel(session: VerifiedSession, id: string, reasonInput: string, meta: RequestMeta) {
      requirePermission(session, catalog, PART, "edit");
      const reason = reasonInput.replace(/\s+/g, " ").trim();
      if (reason.length < 3) throw new AppError("VALIDATION_FAILED", REASON_NEEDED, { fields: { reason: REASON_NEEDED } });
      if (reason.length > CANCEL_REASON_MAX) throw new AppError("VALIDATION_FAILED", `Keep the reason under ${CANCEL_REASON_MAX} characters.`, { fields: { reason: `Keep the reason under ${CANCEL_REASON_MAX} characters.` } });
      return unit.run(session, async (repos) => {
        const order = await repos.roomService.get(id, { forUpdate: true });
        if (!order) throw new AppError("NOT_FOUND");
        if (order.status === "cancelled") return orderView(order);
        if (order.status === "delivered") throw new AppError("CONFLICT", ALREADY_DELIVERED);
        const who = await actor(session);
        const done = await cancelInUnit(repos, order, "hotel", reason, { id: session.userId, name: who?.name ?? "Staff" }, now());
        const removed = order.lines.filter((l) => l.chargeId).length;
        await repos.systemLogs.write({
          ...updatedEntry(logCtx(session, meta, who), "Room service order", { id: order.id, label: order.orderNo }, { Status: order.status }, { Status: "cancelled" }, LOG_MODULE),
          summary: `Cancelled room service order ${order.orderNo}: ${reason}`.slice(0, 500),
          details: { Reason: reason, "Charges removed": String(removed), "Was": order.status },
        });
        return orderView(done);
      });
    },

    /** The guest cancel window (minutes; 0 = guests cannot cancel). */
    async settings(session: VerifiedSession) {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => ({ guestCancelMinutes: await guestCancelMinutesOf(repos), maxMinutes: MAX_GUEST_CANCEL_MINUTES }));
    },

    async saveSettings(session: VerifiedSession, input: { guestCancelMinutes: number }, meta: RequestMeta) {
      if (!mayChangeGuestCancelWindow(session.accountRole)) throw new AppError("FORBIDDEN", WINDOW_ADMIN_ONLY);
      requirePermission(session, catalog, PART, "full");
      const minutes = input.guestCancelMinutes;
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_GUEST_CANCEL_MINUTES) {
        const message = `Choose between 0 and ${MAX_GUEST_CANCEL_MINUTES} minutes (0 = guests cannot cancel).`;
        throw new AppError("VALIDATION_FAILED", message, { fields: { guestCancelMinutes: message } });
      }
      return unit.run(session, async (repos) => {
        const before = await guestCancelMinutesOf(repos);
        await repos.roomService.setGuestCancelMinutes(minutes);
        // a setting has no row id of its own (the log's subject id is a uuid column): the label says what changed
        if (before !== minutes) await repos.systemLogs.write({ ...updatedEntry(logCtx(session, meta, await actor(session)), "Room service settings", { id: "", label: "Guest cancel window" }, { "Guest cancel minutes": before }, { "Guest cancel minutes": minutes }, LOG_MODULE), subjectId: null });
        return { guestCancelMinutes: minutes, maxMinutes: MAX_GUEST_CANCEL_MINUTES };
      });
    },
  };
}

export type RoomServiceDesk = ReturnType<typeof createRoomServiceDesk>;

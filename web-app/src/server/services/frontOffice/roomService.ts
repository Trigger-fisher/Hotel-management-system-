import "server-only";
import type { Board, BulkRoomsResult, Room, RoomList } from "@shared/dashboards/frontOffice";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { FrontOfficeRepos, RoomRecord } from "../../repos/frontOffice";
import { RepoError } from "../../repos/types";
import { actorOf, logLine, readOnce, today, typeMap, type FrontOfficeDeps, type Who } from "./context";
import { reservationDto, roomDto, stayDto } from "./dto";
import { occupancy, parseRoomNumbers, roomState } from "./rules";
import { Check } from "./validate";
import type { RoomBody } from "./schemas";
import { loadReservationContext, loadStayContext } from "./loaders";

// Front Office rooms and the board (Pallav RoomController, BoardController). Rooms are hard-deleted and have no version (no column, ruled);
// every change writes its system-log line in the same unit. Spec: docs/specs/front-office.md §2-3.

const ROOMS = "pms.rooms";
const BOARD = "pms.board";

export function createRoomService(deps: FrontOfficeDeps) {
  const { unit, catalog } = deps;

  async function roomsWithState(repos: FrontOfficeRepos, rows: RoomRecord[]): Promise<Room[]> {
    const ids = rows.map((r) => r.id);
    const current = await repos.stays.currentByRoom(ids);
    const history = await repos.rooms.withStays(ids);
    const types = await typeMap(repos);
    return rows.map((r) => roomDto(r, { types, current: current.get(r.id), hasHistory: history.has(r.id) }));
  }

  /** :111-119 */
  async function validated(repos: FrontOfficeRepos, input: RoomBody, force: boolean, except: string | null) {
    const c = new Check(force);
    const number = c.required("number", "number", input.number);
    c.max("number", "number", number, 20);
    const floor = c.text("floor", "floor", input.floor, 20);
    const roomTypeId = input.roomTypeId === "" ? null : input.roomTypeId;
    if (roomTypeId && !force && !(await repos.roomTypes.get(roomTypeId))) c.fail("roomTypeId", "The selected room type id is invalid.");
    const notes = c.text("notes", "notes", input.notes, 255);
    if (number && !force && (await repos.rooms.existingNumbers([number])).some((n) => n.toLowerCase() === number.toLowerCase()) && !(except && (await repos.rooms.get(except))?.number.toLowerCase() === number.toLowerCase())) {
      c.fail("number", "There is already a room with that number.");
    }
    c.done();
    return { number: number ?? "", floor, roomTypeId, notes };
  }

  const numberTaken = (error: unknown): never => {
    if (error instanceof RepoError && error.kind === "unique") throw new AppError("VALIDATION_FAILED", undefined, { fields: { number: "There is already a room with that number." } });
    throw error;
  };
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });
  const label = (r: RoomRecord) => ({ id: r.id, label: `Room ${r.number}` });

  return {
    /** BoardController::index */
    async board(session: VerifiedSession): Promise<Board> {
      requirePermission(session, catalog, BOARD, "view");
      const day = today(deps);
      return unit.run(session, async (unitRepos) => {
        // a read-only page: the rooms, the room types and the current stays are read once, not once per helper (readOnce, context.ts)
        const repos = readOnce(unitRepos);
        const rooms = await repos.rooms.all();
        const current = await repos.stays.currentByRoom(rooms.map((r) => r.id));
        const shown = await roomsWithState(repos, rooms);
        const floors = new Map<string, Room[]>();
        for (const r of shown) floors.set(r.floor || "Rooms", [...(floors.get(r.floor || "Rooms") ?? []), r]);
        const states = rooms.map((r) => roomState(r, current.get(r.id)));
        const occupied = states.filter((s) => s === "occupied").length;
        const arrivals = await repos.reservations.arrivals(day);
        const departures = await repos.stays.departures(day);
        const resCtx = await loadReservationContext(repos, arrivals);
        const stayCtx = await loadStayContext(repos, deps, departures);
        return {
          floors: [...floors].map(([floor, list]) => ({ floor, rooms: list })),
          stats: {
            rooms: rooms.length,
            occupied,
            vacant: states.filter((s) => s === "vacant").length,
            dirty: states.filter((s) => s === "dirty").length,
            outOfOrder: states.filter((s) => s === "out_of_order").length,
            occupancy: occupancy(occupied, rooms.filter((r) => !r.outOfOrder).length),
          },
          arrivals: arrivals.map((r) => reservationDto(r, resCtx)),
          departures: departures.map((s) => stayDto(s, stayCtx(s))),
          inHouse: await repos.stays.inHouseCount(),
        };
      });
    },

    async list(session: VerifiedSession, q: { filter: "all" | "vacant" | "occupied" | "dirty" | "outOfOrder"; search?: string; page: number; pageSize: number }): Promise<RoomList> {
      requirePermission(session, catalog, ROOMS, "view");
      return unit.run(session, async (repos) => {
        const all = await roomsWithState(repos, await repos.rooms.all());
        const words = (q.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const matched = all.filter((r) => words.every((w) => [r.number, r.floor, r.roomTypeName, r.notes, r.currentStay?.guestName].join(" ").toLowerCase().includes(w)));
        const counts = { all: matched.length, vacant: 0, occupied: 0, dirty: 0, outOfOrder: 0 };
        for (const r of matched) counts[r.state] += 1;
        const inFilter = q.filter === "all" ? matched : matched.filter((r) => r.state === q.filter);
        return { items: inFilter.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: inFilter.length, page: q.page, pageSize: q.pageSize, counts };
      });
    },

    /** RoomController::store (:11-19) */
    async create(session: VerifiedSession, input: RoomBody, meta: RequestMeta): Promise<Room> {
      requirePermission(session, catalog, ROOMS, "create");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const v = await validated(repos, input, false, null);
        const room = await repos.rooms.create({ ...v, hkStatus: "clean", outOfOrder: false, outOfOrderReason: null, sortOrder: (await repos.rooms.maxSortOrder()) + 1, createdBy: session.userId }).catch(numberTaken);
        const type = room.roomTypeId ? await repos.roomTypes.get(room.roomTypeId) : null;
        await repos.systemLogs.write(logLine(w, { action: "created", entity: "Room", summary: `Added Room: Room ${room.number}`, subject: label(room), details: Object.fromEntries(Object.entries({ Category: type?.name ?? null, Floor: room.floor }).filter(([, x]) => x !== null)) }));
        return (await roomsWithState(repos, [room]))[0];
      });
    },

    /** RoomController::bulk (:22-59) */
    async bulk(session: VerifiedSession, input: { numbers: string; floor: string; roomTypeId: string }, meta: RequestMeta): Promise<BulkRoomsResult> {
      requirePermission(session, catalog, ROOMS, "create");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const c = new Check(false);
        const typed = c.required("numbers", "numbers", input.numbers);
        c.max("numbers", "numbers", typed, 500);
        const floor = c.text("floor", "floor", input.floor, 20);
        const roomTypeId = input.roomTypeId === "" ? null : input.roomTypeId;
        if (roomTypeId && !(await repos.roomTypes.get(roomTypeId))) c.fail("roomTypeId", "The selected room type id is invalid.");
        c.done();
        const numbers = parseRoomNumbers(typed ?? "");
        const existing = await repos.rooms.existingNumbers(numbers);
        const taken = new Set(existing.map((n) => n.toLowerCase()));
        let sort = await repos.rooms.maxSortOrder();
        let added = 0;
        for (const number of [...new Set(numbers)]) {
          if (taken.has(number.toLowerCase())) continue;
          taken.add(number.toLowerCase());
          await repos.rooms.create({ number, floor, roomTypeId, notes: null, hkStatus: "clean", outOfOrder: false, outOfOrderReason: null, sortOrder: ++sort, createdBy: session.userId });
          added += 1;
        }
        if (added === 0) throw new AppError("VALIDATION_FAILED", "Those rooms are all already there.", { fields: { numbers: "Those rooms are all already there." } });
        await repos.systemLogs.write(logLine(w, { action: "created", entity: "Room", summary: `Added ${added} rooms`, subject: null, details: { Numbers: typed } }));
        return { added, skipped: existing };
      });
    },

    /** RoomController::update (:61-70) */
    async update(session: VerifiedSession, id: string, input: RoomBody, meta: RequestMeta): Promise<Room> {
      requirePermission(session, catalog, ROOMS, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const room = await repos.rooms.get(id, { forUpdate: true });
        if (!room) throw new AppError("NOT_FOUND");
        const v = await validated(repos, input, false, room.id);
        const updated = await repos.rooms.update(room.id, v, session.userId).catch(numberTaken);
        if (!updated) throw new AppError("NOT_FOUND");
        const pick = (r: RoomRecord) => ({ number: r.number, floor: r.floor, room_type_id: r.roomTypeId, notes: r.notes });
        const before = pick(room);
        const after = pick(updated);
        const changed = Object.keys(after).filter((k) => String(before[k as keyof typeof before] ?? "") !== String(after[k as keyof typeof after] ?? ""));
        const readable = (k: string) => k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " ");
        await repos.systemLogs.write(
          logLine(w, {
            action: "updated",
            entity: "Room",
            summary: changed.length ? `Changed Room: Room ${updated.number} (${changed.map(readable).join(", ")})` : `Saved Room: Room ${updated.number} with no change`,
            subject: label(updated),
            details: Object.fromEntries(changed.map((k) => [readable(k), `was ${before[k as keyof typeof before] ?? "empty"}, became ${after[k as keyof typeof after] ?? "empty"}`])),
          }),
        );
        return (await roomsWithState(repos, [updated]))[0];
      });
    },

    /** RoomController::destroy (:72-82): hard delete, only a room no stay names. */
    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, ROOMS, "full");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const room = await repos.rooms.get(id, { forUpdate: true });
        if (!room) throw new AppError("NOT_FOUND");
        if (await repos.rooms.hasStays(room.id)) throw new AppError("CONFLICT", `Room ${room.number} has guests on record and stays. Mark it out of order instead.`);
        await repos.rooms.delete(room.id);
        await repos.systemLogs.write(logLine(w, { action: "deleted", entity: "Room", summary: `Removed Room: Room ${room.number}`, subject: label(room) }));
        return { id: room.id };
      });
    },

    /** RoomController::toggleClean (:85-91). HMS: the status the clerk wants is sent (set, not toggle). */
    async housekeeping(session: VerifiedSession, id: string, hkStatus: "clean" | "dirty", meta: RequestMeta): Promise<Room> {
      requirePermission(session, catalog, ROOMS, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const room = await repos.rooms.get(id, { forUpdate: true });
        if (!room) throw new AppError("NOT_FOUND");
        const updated = (await repos.rooms.update(room.id, { hkStatus }, session.userId)) as RoomRecord;
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Room", summary: `Room ${room.number} marked ${hkStatus}`, subject: label(room) }));
        return (await roomsWithState(repos, [updated]))[0];
      });
    },

    /** RoomController::toggleService (:94-109). HMS: the wanted state is sent. */
    async service(session: VerifiedSession, id: string, input: { outOfOrder: boolean; reason: string }, meta: RequestMeta): Promise<Room> {
      requirePermission(session, catalog, ROOMS, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const room = await repos.rooms.get(id, { forUpdate: true });
        if (!room) throw new AppError("NOT_FOUND");
        if (input.outOfOrder && (await repos.stays.currentByRoom([room.id])).has(room.id)) {
          throw new AppError("CONFLICT", `Room ${room.number} has a guest in it. Check them out or move them first.`);
        }
        const reason = input.outOfOrder ? Array.from(input.reason.trim()).slice(0, 255).join("") || null : null;
        const updated = (await repos.rooms.update(room.id, { outOfOrder: input.outOfOrder, outOfOrderReason: reason }, session.userId)) as RoomRecord;
        await repos.systemLogs.write(
          logLine(w, { action: "updated", entity: "Room", summary: `Room ${room.number} ${input.outOfOrder ? "taken out of order" : "back in service"}`, subject: label(room), details: reason ? { Reason: reason } : {} }),
        );
        return (await roomsWithState(repos, [updated]))[0];
      });
    },

    /** FrontDesk::roomsToGive (:199-206): free rooms, the given category first, clean before dirty. */
    async roomsToGive(repos: FrontOfficeRepos, typeId: string | null, except: string | null = null): Promise<Room[]> {
      const rows = await repos.rooms.all();
      const current = await repos.stays.currentByRoom(rows.map((r) => r.id));
      const free = rows.filter((r) => !r.outOfOrder && !current.has(r.id) && r.id !== except);
      const rank = (r: RoomRecord) => (typeId && r.roomTypeId === typeId ? 0 : 2) + (r.hkStatus === "clean" ? 0 : 1);
      // a stable sort keeps the board's order inside each group (Laravel sortBy is stable)
      return roomsWithState(repos, free.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r));
    },
  };
}

export type RoomService = ReturnType<typeof createRoomService>;

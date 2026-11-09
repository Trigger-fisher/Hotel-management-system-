import "server-only";
import type { WebRatePlan, WebRoom, WebRoomRates } from "@shared/dashboards/website";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import type { PriceTier, SitePlanFields, SitePlanRecord, SiteRoomFields, SiteRoomRecord } from "../../repos/website";
import { diffDetails } from "../cash/syslog";
import { Rules } from "../payrollCore/validate";
import { actorOf, conflict, logLine, notFound, roomState, today, type WebsiteDeps, type WebsiteUnitRepos, type Who } from "./context";
import { planDto, roomDto } from "./dto";
import type { PlanBody, RoomBody } from "./schemas";
import { matchWords } from "../../validation/listQuery";
import { RepoError } from "../../repos/types";

// Room categories (Pallav Website/RoomController) and their tariff plans (RateController). Rooms are the front office's room types: this module
// owns the writes. A room with enquiries is history (never deleted); a plan's price ladder is by number of guests. Spec: docs/specs/website.md §4-5.

const ROOMS = "website.rooms";
const RATES = "website.rates";
const PLAN_MESSAGE = "Please fill in the plan name and at least one occupancy price.";

const slugOf = (name: string): string => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "room";

export function createRoomService(deps: WebsiteDeps) {
  const { unit, catalog } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });

  /** Today's real free count (capacity less what is held), not a stored figure (RoomController::index :18-21). */
  async function freeToday(repos: WebsiteUnitRepos, roomId: string): Promise<number> {
    const t = today(deps);
    return (await roomState(deps, repos, roomId, [t]))[t]?.free ?? 0;
  }

  /** The room's photos after this save: the ones kept (with any new name and alt text), the rest removed (uploads come with the media store). */
  function keptPhotos(room: SiteRoomRecord, input: RoomBody): SiteRoomFields["photos"] {
    return room.photos
      .filter((p) => input.photos.some((x) => x.id === p.path))
      .map((p) => {
        const given = input.photos.find((x) => x.id === p.path)!;
        return { path: p.path, name: Rules.clean(given.name) === p.path ? null : Rules.clean(given.name), alt: Rules.clean(given.alt) };
      });
  }

  /** validated() (:90-111) */
  function validatedRoom(input: RoomBody): Omit<SiteRoomFields, "photos"> {
    const v = new Rules();
    const name = v.max("name", "name", v.required("name", "name", input.name, "Room name is required."), 100);
    const size = v.text("size", "size", input.size, 50);
    const bedType = v.text("bedType", "bed type", input.bedType, 50);
    v.atLeast("maxGuests", "max guests", input.maxGuests, 1);
    v.atMost("maxGuests", "max guests", input.maxGuests, 20);
    v.atLeast("totalCount", "total count", input.totalCount, 1);
    v.atMost("totalCount", "total count", input.totalCount, 255);
    const note = v.text("note", "note", input.note, 255);
    const badge = v.text("badgeLabel", "badge label", input.badgeLabel, 40);
    v.done();
    return { name: name!.trim(), size, bedType, maxGuests: input.maxGuests, totalCount: input.totalCount, note, badgeLabel: badge, showPrice: input.showPrice, available: input.available };
  }

  const roomLog = (r: Pick<SiteRoomFields, "name" | "size" | "bedType" | "maxGuests" | "totalCount" | "showPrice" | "available" | "note" | "badgeLabel">): Record<string, unknown> => ({ name: r.name, size: r.size, bed_type: r.bedType, max_guests: r.maxGuests, total_count: r.totalCount, show_price: r.showPrice, available: r.available, note: r.note, badge_label: r.badgeLabel });

  /** RateController::validated (:99-132): name and code, then the price ladder; the single and double prices are kept in their own columns too. */
  function validatedPlan(input: PlanBody): SitePlanFields {
    const v = new Rules();
    const name = v.max("name", "name", v.required("name", "name", input.name, PLAN_MESSAGE), 60);
    const code = v.max("code", "code", v.required("code", "code", input.code), 10);
    // a price that is empty or not a number is skipped; guests at least 1, a price never below 0 (the apps send whole paise)
    const ladder: PriceTier[] = input.tiers.map((t) => ({ guests: Math.max(1, t.guests), pricePaise: BigInt(Math.max(0, t.pricePaise)) })).sort((a, b) => a.guests - b.guests);
    if (ladder.length === 0) v.fail("tiers", PLAN_MESSAGE);
    v.done();
    const double = ladder.find((t) => t.guests === 2) ?? ladder[0];
    const single = ladder.find((t) => t.guests === 1) ?? null;
    return { name: name!.trim(), code: code!.trim(), tiers: ladder, doublePaise: double.pricePaise, singlePaise: single ? single.pricePaise : null, extraPersonPaise: input.extraPersonPaise === null ? null : BigInt(input.extraPersonPaise) };
  }

  const planLog = (p: Pick<SitePlanFields, "name" | "code" | "doublePaise" | "singlePaise" | "extraPersonPaise">): Record<string, unknown> => ({
    name: p.name,
    code: p.code,
    price_double: p.doublePaise === null ? null : paiseToNumber(p.doublePaise),
    price_single: p.singlePaise === null ? null : paiseToNumber(p.singlePaise),
    extra_person_price: p.extraPersonPaise === null ? null : paiseToNumber(p.extraPersonPaise),
  });

  async function roomOut(repos: WebsiteUnitRepos, r: SiteRoomRecord, plansCount: number): Promise<WebRoom> {
    return roomDto(r, { freeToday: await freeToday(repos, r.id), plansCount });
  }

  /** The order of a list after moving one item up or down; null when it cannot move that way. */
  function moved(ids: string[], id: string, dir: "up" | "down"): string[] | null {
    const i = ids.indexOf(id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return null;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }

  return {
    /** index (:15-24): sort order, with today's free rooms and how many plans each has. */
    async list(session: VerifiedSession, search?: string): Promise<WebRoom[]> {
      requirePermission(session, catalog, ROOMS, "view");
      return unit.run(session, async (repos) => {
        const rooms = await repos.siteRooms.list();
        return matchWords(await Promise.all(rooms.map((r) => roomOut(repos, r, r.plansCount))), search, (r) => [r.name, r.bedType, r.size, r.badgeLabel, r.note]);
      });
    },

    async get(session: VerifiedSession, id: string): Promise<WebRoom> {
      requirePermission(session, catalog, ROOMS, "view");
      return unit.run(session, async (repos) => {
        const r = await repos.siteRooms.get(id);
        if (!r) throw notFound();
        return roomOut(repos, r, (await repos.sitePlans.forRooms([id])).length);
      });
    },

    /** store (:31-41): a unique slug from the name, last in the order. */
    async create(session: VerifiedSession, input: RoomBody, meta: RequestMeta): Promise<WebRoom> {
      requirePermission(session, catalog, ROOMS, "create");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const fields = validatedRoom(input);
        const base = slugOf(fields.name);
        let slug = base;
        for (let i = 1; await repos.siteRooms.slugTaken(slug); ) slug = `${base}-${(i += 1)}`;
        const r = await repos.siteRooms.create({ ...fields, photos: [], slug }, session.userId).catch((error: unknown) => {
          if (error instanceof RepoError && error.kind === "unique") throw conflict("A room with this name already exists.");
          throw error;
        });
        await repos.systemLogs.write(logLine(w, { action: "created", entity: "Website room", summary: `Added Website room: ${r.name}`, subject: { id: r.id, label: r.name }, details: { "Rooms in category": r.totalCount, "Max guests": r.maxGuests } }));
        return roomOut(repos, r, 0);
      });
    },

    /** update (:48-56) */
    async update(session: VerifiedSession, id: string, input: RoomBody, meta: RequestMeta): Promise<WebRoom> {
      requirePermission(session, catalog, ROOMS, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const before = await repos.siteRooms.get(id, { forUpdate: true });
        if (!before) throw notFound();
        const fields = validatedRoom(input);
        const saved = await repos.siteRooms.update(id, { ...fields, photos: keptPhotos(before, input) }, session.userId);
        const changes = diffDetails(roomLog(before), roomLog(saved));
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Website room", summary: `Changed Website room: ${saved.name} (${Object.keys(changes).join(", ") || "no change"})`.slice(0, 500), subject: { id, label: saved.name }, details: changes }));
        return roomOut(repos, saved, (await repos.sitePlans.forRooms([id])).length);
      });
    },

    /** destroy (:58-70): a room with enquiries on record is history; mark it unavailable instead. */
    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, ROOMS, "full");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const r = await repos.siteRooms.get(id, { forUpdate: true });
        if (!r) throw notFound();
        if (await repos.siteEnquiries.hasForRoom(id)) throw conflict(`Can't delete ${r.name} - it has existing enquiries or bookings. Untick "Taking enquiries" on it instead.`);
        await repos.siteRooms.remove(id);
        await repos.systemLogs.write(logLine(w, { action: "deleted", entity: "Website room", summary: `Removed Website room: ${r.name}`, subject: { id, label: r.name }, details: { "Rooms in category": r.totalCount } }));
        return { id };
      });
    },

    /** move (:72-84): the order of the cards is the order on the website. */
    async move(session: VerifiedSession, id: string, direction: "up" | "down", meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, ROOMS, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const ids = (await repos.siteRooms.list()).map((r) => r.id);
        const next = moved(ids, id, direction);
        if (!ids.includes(id)) throw notFound();
        if (!next) throw conflict("That room cannot move that way.");
        await repos.siteRooms.setOrder(next);
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Website room", summary: "Reordered room categories", subject: null }));
        return { id };
      });
    },

    /* ------------------------------------------------------------ tariff plans */

    /** RateController::index (:15-28): each room with its plans and what the first active plan costs tonight (a price set for today wins). */
    async listRates(session: VerifiedSession, search?: string): Promise<WebRoomRates[]> {
      requirePermission(session, catalog, RATES, "view");
      const t = today(deps);
      return unit.run(session, async (repos) => {
        const rooms = await repos.siteRooms.list();
        const plans = await repos.sitePlans.forRooms(rooms.map((r) => r.id));
        const dated = new Map((await repos.calendar.rates(plans.map((p) => p.id), t, t)).map((d) => [d.planId, d]));
        const out: WebRoomRates[] = [];
        for (const r of rooms) {
          const mine = plans.filter((p) => p.roomId === r.id);
          const first = mine.find((p) => p.active);
          const tonight = first ? (dated.get(first.id)?.doublePaise ?? first.doublePaise) : BigInt(0);
          out.push({ room: await roomOut(repos, r, mine.length), tonightPaise: paiseToNumber(tonight), plans: mine.map(planDto) });
        }
        return matchWords(out, search, (x) => [x.room.name, ...x.plans.flatMap((p) => [p.name, p.code])]);
      });
    },

    /** store (:30-40) */
    async createPlan(session: VerifiedSession, roomId: string, input: PlanBody, meta: RequestMeta): Promise<WebRatePlan> {
      requirePermission(session, catalog, RATES, "create");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const room = await repos.siteRooms.get(roomId, { forUpdate: true });
        if (!room) throw notFound();
        const p = await repos.sitePlans.create(roomId, validatedPlan(input), session.userId);
        await repos.systemLogs.write(logLine(w, { action: "created", entity: "Tariff plan", summary: `Added Tariff plan: ${p.name} (${room.name})`, subject: { id: p.id, label: `${p.name} (${room.name})` }, details: { Room: room.name, Code: p.code } }));
        return planDto(p);
      });
    },

    /** update (:42-52) */
    async updatePlan(session: VerifiedSession, id: string, input: PlanBody, meta: RequestMeta): Promise<WebRatePlan> {
      requirePermission(session, catalog, RATES, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const before = await repos.sitePlans.get(id, { forUpdate: true });
        if (!before) throw notFound();
        const saved = await repos.sitePlans.update(id, validatedPlan(input), session.userId);
        const room = await repos.siteRooms.get(saved.roomId);
        const changes = diffDetails(planLog(before), planLog(saved));
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Tariff plan", summary: `Changed Tariff plan: ${saved.name} (${room?.name ?? ""}) (${Object.keys(changes).join(", ") || "no change"})`.slice(0, 500), subject: { id, label: `${saved.name} (${room?.name ?? ""})` }, details: changes }));
        return planDto(saved);
      });
    },

    /** destroy (:54-62): the plan goes with its dated prices. */
    async deletePlan(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, RATES, "full");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const p = await repos.sitePlans.get(id, { forUpdate: true });
        if (!p) throw notFound();
        const room = await repos.siteRooms.get(p.roomId);
        await repos.sitePlans.remove(id);
        await repos.systemLogs.write(logLine(w, { action: "deleted", entity: "Tariff plan", summary: `Removed Tariff plan: ${p.name} (${room?.name ?? ""})`, subject: { id, label: `${p.name} (${room?.name ?? ""})` }, details: { Room: room?.name ?? "" } }));
        return { id };
      });
    },

    /** toggle (:64-71): pause a plan (it leaves the website and the calendar) or bring it back. */
    async togglePlan(session: VerifiedSession, id: string, meta: RequestMeta): Promise<WebRatePlan> {
      requirePermission(session, catalog, RATES, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const p = await repos.sitePlans.get(id, { forUpdate: true });
        if (!p) throw notFound();
        const saved = await repos.sitePlans.update(id, { active: !p.active }, session.userId);
        const room = await repos.siteRooms.get(p.roomId);
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Tariff plan", summary: `${saved.active ? "Activated" : "Paused"} tariff plan "${saved.name}" (${room?.name ?? ""})`, subject: { id, label: saved.name } }));
        return planDto(saved);
      });
    },

    /** move (:73-88): plans of one room, in order. */
    async movePlan(session: VerifiedSession, id: string, direction: "up" | "down", meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, RATES, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const p = await repos.sitePlans.get(id, { forUpdate: true });
        if (!p) throw notFound();
        const next = moved((await repos.sitePlans.forRooms([p.roomId])).map((x: SitePlanRecord) => x.id), id, direction);
        if (!next) throw conflict("That plan cannot move that way.");
        await repos.sitePlans.setOrder(next);
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Tariff plan", summary: "Reordered tariff plans", subject: null }));
        return { id };
      });
    },
  };
}

export type RoomService = ReturnType<typeof createRoomService>;

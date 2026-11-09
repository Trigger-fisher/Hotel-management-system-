import "server-only";
import type { WebBlockedRange, WebCalendarWeek } from "@shared/dashboards/website";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import type { SitePlanRecord } from "../../repos/website";
import { isDate } from "../billing/advanceValidate";
import { addDays, blockedRanges, inventoryRule } from "./availability";
import { actorOf, conflict, fieldError, logLine, notFound, roomState, today, type WebsiteDeps, type WebsiteUnitRepos, type Who } from "./context";
import type { BlockBody, BulkRatesBody, CalendarSaveBody } from "./schemas";

// The rate and inventory calendar (Pallav Website/CalendarController): a week of rooms open, sold and blocked and of dated prices; a save of the cells
// edited (each checked on its own, one refused cell does not stop the rest); blocking and opening dates; bulk prices over a range. Availability is the
// one pure source (availability.ts) so the calendar can never disagree with the public check. Spec: docs/specs/website.md §6.

const PART = "website.calendar";
/** The longest stretch one action may touch, so a typo cannot silently rewrite years. */
const MAX_RANGE_DAYS = 366;

/** Dates from start to end inclusive; one more than the cap when it is longer (CalendarController::dates). */
function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length <= MAX_RANGE_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}
const nightsIn = (start: string, end: string): number => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function createCalendarService(deps: WebsiteDeps) {
  const { unit, catalog } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });

  async function blocked(repos: WebsiteUnitRepos): Promise<WebBlockedRange[]> {
    const t = today(deps);
    return blockedRanges(await repos.calendar.blockedFrom(addDays(t, -1)), t).map((r) => ({ roomId: r.roomId, roomName: r.roomName, start: r.start, end: r.end, nights: nightsIn(r.start, r.end) }));
  }

  function checkRange(input: { roomIds: readonly string[]; start: string; end: string }, roomMessage: string): { start: string; end: string; dates: string[] } {
    const f: Record<string, string> = {};
    if (input.roomIds.length === 0) f.roomIds = roomMessage;
    const start = input.start.trim();
    const end = input.end.trim();
    if (start === "") f.start = "The start date field is required.";
    else if (!isDate(start)) f.start = "The start date field must be a valid date.";
    if (end === "") f.end = "The end date field is required.";
    else if (!isDate(end)) f.end = "The end date field must be a valid date.";
    else if (!f.start && end < start) f.end = "Start date must be before end date.";
    if (Object.keys(f).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(f)[0], { fields: f });
    const dates = datesBetween(start, end);
    if (dates.length > MAX_RANGE_DAYS) throw fieldError("end", `Range cannot exceed ${MAX_RANGE_DAYS} days.`);
    return { start, end, dates };
  }

  return {
    /** index (:17-48): seven days from the date asked for (today by default), the active plans, and the blocked stretches. */
    async week(session: VerifiedSession, start?: string): Promise<WebCalendarWeek> {
      requirePermission(session, catalog, PART, "view");
      const first = start && isDate(start) ? start : today(deps);
      const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
      return unit.run(session, async (repos) => {
        const rooms = await repos.siteRooms.list();
        const plans = await repos.sitePlans.forRooms(rooms.map((r) => r.id), { activeOnly: true });
        const dated = new Map<string, Map<string, { doublePaise: bigint; singlePaise: bigint | null }>>();
        for (const d of await repos.calendar.rates(plans.map((p) => p.id), days[0], days[6])) {
          if (!dated.has(d.planId)) dated.set(d.planId, new Map());
          dated.get(d.planId)!.set(d.date, d);
        }
        const out: WebCalendarWeek["rooms"] = [];
        for (const r of rooms) {
          const state = await roomState(deps, repos, r.id, days);
          out.push({
            roomId: r.id,
            roomName: r.name,
            totalCount: r.totalCount,
            cells: days.map((date) => ({ date, capacity: state[date].capacity, sold: state[date].sold, blocked: state[date].blocked })),
            plans: plans
              .filter((p) => p.roomId === r.id)
              .map((p: SitePlanRecord) => ({
                planId: p.id,
                code: p.code,
                name: p.name,
                rows: (["single", "double"] as const)
                  .filter((occ) => (occ === "single" ? p.singlePaise !== null : true))
                  .map((occ) => {
                    const base = occ === "single" ? p.singlePaise! : p.doublePaise;
                    return {
                      occ,
                      prices: days.map((date) => {
                        const row = dated.get(p.id)?.get(date);
                        const price = row ? (occ === "single" ? (row.singlePaise ?? base) : row.doublePaise) : base;
                        // "dated" = a dated price that differs from the plan's own
                        return { date, pricePaise: paiseToNumber(price), dated: price !== base };
                      }),
                    };
                  }),
              })),
          });
        }
        return { days, prevStart: addDays(days[0], -7), nextStart: addDays(days[0], 7), today: today(deps), rooms: out, blocked: await blocked(repos) };
      });
    },

    /**
     * save (:50-120): the cells edited, all at once; each is checked on its own, so one refused cell does not stop the rest. The answer says how many
     * went through and why the first refusal was refused. Rooms open can never fall below what is already confirmed nor rise above the category's total.
     */
    async save(session: VerifiedSession, input: CalendarSaveBody, meta: RequestMeta): Promise<{ saved: number; error: string | null }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        let saved = 0;
        let error: string | null = null;
        const lines: string[] = [];
        const roomIds = [...new Set(input.inventory.map((i) => i.roomId))];
        const rooms = new Map((await repos.siteRooms.getMany(roomIds)).map((r) => [r.id, r]));
        const planIds = [...new Set(input.rates.map((r) => r.planId))];
        const plans = new Map((await repos.sitePlans.forRooms([...new Set((await repos.siteRooms.list()).map((r) => r.id))])).filter((p) => planIds.includes(p.id)).map((p) => [p.id, p]));

        const rateRows: Array<Parameters<typeof repos.calendar.upsertRates>[0][number]> = [];
        for (const row of input.rates) {
          const plan = plans.get(row.planId);
          if (!plan || row.pricePaise < 0 || !isDate(row.date)) {
            error ??= "Invalid input";
            continue;
          }
          rateRows.push({ planId: plan.id, date: row.date, ...(row.occ === "double" ? { doublePaise: BigInt(row.pricePaise) } : { singlePaise: BigInt(row.pricePaise) }), planDouble: plan.doublePaise, planSingle: plan.singlePaise });
          saved += 1;
          lines.push(`Rate ${row.date}: ${row.occ} ₹${row.pricePaise / 100}`);
        }
        await repos.calendar.upsertRates(rateRows);

        const inventoryRows: Array<Parameters<typeof repos.calendar.upsertInventory>[0][number]> = [];
        for (const row of input.inventory) {
          const room = rooms.get(row.roomId);
          if (!room || row.capacity < 0 || row.capacity > 250 || !isDate(row.date)) {
            error ??= "Invalid input";
            continue;
          }
          const sold = (await roomState(deps, repos, room.id, [row.date]))[row.date]?.sold ?? 0;
          const refused = inventoryRule(row.capacity, sold, room.totalCount, room.name);
          if (refused) {
            error ??= refused;
            continue;
          }
          const existing = (await repos.calendar.inventory([room.id], row.date, row.date))[0];
          inventoryRows.push({ roomId: room.id, date: row.date, roomsLeft: row.capacity, blocked: existing?.blocked ?? false });
          saved += 1;
          lines.push(`Rooms open ${row.date}: ${row.capacity}`);
        }
        await repos.calendar.upsertInventory(inventoryRows);
        if (saved > 0) await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Rate calendar", summary: `Saved ${saved} calendar ${saved === 1 ? "change" : "changes"}`, subject: null, details: Object.fromEntries(lines.slice(0, 40).map((l, i) => [String(i + 1), l])) }));
        return { saved, error };
      });
    },

    /** toggle (:122-142): close one date to booking, or open it again; a date with confirmed bookings cannot be closed. */
    async toggleBlock(session: VerifiedSession, roomId: string, date: string, meta: RequestMeta): Promise<{ blocked: boolean }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const room = await repos.siteRooms.get(roomId, { forUpdate: true });
        if (!room) throw notFound();
        // decided from the state the button was drawn from: a date past the open window shows as closed with no row, so "unblock" must open it
        const state = (await roomState(deps, repos, roomId, [date]))[date];
        const closing = !(state?.blocked ?? false);
        if (closing && (state?.sold ?? 0) > 0) throw conflict(`Can't block this date - ${state.sold} ${state.sold === 1 ? "room is" : "rooms are"} already confirmed for it.`);
        await repos.calendar.setBlocked([{ roomId, date, blocked: closing, totalCount: room.totalCount }]);
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Rate calendar", summary: `${closing ? "Blocked" : "Unblocked"} ${room.name} for ${date}`, subject: { id: room.id, label: room.name } }));
        return { blocked: closing };
      });
    },

    /** block (:144-186): close a stretch of dates for some rooms; a date with real bookings is skipped. */
    async blockRange(session: VerifiedSession, input: BlockBody, meta: RequestMeta): Promise<{ blocked: number; skipped: number; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      const { dates } = checkRange(input, "Select at least one room category.");
      return unit.run(session, async (repos) => {
        const rooms = await repos.siteRooms.getMany(input.roomIds);
        if (rooms.length !== new Set(input.roomIds).size) throw fieldError("roomIds", "The selected room_ids.0 is invalid.");
        let skipped = 0;
        const rows: Array<Parameters<typeof repos.calendar.setBlocked>[0][number]> = [];
        for (const room of [...rooms].sort((a, b) => (a.id < b.id ? -1 : 1))) {
          await repos.siteRooms.get(room.id, { forUpdate: true });
          const state = await roomState(deps, repos, room.id, dates);
          for (const date of dates) {
            if (state[date].sold > 0) {
              skipped += 1;
              continue;
            }
            rows.push({ roomId: room.id, date, blocked: true, totalCount: room.totalCount });
          }
        }
        await repos.calendar.setBlocked(rows);
        const names = rooms.map((r) => r.name).join(", ");
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Rate calendar", summary: `Blocked ${names} from ${dates[0]} to ${dates[dates.length - 1]}`, subject: null }));
        const message = `Blocked ${plural(dates.length, "date", "dates")} for ${plural(rooms.length, "room category", "room categories")}${skipped ? ` (${skipped} skipped: already booked)` : ""}.`;
        return { blocked: rows.length, skipped, message };
      });
    },

    /** unblock (:188-205): open the stretches picked; only the rows that exist change. */
    async unblock(session: VerifiedSession, ranges: readonly { roomId: string; start: string; end: string }[], meta: RequestMeta): Promise<{ unblocked: number; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      if (ranges.length === 0) throw fieldError("ranges", "Select at least one blocked stretch.");
      return unit.run(session, async (repos) => {
        let stretches = 0;
        let opened = 0;
        for (const r of ranges) {
          const room = await repos.siteRooms.get(r.roomId, { forUpdate: true });
          if (!room || r.end < r.start) continue;
          const dates = datesBetween(r.start, r.end);
          if (dates.length > MAX_RANGE_DAYS) continue;
          const rows = (await repos.calendar.inventory([room.id], dates[0], dates[dates.length - 1])).filter((i) => i.blocked);
          await repos.calendar.setBlocked(rows.map((i) => ({ roomId: room.id, date: i.date, blocked: false, totalCount: room.totalCount })));
          opened += rows.length;
          stretches += 1;
          await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Rate calendar", summary: `Unblocked ${room.name} from ${dates[0]} to ${dates[dates.length - 1]}`, subject: { id: room.id, label: room.name } }));
        }
        if (stretches === 0) throw fieldError("ranges", "Select at least one blocked stretch.");
        return { unblocked: opened, message: `Opened ${stretches} blocked ${stretches === 1 ? "stretch" : "stretches"}.` };
      });
    },

    async planNames(session: VerifiedSession): Promise<string[]> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => repos.sitePlans.names());
    },

    /**
     * bulk (:207-290): prices across a range of dates for the plan of that name in each room picked (names recur between rooms, so the name is matched
     * per room). One, two and extra-person prices are separate; the extra-person price is flat per plan (no dated version). Only a date whose price
     * really changes is written, so cells nobody touched are not flagged.
     */
    async bulk(session: VerifiedSession, input: BulkRatesBody, meta: RequestMeta): Promise<{ dates: number; rooms: number; skipped: string[]; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      const f: Record<string, string> = {};
      const planName = input.planName.trim();
      if (planName === "") f.planName = "Select a rate plan.";
      if (input.singlePaise === null && input.doublePaise === null && input.extraPaise === null) f.prices = "Enter a price for at least one kind of guest.";
      const { dates } = (() => {
        try {
          return checkRange(input, "Select a room category.");
        } catch (error) {
          if (error instanceof AppError && error.details?.fields) Object.assign(f, error.details.fields);
          else throw error;
          return { dates: [] as string[] };
        }
      })();
      if (Object.keys(f).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(f)[0], { fields: f });
      return unit.run(session, async (repos) => {
        const rooms = await repos.siteRooms.getMany(input.roomIds);
        const plans = await repos.sitePlans.forRooms(rooms.map((r) => r.id), { activeOnly: true });
        const existing = await repos.calendar.rates(plans.filter((p) => p.name === planName).map((p) => p.id), dates[0], dates[dates.length - 1]);
        let updated = 0;
        const skipped: string[] = [];
        const rows: Array<Parameters<typeof repos.calendar.upsertRates>[0][number]> = [];
        for (const room of rooms) {
          const plan = plans.find((p) => p.roomId === room.id && p.name === planName);
          if (!plan) {
            skipped.push(room.name);
            continue;
          }
          await repos.sitePlans.get(plan.id, { forUpdate: true });
          if (input.doublePaise !== null || input.singlePaise !== null) {
            for (const date of dates) {
              const row = existing.find((e) => e.planId === plan.id && e.date === date);
              const double = input.doublePaise === null ? undefined : BigInt(input.doublePaise);
              const single = input.singlePaise === null ? undefined : BigInt(input.singlePaise);
              if (row) {
                const changes: { doublePaise?: bigint; singlePaise?: bigint } = {};
                if (double !== undefined && row.doublePaise !== double) changes.doublePaise = double;
                if (single !== undefined && (row.singlePaise ?? BigInt(0)) !== single) changes.singlePaise = single;
                if (changes.doublePaise !== undefined || changes.singlePaise !== undefined) rows.push({ planId: plan.id, date, ...changes, planDouble: plan.doublePaise, planSingle: plan.singlePaise });
              } else {
                const d = double ?? plan.doublePaise;
                const s = single ?? plan.singlePaise;
                if (d !== plan.doublePaise || (s ?? BigInt(0)) !== (plan.singlePaise ?? BigInt(0))) rows.push({ planId: plan.id, date, doublePaise: d, singlePaise: s, planDouble: plan.doublePaise, planSingle: plan.singlePaise });
              }
            }
          }
          if (input.extraPaise !== null && (plan.extraPersonPaise ?? BigInt(0)) !== BigInt(input.extraPaise)) await repos.sitePlans.update(plan.id, { extraPersonPaise: BigInt(input.extraPaise) }, session.userId);
          updated += 1;
        }
        await repos.calendar.upsertRates(rows);
        const labels: [string, number | null][] = [["2 Guests", input.doublePaise], ["1 Guest", input.singlePaise], ["Extra Person", input.extraPaise]];
        const priceText = labels.filter(([, v]) => v !== null).map(([l, v]) => `${l} ₹${v! / 100}`).join(", ");
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Rate calendar", summary: `Set ${planName} rate (${priceText}) from ${dates[0]} to ${dates[dates.length - 1]} for ${rooms.map((r) => r.name).join(", ")}`, subject: null }));
        const message = `Updated ${plural(updated, "room", "rooms")} across ${dates.length} dates.`;
        if (updated === 0) throw conflict(`No active plan named "${planName}" in ${skipped.join(", ")}.`);
        return { dates: dates.length, rooms: updated, skipped, message: skipped.length > 0 ? `${message} No active plan named "${planName}" in ${skipped.join(", ")}.` : message };
      });
    },
  };
}

export type CalendarService = ReturnType<typeof createCalendarService>;

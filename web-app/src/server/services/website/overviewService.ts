import "server-only";
import type { WebArrival, WebBlockedRange, WebOverview } from "@shared/dashboards/website";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { addDays } from "./availability";
import { today, type WebsiteDeps } from "./context";
import { enquiryDto } from "./dto";

// The Website overview (Pallav Website/OverviewController): enquiry counts for a financial year (1 April to 31 March, India time), who arrives today and
// this week, the latest enquiries, the dates closed for booking, the latest changes made to the website and how many rooms and photos there are. Module
// `website` (view). Everything is read in a handful of queries however much there is. Spec: docs/BACKEND.md section 7.7.

/** The Indian financial year (April to March) a date falls in, as its first calendar year. */
export const fyOf = (date: string): number => {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? y : y - 1;
};

const MAX_BACK = 20;

export function createOverviewService(deps: WebsiteDeps) {
  const { unit, catalog, now, publicUrl } = deps;

  return {
    async overview(session: VerifiedSession, askedFy?: number): Promise<WebOverview> {
      requirePermission(session, catalog, "website", "view");
      const day = today(deps);
      const currentFy = fyOf(day);
      const fy = askedFy ?? currentFy;
      if (!Number.isInteger(fy) || fy > currentFy + 1 || fy < currentFy - MAX_BACK) throw new AppError("VALIDATION_FAILED", "Choose a financial year from the list.", { fields: { fy: "Choose a financial year from the list." } });
      const range = { from: new Date(`${fy}-04-01T00:00:00+05:30`), to: new Date(`${fy + 1}-03-31T23:59:59.999+05:30`) };
      void now;
      return unit.run(session, async (repos) => {
        const arrival = (e: Awaited<ReturnType<typeof repos.siteEnquiries.arrivals>>[number]): WebArrival => ({
          id: e.id, reference: e.reference, name: e.name, phone: e.phone ?? "", roomName: e.roomName, guests: Math.max(1, (e.guests ?? 1) - (e.children ?? 0)), children: e.children ?? 0, checkIn: e.checkIn ?? "", message: e.message ?? "",
        });
        const [stats, todays, week, recent, blockedDates, changes, rooms, photos] = await Promise.all([
          repos.siteEnquiries.counts(range),
          repos.siteEnquiries.arrivals(day, day),
          repos.siteEnquiries.arrivals(addDays(day, 1), addDays(day, 7)),
          repos.siteEnquiries.recent(range, 6),
          repos.calendar.blockedFrom(addDays(day, -1)),
          repos.websiteChanges.recent(6),
          repos.siteRooms.list(),
          repos.gallery.count(),
        ]);
        // consecutive blocked dates of one room become one range
        const blocked: WebBlockedRange[] = [];
        let cur: WebBlockedRange | null = null;
        for (const b of blockedDates) {
          if (cur && cur.roomId === b.roomId && addDays(cur.end, 1) === b.date) {
            cur.end = b.date;
            cur.nights += 1;
          } else {
            if (cur) blocked.push(cur);
            cur = { roomId: b.roomId, roomName: b.roomName, start: b.date, end: b.date, nights: 1 };
          }
        }
        if (cur) blocked.push(cur);
        return {
          siteUrl: publicUrl,
          fy,
          currentFy,
          years: [currentFy, currentFy - 1, currentFy - 2],
          stats,
          arrivingToday: todays.map(arrival),
          arrivingWeek: week.map(arrival),
          recent: recent.map((e) => enquiryDto(e, e.roomName)),
          blocked,
          changes: changes.map((c) => ({ id: c.id, summary: c.summary, userName: c.userName, at: c.at.toISOString() })),
          facts: { rooms: rooms.length, photos },
        };
      });
    },
  };
}

export type OverviewService = ReturnType<typeof createOverviewService>;

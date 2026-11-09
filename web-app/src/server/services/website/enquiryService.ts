import "server-only";
import type { Page } from "@shared/dashboards/common";
import type { WebEnquiry, WebEnquiryStats } from "@shared/dashboards/website";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import type { SiteEnquiryRecord } from "../../repos/website";
import { istInstant } from "../cash/ist";
import { diffDetails } from "../cash/syslog";
import { Rules } from "../payrollCore/validate";
import { stayNights } from "./availability";
import { actorOf, conflict, fieldError, logLine, notFound, roomState, today, type EnquiryMailInfo, type EnquiryMailStatus, type WebsiteDeps, type WebsiteUnitRepos, type Who } from "./context";
import { enquiryDto } from "./dto";
import { normalizePhone } from "./rules";
import type { DeclineBody, EnquiryBody } from "./schemas";

// Guest enquiries (Pallav Website/EnquiryController): the list with its tabs, correcting the details, confirming (it becomes a booking and holds its
// room: availability is checked AGAIN under the room lock) and cancelling (with a reason), deleting. Confirming makes the front-office reservation
// in the same unit; cancelling frees it. Spec: docs/specs/website.md §3.

const PART = "website.enquiries";
const dmy = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function createEnquiryService(deps: WebsiteDeps) {
  const { unit, catalog, reservations, mail } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });

  /** What the guest's mail names: the hotel and the room asked for (read in the decision's own unit). */
async function mailInfo(repos: WebsiteUnitRepos, e: SiteEnquiryRecord): Promise<EnquiryMailInfo> {
  return { hotelName: (await repos.hotelProfile.header()).name, roomName: e.roomId ? ((await repos.siteRooms.get(e.roomId))?.name ?? null) : null };
}

async function dtos(repos: WebsiteUnitRepos, rows: readonly SiteEnquiryRecord[]): Promise<WebEnquiry[]> {
    const rooms = new Map((await repos.siteRooms.getMany([...new Set(rows.flatMap((r) => (r.roomId ? [r.roomId] : [])))])).map((r) => [r.id, r.name]));
    return rows.map((e) => enquiryDto(e, e.roomId ? (rooms.get(e.roomId) ?? null) : null));
  }

  const plain = (e: SiteEnquiryRecord): Record<string, unknown> => ({ name: e.name, phone: e.phone, email: e.email, room_id: e.roomId, check_in: e.checkIn, check_out: e.checkOut, guests: e.guests, message: e.message });

  /** update's rules and messages (:57-82); the phone is normalised then judged by its digits (7 to 15). */
  async function validated(repos: WebsiteUnitRepos, input: EnquiryBody) {
    const v = new Rules();
    const name = v.max("name", "name", v.required("name", "name", input.name, "Please enter the guest name."), 100);
    if (name !== null && Array.from(name).length < 2) v.fail("name", "The name field must be at least 2 characters.");
    const email = v.max("email", "email", v.email("email", "email", Rules.clean(input.email)), 150);
    let roomId = input.roomId;
    if (roomId !== null && !(await repos.siteRooms.get(roomId))) {
      v.fail("roomId", "The selected room id is invalid.");
      roomId = null;
    }
    const checkIn = v.date("checkIn", "check in", v.required("checkIn", "check in", input.checkIn));
    const checkOut = v.date("checkOut", "check out", v.required("checkOut", "check out", input.checkOut));
    if (checkIn && checkOut && !v.has("checkOut") && checkOut < checkIn) v.fail("checkOut", "Check-out must be on or after check-in.");
    v.atLeast("guests", "guests", input.guests, 1);
    v.atMost("guests", "guests", input.guests, 30);
    v.atLeast("children", "children", input.children, 0);
    v.atMost("children", "children", input.children, 20);
    const message = v.max("message", "message", v.required("message", "message", input.message, "Please enter the enquiry message."), 2000);
    const phone = normalizePhone(input.phone);
    const digits = phone.replace(/^\+/, "");
    if (digits.length < 7 || digits.length > 15) v.fail("phone", "Please enter a valid phone number with country code.");
    v.done();
    // the count kept is the total: adults and children
    return { name: name!, phone, email, roomId, checkIn: checkIn!, checkOut: checkOut!, guests: input.guests + input.children, children: input.children, message: message! };
  }

  return {
    /** index (:15-60): "new" from an earlier day becomes "pending" first; the tiles count EVERY enquiry (global, as Pallav), the page follows the tab and search. */
    async list(session: VerifiedSession, q: { search?: string; tab: "all" | "pending" | "confirmed" | "declined"; page: number; pageSize: number }): Promise<{ page: Page<WebEnquiry>; stats: WebEnquiryStats }> {
      requirePermission(session, catalog, PART, "view");
      const words = (q.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return unit.run(session, async (repos) => {
        await repos.siteEnquiries.promoteNew(istInstant(today(deps), "00:00:00"));
        const listed = await repos.siteEnquiries.list({ tab: q.tab, words, page: q.page, pageSize: q.pageSize });
        return { page: { items: await dtos(repos, listed.rows), total: listed.total, page: q.page, pageSize: q.pageSize }, stats: await repos.siteEnquiries.counts() };
      });
    },

    async get(session: VerifiedSession, id: string): Promise<WebEnquiry> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const e = await repos.siteEnquiries.get(id);
        if (!e) throw notFound();
        return (await dtos(repos, [e]))[0];
      });
    },

    /** update (:53-83): correct who, which room, which dates. */
    async update(session: VerifiedSession, id: string, input: EnquiryBody, meta: RequestMeta): Promise<WebEnquiry> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const before = await repos.siteEnquiries.get(id, { forUpdate: true });
        if (!before) throw notFound();
        const v = await validated(repos, input);
        const saved = await repos.siteEnquiries.update(id, v, session.userId);
        const changes = diffDetails(plain(before), plain(saved));
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Guest enquiry", summary: `Changed Guest enquiry: ${saved.reference} (${Object.keys(changes).join(", ") || "no change"})`.slice(0, 500), subject: { id, label: saved.reference }, details: changes }));
        return (await dtos(repos, [saved]))[0];
      });
    },

    /**
     * confirm (:91-137): it becomes a booking and holds its room. Availability is checked again under the room's lock (the calendar and the public
     * check are only displays and a pending enquiry can go stale): two people confirming the same room queue up instead of both reading "1 left".
     */
    async confirm(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ enquiry: WebEnquiry; message: string; mail: EnquiryMailStatus }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      const done = await unit.run(session, async (repos) => {
        const first = await repos.siteEnquiries.get(id);
        if (!first) throw notFound();
        // the room first, then the enquiry again under the lock: someone else may have decided it while we waited
        if (first.roomId) await repos.siteRooms.get(first.roomId, { forUpdate: true });
        const e = await repos.siteEnquiries.get(id, { forUpdate: true });
        if (!e) throw notFound();
        if (e.status === "confirmed") throw conflict(`Enquiry ${e.reference} is already confirmed.`);
        if (e.roomId) {
          const nights = stayNights(e.checkIn, e.checkOut);
          if (nights.length > 0) {
            // a request a guest already sent is not stopped by the rolling window: a real per-date closing or running out of rooms still is
            const state = await roomState(deps, repos, e.roomId, nights, { ignoreEnquiryId: e.id, respectOpenWindow: false });
            const full = Object.entries(state).find(([, s]) => s.free < 1);
            if (full) {
              const room = (await repos.siteRooms.get(e.roomId))?.name ?? "That room";
              throw conflict(`Can't confirm ${e.reference} - no ${room} is free on ${dmy(full[0])}. Free up inventory for that date first, or cancel this enquiry.`);
            }
          }
        }
        const confirmed = await repos.siteEnquiries.decide(id, { status: "confirmed", by: session.userId, byName: w.actor?.name ?? "System", at: deps.now(), note: null });
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Guest enquiry", summary: `Confirmed enquiry ${confirmed.reference} for ${confirmed.name}`, subject: { id, label: confirmed.reference } }));
        // it becomes a reservation at the front desk, for the same room and dates
        const reservation = await reservations.reserveFromEnquiry(repos, session, id);
        const made = reservation ? ` Reservation ${reservation.reference} made at the front desk.` : "";
        return { confirmed, info: await mailInfo(repos, confirmed), enquiry: (await dtos(repos, [confirmed]))[0], message: `Enquiry ${confirmed.reference} confirmed.${made}` };
      });
      // the guest is told only once the confirmation is saved; a mail that cannot be queued never undoes it (the answer says so)
      const mailed = await mail.enquiryConfirmed(session.hotelId, done.confirmed, done.info);
      return { enquiry: done.enquiry, message: done.message, mail: mailed };
    },

    /** decline (:140-165): a pending enquiry declined or a confirmed booking cancelled: the same change, with a reason. */
    async decline(session: VerifiedSession, id: string, input: DeclineBody, meta: RequestMeta): Promise<{ enquiry: WebEnquiry; message: string; mail: EnquiryMailStatus }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      const note = input.reason.trim();
      if (note === "") throw fieldError("reason", "Please give a reason for cancelling this enquiry.");
      const done = await unit.run(session, async (repos) => {
        const e = await repos.siteEnquiries.get(id, { forUpdate: true });
        if (!e) throw notFound();
        // a double-submitted form must not stamp the decision again or send a second email
        if (e.status === "declined") throw conflict(`Enquiry ${e.reference} is already cancelled.`);
        const wasConfirmed = e.status === "confirmed";
        const saved = await repos.siteEnquiries.decide(id, { status: "declined", by: session.userId, byName: w.actor?.name ?? "System", at: deps.now(), note: Array.from(note).slice(0, 255).join("") });
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Guest enquiry", summary: `${wasConfirmed ? "Cancelled booking" : "Cancelled enquiry"} ${saved.reference} for ${saved.name}`, subject: { id, label: saved.reference }, details: { Reason: note } }));
        await reservations.cancelFromEnquiry(repos, session, id, `Website enquiry cancelled: ${note}`);
        return { saved, info: await mailInfo(repos, saved), enquiry: (await dtos(repos, [saved]))[0], message: `Enquiry ${saved.reference} cancelled.` };
      });
      const mailed = await mail.enquiryDeclined(session.hotelId, done.saved, done.info);
      return { enquiry: done.enquiry, message: done.message, mail: mailed };
    },

    /** destroy (:167-175) */
    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, PART, "full");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const e = await repos.siteEnquiries.get(id, { forUpdate: true });
        if (!e) throw notFound();
        await repos.siteEnquiries.remove(id);
        const details = Object.fromEntries(Object.entries({ Guest: e.name, Phone: e.phone, Status: e.status, Stay: e.checkIn && e.checkOut ? `${e.checkIn} to ${e.checkOut}` : null }).filter(([, x]) => x));
        await repos.systemLogs.write(logLine(w, { action: "deleted", entity: "Guest enquiry", summary: `Removed Guest enquiry: ${e.reference}`, subject: { id, label: e.reference }, details }));
        return { id };
      });
    },
  };
}

export type EnquiryService = ReturnType<typeof createEnquiryService>;

import "server-only";
import type { CancelResult, FrontOfficeOptions, MealPlan, ReservationPage, ReservationView as UiView } from "@shared/dashboards/frontOffice";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { FrontOfficeRepos, ReservationRecord, ReservationView } from "../../repos/frontOffice";
import { RepoError } from "../../repos/types";
import { unwrapVersioned } from "../../repos/unwrap";
import { advanceSides, receiptNumber } from "../billing/advanceRules";
import { actorOf, logLine, today, typeMap, year2, type FrontOfficeDeps, type Who } from "./context";
import { foAdvanceDto, reservationDto, SOURCE_IN, type ReservationDto } from "./dto";
import { loadReservationContext } from "./loaders";
import { addDay, billMobile, enquiryRate, freeRooms, istDate, nightsOf } from "./rules";
import type { ReservationAdvanceBody, ReservationBody } from "./schemas";
import { Check } from "./validate";

// Front Office reservations (Pallav ReservationController, FrontDesk availability and the website-enquiry conversion, Billing::advance).
// Spec: docs/specs/front-office.md §4-5.

const PART = "pms.reservations";
const VIEW_IN: Record<UiView, ReservationView> = { upcoming: "upcoming", today: "today", inHouse: "in_house", past: "past", cancelled: "cancelled", all: "all" };
const VIEW_OUT: Record<ReservationView, UiView> = { upcoming: "upcoming", today: "today", in_house: "inHouse", past: "past", cancelled: "cancelled", all: "all" };
const PICKER_LIMIT = 500;

export function createReservationService(deps: FrontOfficeDeps) {
  const { unit, catalog } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });
  const dateText = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

  async function dtos(repos: FrontOfficeRepos, rows: ReservationRecord[]): Promise<ReservationDto[]> {
    const ctx = await loadReservationContext(repos, rows);
    return rows.map((r) => reservationDto(r, ctx));
  }

  /** FrontDesk::freeFor (:126-137) for a category on the stay's nights. */
  async function free(repos: FrontOfficeRepos, typeId: string, from: string, to: string, ignoreId?: string): Promise<number> {
    const nights = nightsOf(from, to);
    if (nights.length === 0) return 0;
    const rooms = (await repos.rooms.all()).filter((r) => r.roomTypeId === typeId);
    const type = await repos.roomTypes.get(typeId);
    const capacity = rooms.length > 0 ? rooms.filter((r) => !r.outOfOrder).length : (type?.totalCount ?? 0);
    const held = await repos.reservations.holding(typeId, nights[0], nights[nights.length - 1], { ignoreId });
    const tomorrow = addDay(today(deps));
    const walkIns = (await repos.stays.walkInsOfType(typeId)).map((s) => ({ from: istDate(s.checkInAt), until: s.expectedCheckOut > tomorrow ? s.expectedCheckOut : tomorrow }));
    return freeRooms(capacity, held, walkIns, from, to);
  }

  /** ReservationController::validated (:159-182) and noRoom (:185-198). */
  async function validated(repos: FrontOfficeRepos, input: ReservationBody, ignoreId?: string) {
    const c = new Check(false);
    const guestName = c.required("guestName", "guest name", input.guestName);
    c.max("guestName", "guest name", guestName, 150);
    const mobile = c.text("mobile", "mobile", input.mobile, 20);
    const email = c.email("email", input.email);
    const companyId = input.companyId === "" ? null : input.companyId;
    if (companyId && !(await repos.companies.exists(companyId))) c.fail("companyId", "The selected company id is invalid.");
    const roomTypeId = input.roomTypeId === "" ? null : input.roomTypeId;
    if (!roomTypeId) c.fail("roomTypeId", "Choose a room category.");
    else if (!(await repos.roomTypes.get(roomTypeId))) c.fail("roomTypeId", "The selected room type id is invalid.");
    const rooms = c.between("rooms", "rooms", input.rooms, 1, 50);
    const plan = c.text("plan", "plan", input.plan, 60);
    const rate = c.money("ratePaise", "rate", input.ratePaise) ?? BigInt(0);
    const adults = c.between("adults", "adults", input.adults, 1, 99);
    const children = c.between("children", "children", input.children, 0, 99);
    const checkIn = c.date("checkIn", "check in", input.checkIn, "");
    const checkOut = c.date("checkOut", "check out", input.checkOut, "");
    if (checkIn && checkOut && !c.fields.checkIn && !c.fields.checkOut && checkOut <= checkIn) c.fail("checkOut", "Check-out must be after check-in.");
    const notes = c.text("notes", "notes", input.notes, 2000);
    c.done();
    const fields = { guestName: guestName ?? "", mobile, email, companyId, roomTypeId, rooms, plan, ratePaise: rate, adults, children, checkIn, checkOut, source: SOURCE_IN[input.source], notes };
    const left = await free(repos, roomTypeId as string, checkIn, checkOut, ignoreId);
    if (left < rooms) {
      const name = (await repos.roomTypes.get(roomTypeId as string))?.name ?? "that category";
      throw new AppError("CONFLICT", left === 0 ? `No ${name} room is free for every night of those dates.` : `Only ${left} ${name} ${left === 1 ? "room is" : "rooms are"} free for every night of those dates.`);
    }
    return fields;
  }

  const logFields = (r: ReservationRecord, typeName: string | null) => ({ Room: typeName, Stay: `${dateText(r.checkIn)} to ${dateText(r.checkOut)}`, Rooms: r.rooms, Rate: Number(r.ratePaise) });

  return {
    async list(session: VerifiedSession, q: { view: UiView; search?: string; page: number; pageSize: number }): Promise<ReservationPage> {
      requirePermission(session, catalog, PART, "view");
      const words = (q.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const day = today(deps);
      return unit.run(session, async (repos) => {
        const listed = await repos.reservations.list({ view: VIEW_IN[q.view], today: day, words, page: q.page, pageSize: q.pageSize });
        const counts = await repos.reservations.countByView(day, words);
        return { items: await dtos(repos, listed.rows), total: listed.total, page: q.page, pageSize: q.pageSize, counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [VIEW_OUT[k as ReservationView], v])) as ReservationPage["counts"] };
      });
    },

    async get(session: VerifiedSession, id: string): Promise<ReservationDto> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const r = await repos.reservations.get(id);
        if (!r) throw new AppError("NOT_FOUND");
        return (await dtos(repos, [r]))[0];
      });
    },

    /** Confirmed or checked-in reservations with a room still to fill (the check-in picker). */
    async forCheckIn(session: VerifiedSession): Promise<ReservationDto[]> {
      requirePermission(session, catalog, "pms.stays", "view");
      return unit.run(session, async (repos) => {
        const open = await repos.reservations.openForCheckIn(PICKER_LIMIT);
        const stays = await repos.stays.byReservation(open.map((r) => r.id));
        const fillable = open.filter((r) => r.status === "confirmed" || (stays.get(r.id) ?? []).filter((s) => s.status === "in_house").length < r.rooms);
        return dtos(repos, fillable);
      });
    },

    /** ReservationController::store (:40-56) */
    async create(session: VerifiedSession, input: ReservationBody, meta: RequestMeta): Promise<ReservationDto> {
      requirePermission(session, catalog, PART, "create");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const v = await validated(repos, input);
        const r = await repos.reservations.create({ ...v, status: "confirmed", siteEnquiryId: null, cancelReason: null, createdBy: session.userId, year2: year2(deps) });
        const type = await repos.roomTypes.get(r.roomTypeId as string);
        await repos.systemLogs.write(logLine(w, { action: "created", entity: "Reservation", summary: `Added Reservation: ${r.reference} - ${r.guestName}`, subject: { id: r.id, label: `${r.reference} - ${r.guestName}` }, details: logFields(r, type?.name ?? null) }));
        return (await dtos(repos, [r]))[0];
      });
    },

    /** ReservationController::update (:77-97) */
    async update(session: VerifiedSession, id: string, input: ReservationBody & { version: number }, meta: RequestMeta): Promise<ReservationDto> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const r = await repos.reservations.get(id, { forUpdate: true });
        if (!r) throw new AppError("NOT_FOUND");
        if (r.status !== "confirmed" && r.status !== "checked_in") throw new AppError("CONFLICT", "A reservation that is finished or cancelled cannot be changed.");
        if (r.version !== input.version) throw new AppError("CONFLICT", undefined, { currentVersion: r.version });
        const v = await validated(repos, input, r.id);
        const updated = unwrapVersioned(await repos.reservations.update(r.id, input.version, v, session.userId));
        const keys = ["guestName", "mobile", "email", "companyId", "roomTypeId", "rooms", "plan", "ratePaise", "adults", "children", "checkIn", "checkOut", "source", "notes"] as const;
        const snake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`).replace("rate_paise", "rate");
        const show = (x: unknown) => (x === null || x === undefined || x === "" ? "empty" : String(x));
        const changed = keys.filter((k) => show(r[k]) !== show(updated[k]));
        const readable = (k: string) => { const s = snake(k).replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
        await repos.systemLogs.write(
          logLine(w, {
            action: "updated",
            entity: "Reservation",
            summary: changed.length ? `Changed Reservation: ${updated.reference} - ${updated.guestName} (${changed.map(readable).join(", ")})` : `Saved Reservation: ${updated.reference} - ${updated.guestName} with no change`,
            subject: { id: updated.id, label: `${updated.reference} - ${updated.guestName}` },
            details: Object.fromEntries(changed.map((k) => [readable(k), `was ${show(r[k])}, became ${show(updated[k])}`])),
          }),
        );
        return (await dtos(repos, [updated]))[0];
      });
    },

    /** ReservationController::cancel (:100-121) */
    async cancel(session: VerifiedSession, id: string, input: { noShow: boolean; reason: string; version: number }, meta: RequestMeta): Promise<CancelResult> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const r = await repos.reservations.get(id, { forUpdate: true });
        if (!r) throw new AppError("NOT_FOUND");
        if (r.status !== "confirmed") throw new AppError("CONFLICT", "Only a reservation not yet checked in can be cancelled.");
        if (r.version !== input.version) throw new AppError("CONFLICT", undefined, { currentVersion: r.version });
        const reason = input.reason.trim();
        if (!input.noShow && reason === "") throw new AppError("VALIDATION_FAILED", "Please give a reason for cancelling.", { fields: { reason: "Please give a reason for cancelling." } });
        const cancelReason = Array.from(reason || "Did not arrive").slice(0, 255).join("");
        const updated = unwrapVersioned(await repos.reservations.update(r.id, input.version, { status: input.noShow ? "no_show" : "cancelled", cancelReason }, session.userId));
        await repos.systemLogs.write(
          logLine(w, { action: "updated", entity: "Reservation", summary: `${input.noShow ? "No-show: " : "Cancelled reservation "}${r.reference} - ${r.guestName}`, subject: { id: r.id, label: r.reference }, details: { Reason: cancelReason } }),
        );
        const left = ((await repos.advances.byReservation([r.id])).get(r.id) ?? []).reduce((t, a) => t + a.hotelBalancePaise + a.foodBalancePaise, BigInt(0));
        return { reservation: (await dtos(repos, [updated]))[0], notice: left > BigInt(0) ? "It still has an advance: refund it from Guest Advances if it is to be returned." : null };
      });
    },

    /** Billing::suggest for receipts (Support/Pms/Billing.php:175-182): one past the highest typed this year. */
    async suggestReceipt(session: VerifiedSession): Promise<string> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => String((await repos.advances.highestTyped(`${today(deps).slice(0, 4)} / `)) + 1));
    },

    /** ReservationController::advance (:124-147) and Billing::advance (Billing.php:31-62): a payment taken against the reservation, as a Guest Advance. */
    async addAdvance(session: VerifiedSession, id: string, input: ReservationAdvanceBody, meta: RequestMeta) {
      requirePermission(session, catalog, PART, "create");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const r = await repos.reservations.get(id, { forUpdate: true });
        if (!r) throw new AppError("NOT_FOUND");
        const c = new Check(false);
        const typed = c.required("receiptNumber", "receipt number", input.receiptNumber);
        c.max("receiptNumber", "receipt number", typed, 50);
        const paymentDate = c.date("paymentDate", "payment date", input.paymentDate, "");
        const hotel = c.money("hotelPaise", "hotel amount", input.hotelPaise);
        const food = c.money("foodPaise", "food amount", input.foodPaise);
        const hotelMode = c.text("hotelMode", "hotel mode", input.hotelMode, 20);
        const foodMode = c.text("foodMode", "food mode", input.foodMode, 20);
        const instruction = c.text("instruction", "instruction", input.instruction, 255);
        c.done();
        const sides = advanceSides({ covers: "both", hotelPaise: hotel, foodPaise: food, hotelMode, foodMode });
        if (!sides.paid) throw new AppError("VALIDATION_FAILED", "Enter how much the guest paid.", { fields: { hotelPaise: "Enter how much the guest paid." } });
        const receipt = receiptNumber(today(deps).slice(0, 4), typed ?? "");
        if (await repos.advances.byReceipt(receipt)) throw new AppError("VALIDATION_FAILED", "That receipt number is already used.", { fields: { receiptNumber: "That receipt number is already used." } });
        const advance = await repos.advances
          .create({
            receiptNumber: receipt,
            guestName: r.guestName,
            mobileNumber: billMobile(r.mobile),
            roomNumber: null,
            companyId: r.companyId,
            reservationId: r.id,
            paymentDate,
            hotelAmountPaise: sides.hotelAmountPaise,
            foodAmountPaise: sides.foodAmountPaise,
            hotelMode: sides.hotelMode,
            foodMode: sides.foodMode,
            referenceName: r.reference,
            referenceMobileNumber: null,
            instruction: instruction ?? `Advance for reservation ${r.reference}`,
            hotelBalancePaise: sides.hotelBalancePaise,
            foodBalancePaise: sides.foodBalancePaise,
            totalPaise: sides.totalPaise,
            hotelRefundAmountPaise: null,
            foodRefundAmountPaise: null,
            hotelRefundMode: null,
            foodRefundMode: null,
            refundPaymentDate: null,
            refundGuestName: null,
            refundMobileNumber: null,
            refundInstruction: null,
            createdBy: session.userId,
          })
          .catch((error: unknown) => {
            if (error instanceof RepoError && error.kind === "unique") throw new AppError("VALIDATION_FAILED", "That receipt number is already used.", { fields: { receiptNumber: "That receipt number is already used." } });
            throw error;
          });
        await repos.systemLogs.write(
          logLine(w, { module: "bills", action: "created", entity: "Advance", summary: `Added Advance: Advance ${advance.receiptNumber} - ${advance.guestName}`, subject: { id: advance.id, label: `Advance ${advance.receiptNumber} - ${advance.guestName}` }, details: { Reservation: r.reference, "Hotel amount": Number(sides.hotelAmountPaise), "Food amount": Number(sides.foodAmountPaise) } }),
        );
        return foAdvanceDto(advance);
      });
    },

    /** The forms' lists: categories with their active plans, companies, ID types, payment modes (part key: anyone filling a front-office form). */
    async options(session: VerifiedSession): Promise<FrontOfficeOptions> {
      requirePermission(session, catalog, "pms.reservations", "view");
      return unit.run(session, async (repos) => ({
        roomTypes: [...(await typeMap(repos)).values()].map((t) => ({
          id: t.id,
          name: t.name,
          plans: t.plans.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder).map((p): MealPlan => ({ code: p.code as MealPlan["code"], name: p.name, singlePaise: Number(p.singlePaise ?? p.doublePaise), doublePaise: Number(p.doublePaise) })),
        })),
        companies: await repos.companies.list(PICKER_LIMIT),
        idTypes: await repos.idProofTypes.activeNames(),
        paymentModes: (await repos.optionLists.items("payment_mode")).map((m) => m.value),
      }));
    },

    /**
     * FrontDesk::reserveFromEnquiry (:144-180), for the Website module inside ITS unit: once per enquiry (a cancelled or no-show one is
     * confirmed again); the room's first active plan by sort order; Pallav's single/double rate rule.
     */
    async reserveFromEnquiry(repos: FrontOfficeRepos, session: VerifiedSession, enquiryId: string): Promise<ReservationRecord | null> {
      const e = await repos.enquiries.get(enquiryId);
      if (!e || !e.roomId || !e.checkIn || !e.checkOut) return null;
      const existing = await repos.reservations.byEnquiry(e.id);
      if (existing) {
        if (existing.status === "cancelled" || existing.status === "no_show") return unwrapVersioned(await repos.reservations.update(existing.id, existing.version, { status: "confirmed", cancelReason: null }, session.userId));
        return existing;
      }
      const type = await repos.roomTypes.get(e.roomId);
      const plan = type?.plans.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;
      const rate = enquiryRate(e.guests, e.children, plan ? { singlePaise: plan.singlePaise, doublePaise: plan.doublePaise } : null);
      return repos.reservations.create({
        guestName: e.name,
        mobile: e.phone,
        email: e.email,
        companyId: null,
        roomTypeId: e.roomId,
        rooms: 1,
        plan: plan?.code ?? null,
        ratePaise: rate.ratePaise,
        adults: rate.adults,
        children: rate.children,
        checkIn: e.checkIn,
        checkOut: e.checkOut,
        source: "website",
        status: "confirmed",
        siteEnquiryId: e.id,
        notes: `Website enquiry ${e.reference}\n${e.message ?? ""}`.trim(),
        cancelReason: null,
        createdBy: session.userId,
        year2: year2(deps),
      });
    },

    /** FrontDesk::cancelFromEnquiry (:183-191): the enquiry's confirmed reservation goes too (not once the guest has arrived). */
    async cancelFromEnquiry(repos: FrontOfficeRepos, session: VerifiedSession, enquiryId: string, reason: string): Promise<void> {
      const r = await repos.reservations.byEnquiry(enquiryId);
      if (r && r.status === "confirmed") unwrapVersioned(await repos.reservations.update(r.id, r.version, { status: "cancelled", cancelReason: Array.from(reason).slice(0, 255).join("") }, session.userId));
    },
  };
}

export type ReservationService = ReturnType<typeof createReservationService>;

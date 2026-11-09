import "server-only";
import { guestDetailsOf } from "./guestDetails";
import { groupGuests, mobileDigits } from "./guestLookup";
import { GST_SLAB_LIMIT_PAISE, gstSlabPercent, type Charge, type CheckInPrefill, type CheckoutDefaults, type GuestLookupResult, type Room, type StayIdNumbers, type StayPage, type StayView as UiStayView } from "@shared/dashboards/frontOffice";
import { requirePermission } from "../../auth/permissions";
import { maskNumber } from "../../crypto/fieldSeal";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import type { AdvanceRecord } from "../../repos/billing";
import type { FrontOfficeRepos, StayFields, StayRecord } from "../../repos/frontOffice";
import { RepoError } from "../../repos/types";
import { unwrapVersioned } from "../../repos/unwrap";
import { billingKit } from "../billing/kit";
import { actorOf, logLine, today, type FrontOfficeDeps, type Who } from "./context";
import { CATEGORY_IN, chargeDto, reservationDto, stayDto, type StayDto } from "./dto";
import { loadReservationContext, loadStayContext } from "./loaders";
import type { RoomService } from "./roomService";
import { billAddress, billMobile, chargeAmount, checkoutAdvance, checkoutTotals, istDate, roomCharge, stayNights } from "./rules";
import type { ChargeBody, CheckInBody, CheckOutBody, GuestDetailsBody } from "./schemas";
import { Check, gstPercent, quantity } from "./validate";

// Front Office stays (Pallav StayController, Support/Pms/Billing::bill): check-in, the guest's account, moving room, staying longer, and
// check-out into a Bill Master bill written by the BILL SERVICE's own function in the same unit (ruled (f)). The stay is read FOR UPDATE by
// every change, so a charge can never land after check-out. Spec: docs/specs/front-office.md §6-8.

const PART = "pms.stays";
const SIDE: Record<string, "hotel" | "food"> = { food: "food", room_service: "food", laundry: "hotel", extra_bed: "hotel", other: "hotel" };
const NOT_IN_HOUSE = "This guest has checked out; their bill is in Bills.";
const SETTING_KEYS = ["checkout.hotel_gst_percent", "checkout.food_gst_percent", "checkout.gst_slab_limit_paise"] as const;
/** The guest lookup reads this many newest rows of each table before grouping, and answers at most five guests. */
const LOOKUP_ROWS = 50;
const LOOKUP_GUESTS = 5;

export function createStayService(deps: FrontOfficeDeps, rooms: RoomService) {
  const { unit, catalog, now } = deps;
  const kit = billingKit(deps);
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });

  async function dtos(repos: FrontOfficeRepos, rows: StayRecord[]): Promise<StayDto[]> {
    const ctx = await loadStayContext(repos, deps, rows);
    return rows.map((s) => stayDto(s, ctx(s)));
  }
  async function lockStay(repos: FrontOfficeRepos, id: string): Promise<StayRecord> {
    const s = await repos.stays.get(id, { forUpdate: true });
    if (!s) throw new AppError("NOT_FOUND");
    return s;
  }
  const checkVersion = (s: StayRecord, version: number): void => {
    if (s.version !== version) throw new AppError("CONFLICT", undefined, { currentVersion: s.version });
  };
  const roomNumber = async (repos: FrontOfficeRepos, roomId: string): Promise<string> => (await repos.rooms.get(roomId))?.number ?? "";

  return {
    async list(session: VerifiedSession, q: { view: UiStayView; search?: string; page: number; pageSize: number }): Promise<StayPage> {
      requirePermission(session, catalog, PART, "view");
      const words = (q.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return unit.run(session, async (repos) => {
        const listed = await repos.stays.list({ view: q.view === "past" ? "past" : "in_house", words, page: q.page, pageSize: q.pageSize });
        const counts = await repos.stays.countByView(words);
        return { items: await dtos(repos, listed.rows), total: listed.total, page: q.page, pageSize: q.pageSize, counts: { inHouse: counts.in_house, past: counts.past } };
      });
    },

    async get(session: VerifiedSession, id: string): Promise<StayDto> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const s = await repos.stays.get(id);
        if (!s) throw new AppError("NOT_FOUND");
        const dto = (await dtos(repos, [s]))[0];
        // the duplicate warning: the same main ID number on another guest in the house (never blocks, a person can really be in two records)
        if (s.status !== "in_house" || !s.idProofNumber) return dto;
        const same = await repos.stays.sameIdInHouse(s.idProofNumber, s.id);
        if (same.length === 0) return dto;
        const sameIdElsewhere = await Promise.all(same.map(async (o) => ({ stayId: o.id, roomNumber: await roomNumber(repos, o.roomId), guestName: o.guestName })));
        return { ...dto, sameIdElsewhere };
      });
    },

    /** StayController::create (:46-67): the form, filled from a reservation when there is one. */
    async prefill(session: VerifiedSession, reservationId: string | undefined): Promise<CheckInPrefill> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const r = reservationId ? await repos.reservations.get(reservationId) : null;
        if (reservationId && !r) throw new AppError("NOT_FOUND");
        if (r && r.status !== "confirmed" && r.status !== "checked_in") throw new AppError("VALIDATION_FAILED", "This reservation cannot be checked in.", { fields: { reservationId: "This reservation cannot be checked in." } });
        const given = await rooms.roomsToGive(repos, r?.roomTypeId ?? null);
        if (given.length === 0) throw new AppError("CONFLICT", "No room is free to give: every room is occupied or out of order.");
        const alreadyIn = r ? ((await repos.stays.byReservation([r.id])).get(r.id) ?? []).filter((s) => s.status === "in_house").length : 0;
        // HMS: the next guest-register number, one past the highest on record; none yet means the desk starts its own
        const highestGr = await repos.stays.highestGrNumber();
        return { reservation: r ? reservationDto(r, await loadReservationContext(repos, [r])) : null, alreadyIn, rooms: given, ...(highestGr > 0 ? { suggestedGrNumber: String(highestGr + 1) } : {}) };
      });
    },

    /** HMS: a past guest of THIS hotel by mobile, for the check-in form. Nothing here is logged: the number and the ID are guest data. */
    async lookupGuest(session: VerifiedSession, mobile: string): Promise<GuestLookupResult> {
      requirePermission(session, catalog, PART, "view");
      const digits = mobileDigits(mobile);
      if (digits.length < 6) throw new AppError("VALIDATION_FAILED", undefined, { fields: { mobile: "Enter at least the last 6 digits of the mobile number." } });
      return unit.run(session, async (repos) => {
        const [stays, reservations] = await Promise.all([repos.stays.byMobileSuffix(digits, LOOKUP_ROWS), repos.reservations.byMobileSuffix(digits, LOOKUP_ROWS)]);
        // one read of the hotel's rooms (a few hundred at most) instead of one per stay
        const numbers = stays.length > 0 ? new Map((await repos.rooms.all()).map((r) => [r.id, r.number] as const)) : new Map<string, string>();
        return { matches: groupGuests(stays, reservations, (roomId) => numbers.get(roomId) || null, LOOKUP_GUESTS) };
      });
    },

    async roomsToMove(session: VerifiedSession, id: string): Promise<Room[]> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const s = await repos.stays.get(id);
        if (!s) throw new AppError("NOT_FOUND");
        const room = await repos.rooms.get(s.roomId);
        return rooms.roomsToGive(repos, room?.roomTypeId ?? null, s.roomId);
      });
    },

    /**
     * Billing::suggest for bills, and the check-out GST defaults (MJ #19): the hotel's typed percents (settings, 0 to 28) win; with none typed
     * and a stay named, the hotel side follows the room GST slab of that stay's rate (5% at or under the limit, 18% above; the limit is the
     * hotel setting checkout.gst_slab_limit_paise, else 7,500 rupees); otherwise 5.
     */
    async checkoutDefaults(session: VerifiedSession, stayId?: string): Promise<CheckoutDefaults> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const stay = stayId ? await repos.stays.get(stayId) : null;
        if (stayId && !stay) throw new AppError("NOT_FOUND");
        const settings = await repos.settings.values(SETTING_KEYS);
        const typed = (key: string): number | null => {
          const raw = (settings.get(key) ?? "").trim();
          const v = Number(raw);
          return raw !== "" && Number.isFinite(v) && v >= 0 && v <= 28 ? v : null;
        };
        const limit = Number(settings.get(SETTING_KEYS[2]) ?? "");
        const slab = stay ? gstSlabPercent(Number(stay.ratePaise), Number.isFinite(limit) && limit > 0 ? limit : GST_SLAB_LIMIT_PAISE) : 5;
        return { hotelGstPercent: typed(SETTING_KEYS[0]) ?? slab, foodGstPercent: typed(SETTING_KEYS[1]) ?? 5, suggestedBillNumber: String((await repos.bills.highestTyped(`${today(deps).slice(0, 4)} / `)) + 1) };
      });
    },

    /** StayController::store (:69-128) */
    async checkIn(session: VerifiedSession, input: CheckInBody, meta: RequestMeta): Promise<StayDto> {
      requirePermission(session, catalog, PART, "create");
      const w = await who(session, meta);
      const day = today(deps);
      return unit.run(session, async (repos) => {
        const c = new Check(false);
        const reservationId = input.reservationId === "" ? null : input.reservationId;
        const reservation = reservationId ? await repos.reservations.get(reservationId, { forUpdate: true }) : null;
        if (reservationId && !reservation) c.fail("reservationId", "The selected reservation id is invalid.");
        const room = await repos.rooms.get(input.roomId, { forUpdate: true });
        if (!room) c.fail("roomId", "The selected room id is invalid.");
        const grNumber = c.text("grNumber", "gr number", input.grNumber, 50);
        const guestName = c.required("guestName", "guest name", input.guestName);
        c.max("guestName", "guest name", guestName, 150);
        const mobile = c.required("mobile", "mobile", input.mobile);
        c.max("mobile", "mobile", mobile, 20);
        const email = c.email("email", input.email);
        const address = c.text("address", "address", input.address, 255);
        const city = c.text("city", "city", input.city, 100);
        const nationality = c.text("nationality", "nationality", input.nationality, 60);
        const idProofType = c.text("idProofType", "id proof type", input.idProofType, 60);
        const idProofNumber = c.text("idProofNumber", "id proof number", input.idProofNumber, 60);
        const companyId = input.companyId === "" ? null : input.companyId;
        if (companyId && !(await repos.companies.exists(companyId))) c.fail("companyId", "The selected company id is invalid.");
        const guestGstin = c.text("guestGstin", "guest gstin", input.guestGstin, 20);
        const adults = c.between("adults", "adults", input.adults, 1, 20);
        const children = c.between("children", "children", input.children, 0, 20);
        const plan = c.text("plan", "plan", input.plan, 60);
        if (input.ratePaise === null) c.fail("ratePaise", "The rate field is required.");
        const rate = c.money("ratePaise", "rate", input.ratePaise) ?? BigInt(0);
        const expected = c.date("expectedCheckOut", "expected check out", input.expectedCheckOut, "");
        if (expected && !c.fields.expectedCheckOut && expected <= day) c.fail("expectedCheckOut", "The check-out date must be after today.");
        const notes = c.text("notes", "notes", input.notes, 2000);
        // the main guest's further details: optional, checked when given
        const guest = guestDetailsOf(input, day, input.adults + input.children);
        for (const [key, message] of Object.entries(guest.errors)) c.fail(key, message);
        c.done();
        const theRoom = room as NonNullable<typeof room>;
        if (theRoom.outOfOrder || (await repos.stays.currentByRoom([theRoom.id])).has(theRoom.id)) throw new AppError("CONFLICT", `Room ${theRoom.number} is not free. Choose another.`);

        const stay = await repos.stays
          .create({
            reservationId,
            roomId: theRoom.id,
            grNumber,
            guestName: guestName ?? "",
            mobile,
            email,
            address,
            city,
            nationality,
            idProofType,
            idProofNumber: idProofNumber || null,
            idProofPath: null,
            companyId,
            guestGstin,
            adults,
            children,
            plan,
            ratePaise: rate,
            checkInAt: now(),
            expectedCheckOut: expected,
            checkOutAt: null,
            status: "in_house",
            billId: null,
            hotelGstPercent: null,
            foodGstPercent: null,
            notes,
            guestDetails: guest.details,
            createdBy: session.userId,
          })
          .catch((error: unknown) => {
            // the one-in-house-per-room index: another clerk checked someone into this room a moment ago
            if (error instanceof RepoError && error.kind === "unique") throw new AppError("CONFLICT", `Room ${theRoom.number} is not free. Choose another.`);
            throw error;
          });
        // the reservation is checked in once all its rooms have someone in them (:115-118)
        if (reservation) {
          const inHouse = ((await repos.stays.byReservation([reservation.id])).get(reservation.id) ?? []).filter((s) => s.status === "in_house").length;
          if (inHouse >= reservation.rooms && reservation.status !== "checked_in") unwrapVersioned(await repos.reservations.update(reservation.id, reservation.version, { status: "checked_in" }, session.userId));
        }
        await repos.systemLogs.write(
          logLine(w, {
            action: "created",
            entity: "Check-in",
            summary: `Added Check-in: ${stay.guestName} in room ${theRoom.number}`,
            subject: { id: stay.id, label: `${stay.guestName} in room ${theRoom.number}` },
            details: { Reservation: reservation?.reference ?? "Walk-in", Rate: paiseToNumber(rate), Until: new Date(`${expected}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) },
          }),
        );
        return (await dtos(repos, [stay]))[0];
      });
    },

    /**
     * Show (decision 74): the whole ID numbers of one stay (the main guest's and the other guests'), for someone who may edit the stay. One Activity line per call that names the stay,
     * never a number. Refused to platform staff during a visit and to API keys (visitAccess.ts, apiTokens.ts).
     */
    async revealIdNumbers(session: VerifiedSession, id: string, meta: RequestMeta): Promise<StayIdNumbers> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const s = await repos.stays.get(id);
        if (!s) throw new AppError("NOT_FOUND");
        const members = (s.guestDetails?.members ?? []).map((m) => ({ idNumber: m.idNumber ?? "" }));
        if (!s.idProofNumber && members.every((m) => m.idNumber === "")) throw new AppError("CONFLICT", "No ID number is saved for this stay.");
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Stay", summary: "ID numbers shown", subject: { id: s.id, label: `Stay ${s.id.slice(0, 8)}` } }));
        return { idProofNumber: s.idProofNumber ?? "", members };
      });
    },

    /**
     * HMS (MJ): the main guest's further details and the room's other guests, edited after check-in. The whole set is replaced; a stale version
     * is a CONFLICT.
     */
    async updateGuestDetails(session: VerifiedSession, id: string, input: GuestDetailsBody, meta: RequestMeta): Promise<StayDto> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const s = await repos.stays.get(id, { forUpdate: true });
        if (!s) throw new AppError("NOT_FOUND");
        const guest = guestDetailsOf(input, today(deps), s.adults + s.children);
        // the main guest's own fields, checked like at check-in; only the ones sent change (an empty string clears)
        const c = new Check(false);
        const own: Partial<Pick<StayFields, "idProofType" | "idProofNumber" | "email" | "address" | "city">> = {};
        if (input.idProofType !== undefined) own.idProofType = c.text("idProofType", "id proof type", input.idProofType, 60);
        if (input.idProofNumber !== undefined) {
          const typed = c.text("idProofNumber", "id proof number", input.idProofNumber, 60);
          // the screens show the number masked (decision 74): the masked text sent back unchanged keeps the stored number; any other mask is not a number
          if (typed && s.idProofNumber && typed === maskNumber(s.idProofNumber)) void 0;
          else if (typed && typed.includes("\u2022")) c.fail("idProofNumber", "Type the whole ID number again, or leave it as it is.");
          else own.idProofNumber = typed || null;
        }
        if (input.email !== undefined) own.email = c.email("email", input.email);
        if (input.address !== undefined) own.address = c.text("address", "address", input.address, 255);
        if (input.city !== undefined) own.city = c.text("city", "city", input.city, 100);
        for (const [key, message] of Object.entries(guest.errors)) c.fail(key, message);
        // another guest's masked number sent back unchanged (same place in the list) keeps the stored one; any other mask is not a number
        const storedMembers = s.guestDetails?.members ?? [];
        guest.details?.members?.forEach((m, i) => {
          const was = storedMembers[i]?.idNumber;
          if (!m.idNumber) return;
          if (was && m.idNumber === maskNumber(was)) m.idNumber = was;
          else if (m.idNumber.includes("\u2022")) c.fail(`members.${i}.idNumber`, "Type the whole ID number again, or leave it as it is.");
        });
        c.done();
        // the stay's further ID images are not part of this form: they are kept as they are
        const photos = s.guestDetails?.idPhotos;
        const details = photos && photos.length > 0 ? { ...(guest.details ?? {}), idPhotos: photos } : guest.details;
        const updated = unwrapVersioned(await repos.stays.update(s.id, input.version, { guestDetails: details, ...own }, session.userId));
        // the log names the stay and what kind of change it was, never the values (they are guest data)
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Stay", summary: "Guest details updated", subject: { id: s.id, label: `Stay ${s.id.slice(0, 8)}` }, details: { "Other guests": guest.details?.members?.length ?? 0 } }));
        return (await dtos(repos, [updated]))[0];
      });
    },

    /** StayController::charge (:143-166). The stay is read FOR UPDATE (ruled): no charge after check-out. */
    async addCharge(session: VerifiedSession, id: string, input: ChargeBody, meta: RequestMeta): Promise<Charge> {
      requirePermission(session, catalog, PART, "create");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const s = await lockStay(repos, id);
        if (s.status !== "in_house") throw new AppError("CONFLICT", NOT_IN_HOUSE);
        const c = new Check(false);
        const description = c.required("description", "description", input.description);
        c.max("description", "description", description, 255);
        const chargeDate = c.date("chargeDate", "charge date", input.chargeDate, "");
        const qty = quantity(c, "quantity", input.quantity, false);
        if (input.unitPricePaise === null) c.fail("unitPricePaise", "The unit price field is required.");
        const unitPrice = c.money("unitPricePaise", "unit price", input.unitPricePaise) ?? BigInt(0);
        c.done();
        const category = CATEGORY_IN[input.category];
        const charge = await repos.charges.create({ stayId: s.id, chargeDate, category, side: SIDE[category], description: description ?? "", quantity: qty, unitPricePaise: unitPrice, amountPaise: chargeAmount(qty, unitPrice), createdBy: session.userId });
        const n = await roomNumber(repos, s.roomId);
        await repos.systemLogs.write(logLine(w, { action: "created", entity: "Guest charge", summary: `Added Guest charge: ${charge.description} - room ${n}`, subject: { id: charge.id, label: `${charge.description} - room ${n}` }, details: { Amount: paiseToNumber(charge.amountPaise), Kind: CHARGE_LABEL[category] } }));
        return chargeDto(charge);
      });
    },

    /** StayController::removeCharge (:168-180): hard delete, only while in house. */
    async removeCharge(session: VerifiedSession, id: string, chargeId: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, PART, "full");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const s = await lockStay(repos, id);
        const charge = await repos.charges.get(chargeId);
        if (!charge || charge.stayId !== s.id) throw new AppError("NOT_FOUND");
        if (s.status !== "in_house") throw new AppError("CONFLICT", NOT_IN_HOUSE);
        await repos.charges.delete(charge.id);
        const n = await roomNumber(repos, s.roomId);
        await repos.systemLogs.write(logLine(w, { action: "deleted", entity: "Guest charge", summary: `Removed Guest charge: ${charge.description} - room ${n}`, subject: { id: charge.id, label: `${charge.description} - room ${n}` }, details: { Amount: paiseToNumber(charge.amountPaise) } }));
        return { id: charge.id };
      });
    },

    /** StayController::move (:183-199): to another free room; the room left needs cleaning. */
    async move(session: VerifiedSession, id: string, input: { roomId: string; ratePaise: number | null; version: number }, meta: RequestMeta): Promise<StayDto> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const s = await lockStay(repos, id);
        const to = await repos.rooms.get(input.roomId, { forUpdate: true });
        if (!to) throw new AppError("VALIDATION_FAILED", undefined, { fields: { roomId: "The selected room id is invalid." } });
        const c = new Check(false);
        const rate = c.money("ratePaise", "rate", input.ratePaise);
        c.done();
        if (s.status !== "in_house" || to.outOfOrder || (await repos.stays.currentByRoom([to.id])).has(to.id)) throw new AppError("CONFLICT", `Room ${to.number} is not free.`);
        checkVersion(s, input.version);
        const from = await repos.rooms.get(s.roomId, { forUpdate: true });
        const moved = unwrapVersioned(
          await repos.stays.update(s.id, input.version, { roomId: to.id, ...(rate !== null ? { ratePaise: rate } : {}) }, session.userId).catch((error: unknown) => {
            if (error instanceof RepoError && error.kind === "unique") throw new AppError("CONFLICT", `Room ${to.number} is not free.`);
            throw error;
          }),
        );
        if (from) await repos.rooms.update(from.id, { hkStatus: "dirty" }, session.userId);
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Check-in", summary: `Moved ${s.guestName} from room ${from?.number ?? ""} to ${to.number}`, subject: { id: s.id, label: s.guestName }, details: { Rate: paiseToNumber(moved.ratePaise) } }));
        return (await dtos(repos, [moved]))[0];
      });
    },

    /** StayController::extend (:202-213): the expected check-out, after the check-in date; the reservation follows. */
    async extend(session: VerifiedSession, id: string, input: { expectedCheckOut: string; version: number }, meta: RequestMeta): Promise<StayDto> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const s = await lockStay(repos, id);
        checkVersion(s, input.version);
        const c = new Check(false);
        const checkInDate = istDate(s.checkInAt);
        const date = c.date("expectedCheckOut", "expected check out", input.expectedCheckOut, "");
        if (date && !c.fields.expectedCheckOut && date <= checkInDate) c.fail("expectedCheckOut", `The expected check out field must be a date after ${checkInDate}.`);
        c.done();
        const before = s.expectedCheckOut;
        const updated = unwrapVersioned(await repos.stays.update(s.id, input.version, { expectedCheckOut: date }, session.userId));
        if (s.reservationId) {
          const r = await repos.reservations.get(s.reservationId, { forUpdate: true });
          if (r && date > r.checkIn) unwrapVersioned(await repos.reservations.update(r.id, r.version, { checkOut: date }, session.userId));
        }
        const n = await roomNumber(repos, s.roomId);
        await repos.systemLogs.write(
          logLine(w, { action: "updated", entity: "Check-in", summary: `Changed Check-in: ${s.guestName} room ${n} (Expected check out)`, subject: { id: s.id, label: `${s.guestName} room ${n}` }, details: { "Expected check out": `was ${before}, became ${date}` } }),
        );
        return (await dtos(repos, [updated]))[0];
      });
    },

    /** StayController::checkout (:219-259) + Support/Pms/Billing::bill (:74-161), in ONE unit, through the bill service's own writer. */
    async checkOut(session: VerifiedSession, id: string, input: CheckOutBody, meta: RequestMeta): Promise<StayDto> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      const at = now();
      const day = istDate(at);
      return unit.run(session, async (repos) => {
        const s = await lockStay(repos, id);
        if (s.status !== "in_house") throw new AppError("CONFLICT", "This guest has already checked out.");
        checkVersion(s, input.version);
        const c = new Check(false);
        const typed = c.required("billNumber", "bill number", input.billNumber);
        c.max("billNumber", "bill number", typed, 50);
        const billDate = c.date("billDate", "bill date", input.billDate, "");
        const hotelMode = c.text("hotelMode", "hotel mode", input.hotelMode, 100);
        const foodMode = c.text("foodMode", "food mode", input.foodMode, 100);
        const hotelPct = gstPercent(c, "hotelGstPercent", "hotel gst percent", input.hotelGstPercent, false);
        const foodPct = gstPercent(c, "foodGstPercent", "food gst percent", input.foodGstPercent, false);
        const instruction = c.text("instruction", "instruction", input.instruction, 1000);
        c.done();
        const billNumber = `${day.slice(0, 4)} / ${typed ?? ""}`;
        if (await repos.bills.byNumber(billNumber)) throw new AppError("VALIDATION_FAILED", "That bill number is already used.", { fields: { billNumber: "That bill number is already used." } });

        const room = await repos.rooms.get(s.roomId, { forUpdate: true });
        const charges = (await repos.charges.forStays([s.id])).get(s.id) ?? [];
        const sum = (cat: string): bigint => charges.filter((x) => x.category === cat).reduce((t, x) => t + x.amountPaise, BigInt(0));
        const nights = stayNights(s.checkInAt, at);
        const lines = { roomPaise: roomCharge(s.ratePaise, nights), extraBedPaise: sum("extra_bed"), laundryPaise: sum("laundry"), otherPaise: sum("other"), foodPaise: sum("food") + sum("room_service") };
        const totals = checkoutTotals(lines, hotelPct, foodPct);
        const reservation = s.reservationId ? await repos.reservations.get(s.reservationId, { forUpdate: true }) : null;

        // the reservation's advance with the most money left, read again FOR UPDATE before anything is taken off it (Billing.php:124-126)
        let advance: AdvanceRecord | null = null;
        if (reservation) {
          const best = checkoutAdvance((await repos.advances.byReservation([reservation.id])).get(reservation.id) ?? []);
          advance = best ? await repos.advances.get(best.id, { forUpdate: true }) : null;
        }
        await kit.guard({ years: await repos.accountingYears.list(), was: null, now: billDate, action: "save" }, "billDate", { repos, session, meta, actor: w.actor });

        const bill = await deps.bills.writeBillInUnit(
          repos,
          session,
          {
            billNumber,
            billDate,
            companyId: s.companyId,
            guestName: s.guestName,
            mobileNumber: billMobile(s.mobile),
            roomNumber: room?.number ?? null,
            grNumber: s.grNumber,
            guestAddress: billAddress(s.address, s.city),
            guestGstin: s.guestGstin,
            persons: s.adults + s.children,
            arrivalAt: s.checkInAt,
            departureAt: at,
            hotelPlan: s.plan,
            hotelAmountPaise: lines.roomPaise,
            hotelPlanAmountPaise: BigInt(0),
            hotelExtraBedAmountPaise: lines.extraBedPaise,
            hotelLaundryAmountPaise: lines.laundryPaise,
            hotelOtherAmountPaise: lines.otherPaise,
            hotelGstPaise: totals.hotelGstPaise,
            // a side's mode is kept only when it has a total (:110, :115)
            hotelModeOfPayment: totals.hotelTotalPaise > BigInt(0) ? hotelMode : null,
            foodAmountPaise: lines.foodPaise,
            foodPlanAmountPaise: BigInt(0),
            foodLaundryAmountPaise: BigInt(0),
            foodGstPaise: totals.foodGstPaise,
            foodModeOfPayment: totals.foodTotalPaise > BigInt(0) ? foodMode : null,
            totalHotelAmountPaise: totals.hotelTotalPaise,
            totalFoodAmountPaise: totals.foodTotalPaise,
            referenceName: reservation?.reference ?? null,
            referenceMobileNumber: null,
            instruction,
            staySegments: null,
            planFoodAmountPaise: BigInt(0),
            hotelGstPercent: hotelPct,
            foodGstPercent: foodPct,
          },
          advance,
        );
        await repos.systemLogs.write(
          logLine(w, { module: "bills", action: "created", entity: "Bill", summary: `Added Bill: Bill ${bill.billNumber} - ${bill.guestName}`, subject: { id: bill.id, label: `Bill ${bill.billNumber} - ${bill.guestName}` }, details: { Room: room?.number ?? "", Nights: nights, "Hotel total": paiseToNumber(totals.hotelTotalPaise), "Food total": paiseToNumber(totals.foodTotalPaise) } }),
        );

        const closed = unwrapVersioned(await repos.stays.update(s.id, input.version, { status: "checked_out", checkOutAt: at, billId: bill.id, hotelGstPercent: hotelPct, foodGstPercent: foodPct }, session.userId));
        if (room) await repos.rooms.update(room.id, { hkStatus: "dirty" }, session.userId);
        // the reservation is finished once none of its rooms has a guest left (:246-249)
        if (reservation) {
          const left = ((await repos.stays.byReservation([reservation.id])).get(reservation.id) ?? []).some((x) => x.status === "in_house");
          if (!left) unwrapVersioned(await repos.reservations.update(reservation.id, reservation.version, { status: "checked_out", checkOut: day > reservation.checkIn ? day : reservation.checkOut }, session.userId));
        }
        await repos.systemLogs.write(
          logLine(w, { action: "updated", entity: "Check-out", summary: `${s.guestName} checked out of room ${room?.number ?? ""}`, subject: { id: s.id, label: s.guestName }, details: { Bill: bill.billNumber, "Hotel total": paiseToNumber(bill.totalHotelAmountPaise), "Food total": paiseToNumber(bill.totalFoodAmountPaise) } }),
        );
        return (await dtos(repos, [closed]))[0];
      });
    },
  };
}

/** Charge::CATEGORIES labels (Charge.php:17-23). */
const CHARGE_LABEL: Record<string, string> = { food: "Restaurant / food", room_service: "Room service", laundry: "Laundry", extra_bed: "Extra bed", other: "Other" };

export type StayService = ReturnType<typeof createStayService>;

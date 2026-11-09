import "server-only";
import type { Kpi, Page } from "@shared/dashboards/common";
import { billSac, GST_SAC } from "@shared/dashboards/billing";
import { formatINR } from "@shared/dashboards/format";
import { guestCopy, idProofOptions } from "@shared/dashboards/guest";
import type {
  BillLine, BillList, BillPayment, BillTab, BillTotals, BusinessKey, ChargeKind, CurrentStay, GuestBill, GuestOverview, GuestProfile, HistoryCategory, HistoryItem,
  HistoryList, HistoryTab, IdProofType, MenuGroup, OrderResult, PayResult,
} from "@shared/dashboards/guest";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { portalInactive, portalNotLinked } from "../../errors/portal";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import { ONLINE_PAYMENT_KEYS, onlinePaymentAvailable } from "../../payments/onlinePayment";
import type { AdvanceRecord, BillGuests, BillRecord } from "../../repos/billing";
import { personsOf, type BillPersons } from "../billing/guests";
import type { CustomerRecord } from "../../repos/companies";
import type { ChargeRecord, StayRecord } from "../../repos/frontOffice";
import { mobileForms, type PortalRepos } from "../../repos/portal";
import type { MenuItemRecord } from "../../repos/menu";
import type { Unit } from "../../repos/types";
import { matchWords } from "../../validation/listQuery";
import type { ProfileCredentials } from "../auth/credentialPort";
import type { MailQueue } from "../auth/mail";
import { maskEmail } from "../../mail/mask";
import type { GuestAccounts } from "../companies/context";
import { checkoutAdvance, checkoutTotals, istDate, roomCharge, stayNights } from "../frontOffice/rules";
import { MAX_ITEM_QTY, MENU_GROUPS, ORDERABLE_GROUP_KEYS, ORDER_ETA_MINUTES, isOrderableGroup } from "../menu/groups";
import { ACCEPTING_KEY, HOURS_KEY, hoursFromSettings, isOpenAt, type RestaurantHours } from "../menu/hours";
import { callNumber, daysBetween, methodOf, middayIst, portalLog, requireScope, todayIst } from "./portalKit";
import { listByCursorOrPage } from "../portal/cursor";
import { ALREADY_DELIVERED, cancelInUnit, cancellableUntil, guestCancelMinutesOf, NO_LONGER_CANCELLABLE, orderView } from "../roomService/rules";
import { gather, membershipsOf, oneHotel, sessionFor, type Memberships } from "../portal/multiHotel";
import type { GuestPasswordBody, GuestProfileBody, OrderBody } from "./schemas";
import { centralMobile, guestFieldsChanged, lastChangeView, type CentralGuest, type CentralProfilesUnit, type LastProfileChange } from "../../repos/centralProfiles";
import { profilePhotoUrl } from "../admin/profileService";

// The GUEST PORTAL (account role guest_user; ui-shared/dashboards/guest.ts GuestApi, 13 calls). A guest account has NO module permission (can() is
// false everywhere); it reaches only its own records through the record scope: the customer row it points at, and the bills, advances and stays that
// carry that customer's own mobile number and no company (a company's bill belongs to the company portal). Each Bill Master bill shows as one bill per
// business (hotel and food bill separately, as Pallav); the stay going on now shows as a running bill worked out like check-out would (front-office
// rules, the check-out GST settings). Money moves only at reception until online payment (Razorpay) is switched on: paying, booking, ordering and
// emailing a copy answer with a sentence and change nothing. HMS design: Pallav's portal pages were previews on sample data (Support/PortalSample.php).

const ZERO = BigInt(0);
const n = paiseToNumber;
const CAP_BILLS = 500;
const CAP_ADVANCES = 500;
const CAP_STAYS = 200;
const LOG_MODULE = "guest-portal";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What payment is still waiting for: the refusals while online payment is off. */
export const PAY_OFF = "Online payment is not switched on yet. Please pay at reception.";
const EMAIL_OFF = "Emailing a copy is not available right now. Ask reception for a printed copy.";
const NOT_ISSUED = "This bill is still running: you can email it after check-out. Ask reception for a printed copy meanwhile.";
const NOT_STAYING = "Room service is for guests who are staying with us. You can order once you have checked in.";
const CHOOSE_HOTEL = "Choose the hotel you are staying at first.";
const NOT_ISSUED_PDF = "This bill is still running: its PDF is ready after check-out. Ask reception for a printed copy meanwhile.";
/** The most lines a statement PDF lists. */
const STATEMENT_LINES_MAX = 2000;
/** One payment on a bill, for its receipt PDF (round 3 c). */
export interface GuestPaymentReceipt {
  hotelName: string;
  guestName: string;
  mobile: string;
  at: string;
  title: string;
  business: string;
  billNumber: string | null;
  amountPaise: number;
  reference: string;
}
/** The guest's statement for a period (round 3 c). */
export interface GuestStatement {
  guestName: string;
  mobile: string;
  hotels: string[];
  from: string;
  to: string;
  lines: { date: string; at: string; kind: "charge" | "payment"; title: string; business: string; amountPaise: number; hotelName: string }[];
  chargesPaise: number;
  paymentsPaise: number;
  unavailable: { hotelId: string; hotelName: string }[];
}
const NOT_ACCEPTING = "The restaurant is not taking room-service orders right now. Please call reception.";
const CLOSED_NOW = "The restaurant is closed at this time. You can still schedule an order for when it opens.";
/** A scheduled order must be at least this far ahead. */
const SCHEDULE_LEAD_MINUTES = 15;

const scheduleError = (message: string): AppError => new AppError("VALIDATION_FAILED", message, { fields: { scheduledFor: message } });
const hhmm = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** The restaurant hours the hotel admin set (open all day when never set). */
async function hoursOf(repos: PortalRepos): Promise<RestaurantHours> {
  const rows = await repos.settings.values([ACCEPTING_KEY, HOURS_KEY]);
  return hoursFromSettings(rows.get(ACCEPTING_KEY), rows.get(HOURS_KEY));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A quantity as a person reads it: "2.00" is 2, "1.50" is 1.5. */
const quantityText = (q: string): string => String(Number(q));
/** "Order for 13 Oct, 1:00 pm: Dal Tadka" (what placeOrder writes for a scheduled order; the older "Order for 13-10 13:00: ..." is read too). */
const SCHEDULED_LINE = /^Order for (?:(\d{1,2}) ([A-Z][a-z]{2}), (\d{1,2}):(\d{2}) (am|pm)|(\d{2})-(\d{2}) (\d{2}):(\d{2})): (.+)$/;
/** When a scheduled order is due (an IST instant with +05:30) and what it holds, from its charge line; null for any other charge. The year is the placing day's, or the next one when the date is earlier in the year. */
function scheduledLine(description: string, chargeDate: string): { iso: string; name: string } | null {
  const m = SCHEDULED_LINE.exec(description);
  if (!m) return null;
  const month = m[1] ? MONTHS.indexOf(m[2]) + 1 : Number(m[7]);
  const day = m[1] ? Number(m[1]) : Number(m[6]);
  const hour = m[1] ? (Number(m[3]) % 12) + (m[5] === "pm" ? 12 : 0) : Number(m[8]);
  const minute = m[1] ? Number(m[4]) : Number(m[9]);
  if (month < 1 || month > 12) return null;
  const placed = { y: Number(chargeDate.slice(0, 4)), m: Number(chargeDate.slice(5, 7)), d: Number(chargeDate.slice(8, 10)) };
  const year = month < placed.m || (month === placed.m && day < placed.d) ? placed.y + 1 : placed.y;
  const p = (v: number): string => String(v).padStart(2, "0");
  return { iso: `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:00+05:30`, name: m[10] };
}
/** A scheduled time checked: ahead by the lead time, inside the stay, inside an open period of the hotel's hours (IST). */
function scheduleOf(raw: string, ctx: { now: Date; current: CurrentCtx | null }, hours: RestaurantHours): { iso: string; label: string } {
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw scheduleError("Pick a valid date and time for the order.");
  if (at.getTime() < ctx.now.getTime() + SCHEDULE_LEAD_MINUTES * 60_000) throw scheduleError(`Choose a time at least ${SCHEDULE_LEAD_MINUTES} minutes from now.`);
  const ist = new Date(at.getTime() + 330 * 60_000);
  const date = ist.toISOString().slice(0, 10);
  const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const checkOut = ctx.current?.stay.expectedCheckOut ?? "";
  if (checkOut === "" || date > checkOut || (date === checkOut && minute >= 12 * 60)) throw scheduleError(`Choose a time before your check-out on ${checkOut}.`);
  if (!hours.accepting) throw new AppError("CONFLICT", NOT_ACCEPTING);
  const day = hours.days[(ist.getUTCDay() + 6) % 7];
  if (day.closed || minute < hhmm(day.opens) || minute >= hhmm(day.closes)) throw scheduleError(day.closed ? "The restaurant takes no orders that day. Choose another day." : `The restaurant takes orders from ${day.opens} to ${day.closes} that day. Choose a time in that period.`);
  const hour = ist.getUTCHours();
  return { iso: at.toISOString(), label: `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}, ${hour % 12 === 0 ? 12 : hour % 12}:${String(ist.getUTCMinutes()).padStart(2, "0")} ${hour >= 12 ? "pm" : "am"}` };
}

/** The menu as the portal shows it: the orderable groups (food only, MJ 26 Oct 2026), each with its items in the hotel's order; round 3 adds the hotel's category, the veg mark and the photo's address. */
function menuOf(items: readonly MenuItemRecord[], hotelId: string): MenuGroup[] {
  return ORDERABLE_GROUP_KEYS.map((key) => {
    const g = MENU_GROUPS[key];
    return {
      id: key, label: g.label, icon: g.icon, business: g.business, kind: g.kind, hint: g.hint,
      items: items.filter((i) => i.group === key).map((i) => ({
        id: i.id, name: i.name, pricePaise: n(i.pricePaise), note: i.note, available: i.available,
        category: i.category ?? null, veg: i.veg ?? "unknown",
        photoUrl: i.imageFile ? `/api/v1/guest/menu/${i.id}/photo?hotel=${hotelId}` : null,
      })),
    };
  });
}

interface GuestDeps {
  unit: Unit<PortalRepos>;
  now: () => Date;
  /** When the guest last signed in (the platform's sign-in records; the GuestAccounts port). */
  accounts: Pick<GuestAccounts, "lastLogins">;
  /** The signed-in password change (the credential side checks the current password and the rule). */
  credentials: Pick<ProfileCredentials, "changeMyPassword">;
  /** Decision 48: the hotels a guest login is linked to (absent = the session's own hotel only). */
  memberships?: Memberships;
  /** The server key that signs list cursors (HMS_HASH_KEY); absent = a key that lives as long as the process. */
  cursorSecret?: () => Buffer;
  /** "Email me a copy": the invoice mail is queued here (the hotel's own email sends it). Absent = emailing is not available. */
  mail?: MailQueue;
  /** The ONE common guest profile (platform 0132). Absent, or a database before 0132 = each hotel's own record, as before. */
  central?: CentralProfilesUnit;
  /** The stored name of a login's profile photo (platform 0131); absent = no photo. */
  photoName?: (userId: string) => Promise<string | null>;
}

/** The profile fields as the guest sent them, checked (the same rules on every path). */
function checkProfile(input: GuestProfileBody): { name: string; email: string; city: string | null; address: string | null; idNumber: string } {
  const fields: Record<string, string> = {};
  const name = input.name.trim();
  const email = input.email.trim();
  const idNumber = input.idProofNumber.trim();
  if (!name) fields.name = guestCopy.errors.nameRequired;
  else if (name.length > 80) fields.name = guestCopy.errors.nameLong;
  if (!EMAIL_RE.test(email) || email.length > 254) fields.email = guestCopy.errors.emailInvalid;
  if (input.idProofType !== "none" && !idNumber) fields.idProofNumber = guestCopy.errors.idNumberRequired;
  if (input.city.trim().length > 100) fields.city = "Keep the city under 100 characters.";
  if (input.address.trim().length > 255) fields.address = "Keep the address under 255 characters.";
  if (idNumber.length > 50) fields.idProofNumber = "Keep the ID number under 50 characters.";
  if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(fields)[0], { fields });
  return { name, email: email.toLowerCase(), city: input.city.trim() || null, address: input.address.trim() || null, idNumber };
}

/** A guest bill as sent: the contract's bill plus the server's totals (the real GST of the bill, not a rate guessed by the app: contract request). */
type GuestBillCore = GuestBill & { totals: BillTotals; /** Who stayed (decision 52): adults, children and the names kept. */ persons: BillPersons };
/** Who issued the bill: the business's name, address and GST number as the hotel keeps them (null = not entered); the app shows them on the bill (contract request). */
export interface GuestBillSeller {
  name: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
}
type GuestBillDto = GuestBillCore & { seller: GuestBillSeller };

type Side = BusinessKey;
interface CurrentCtx {
  stay: StayRecord;
  roomNumber: string;
  roomType: string;
  bookingNo: string;
  charges: ChargeRecord[];
  advance: AdvanceRecord | null;
  hotelPct: string;
  foodPct: string;
}
interface Ctx {
  customer: CustomerRecord;
  header: { name: string; foodName: string; address: string | null; phone: string | null; gstin: string | null; foodGstin: string | null };
  bills: BillRecord[];
  /** Who stayed, for the bills that came from a stay. */
  billGuests: ReadonlyMap<string, BillGuests>;
  advances: AdvanceRecord[];
  stays: StayRecord[];
  current: CurrentCtx | null;
  today: string;
  now: Date;
}

const ID_TYPE_LABEL: Record<IdProofType, string | null> = Object.fromEntries(idProofOptions.map((o) => [o.value, o.value === "none" ? null : o.label])) as Record<IdProofType, string | null>;

/** The stored ID proof name ("Aadhaar Card", "Driving License") as the contract's choice; anything else reads as not added (contract request: a string). */
export function idTypeOf(stored: string | null): IdProofType {
  const s = (stored ?? "").toLowerCase();
  if (s === "") return "none";
  if (s.includes("aadh")) return "aadhaar";
  if (s.includes("passport")) return "passport";
  if (s.includes("driv")) return "driving_licence";
  if (s.includes("voter") || s.includes("election")) return "voter_id";
  return "none";
}

/** Only the last four characters of an ID number leave the server for the guest's own screen (guestCopy.profile.idHint). */
export const maskId = (value: string | null): string => {
  const v = (value ?? "").trim();
  if (v === "") return "";
  return v.length <= 4 ? v : `XXXX ${v.slice(-4)}`;
};

const chargeKind = (c: ChargeRecord): ChargeKind => (c.category === "food" ? "food" : c.category === "room_service" ? "service" : c.category === "laundry" ? "laundry" : "other");
const chargeSide = (c: ChargeRecord): Side => (c.category === "food" || c.category === "room_service" ? "food" : "hotel");
/** The orders of the stay going on now that are scheduled for later (the "Coming up" list): one per slot, soonest first, with the lines and the total with GST. */
function scheduledOrders(ctx: Ctx): { id: string; orderNo: string; scheduledFor: string; lines: { name: string; qty: number }[]; totalPaise: number }[] {
  if (!ctx.current) return [];
  const groups = new Map<string, { first: ChargeRecord; iso: string; lines: { name: string; qty: number }[]; net: Record<Side, bigint> }>();
  for (const ch of ctx.current.charges) {
    const s = scheduledLine(ch.description, ch.chargeDate);
    if (!s || Date.parse(s.iso) <= ctx.now.getTime()) continue;
    const key = `${ch.chargeDate}|${s.iso}`;
    const g = groups.get(key) ?? { first: ch, iso: s.iso, lines: [], net: { hotel: ZERO, food: ZERO } };
    g.lines.push({ name: s.name, qty: Number(ch.quantity) });
    g.net[chargeSide(ch)] += ch.amountPaise;
    groups.set(key, g);
  }
  const pct = (side: Side): number => Number(side === "hotel" ? ctx.current?.hotelPct : ctx.current?.foodPct) || 0;
  return [...groups.values()]
    .map((g) => {
      const orderNo = `O-${g.first.id.replace(/-/g, "").slice(-6).toUpperCase()}`;
      const total = (["hotel", "food"] as const).reduce((t, side) => t + g.net[side] + BigInt(Math.round((Number(g.net[side]) * pct(side)) / 100)), ZERO);
      return { id: orderNo, orderNo, scheduledFor: g.iso, lines: g.lines, totalPaise: n(total) };
    })
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
}
const historyCategory = (k: ChargeKind): HistoryCategory => (k === "room" ? "room" : k === "food" ? "food" : k === "laundry" ? "laundry" : "service");
const isDebit = (mode: string | null): boolean => (mode ?? "").trim().toLowerCase() === "debit";
const sumOf = (values: readonly bigint[]): bigint => values.reduce((t, v) => t + v, ZERO);

/** The bill's own figures: total and GST as written on it, what is still owed, the rest paid. */
function totalsOf(gstPaise: bigint, totalPaise: bigint, duePaise: bigint): BillTotals {
  const subtotal = totalPaise - gstPaise;
  const due = duePaise < ZERO ? ZERO : duePaise;
  return { subtotalPaise: n(subtotal), gstPaise: n(gstPaise), totalPaise: n(totalPaise), paidPaise: n(totalPaise - due), duePaise: n(due) };
}

/** One business's side of a Bill Master bill; null when that side was not used (nothing billed and nothing owed). */
function billSide(b: BillRecord, side: Side, guestName: string, stays: ReadonlyMap<string, BillGuests>): GuestBillCore | null {
  const hotel = side === "hotel";
  const total = hotel ? b.totalHotelAmountPaise : b.totalFoodAmountPaise;
  const gst = hotel ? b.hotelGstPaise : b.foodGstPaise;
  const balance = hotel ? b.balanceHotelAmountPaise : b.balanceFoodAmountPaise;
  if (total === ZERO && balance === ZERO) return null;
  const room = b.roomNumber ? `Room ${b.roomNumber}` : "Room";
  const raw: [string, string, string | null, bigint, ChargeKind][] = hotel
    ? [["room", room, b.hotelPlan, b.hotelAmountPaise, "room"], ["plan", "Meal plan", b.hotelPlan, b.hotelPlanAmountPaise, "food"], ["extra-bed", "Extra bed", null, b.hotelExtraBedAmountPaise, "other"], ["laundry", "Laundry", null, b.hotelLaundryAmountPaise, "laundry"], ["other", "Other charges", null, b.hotelOtherAmountPaise, "other"]]
    : [["food", "Food and beverages", null, b.foodAmountPaise, "food"], ["plan", "Meal plan", null, b.foodPlanAmountPaise, "food"], ["laundry", "Laundry", null, b.foodLaundryAmountPaise, "laundry"]];
  const lines: BillLine[] = raw.filter((l) => l[3] !== ZERO).map(([id, label, detail, amount, kind]) => ({ id: `${side}-${id}`, label, detail, date: b.billDate, kind, amountPaise: n(amount) }));
  const mode = hotel ? b.hotelModeOfPayment : b.foodModeOfPayment;
  const advance = hotel ? b.advanceHotelAmountPaise : b.advanceFoodAmountPaise;
  const payments: BillPayment[] = [];
  if (advance > ZERO) payments.push({ id: `${side}-advance`, at: middayIst(b.billDate), method: "advance", reference: b.advanceReceiptNumber ? `Receipt ${b.advanceReceiptNumber}` : "Advance", amountPaise: n(advance) });
  const slots = b.debit
    .map((s, i) => ({ i, date: s.date, mode: hotel ? s.hotelMode : s.foodMode, amount: (hotel ? s.hotelPaise : s.foodPaise) ?? ZERO }))
    .filter((s) => s.date && s.amount > ZERO);
  // what was paid at the desk on check-out: the total, less what is still owed, the advance and the later instalments
  const atDesk = total - (balance < ZERO ? ZERO : balance) - advance - sumOf(slots.map((s) => s.amount));
  if (atDesk > ZERO) payments.push({ id: `${side}-desk`, at: b.departureAt?.toISOString() ?? middayIst(b.billDate), method: methodOf(isDebit(mode) ? null : mode), reference: isDebit(mode) ? "Paid later" : (mode ?? ""), amountPaise: n(atDesk) });
  for (const s of slots) payments.push({ id: `${side}-instalment-${s.i}`, at: middayIst(s.date as string), method: methodOf(s.mode), reference: s.mode ?? "", amountPaise: n(s.amount) });
  return {
    id: `${b.id}.${side}`,
    number: b.billNumber,
    business: side,
    billedTo: b.guestName || guestName,
    issuedOn: b.billDate,
    dueOn: null,
    roomNumber: b.roomNumber ?? "",
    stayFrom: b.arrivalAt ? istDate(b.arrivalAt) : b.billDate,
    stayTo: b.departureAt ? istDate(b.departureAt) : b.billDate,
    current: false,
    status: balance > ZERO ? "open" : "paid",
    lines,
    payments,
    totals: totalsOf(gst, total, balance),
    persons: personsOf(stays.get(b.id), b),
    sac: billSac(b)[side],
  };
}

/** The stay going on now as a running bill per business: nights so far at the stay's rate and the charges, with GST at the check-out settings (Billing.php:85-88). */
function currentSides(c: CurrentCtx, now: Date, guestName: string): GuestBillCore[] {
  const nights = stayNights(c.stay.checkInAt, now);
  const roomPaise = roomCharge(c.stay.ratePaise, nights);
  const by = (cat: ChargeRecord["category"][]): bigint => sumOf(c.charges.filter((x) => cat.includes(x.category)).map((x) => x.amountPaise));
  const t = checkoutTotals({ roomPaise, extraBedPaise: by(["extra_bed"]), laundryPaise: by(["laundry"]), otherPaise: by(["other"]), foodPaise: by(["food", "room_service"]) }, c.hotelPct, c.foodPct);
  const from = istDate(c.stay.checkInAt);
  const out: GuestBillCore[] = [];
  for (const side of ["hotel", "food"] as const) {
    const lines: BillLine[] = [];
    if (side === "hotel" && roomPaise > ZERO) lines.push({ id: "hotel-room", label: `Room ${c.roomNumber}${c.roomType ? `, ${c.roomType}` : ""}`, detail: `${nights} ${nights === 1 ? "night" : "nights"} × ${formatINR(n(c.stay.ratePaise))}`, date: from, kind: "room", amountPaise: n(roomPaise) });
    for (const ch of c.charges.filter((x) => chargeSide(x) === side)) lines.push({ id: ch.id, label: ch.description, detail: Number(ch.quantity) === 1 ? null : `${quantityText(ch.quantity)} × ${formatINR(n(ch.unitPricePaise)).replace(/\.00$/, "")}`, date: ch.chargeDate, kind: chargeKind(ch), amountPaise: n(ch.amountPaise) });
    if (lines.length === 0) continue;
    const gst = side === "hotel" ? t.hotelGstPaise : t.foodGstPaise;
    const total = side === "hotel" ? t.hotelTotalPaise : t.foodTotalPaise;
    const held = c.advance ? (side === "hotel" ? c.advance.hotelBalancePaise : c.advance.foodBalancePaise) : ZERO;
    const fromAdvance = held > total ? total : held;
    const payments: BillPayment[] = fromAdvance > ZERO && c.advance ? [{ id: `${side}-advance`, at: middayIst(c.advance.paymentDate), method: "advance", reference: `Receipt ${c.advance.receiptNumber}`, amountPaise: n(fromAdvance) }] : [];
    out.push({
      id: `stay.${c.stay.id}.${side}`,
      number: c.bookingNo,
      business: side,
      billedTo: c.stay.guestName || guestName,
      issuedOn: from,
      dueOn: null,
      roomNumber: c.roomNumber,
      stayFrom: from,
      stayTo: c.stay.expectedCheckOut,
      current: true,
      status: total - fromAdvance > ZERO ? "open" : "paid",
      lines,
      payments,
      totals: totalsOf(gst, total, total - fromAdvance),
      persons: { adults: c.stay.adults, children: c.stay.children, names: [c.stay.guestName, ...(c.stay.guestDetails?.members ?? []).map((m) => m.fullName)].map((x) => x.trim()).filter((x) => x !== "") },
      sac: GST_SAC[side],
    });
  }
  return out;
}

export function createGuestService(deps: GuestDeps) {
  const { unit, now } = deps;

  async function load(repos: PortalRepos, customerId: string): Promise<Ctx> {
    const customer = await repos.customers.get(customerId);
    // the account points at a customer the hotel removed or switched off: no portal (as a disabled account)
    if (!customer) throw portalNotLinked("guest");
    if (!customer.isActive) throw portalInactive("guest");
    const forms = mobileForms(customer.mobile);
    const header = await repos.hotelProfile.header();
    const bills = await repos.portal.guestBills(forms, CAP_BILLS);
    const billGuests = await repos.bills.guestsOf(bills.map((b) => b.id));
    const advances = await repos.portal.guestAdvances(forms, CAP_ADVANCES);
    const stays = await repos.portal.guestStays(forms, CAP_STAYS);
    const at = now();
    const inHouse = stays.find((s) => s.status === "in_house") ?? null;
    let current: CurrentCtx | null = null;
    if (inHouse) {
      const room = await repos.rooms.get(inHouse.roomId);
      const type = room?.roomTypeId ? await repos.roomTypes.get(room.roomTypeId) : null;
      const reservation = inHouse.reservationId ? await repos.reservations.get(inHouse.reservationId) : null;
      const charges = (await repos.charges.forStays([inHouse.id])).get(inHouse.id) ?? [];
      const held = inHouse.reservationId ? ((await repos.advances.byReservation([inHouse.reservationId])).get(inHouse.reservationId) ?? []).filter((a) => a.companyId === null) : [];
      const settings = await repos.settings.values(["checkout.hotel_gst_percent", "checkout.food_gst_percent"]);
      current = {
        stay: inHouse,
        roomNumber: room?.number ?? "",
        roomType: type?.name ?? "",
        bookingNo: reservation?.reference ?? inHouse.grNumber ?? "",
        charges,
        advance: checkoutAdvance(held),
        hotelPct: settings.get("checkout.hotel_gst_percent") ?? "5",
        foodPct: settings.get("checkout.food_gst_percent") ?? "5",
      };
    }
    return { customer, header, bills, billGuests, advances, stays, current, today: todayIst(at), now: at };
  }

  const read = <T>(session: VerifiedSession, work: (ctx: Ctx, repos: PortalRepos) => Promise<T> | T): Promise<T> => {
    const scope = requireScope(session, "guest");
    return unit.run(session, async (repos) => work(await load(repos, scope.id), repos));
  };

  const allBills = (ctx: Ctx): GuestBillDto[] => {
    const current = ctx.current ? currentSides(ctx.current, ctx.now, ctx.customer.name) : [];
    const past = ctx.bills.flatMap((b) => [billSide(b, "hotel", ctx.customer.name, ctx.billGuests), billSide(b, "food", ctx.customer.name, ctx.billGuests)].filter((x): x is GuestBillCore => x !== null));
    return [...current, ...past].map((b) => ({ ...b, seller: sellerOf(ctx, b.business) }));
  };
  const sellerOf = (ctx: Ctx, side: Side): GuestBillSeller => ({
    name: side === "food" ? ctx.header.foodName || ctx.header.name : ctx.header.name,
    address: ctx.header.address,
    phone: ctx.header.phone,
    gstin: side === "food" ? ctx.header.foodGstin : ctx.header.gstin,
  });
  const openBills = (ctx: Ctx): GuestBillDto[] => allBills(ctx).filter((b) => b.status === "open" && b.totals.duePaise > 0);
  const businessName = (ctx: Ctx, side: Side): string => (side === "food" ? ctx.header.foodName || ctx.header.name : ctx.header.name);

  function currentStay(ctx: Ctx): CurrentStay | null {
    const c = ctx.current;
    if (!c) return null;
    const checkIn = istDate(c.stay.checkInAt);
    const nights = Math.max(1, daysBetween(checkIn, c.stay.expectedCheckOut));
    return { bookingNo: c.bookingNo, roomNumber: c.roomNumber, roomType: c.roomType, checkIn, checkOut: c.stay.expectedCheckOut, nights, nightsDone: Math.min(nights, Math.max(0, daysBetween(checkIn, ctx.today))), adults: c.stay.adults, children: c.stay.children };
  }

  /** The login's ONE common profile (platform 0132) when there is one; null = show the hotel's own record (no central tables yet, or not made yet: the first save makes it). */
  async function centralGuestOf(session: VerifiedSession): Promise<{ guest: CentralGuest; last: LastProfileChange | null } | null> {
    if (!deps.central) return null;
    return deps.central.run(async (r) => {
      if (!(await r.ready())) return null;
      const guest = (await r.guests.byUser(session.userId)) ?? (session.scope?.kind === "guest" ? await r.guests.ofRecord(session.hotelId, session.scope.id) : null);
      return guest ? { guest, last: await r.history.last("guest", guest.id) } : null;
    });
  }

  async function profileOf(ctx: Ctx, session: VerifiedSession): Promise<GuestProfile & { username: string; photoUrl: string | null; common: boolean }> {
    const c = ctx.customer;
    const [last, found, photo] = await Promise.all([deps.accounts.lastLogins(session.hotelId, [c.id]).then((m) => m.get(c.id)), centralGuestOf(session), deps.photoName ? deps.photoName(session.userId) : Promise.resolve(null)]);
    const central = found?.guest ?? null;
    return {
      id: c.id,
      // the one common profile when there is one (every hotel shows the same); else this hotel's record
      name: central?.displayName ?? c.name,
      // the guest signs in with the mobile number the hotel keeps for them
      username: session.username ?? c.mobile,
      mobile: c.mobile,
      email: central ? (central.email ?? "") : (c.email ?? ""),
      city: central ? (central.city ?? "") : (c.city ?? ""),
      address: central ? (central.address ?? "") : (c.address ?? ""),
      photoUrl: profilePhotoUrl(photo),
      common: central !== null,
      ...(found ? { lastChange: lastChangeView(found.last) } : {}),
      idProofType: idTypeOf(c.idProofType),
      idProofNumber: maskId(c.idProofNumber),
      // not stored yet (contract/migration request): reachable by email when there is one
      notifyEmail: Boolean(c.email),
      // the platform's record of the last sign-in; this sign-in when the port has none yet
      lastSignInAt: (last ?? ctx.now).toISOString(),
      memberSince: istDate(c.createdAt),
      staysCount: ctx.stays.length,
    };
  }

  function history(ctx: Ctx): HistoryItem[] {
    const items: HistoryItem[] = [];
    for (const b of allBills(ctx)) {
      if (b.current) continue;
      items.push({ id: `bill:${b.id}`, at: middayIst(b.issuedOn), kind: "charge", category: b.business === "hotel" ? "room" : "food", title: `Bill ${b.number}${b.roomNumber ? `, Room ${b.roomNumber}` : ""}`, business: b.business, amountPaise: b.totals.totalPaise, status: b.status === "open" ? "on_bill" : "paid", billNumber: b.number });
      for (const p of b.payments) {
        if (p.method === "advance") continue; // the advance itself is listed below, once
        items.push({ id: `pay:${b.id}:${p.id}`, at: p.at, kind: "payment", category: "payment", title: p.reference && p.reference !== "Paid later" ? `Paid (${p.reference})` : "Paid", business: b.business, amountPaise: p.amountPaise, status: "paid", billNumber: b.number });
      }
    }
    for (const a of ctx.advances) {
      const refunded = a.refundPaymentDate !== null;
      for (const side of ["hotel", "food"] as const) {
        const amount = side === "hotel" ? a.hotelAmountPaise : a.foodAmountPaise;
        if (amount <= ZERO) continue;
        const mode = side === "hotel" ? a.hotelMode : a.foodMode;
        items.push({ id: `adv:${a.id}:${side}`, at: middayIst(a.paymentDate), kind: "payment", category: "payment", title: `Advance received${mode ? ` (${mode})` : ""}${refunded ? ", refunded" : ""}`, business: side, amountPaise: n(amount), status: refunded ? "cancelled" : "paid", billNumber: null });
      }
    }
    const c = ctx.current;
    if (c) {
      const nights = stayNights(c.stay.checkInAt, ctx.now);
      items.push({ id: `stay:${c.stay.id}:room`, at: c.stay.checkInAt.toISOString(), kind: "charge", category: "room", title: `Room ${c.roomNumber}, ${nights} ${nights === 1 ? "night" : "nights"} so far`, business: "hotel", amountPaise: n(roomCharge(c.stay.ratePaise, nights)), status: "on_bill", billNumber: null });
      for (const ch of c.charges) items.push({ id: `charge:${ch.id}`, at: ch.createdAt.toISOString(), kind: "charge", category: historyCategory(chargeKind(ch)), title: ch.description, business: chargeSide(ch), amountPaise: n(ch.amountPaise), status: "on_bill", billNumber: null });
    }
    return items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : x.id < y.id ? 1 : -1));
  }

  const page = <T>(rows: T[], q: { page: number; pageSize: number }): Page<T> => ({ items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: rows.length, page: q.page, pageSize: q.pageSize });
  const words = (s: string | undefined): string[] => (s ?? "").toLowerCase().split(/\s+/).filter(Boolean);

  /** The bill the id names, if it is this guest's; anything else is 404 (another guest's bill, a company's, a removed one). */
  const findBill = (ctx: Ctx, id: string): GuestBillDto => {
    const bill = allBills(ctx).find((b) => b.id.toLowerCase() === id.toLowerCase());
    if (!bill) throw new AppError("NOT_FOUND");
    return bill;
  };

  async function overviewOf(session: VerifiedSession): Promise<GuestOverview> {
      return read(session, async (ctx) => {
        const open = openBills(ctx).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number));
        const stay = currentStay(ctx);
        const due = open.reduce((t, b) => t + b.totals.duePaise, 0);
        const currentBills = allBills(ctx).filter((b) => b.current);
        const paid = currentBills.reduce((t, b) => t + b.totals.paidPaise, 0);
        const ordered = ctx.current ? n(sumOf(ctx.current.charges.map((c) => c.amountPaise))) : 0;
        const kpis: Kpi[] = [
          { id: "due", label: guestCopy.home.kpiDue, value: due, kind: "money", trend: null, tone: due > 0 ? "warning" : "success", icon: "wallet", hint: open.length === 0 ? "Nothing to pay" : `${open.length} ${open.length === 1 ? "bill" : "bills"} open` },
          { id: "paid", label: guestCopy.home.kpiPaid, value: paid, kind: "money", trend: null, tone: "success", icon: "check", hint: paid > 0 ? "Advance received" : "No payments yet" },
          { id: "ordered", label: guestCopy.home.kpiOrdered, value: ordered, kind: "money", trend: null, tone: "graphite", icon: "utensils", hint: ordered > 0 ? "On your room bill" : "Nothing ordered yet" },
          { id: "nights", label: guestCopy.home.kpiNights, value: stay ? Math.max(0, stay.nights - stay.nightsDone) : 0, kind: "count", trend: null, tone: "info", icon: "calendar", hint: stay ? `Check-out ${stay.checkOut}` : "No stay yet" },
        ];
        return { profile: await profileOf(ctx, session), stay, openBills: open, recent: history(ctx).slice(0, 5), kpis };
      });
  }

  return {
    async overview(session: VerifiedSession): Promise<GuestOverview> {
      return overviewOf(session);
    },

    async listBills(session: VerifiedSession, q: { search?: string; tab: BillTab; page: number; pageSize: number }): Promise<BillList> {
      return read(session, (ctx) => {
        const all = allBills(ctx).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number));
        const isOpen = (b: GuestBillDto): boolean => b.status === "open" && b.totals.duePaise > 0;
        const counts: Record<BillTab, number> = { open: all.filter(isOpen).length, paid: all.filter((b) => !isOpen(b) && b.status !== "cancelled").length, cancelled: all.filter((b) => b.status === "cancelled").length, all: all.length };
        const tabbed = all.filter((b) => (q.tab === "open" ? isOpen(b) : q.tab === "paid" ? !isOpen(b) && b.status !== "cancelled" : q.tab === "cancelled" ? b.status === "cancelled" : true));
        const w = words(q.search);
        const found = tabbed.filter((b) => w.every((x) => `${b.number} ${businessName(ctx, b.business)} ${b.roomNumber}`.toLowerCase().includes(x)));
        return { ...page(found, q), counts };
      });
    },

    async getBill(session: VerifiedSession, id: string): Promise<GuestBillDto> {
      return read(session, (ctx) => findBill(ctx, id));
    },

    /** Pay the ticked bills: checked (each must be the guest's own and still owing), then refused while online payment is off. Nothing changes. */
    async payBills(session: VerifiedSession, billIds: readonly string[]): Promise<PayResult> {
      return read(session, (ctx) => {
        if (billIds.length === 0) throw new AppError("VALIDATION_FAILED", guestCopy.errors.nothingSelected, { fields: { bills: guestCopy.errors.nothingSelected } });
        const picked = billIds.map((id) => findBill(ctx, id));
        if (picked.some((b) => b.status !== "open" || b.totals.duePaise <= 0)) throw new AppError("CONFLICT", guestCopy.errors.alreadyPaid);
        throw new AppError("VALIDATION_FAILED", PAY_OFF, { fields: { bills: PAY_OFF } });
      });
    },

    /**
     * "Email me a copy" (decision 61 era mail rule): the guest's OWN bill, as a PDF, to the email kept on their own customer record, from THIS hotel's own email. A bill that is
     * not the guest's is 404; the running bill of a stay that has not ended has no document yet (409); no email on the record is 422. The mail is queued (the PDF is made when it
     * is sent). The answer names a shortened address, never the whole one.
     */
    async emailBill(session: VerifiedSession, id: string): Promise<{ sentTo: string }> {
      const queued = await read(session, (ctx) => {
        const bill = findBill(ctx, id);
        if (bill.current) throw new AppError("CONFLICT", NOT_ISSUED);
        const to = (ctx.customer.email ?? "").trim().toLowerCase();
        if (!EMAIL_RE.test(to)) throw new AppError("VALIDATION_FAILED", guestCopy.errors.emailInvalid, { fields: { email: guestCopy.errors.emailInvalid } });
        return { to, billId: bill.id.replace(/\.(hotel|food)$/i, ""), number: bill.number, hotelName: ctx.header.name, name: ctx.customer.name };
      });
      if (!deps.mail) throw new AppError("CONFLICT", EMAIL_OFF);
      await deps.mail.queue({ kind: "bill_invoice", hotelId: session.hotelId, toEmail: queued.to, payload: { name: queued.name, hotelName: queued.hotelName, number: queued.number, billId: queued.billId } });
      return { sentTo: maskEmail(queued.to) };
    },

    async listHistory(session: VerifiedSession, q: { search?: string; tab: HistoryTab; page: number; pageSize: number }): Promise<HistoryList> {
      return read(session, (ctx) => {
        const all = history(ctx);
        const counts: Record<HistoryTab, number> = { all: all.length, charges: all.filter((h) => h.kind === "charge").length, payments: all.filter((h) => h.kind === "payment").length };
        const tabbed = all.filter((h) => (q.tab === "charges" ? h.kind === "charge" : q.tab === "payments" ? h.kind === "payment" : true));
        const w = words(q.search);
        const found = tabbed.filter((h) => w.every((x) => `${h.title} ${businessName(ctx, h.business)} ${h.billNumber ?? ""}`.toLowerCase().includes(x)));
        return { ...page(found, q), counts };
      });
    },

    // ------------------------------------------------------------------------------------------------------------------------------
    // Decision 48 (MJ, 12 Oct 2026): several hotels (docs/BACKEND.md). `hotel` = a hotel id or "all" (default all).
    // ------------------------------------------------------------------------------------------------------------------------------

    /**
     * The hotels this login is linked to, each with the number to call (the hotel's phone from its profile; null when none is kept) and whether it can be paid online now
     * (the Set-up centre's payment status; false when it cannot be read).
     */
    async hotels(session: VerifiedSession): Promise<{ hotelId: string; name: string; phone: string | null; onlinePayment: boolean }[]> {
      const found = await membershipsOf(deps.memberships, session, "guest");
      return Promise.all(
        found.map(async (m) => {
          const as = sessionFor(session, "guest", m);
          const phone = await unit.run(as, async (repos) => callNumber((await repos.hotelProfile.header()).phone, (await repos.siteSettings.get()).fields.receptionPhone)).catch(() => null);
          const onlinePayment = await unit.run(as, async (repos) => onlinePaymentAvailable(await repos.settings.values(ONLINE_PAYMENT_KEYS))).catch(() => false);
          return { hotelId: m.hotelId, name: m.hotelName, phone, onlinePayment };
        }),
      );
    },

    /** "Coming up": the orders of the current stay scheduled for later, soonest first, at most 20, each tagged with its hotel; empty when the guest is not staying. */
    async scheduledOrdersAcross(session: VerifiedSession, q: { hotel?: string }) {
      const { parts, unavailable } = await gather(deps.memberships, session, "guest", q.hotel, (s) => read(s, (ctx) => scheduledOrders(ctx)));
      const items = parts.flatMap((p) => p.value.map((o) => ({ ...o, hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName })));
      return { items: items.sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor)).slice(0, 20), unavailable };
    },

    /**
     * The hotel selector's numbers (and the app bar chip): every linked hotel with what the guest owes it, the open bills, the open requests to its front desk, and whether the
     * guest is staying there now (with the room). Totals over the hotels that answered; a hotel that cannot be reached is named in `unavailable`. One call for the home screen.
     */
    async hotelsSummary(session: VerifiedSession) {
      const { parts, unavailable } = await gather(deps.memberships, session, "guest", undefined, (s) =>
        read(s, async (ctx, repos) => {
          const open = allBills(ctx).filter((b) => b.status === "open" && b.totals.duePaise > 0);
          const requests = ctx.current ? (await repos.guestRequests.byStay(ctx.current.stay.id)).filter((r) => r.status === "open").length : 0;
          return {
            phone: callNumber(ctx.header.phone, (await repos.siteSettings.get()).fields.receptionPhone),
            outstandingPaise: open.reduce((t, b) => t + b.totals.duePaise, 0),
            openBills: open.length,
            openRequests: requests,
            inHouse: ctx.current !== null,
            roomNumber: ctx.current ? ctx.current.roomNumber : null,
          };
        }),
      );
      const hotels = parts.map((p) => ({ hotelId: p.hotel.hotelId, name: p.hotel.hotelName, ...p.value }));
      const sum = (pick: (h: (typeof hotels)[number]) => number): number => hotels.reduce((t, h) => t + pick(h), 0);
      return { hotels, totals: { outstandingPaise: sum((h) => h.outstandingPaise), openBills: sum((h) => h.openBills), openRequests: sum((h) => h.openRequests) }, unavailable };
    },

    /**
     * The ONE hotel an action is for (an order, a request). A login linked to one hotel may leave `hotel` out; a login linked to several must name it ("all" is never an action's
     * hotel): the guest picks where they are staying, nothing is guessed.
     */
    /** A guest account (403 for anyone else; 409 when it is not linked to any record), for routes that read the platform side only (the sign-ins list). */
    async requireGuest(session: VerifiedSession): Promise<void> {
      await membershipsOf(deps.memberships, session, "guest");
    },

    async forAction(session: VerifiedSession, hotel: string | undefined): Promise<VerifiedSession> {
      if (hotel === undefined || hotel === "" || hotel === "all") {
        const linked = await membershipsOf(deps.memberships, session, "guest");
        if (linked.length > 1) throw new AppError("VALIDATION_FAILED", CHOOSE_HOTEL, { fields: { hotel: CHOOSE_HOTEL } });
        return sessionFor(session, "guest", linked[0]);
      }
      return (await oneHotel(deps.memberships, session, "guest", hotel)).session;
    },

    /**
     * GET /guest/order-info: one hotel (named, or the only one linked) answers `all: false` with that hotel's order info; "All hotels" for a login linked to several answers
     * `all: true` with every hotel and whether the guest is staying there.
     */
    async orderInfoFor(session: VerifiedSession, hotel: string | undefined) {
      if (hotel === undefined || hotel === "" || hotel === "all") {
        const across = await this.orderInfoAcross(session);
        if (across.hotels.length + across.unavailable.length > 1) return { all: true as const, ...across };
      }
      const one = await this.forAction(session, hotel === "all" ? undefined : hotel);
      return { all: false as const, ...(await this.orderInfo(one)) };
    },

    /** Order to room under "All hotels": each linked hotel with whether the guest is staying there now (and the room), so the screen lets them pick only a hotel they are in. */
    async orderInfoAcross(session: VerifiedSession) {
      const { parts, unavailable } = await gather(deps.memberships, session, "guest", "all", (s) => read(s, (ctx) => ({ inHouse: ctx.current !== null, roomNumber: ctx.current ? ctx.current.roomNumber : null })));
      return { hotels: parts.map((p) => ({ hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName, ...p.value })), unavailable };
    },

    /** The login's session for ONE hotel (`hotel` = the id; omitted = the first linked hotel), so the single-hotel routes run for it. */
    async forHotel(session: VerifiedSession, hotel: string | undefined): Promise<VerifiedSession> {
      return (await oneHotel(deps.memberships, session, "guest", hotel)).session;
    },

    /** The home page across hotels: the stay going on now, the bills to pay and the latest activity of every linked hotel, each tagged with its hotel. */
    async overviewAcross(session: VerifiedSession, q: { hotel?: string }) {
      const { parts, unavailable } = await gather(deps.memberships, session, "guest", q.hotel, (s) => overviewOf(s));
      const tag = <T>(h: { hotelId: string; hotelName: string }, row: T) => ({ hotelId: h.hotelId, hotelName: h.hotelName, ...row });
      const first = parts[0];
      const kpis = first.value.kpis.map((k) => ({ ...k, value: parts.reduce((t, p) => t + (p.value.kpis.find((x) => x.id === k.id)?.value ?? 0), 0) }));
      return {
        profile: first.value.profile,
        stay: parts.flatMap((p) => (p.value.stay ? [tag(p.hotel, p.value.stay)] : []))[0] ?? null,
        stays: parts.flatMap((p) => (p.value.stay ? [tag(p.hotel, p.value.stay)] : [])),
        openBills: parts.flatMap((p) => p.value.openBills.map((b) => tag(p.hotel, b))).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn)),
        recent: parts.flatMap((p) => p.value.recent.map((r) => tag(p.hotel, r))).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 5),
        kpis,
        byHotel: parts.map((p) => ({ hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName })),
        unavailable,
      };
    },

    /** The bills across hotels (newest first), with tab counts summed and a search that also matches the hotel name. */
    async billsAcross(session: VerifiedSession, q: { hotel?: string; search?: string; tab: BillTab; page: number; pageSize: number; cursor?: string; limit?: number }) {
      const { parts, unavailable } = await gather(deps.memberships, session, "guest", q.hotel, (s) => read(s, (ctx) => allBills(ctx).map((b) => ({ ...b, searchText: `${b.number} ${businessName(ctx, b.business)} ${b.roomNumber}` }))));
      const all = parts
        .flatMap((p) => p.value.map((b) => ({ hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName, ...b })))
        .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number));
      const isOpen = (b: { status: string; totals: { duePaise: number } }): boolean => b.status === "open" && b.totals.duePaise > 0;
      const counts: Record<BillTab, number> = { open: all.filter(isOpen).length, paid: all.filter((b) => !isOpen(b) && b.status !== "cancelled").length, cancelled: all.filter((b) => b.status === "cancelled").length, all: all.length };
      const tabbed = all.filter((b) => (q.tab === "open" ? isOpen(b) : q.tab === "paid" ? !isOpen(b) && b.status !== "cancelled" : q.tab === "cancelled" ? b.status === "cancelled" : true));
      const w = words(q.search);
      const found = tabbed.filter((b) => w.every((x) => `${b.searchText} ${b.hotelName}`.toLowerCase().includes(x)));
      return { ...listByCursorOrPage(deps.cursorSecret, session.userId, "guest-bills", q, found, (b) => ({ d: b.issuedOn, h: b.hotelId, i: b.id }), "desc"), counts, unavailable };
    },

    /** The history across hotels (newest first). */
    async historyAcross(session: VerifiedSession, q: { hotel?: string; search?: string; tab: HistoryTab; page: number; pageSize: number; cursor?: string; limit?: number }) {
      const { parts, unavailable } = await gather(deps.memberships, session, "guest", q.hotel, (s) => read(s, (ctx) => history(ctx).map((h) => ({ ...h, searchText: `${h.title} ${businessName(ctx, h.business)} ${h.billNumber ?? ""}` }))));
      const all = parts.flatMap((p) => p.value.map((h) => ({ hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName, ...h }))).sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : x.id < y.id ? 1 : -1));
      const counts: Record<HistoryTab, number> = { all: all.length, charges: all.filter((h) => h.kind === "charge").length, payments: all.filter((h) => h.kind === "payment").length };
      const tabbed = all.filter((h) => (q.tab === "charges" ? h.kind === "charge" : q.tab === "payments" ? h.kind === "payment" : true));
      const w = words(q.search);
      const found = tabbed.filter((h) => w.every((x) => `${h.searchText} ${h.hotelName}`.toLowerCase().includes(x)));
      return { ...listByCursorOrPage(deps.cursorSecret, session.userId, "guest-history", q, found, (h) => ({ d: h.at, h: h.hotelId, i: h.id }), "desc"), counts, unavailable };
    },

    /** The order-to-room page's first question (decision 52): is this guest staying, and is the restaurant taking orders now (the hours the hotel admin set)? */
    async orderInfo(session: VerifiedSession) {
      return read(session, async (ctx, repos) => {
        const hours = await hoursOf(repos);
        const stay = ctx.current ? { roomNumber: ctx.current.roomNumber, checkIn: istDate(ctx.current.stay.checkInAt), checkOut: ctx.current.stay.expectedCheckOut } : null;
        // read-only display data for the app bar: the hotel, the room and the guest's name (never a stay id: the server finds the stay itself)
        return { hotelId: session.hotelId, hotelName: ctx.header.name, guestName: ctx.customer.name, roomNumber: stay ? stay.roomNumber : null, guestCancelMinutes: await guestCancelMinutesOf(repos), staying: stay !== null, stay, hours: { accepting: hours.accepting, openNow: isOpenAt(hours, ctx.now), days: hours.days } };
      });
    },

    /** The room-service menu the hotel keeps (Master Data): the three fixed groups with their items, in the hotel's order; an item switched off is still listed (the screen shows it unavailable). */
    async getMenu(session: VerifiedSession, search?: string): Promise<{ stay: CurrentStay | null; profileName: string; menu: MenuGroup[] }> {
      return read(session, async (ctx, repos) => ({
        stay: currentStay(ctx),
        profileName: ctx.customer.name,
        menu: menuOf(await repos.menuItems.list(), session.hotelId).map((g) => ({ ...g, items: matchWords(g.items, search, (i) => [i.name, i.note, g.label, i.pricePaise / 100]) })),
      }));
    },

    /**
     * Order to the room. Needs a stay going on now (403 otherwise). Every line is checked against the menu as it is now (unknown, switched off or too many: 422);
     * paying now waits for online payment (the same sentence as paying a bill); "put it on my room bill" adds one stay charge per item, in this unit, so
     * check-out bills it: the hotel side and the food side separately, with the check-out GST settings, as for any charge reception adds.
     */
    /**
     * The guest's room-service orders (with their status) over the hotels asked for, newest first, each with its hotel and until when the guest may still cancel it
     * (`cancellableUntil`, null when they cannot). A hotel cancel shows its reason. Orders of the guest's own stays only.
     */
    async roomOrders(session: VerifiedSession, q: { hotel?: string }) {
      const now0 = now();
      const { parts, unavailable } = await gather(deps.memberships, session, "guest", q.hotel, (s) =>
        read(s, async (ctx, repos) => {
          const minutes = await guestCancelMinutesOf(repos);
          const orders = await repos.roomService.forStays(ctx.stays.map((x) => x.id));
          return { minutes, orders: orders.map((o) => ({ ...orderView(o), cancellableUntil: cancellableUntil(o, minutes, now0) })) };
        }),
      );
      const items = parts.flatMap((p) => p.value.orders.map((o) => ({ ...o, hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName }))).sort((a, b) => (a.placedAt < b.placedAt ? 1 : a.placedAt > b.placedAt ? -1 : a.id < b.id ? 1 : -1));
      return { items, guestCancelMinutes: parts.map((p) => ({ hotelId: p.hotel.hotelId, minutes: p.value.minutes })), unavailable };
    },

    /**
     * The guest cancels one of their orders: only while it is still "placed" and inside the hotel's window (server time). Its charges come off the room bill in the same unit.
     * Cancelling twice answers the cancelled order again. Another guest's order (or another hotel's) is 404.
     */
    async cancelRoomOrder(session: VerifiedSession, id: string, meta: RequestMeta) {
      return read(session, async (ctx, repos) => {
        const order = await repos.roomService.get(id, { forUpdate: true });
        if (!order || !ctx.stays.some((s) => s.id === order.stayId)) throw new AppError("NOT_FOUND");
        const at = now();
        if (order.status === "cancelled") return { ...orderView(order), cancellableUntil: null, hotelId: session.hotelId, hotelName: ctx.header.name };
        const minutes = await guestCancelMinutesOf(repos);
        if (order.status === "delivered") throw new AppError("CONFLICT", ALREADY_DELIVERED);
        if (cancellableUntil(order, minutes, at) === null) throw new AppError("CONFLICT", NO_LONGER_CANCELLABLE);
        const done = await cancelInUnit(repos, order, "guest", null, { id: session.userId, name: ctx.customer.name }, at);
        await repos.systemLogs.write(portalLog(session, meta, { module: LOG_MODULE, action: "updated", entity: "Room service order", summary: `${ctx.customer.name} cancelled order ${order.orderNo} in the guest portal`, subject: { id: order.id, label: order.orderNo }, userName: ctx.customer.name }));
        return { ...orderView(done), cancellableUntil: null, hotelId: session.hotelId, hotelName: ctx.header.name };
      });
    },

    // ------------------------------------------------------------------------------------------------------------------------------
    // Round 3 c: the guest's documents as PDFs. Ownership is decided HERE, in the guest's own scoped read; the routes then draw the document (a bill or an advance receipt with
    // the same data as the hotel's print, through billing's worker-side preview; a payment receipt and the statement from the guest's own history).
    // ------------------------------------------------------------------------------------------------------------------------------

    /** The bill to print: one of the guest's own ISSUED bills (the running stay bill is not a document yet: 409). Answers the Bill Master bill id. */
    async billDocument(session: VerifiedSession, id: string): Promise<{ billId: string }> {
      return read(session, (ctx) => {
        const bill = findBill(ctx, id);
        if (bill.current) throw new AppError("CONFLICT", NOT_ISSUED_PDF);
        return { billId: bill.id.replace(/\.(hotel|food)$/i, "") };
      });
    },

    /**
     * The receipt for one line of the guest's payment history: an advance (`adv:<id>:<side>`) prints as the hotel's advance receipt; a payment on a bill (`pay:<bill>:<payment>`)
     * as a simple receipt from the line itself. Anything that is not one of the guest's own payment lines is 404.
     */
    async receiptDocument(session: VerifiedSession, id: string): Promise<{ kind: "advance"; advanceId: string } | { kind: "payment"; receipt: GuestPaymentReceipt }> {
      return read(session, (ctx) => {
        const item = history(ctx).find((h) => h.id === id && h.kind === "payment");
        if (!item) throw new AppError("NOT_FOUND");
        const adv = /^adv:([0-9a-f-]{36}):/i.exec(item.id);
        if (adv && ctx.advances.some((a) => a.id === adv[1])) return { kind: "advance" as const, advanceId: adv[1] };
        return { kind: "payment" as const, receipt: { hotelName: ctx.header.name, guestName: ctx.customer.name, mobile: ctx.customer.mobile, at: item.at, title: item.title, business: businessName(ctx, item.business), billNumber: item.billNumber ?? null, amountPaise: item.amountPaise, reference: item.id.split(":").pop() ?? item.id } };
      });
    },

    /** The statement: the guest's charges and payments in a period (dates YYYY-MM-DD, IST, at most 366 days) over the hotels asked for, oldest first, with totals. */
    async statementDocument(session: VerifiedSession, q: { hotel?: string; from: string; to: string }): Promise<GuestStatement> {
      if (q.from > q.to) throw new AppError("VALIDATION_FAILED", "The start date is after the end date.", { fields: { from: "The start date is after the end date." } });
      if (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`) > 366 * 86_400_000) throw new AppError("VALIDATION_FAILED", "Choose at most one year.", { fields: { to: "Choose at most one year." } });
      const { parts, unavailable } = await gather(deps.memberships, session, "guest", q.hotel, (s) =>
        read(s, (ctx) => ({
          guestName: ctx.customer.name,
          mobile: ctx.customer.mobile,
          lines: history(ctx)
            .filter((h) => { const day = istDate(new Date(h.at)); return day >= q.from && day <= q.to; })
            .map((h) => ({ date: istDate(new Date(h.at)), at: h.at, kind: h.kind, title: h.title, business: businessName(ctx, h.business), amountPaise: h.amountPaise })),
        })),
      );
      const lines = parts.flatMap((p) => p.value.lines.map((l) => ({ ...l, hotelName: p.hotel.hotelName }))).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(0, STATEMENT_LINES_MAX);
      return {
        guestName: parts[0]?.value.guestName ?? "",
        mobile: parts[0]?.value.mobile ?? "",
        hotels: parts.map((p) => p.hotel.hotelName),
        from: q.from,
        to: q.to,
        lines,
        chargesPaise: lines.filter((l) => l.kind === "charge").reduce((t, l) => t + l.amountPaise, 0),
        paymentsPaise: lines.filter((l) => l.kind === "payment").reduce((t, l) => t + l.amountPaise, 0),
        unavailable,
      };
    },

    async placeOrder(session: VerifiedSession, input: OrderBody, meta: RequestMeta): Promise<OrderResult & { scheduledFor: string | null; orderId: string; status: string; cancellableUntil: string | null }> {
      return read(session, async (ctx, repos) => {
        if (!ctx.current) throw new AppError("CONFLICT", NOT_STAYING);
        const hours = await hoursOf(repos);
        const scheduled = input.scheduledFor ? scheduleOf(input.scheduledFor, ctx, hours) : null;
        if (!scheduled) {
          if (!hours.accepting) throw new AppError("CONFLICT", NOT_ACCEPTING);
          if (!isOpenAt(hours, ctx.now)) throw new AppError("CONFLICT", CLOSED_NOW);
        }
        // food only (MJ, 26 Oct 2026): a laundry or service item is refused like an unknown one
        const menu = (await repos.menuItems.list()).filter((m) => isOrderableGroup(m.group));
        const wanted = Object.entries(input.qty).filter(([, q]) => q > 0);
        const refuse = (message: string): never => {
          throw new AppError("VALIDATION_FAILED", message, { fields: { cart: message } });
        };
        if (wanted.length === 0) refuse(guestCopy.errors.cartEmpty);
        const lines = wanted.map(([id, qty]) => {
          const item = menu.find((m) => m.id === id);
          if (!item || !item.available || qty > MAX_ITEM_QTY) return refuse(guestCopy.errors.cartEmpty);
          return { item, qty };
        });
        if (input.payWith === "pay_now") throw new AppError("VALIDATION_FAILED", PAY_OFF, { fields: { payWith: PAY_OFF } });
        // the stay is locked and read again: a check-out that just happened ends the order
        const stay = await repos.stays.get(ctx.current.stay.id, { forUpdate: true });
        if (!stay || stay.status !== "in_house") throw new AppError("CONFLICT", NOT_STAYING);
        const at = ctx.now;
        const day = ctx.today;
        const made: ChargeRecord[] = [];
        for (const { item, qty } of lines) {
          const g = MENU_GROUPS[item.group];
          const amount = item.pricePaise * BigInt(qty);
          made.push(await repos.charges.create({ stayId: stay.id, chargeDate: day, category: g.category, side: g.business, description: `${scheduled ? `Order for ${scheduled.label}` : "Order"}: ${item.name}`.slice(0, 255), quantity: `${qty}.00`, unitPricePaise: item.pricePaise, amountPaise: amount, createdBy: session.userId }));
        }
        const orderNo = `O-${made[0].id.replace(/-/g, "").slice(-6).toUpperCase()}`;
        const pct = (side: "hotel" | "food"): number => Number(side === "hotel" ? ctx.current?.hotelPct : ctx.current?.foodPct) || 0;
        const parts = (["hotel", "food"] as const).flatMap((business) => {
          const mine = made.filter((c) => c.side === business);
          if (mine.length === 0) return [];
          const subtotal = mine.reduce((s, c) => s + c.amountPaise, ZERO);
          const gst = BigInt(Math.round((Number(subtotal) * pct(business)) / 100));
          return [{ business, subtotalPaise: n(subtotal), gstPaise: n(gst), totalPaise: n(subtotal + gst) }];
        });
        const totalPaise = parts.reduce((s, p) => s + p.totalPaise, 0);
        // the order's own row (migration 0041): status placed, its lines pointing at the charges just added (so a cancel can take them off again)
        const order = await repos.roomService.create({
          orderNo,
          stayId: stay.id,
          scheduledFor: scheduled ? new Date(scheduled.iso) : null,
          note: input.note.trim() === "" ? null : input.note.trim().slice(0, 500),
          totalPaise: BigInt(totalPaise),
          placedBy: session.userId,
          placedAt: at,
          lines: lines.map((l, i) => ({ itemId: l.item.id, name: l.item.name.slice(0, 120), qty: l.qty, unitPricePaise: l.item.pricePaise, chargeId: made[i]?.id ?? null, sortOrder: i })),
        });
        await repos.systemLogs.write(portalLog(session, meta, { module: LOG_MODULE, action: "created", entity: "Room service order", summary: `${ctx.customer.name} ordered to room ${ctx.current.roomNumber} in the guest portal (${orderNo})`, subject: { id: stay.id, label: `${orderNo} - room ${ctx.current.roomNumber}` }, userName: ctx.customer.name, details: { Items: lines.map((l) => `${l.item.name} x ${l.qty}`).join(", "), "For": scheduled ? scheduled.label : undefined, Note: input.note.trim() === "" ? undefined : input.note.trim() } }));
        const minutes = await guestCancelMinutesOf(repos);
        return { orderNo, orderId: order.id, status: order.status, cancellableUntil: cancellableUntil(order, minutes, at), placedAt: at.toISOString(), payWith: input.payWith, totalPaise, parts, etaMinutes: ORDER_ETA_MINUTES, scheduledFor: scheduled ? scheduled.iso : null };
      });
    },

    async getProfile(session: VerifiedSession): Promise<GuestProfile & { username: string }> {
      return read(session, (ctx) => profileOf(ctx, session));
    },

    /**
     * The guest's own details (the mobile, their sign-in, is reception's to change).
     * With the ONE common profile (platform 0132; docs/plans/CENTRAL-GUEST-COMPANY-PLAN-2026-10-18.md): name, email, city and address are written ONCE, to the central profile,
     * and every hotel reads them from there (no fan-out). The first save makes the profile from this hotel's record and links every hotel record of the login. The ID proof
     * is each hotel's own (KYC), so it is written to the guest's record in every linked hotel, and only when it changed (`updatedHotels` / `unavailable` are about that).
     * Without the central tables (a database before 0132) it is the round 3 d behaviour: every field to every linked hotel's record.
     */
    async updateProfile(session: VerifiedSession, input: GuestProfileBody, meta: RequestMeta): Promise<GuestProfile & { updatedHotels: number; unavailable: { hotelId: string; hotelName: string }[] }> {
      const scope = requireScope(session, "guest");
      const clean = checkProfile(input);
      const central = deps.central && (await deps.central.run((r) => r.ready())) ? deps.central : null;
      if (!central) {
        const { parts, unavailable } = await gather(deps.memberships, session, "guest", "all", (s) => this.updateProfileAt(s, input, meta));
        const mine = parts.find((p) => p.hotel.hotelId === session.hotelId) ?? parts[0];
        return { ...mine.value, updatedHotels: parts.length, unavailable };
      }
      const record = await read(session, (ctx) => ctx.customer);
      const links = await membershipsOf(deps.memberships, session, "guest");
      const { before, after } = await central.run(async (r) => {
        let g = (await r.guests.byUser(session.userId)) ?? (await r.guests.ofRecord(session.hotelId, scope.id));
        // the first version of the profile is this hotel's record as it is; the save below is then a change like any other (and logged as one)
        if (!g) g = await r.guests.create({ displayName: record.name.trim().slice(0, 100) || clean.name, mobile: centralMobile(record.mobile), email: record.email?.trim().toLowerCase() || null, address: record.address?.trim().slice(0, 255) || null, city: record.city?.trim().slice(0, 100) || null, userId: session.userId });
        else if (g.userId === null) g = (await r.guests.update(g.id, { userId: session.userId })) ?? g;
        for (const m of links) await r.guests.link(m.hotelId, m.subjectId, g.id);
        const updated = await r.guests.update(g.id, { displayName: clean.name, email: clean.email, city: clean.city, address: clean.address });
        const after = updated ?? g;
        // the central history (M1(a)), in the same transaction: from which hotel, by the guest, which fields
        const fields = guestFieldsChanged(g, after);
        if (fields.length > 0) await r.history.record({ kind: "guest", profileId: g.id, hotelId: session.hotelId, byUserId: session.userId, byName: after.displayName, via: "portal", fields, at: now(), traceId: meta.traceId });
        return { before: g, after };
      });
      const changed = ([["name", before.displayName, after.displayName], ["email", before.email, after.email], ["city", before.city, after.city], ["address", before.address, after.address]] as const).filter(([, a, b]) => (a ?? null) !== (b ?? null)).map(([k]) => k);
      // the ID proof stays each hotel's own: written to every linked hotel's record only when it changed
      const keepNumber = input.idProofType !== "none" && clean.idNumber === maskId(record.idProofNumber) && idTypeOf(record.idProofType) === input.idProofType;
      const idSame = input.idProofType === "none" ? record.idProofType === null && record.idProofNumber === null : keepNumber;
      let updatedHotels = 0;
      let unavailable: { hotelId: string; hotelName: string }[] = [];
      if (!idSame) {
        const ids = await gather(deps.memberships, session, "guest", "all", (s) => this.updateProfileAt(s, input, meta, "id"));
        updatedHotels = ids.parts.length;
        unavailable = ids.unavailable;
      }
      if (changed.length > 0) {
        // one line, in the hotel the guest is using now (field names only)
        await unit.run(session, (repos) => repos.systemLogs.write(portalLog(session, meta, { module: LOG_MODULE, action: "updated", entity: "Guest profile", summary: `${clean.name} updated their profile in the guest portal`, subject: { id: scope.id, label: clean.name }, userName: clean.name, details: { Changed: changed.join(", ") } })));
      }
      return { ...(await this.getProfile(session)), updatedHotels, unavailable };
    },

    /** One hotel's part of updateProfile (the session is that hotel's, with its own customer record): every field, or with `only` = "id" the ID proof alone. */
    async updateProfileAt(session: VerifiedSession, input: GuestProfileBody, meta: RequestMeta, only: "all" | "id" = "all"): Promise<GuestProfile> {
      const scope = requireScope(session, "guest");
      const { name, email, idNumber, city, address } = checkProfile(input);
      return unit.run(session, async (repos) => {
        const before = await load(repos, scope.id);
        const c = before.customer;
        // the masked number sent back unchanged keeps the stored one (only the last four ever leave the server)
        const keepNumber = input.idProofType !== "none" && idNumber === maskId(c.idProofNumber) && idTypeOf(c.idProofType) === input.idProofType;
        const id = {
          idProofType: input.idProofType === "none" ? null : keepNumber ? c.idProofType : ID_TYPE_LABEL[input.idProofType],
          idProofNumber: input.idProofType === "none" ? null : keepNumber ? c.idProofNumber : idNumber,
        };
        const patch = only === "id" ? id : { name, email, city, address, ...id };
        const updated = await repos.customers.update(c.id, patch, session.userId);
        if (!updated) throw new AppError("NOT_FOUND");
        // field names only: an ID number is never written to a log
        const changed: string[] = (Object.keys(patch) as (keyof typeof patch & keyof CustomerRecord)[]).filter((k) => (c[k] ?? null) !== ((patch as Record<string, unknown>)[k] ?? null));
        if (changed.length > 0) {
          await repos.systemLogs.write(portalLog(session, meta, { module: LOG_MODULE, action: "updated", entity: "Customer", summary: `${updated.name} updated their details in the guest portal`, subject: { id: c.id, label: updated.name }, userName: updated.name, details: { Changed: changed.join(", ") } }));
        }
        return profileOf({ ...before, customer: updated }, session);
      });
    },

    /** The signed-in password change: the shape here (Pallav's words from the contract), the current password and the rule on the credential side. */
    async changePassword(session: VerifiedSession, input: GuestPasswordBody, meta: RequestMeta): Promise<{ changed: true }> {
      requireScope(session, "guest");
      const fields: Record<string, string> = {};
      if (!input.current) fields.current = guestCopy.errors.currentRequired;
      if (!input.next) fields.next = guestCopy.errors.nextShort;
      else if (input.next === input.current) fields.next = guestCopy.errors.nextSame;
      if (input.confirm !== input.next) fields.confirm = guestCopy.errors.confirmMismatch;
      if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(fields)[0], { fields });
      try {
        await deps.credentials.changeMyPassword(session, { currentPassword: input.current, newPassword: input.next }, meta);
      } catch (error) {
        if (error instanceof AppError && error.code === "INVALID_CREDENTIALS") throw new AppError("VALIDATION_FAILED", guestCopy.errors.currentWrong, { fields: { current: guestCopy.errors.currentWrong } });
        if (error instanceof AppError && (error.code === "PASSWORD_TOO_WEAK" || error.code === "PASSWORD_REUSED")) throw new AppError(error.code, error.message, { fields: { next: error.message } });
        throw error;
      }
      return { changed: true };
    },
  };
}

export type GuestService = ReturnType<typeof createGuestService>;

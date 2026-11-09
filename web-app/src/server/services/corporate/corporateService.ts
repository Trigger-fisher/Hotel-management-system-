import "server-only";
import { billSac } from "@shared/dashboards/billing";
import { PAY_WITHIN_DAYS } from "@shared/dashboards/corporate";
import type {
  BillDetail, BillSettlement, BillStatus, Business, CompanyBill, CompanyProfile, Dues, LedgerLine, LedgerPeriod, LedgerTotals,
  PaymentReceipt,
} from "@shared/dashboards/corporate";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { portalNotLinked } from "../../errors/portal";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import { ONLINE_PAYMENT_KEYS, onlinePaymentAvailable } from "../../payments/onlinePayment";
import type { CompanyRecord } from "../../repos/companies";
import type { PortalRepos } from "../../repos/portal";
import type { Unit } from "../../repos/types";
import { personsOf, type BillPersons } from "../billing/guests";
import type { BillGuests } from "../../repos/billing";
import type { PeopleDirectory } from "../cash/ports";
import { buildLedger, ledgerTotals, modes, type LedgerBill, type Line } from "../companies/ledger";
import { STATEMENT_MAX_DAYS, STATEMENT_MAX_ROWS } from "../companies/ledgerService";
import { istDate } from "../frontOffice/rules";
import { callNumber, daysBetween, portalLog, requireScope, todayIst } from "../guest/portalKit";
import { createPortalNotifications } from "../notifications/portalNotificationService";
import { cursorModeOf, cursorSecretOr, makeCursor, pageByKeyset, readCursor, type Keyset, type TieOrder } from "../portal/cursor";
import { gather, membershipsOf, oneHotel, sessionFor, type Memberships, type UnavailableHotel } from "../portal/multiHotel";
import type { CompanyProfileBody } from "./schemas";
import { companyFieldsChanged, lastChangeView, maskGstin, type CentralCompany, type CentralCompanyFields, type CentralProfilesUnit, type LastProfileChange } from "../../repos/centralProfiles";
import { profilePhotoUrl } from "../admin/profileService";

// The COMPANY PORTAL (account role corporate_user; ui-shared/dashboards/corporate.ts CorporateApi, 17 calls). A corporate account has NO module
// permission; it reaches only the company its account points at (record scope): that company's profile, its live Bill Master bills and advances (the
// SAME ledger the hotel's accounts team sees, services/companies/ledger.ts, golden-tested against Pallav's CompanyLedger) and its reservations. Paying
// and booking wait for online payment (Razorpay): they are checked, then answered with a sentence, and change nothing. Cancelling a booking that has
// not started is real (the front desk's own rule: only a confirmed reservation; its advance stays for the accounts team to refund). (The team list and
// Add member were removed from the company portal, decision 59.)
// HMS design: Pallav's company portal pages were previews on sample data (PortalCompanyController, Support/PortalSample.php).

const ZERO = BigInt(0);
const n = paiseToNumber;
const LOG_MODULE = "company-portal";
const ON_ACCOUNT = "On account";

export const PAY_OFF = "Online payment is not switched on yet. Please pay the hotel accounts team by bank transfer or at reception.";

interface CorporateDeps {
  unit: Unit<PortalRepos>;
  now: () => Date;
  /** Names of the hotel's staff who made a booking. */
  people: PeopleDirectory;
  /** Decision 48: the hotels a company login is linked to (absent = the session's own hotel only). */
  memberships?: Memberships;
  /** The server key that signs list cursors (HMS_HASH_KEY); absent = a key that lives as long as the process. */
  cursorSecret?: () => Buffer;
  /** The ONE common company profile (platform 0132). Absent, or a database before 0132 = each hotel's own record, as before. */
  central?: CentralProfilesUnit;
  /** The stored name of a login's profile photo (platform 0131); absent = no photo. */
  photoName?: (userId: string) => Promise<string | null>;
}

/** A hotel's company record as the first version of its ONE common profile. */
const centralFieldsOf = (c: CompanyRecord, userId: string): CentralCompanyFields => ({
  name: c.name.trim().slice(0, 100) || "Company",
  mainContactName: c.contacts[0]?.name?.trim().slice(0, 100) || null,
  gstin: c.gstNumber?.trim().toUpperCase() || null,
  email: c.email?.trim().toLowerCase() || null,
  mobile: c.mobileNumber?.trim() || null,
  landline: c.phoneNumber?.trim() || null,
  address: c.address?.trim().slice(0, 100) || null,
  pincode: c.pincode?.trim() || null,
  country: c.country?.trim() || null,
  contacts: c.contacts.map((x) => ({ name: x.name, role: x.role, email: x.email, mobile: x.mobile })),
  userId,
});

/** The paging part of a list query: pages (`page`, `pageSize`) or a cursor (`limit`, `cursor`). */
interface ListQ {
  hotel?: string;
  search?: string;
  period?: string;
  unread?: boolean;
  page: number;
  pageSize: number;
  cursor?: string;
  limit?: number;
}

interface Ctx {
  company: CompanyRecord;
  profile: CompanyProfile;
  bills: LedgerBill[];
  /** Who stayed, for the bills that came from a stay (decision 52). */
  billGuests: ReadonlyMap<string, BillGuests>;
  lines: Line[];
  today: string;
}

const isDebit = (mode: string | null): boolean => (mode ?? "").trim().toLowerCase() === "debit";
const pct = (v: string | null): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const sumOf = (values: readonly bigint[]): bigint => values.reduce((t, v) => t + v, ZERO);

export function companyBill(b: LedgerBill, companyId: string, stays?: ReadonlyMap<string, BillGuests>): CompanyBill & { persons: BillPersons } {
  const segments = b.staySegments ?? [];
  const nights = segments.length > 0 ? segments.reduce((t, s) => t + s.nights, 0) : b.arrivalAt && b.departureAt ? Math.max(0, daysBetween(istDate(b.arrivalAt), istDate(b.departureAt))) : 0;
  const settlements: BillSettlement[] = b.debit
    .filter((s) => s.date && ((s.hotelPaise ?? ZERO) !== ZERO || (s.foodPaise ?? ZERO) !== ZERO))
    .map((s) => ({ date: s.date as string, hotelPaise: n(s.hotelPaise ?? ZERO), foodPaise: n(s.foodPaise ?? ZERO), mode: modes(s.hotelMode, s.foodMode) ?? "", reference: null }));
  return {
    id: b.id,
    billNumber: b.billNumber,
    billDate: b.billDate,
    guestName: b.guestName,
    guestMobile: b.mobileNumber,
    roomNumber: b.roomNumber,
    roomType: null,
    plan: b.hotelPlan,
    checkIn: b.arrivalAt ? istDate(b.arrivalAt) : b.billDate,
    nights,
    roomTariffPaise: n(b.hotelAmountPaise + b.hotelPlanAmountPaise + b.hotelExtraBedAmountPaise + b.hotelOtherAmountPaise),
    discountPaise: 0,
    laundryPaise: n(b.hotelLaundryAmountPaise),
    hotelGstPaise: n(b.hotelGstPaise),
    totalHotelPaise: n(b.totalHotelAmountPaise),
    foodPaise: n(b.foodAmountPaise + b.foodPlanAmountPaise + b.foodLaundryAmountPaise),
    foodGstPaise: n(b.foodGstPaise),
    totalFoodPaise: n(b.totalFoodAmountPaise),
    hotelSac: billSac(b).hotel,
    foodSac: billSac(b).food,
    hotelMode: isDebit(b.hotelModeOfPayment) ? ON_ACCOUNT : b.hotelModeOfPayment,
    foodMode: isDebit(b.foodModeOfPayment) ? ON_ACCOUNT : b.foodModeOfPayment,
    advanceHotelPaise: n(b.advanceHotelAmountPaise),
    advanceFoodPaise: n(b.advanceFoodAmountPaise),
    advanceReceipt: b.advanceReceiptNumber,
    advanceIsCompanys: b.advanceId !== null && b.advanceCompanyId === companyId,
    settlements,
    balanceHotelPaise: n(b.balanceHotelAmountPaise),
    balanceFoodPaise: n(b.balanceFoodAmountPaise),
    reference: b.referenceName,
    note: b.instruction,
    persons: personsOf(stays?.get(b.id), b),
  };
}

const BILL_KINDS = new Set<Line["kind"]>(["bill", "adjusted", "checkout", "settlement"]);

export function ledgerLine(l: Line, bills: ReadonlyMap<string, LedgerBill>): LedgerLine {
  const bill = BILL_KINDS.has(l.kind) ? bills.get(l.recordId) : undefined;
  const onAccount = l.kind === "bill" && bill !== undefined && (isDebit(bill.hotelModeOfPayment) || isDebit(bill.foodModeOfPayment));
  return { id: l.key, kind: l.kind, date: l.date, ref: l.ref, guest: l.guest, room: l.room, mode: onAccount ? ON_ACCOUNT : l.mode, note: l.note, billId: bill ? bill.id : null, debitPaise: n(l.debitPaise), creditPaise: n(l.creditPaise), balancePaise: n(l.balancePaise) };
}

const totalsDto = (lines: readonly Line[]): LedgerTotals => {
  const t = ledgerTotals(lines);
  return { billedPaise: n(t.billedPaise), receivedPaise: n(t.receivedPaise), refundedPaise: n(t.refundedPaise), balancePaise: n(t.balancePaise) };
};

function duesOf(bills: readonly LedgerBill[]): Dues {
  const hotelOpen = bills.filter((b) => b.balanceHotelAmountPaise > ZERO);
  const foodOpen = bills.filter((b) => b.balanceFoodAmountPaise > ZERO);
  const hotel = sumOf(hotelOpen.map((b) => b.balanceHotelAmountPaise));
  const food = sumOf(foodOpen.map((b) => b.balanceFoodAmountPaise));
  return { hotelPaise: n(hotel), foodPaise: n(food), hotelOpen: hotelOpen.length, foodOpen: foodOpen.length, totalPaise: n(hotel + food), openBills: bills.filter((b) => b.balanceHotelAmountPaise + b.balanceFoodAmountPaise > ZERO).length };
}

function billStatusOf(b: CompanyBill, today: string): BillStatus {
  if (b.balanceHotelPaise + b.balanceFoodPaise <= 0) return "paid";
  return daysBetween(b.billDate, today) > PAY_WITHIN_DAYS ? "overdue" : "due";
}

const shiftMonth = (yyyyMm: string, by: number): string => {
  const d = new Date(Date.UTC(Number(yyyyMm.slice(0, 4)), Number(yyyyMm.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const monthEnd = (yyyyMm: string): string => new Date(Date.parse(`${shiftMonth(yyyyMm, 1)}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** The portal's quick periods: this month, last month, this financial year (1 April to 31 March, the contract's "This financial year"), all time. */
export function periodRange(period: LedgerPeriod, today: string): [string | null, string | null] {
  if (period === "month") return [`${today.slice(0, 7)}-01`, today];
  if (period === "last") {
    const last = shiftMonth(today.slice(0, 7), -1);
    return [`${last}-01`, monthEnd(last)];
  }
  if (period === "year") {
    const y = Number(today.slice(0, 4));
    return [`${Number(today.slice(5, 7)) >= 4 ? y : y - 1}-04-01`, today];
  }
  return [null, null];
}

/** The ledger the portal shows: a period's lines (oldest first here; the pages show them newest first), the balance before them, and whether the rule cut older lines off. */
interface LedgerWindow {
  from: string | null;
  to: string | null;
  openingPaise: bigint;
  closingPaise: bigint;
  lines: Line[];
  capped: boolean;
}

/**
 * The period's lines under the statement rule (BACKEND.md binding rule 8, the staff statement's own constants): "All time" shows at most the last three
 * years, and any period at most the newest 5,000 lines. When older lines are cut off, `from` becomes the first day shown, the opening balance carries
 * everything before it, and `capped` says so.
 */
export function ledgerWindow(all: readonly Line[], period: LedgerPeriod, today: string): LedgerWindow {
  const range = periodRange(period, today);
  let from = range[0];
  const to = range[1];
  let capped = false;
  if (from === null) {
    const earliest = new Date(Date.parse(`${today}T00:00:00Z`) - STATEMENT_MAX_DAYS * 86_400_000).toISOString().slice(0, 10);
    if (all.some((l) => l.date < earliest)) [from, capped] = [earliest, true];
  }
  let inside = all.filter((l) => (!from || l.date >= from) && (!to || l.date <= to));
  if (inside.length > STATEMENT_MAX_ROWS) {
    inside = inside.slice(-STATEMENT_MAX_ROWS);
    [from, capped] = [inside[0].date, true];
  }
  // the balance just before the first line shown (the lines are in date order, each carrying its running balance)
  const firstAt = inside.length > 0 ? all.indexOf(inside[0]) : -1;
  const before = firstAt >= 0 ? all.slice(0, firstAt) : from ? all.filter((l) => l.date < from) : [];
  const opening = before.length > 0 ? before[before.length - 1].balancePaise : ZERO;
  const closing = inside.length > 0 ? inside[inside.length - 1].balancePaise : opening;
  return { from, to, openingPaise: opening, closingPaise: closing, lines: inside, capped };
}

/** The word each ledger line kind shows on the Ledger page (decision 48). */
const LEDGER_WORD: Record<string, string> = { bill: "Bill", advance: "Advance received", checkout: "Paid at check-out", adjusted: "Advance used", settlement: "Payment received", refund: "Refund" };
const matchesAll = (w: readonly string[], fields: readonly (string | null | undefined)[]): boolean => w.every((x) => fields.some((f) => (f ?? "").toLowerCase().includes(x)));
const byDateDesc = <T extends { date: string; id: string }>(a: T, b: T): number => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id.localeCompare(a.id));


export function createCorporateService(deps: CorporateDeps) {
  const { unit, now } = deps;

  async function load(repos: PortalRepos, companyId: string): Promise<Ctx> {
    const company = await repos.companyProfiles.get(companyId);
    // the company was deleted (recycle bin) or never existed: no portal (as a disabled account)
    if (!company) throw portalNotLinked("company");
    const header = await repos.hotelProfile.header();
    const src = await repos.ledgerSource.forCompany(companyId);
    const profile: CompanyProfile = {
      id: company.id,
      name: company.name,
      gstin: company.gstNumber ?? "",
      email: company.email ?? "",
      mobile: company.mobileNumber ?? "",
      landline: company.phoneNumber,
      address: company.address ?? "",
      // company_profiles keeps no city or state (Pallav's shape): empty
      city: "",
      state: "",
      pincode: company.pincode ?? "",
      country: company.country ?? "",
      discountPct: pct(company.discountPercentage),
      gstPct: pct(company.gstPercentage),
      tcsPct: pct(company.tcsPercentage),
      tdsPct: pct(company.tdsPercentage),
      accountSince: istDate(company.createdAt),
      mainContactName: company.contacts[0]?.name || null,
      billedBy: { name: header.name, gstin: header.gstin ?? "", address: header.address ?? "", phone: header.phone ?? "", email: "" },
    };
    const billGuests = await repos.bills.guestsOf(src.bills.map((b) => b.id));
    return { company, profile, bills: src.bills, billGuests, lines: buildLedger(companyId, src.bills, src.advances), today: todayIst(now()) };
  }

  const read = <T>(session: VerifiedSession, work: (ctx: Ctx, repos: PortalRepos) => Promise<T> | T): Promise<T> => {
    const scope = requireScope(session, "company");
    return unit.run(session, async (repos) => work(await load(repos, scope.id), repos));
  };

  const billMap = (ctx: Ctx): Map<string, LedgerBill> => new Map(ctx.bills.map((b) => [b.id, b]));
  const sortedBills = (ctx: Ctx): CompanyBill[] =>
    ctx.bills.map((b) => companyBill(b, ctx.company.id, ctx.billGuests)).sort((a, b) => (a.billDate < b.billDate ? 1 : a.billDate > b.billDate ? -1 : b.billNumber.localeCompare(a.billNumber)));
  const words = (s: string | undefined): string[] => (s ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const page = <T>(rows: T[], q: { page: number; pageSize: number }) => ({ items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: rows.length, page: q.page, pageSize: q.pageSize });
  /**
   * One list answer: by page (`page`, `pageSize`, as before) or, when a `limit` or `cursor` is sent, by cursor in the stable order (date newest first, hotel, token). The cursor is signed
   * for this login and for this list, hotel, search and period; `nextCursor` is null on the last page. `unavailable` names the linked hotels that are missing from the rows.
   */
  function listOut<T>(session: VerifiedSession, name: string, q: ListQ, rows: T[], keyOf: (row: T) => Keyset, tie: TieOrder, unavailable: UnavailableHotel[]) {
    const mode = cursorModeOf(q);
    if (!mode) return { ...page(rows, q), nextCursor: null as string | null, unavailable };
    const secret = cursorSecretOr(deps.cursorSecret);
    const scope = [name, q.hotel || "all", q.search ?? "", q.period ?? "", q.unread ? "unread" : ""].join("|");
    const after = q.cursor === undefined ? null : readCursor(secret, session.userId, scope, q.cursor);
    const { items, next } = pageByKeyset(rows, keyOf, after, mode.limit, tie);
    return { items, total: rows.length, page: 1, pageSize: mode.limit, nextCursor: next ? makeCursor(secret, session.userId, scope, next) : null, unavailable };
  }

  /** The central tables, when this database has them (platform 0132). */
  const centralUnit = async (): Promise<CentralProfilesUnit | null> => (deps.central && (await deps.central.run((r) => r.ready())) ? deps.central : null);

  /** The login's ONE common profile when there is one; null = show the hotel's own record (no central tables yet, or not made yet: the first save makes it). */
  async function centralCompanyOf(session: VerifiedSession, hotelId: string, recordId: string): Promise<{ company: CentralCompany; last: LastProfileChange | null } | null> {
    const central = await centralUnit();
    if (!central) return null;
    return central.run(async (r) => {
      const company = (await r.companies.byUser(session.userId)) ?? (await r.companies.ofRecord(hotelId, recordId));
      return company ? { company, last: await r.history.last("company", company.id) } : null;
    });
  }

  /**
   * The company profile: the contact details and GSTIN of the ONE common profile when there is one (every hotel shows the same), else the hotel's own record; the prices are
   * always that ONE hotel's (`hotel`, omitted = the first), read-only.
   */
  async function companyProfileOf(session: VerifiedSession, q: { hotel?: string }) {
    const one = await oneHotel(deps.memberships, session, "company", q.hotel === "all" ? undefined : q.hotel);
    const view = await read(one.session, (ctx) => ({ company: ctx.company, pricing: { discountPct: ctx.profile.discountPct, gstPct: ctx.profile.gstPct, tcsPct: ctx.profile.tcsPct, tdsPct: ctx.profile.tdsPct } }));
    const [found, photo] = await Promise.all([centralCompanyOf(session, one.hotel.hotelId, view.company.id), deps.photoName ? deps.photoName(session.userId) : Promise.resolve(null)]);
    const central = found?.company ?? null;
    const c = view.company;
    return {
      hotelId: one.hotel.hotelId,
      hotelName: one.hotel.hotelName,
      id: c.id,
      name: central?.name ?? c.name,
      mainContactName: central ? (central.mainContactName ?? central.contacts[0]?.name ?? "") : (c.contacts[0]?.name ?? ""),
      email: (central ? central.email : c.email) ?? "",
      mobile: (central ? central.mobile : c.mobileNumber) ?? "",
      landline: (central ? central.landline : c.phoneNumber) ?? "",
      address: (central ? central.address : c.address) ?? "",
      pincode: (central ? central.pincode : c.pincode) ?? "",
      country: (central ? central.country : c.country) ?? "",
      gstin: (central ? central.gstin : c.gstNumber) ?? "",
      contacts: (central ? central.contacts : c.contacts).map((x) => ({ name: x.name, role: x.role, email: x.email, mobile: x.mobile })),
      pricing: view.pricing,
      setByHotel: true as const,
      photoUrl: profilePhotoUrl(photo),
      common: central !== null,
      ...(found ? { lastChange: lastChangeView(found.last) } : {}),
    };
  }

  return {
    // Notifications the hotels sent (docs/BACKEND.md "Notifications"): list, unread badge, mark read, mark all read
    ...createPortalNotifications({ unit, now, memberships: deps.memberships, cursorSecret: deps.cursorSecret }),

    /** One bill of THIS company; any other id (another company's, a guest's, a removed one) is 404. */
    async getBill(session: VerifiedSession, id: string): Promise<BillDetail> {
      return read(session, (ctx) => {
        const bill = ctx.bills.find((b) => b.id === id);
        if (!bill) throw new AppError("NOT_FOUND");
        return { bill: companyBill(bill, ctx.company.id, ctx.billGuests), company: ctx.profile };
      });
    },

    async payDues(session: VerifiedSession, businesses: readonly Business[]): Promise<PaymentReceipt[]> {
      return read(session, (ctx) => {
        const dues = duesOf(ctx.bills);
        const owing = businesses.filter((b) => (b === "hotel" ? dues.hotelPaise : dues.foodPaise) > 0);
        if (owing.length === 0) throw new AppError("VALIDATION_FAILED", "Nothing is due for the businesses you picked.", { fields: { businesses: "Nothing is due for the businesses you picked." } });
        throw new AppError("VALIDATION_FAILED", PAY_OFF, { fields: { businesses: PAY_OFF } });
      });
    },

    async payBill(session: VerifiedSession, id: string): Promise<PaymentReceipt[]> {
      return read(session, (ctx) => {
        const bill = ctx.bills.find((b) => b.id === id);
        if (!bill) throw new AppError("NOT_FOUND");
        if (bill.balanceHotelAmountPaise + bill.balanceFoodAmountPaise <= ZERO) throw new AppError("CONFLICT", "This bill is already paid.");
        throw new AppError("VALIDATION_FAILED", PAY_OFF, { fields: { bill: PAY_OFF } });
      });
    },

    // ------------------------------------------------------------------------------------------------------------------------------
    // Decision 48 (MJ, 12 Oct 2026): several hotels, the Accounts pages, the calm dashboard, the editable profile (docs/BACKEND.md)
    // ------------------------------------------------------------------------------------------------------------------------------

    /**
     * The hotels this login is linked to, each with the number to call (the hotel profile phone, else the Website reception phone, else null) and whether it can be paid
     * online now (the Set-up centre's payment status; false when it cannot be read).
     */
    async hotels(session: VerifiedSession): Promise<{ hotelId: string; name: string; phone: string | null; onlinePayment: boolean }[]> {
      const found = await membershipsOf(deps.memberships, session, "company");
      return Promise.all(
        found.map(async (m) => {
          const as = sessionFor(session, "company", m);
          const phone = await unit.run(as, async (repos) => callNumber((await repos.hotelProfile.header()).phone, (await repos.siteSettings.get()).fields.receptionPhone)).catch(() => null);
          const onlinePayment = await unit.run(as, async (repos) => onlinePaymentAvailable(await repos.settings.values(ONLINE_PAYMENT_KEYS))).catch(() => false);
          return { hotelId: m.hotelId, name: m.hotelName, phone, onlinePayment };
        }),
      );
    },

    /**
     * The selector's numbers: every linked hotel with what the company owes it, its open bills and its unread notifications, and the totals. A hotel that cannot be reached is
     * named in `unavailable` and left out of the totals. (`hotels` above stays the cheap list the sidebar loads on every page.)
     */
    async hotelsSummary(session: VerifiedSession) {
      const { parts, unavailable } = await gather(deps.memberships, session, "company", undefined, (s) =>
        read(s, async (ctx, repos) => {
          const dues = duesOf(ctx.bills);
          return {
            phone: callNumber((await repos.hotelProfile.header()).phone, (await repos.siteSettings.get()).fields.receptionPhone),
            outstandingPaise: dues.totalPaise,
            openBills: dues.openBills,
            unreadNotifications: await repos.notifications.unreadCount(ctx.company.id, ctx.today),
          };
        }),
      );
      const hotels = parts.map((p) => ({ hotelId: p.hotel.hotelId, name: p.hotel.hotelName, ...p.value }));
      const sum = (pick: (h: (typeof hotels)[number]) => number): number => hotels.reduce((t, h) => t + pick(h), 0);
      return {
        hotels,
        totals: { outstandingPaise: sum((h) => h.outstandingPaise), openBills: sum((h) => h.openBills), unreadNotifications: sum((h) => h.unreadNotifications) },
        unavailable,
      };
    },

    /** The login's session for ONE hotel (`hotel` = the id; omitted = the first linked hotel), so the existing single-hotel reads run for it. */
    async forHotel(session: VerifiedSession, hotel: string | undefined): Promise<VerifiedSession> {
      return (await oneHotel(deps.memberships, session, "company", hotel)).session;
    },

    /** The calm dashboard: a few cards, the oldest open bills, the last payments; no pay links. */
    async dashboard(session: VerifiedSession, q: { hotel?: string }) {
      const { parts, unavailable } = await gather(deps.memberships, session, "company", q.hotel, (s) =>
        read(s, async (ctx, repos) => {
          const bills = billMap(ctx);
          const open = sortedBills(ctx).filter((b) => b.balanceHotelPaise + b.balanceFoodPaise > 0);
          const credit = ctx.lines.length > 0 ? ctx.lines[ctx.lines.length - 1].balancePaise : ZERO;
          return {
            unread: await repos.notifications.unreadCount(ctx.company.id, ctx.today),
            duePaise: duesOf(ctx.bills).totalPaise,
            creditPaise: credit < ZERO ? n(-credit) : 0,
            thisMonth: ctx.bills.filter((b) => b.billDate.slice(0, 7) === ctx.today.slice(0, 7)).length,
            open: open.map((b) => ({ billId: b.id, billNumber: b.billNumber, billDate: b.billDate, guestName: b.guestName, duePaise: b.balanceHotelPaise + b.balanceFoodPaise, ageDays: daysBetween(b.billDate, ctx.today), status: billStatusOf(b, ctx.today) as "due" | "overdue" })),
            payments: ctx.lines.filter((l) => l.creditPaise > ZERO).map((l) => ledgerLine(l, bills)),
          };
        }),
      );
      const named = <T>(h: { hotelId: string; hotelName: string }, row: T) => ({ hotelId: h.hotelId, hotelName: h.hotelName, ...row });
      const payments = parts.flatMap((p) => p.value.payments.map((l) => named(p.hotel, { id: l.id, date: l.date, amountPaise: l.creditPaise, mode: l.mode ?? "", reference: l.ref ?? "", kind: (l.kind === "advance" ? "advance" : "payment") as "payment" | "advance" }))).sort(byDateDesc);
      const attention = parts.flatMap((p) => p.value.open.map((b) => named(p.hotel, b))).sort((a, b) => (a.billDate < b.billDate ? -1 : a.billDate > b.billDate ? 1 : a.billNumber.localeCompare(b.billNumber))).slice(0, 5);
      const last = payments[0] ?? null;
      // what is owed by the age of the bill, over every open bill of the hotels asked for
      const ageing = { upTo30Paise: 0, upTo60Paise: 0, upTo90Paise: 0, over90Paise: 0, overdueCount: 0, overduePaise: 0 };
      for (const b of parts.flatMap((p) => p.value.open)) {
        if (b.ageDays <= 30) ageing.upTo30Paise += b.duePaise;
        else if (b.ageDays <= 60) ageing.upTo60Paise += b.duePaise;
        else if (b.ageDays <= 90) ageing.upTo90Paise += b.duePaise;
        else ageing.over90Paise += b.duePaise;
        if (b.status === "overdue") {
          ageing.overdueCount += 1;
          ageing.overduePaise += b.duePaise;
        }
      }
      return {
        ageing,
        cards: {
          totalDuePaise: parts.reduce((t, p) => t + p.value.duePaise, 0),
          creditPaise: parts.reduce((t, p) => t + p.value.creditPaise, 0),
          billsThisMonth: parts.reduce((t, p) => t + p.value.thisMonth, 0),
          lastPayment: last ? { date: last.date, amountPaise: last.amountPaise, mode: last.mode, hotelName: last.hotelName } : null,
        },
        attention,
        recentPayments: payments.slice(0, 5),
        byHotel: parts.map((p) => ({ hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName, totalDuePaise: p.value.duePaise })),
        /** Notifications the hotels sent that this company has not read yet (the sidebar badge), over the hotels asked for. */
        unreadNotifications: parts.reduce((t, p) => t + p.value.unread, 0),
        /** Linked hotels missing from these figures (failed, ran late, or past the 25th); empty when all answered. */
        unavailable,
      };
    },

    /** Accounts > Due bills: the open bills with a balance, newest first (decision 52), each with a drop-down `detail`. */
    async dueBills(session: VerifiedSession, q: ListQ) {
      const { parts, unavailable } = await gather(deps.memberships, session, "company", q.hotel, (s) =>
        read(s, (ctx) => ({
          dues: duesOf(ctx.bills),
          rows: sortedBills(ctx)
            .filter((b) => b.balanceHotelPaise + b.balanceFoodPaise > 0)
            .map((b) => ({
              id: b.id,
              billNumber: b.billNumber,
              billDate: b.billDate,
              guestName: b.guestName,
              duePaise: b.balanceHotelPaise + b.balanceFoodPaise,
              ageDays: daysBetween(b.billDate, ctx.today),
              status: billStatusOf(b, ctx.today) as "due" | "overdue",
              detail: {
                guestMobile: b.guestMobile ?? "",
                roomNumber: b.roomNumber ?? "",
                plan: b.plan ?? "",
                checkIn: b.checkIn,
                nights: b.nights,
                hotelAmountPaise: b.totalHotelPaise,
                foodAmountPaise: b.totalFoodPaise,
                advancePaise: b.advanceHotelPaise + b.advanceFoodPaise,
                balanceHotelPaise: b.balanceHotelPaise,
                balanceFoodPaise: b.balanceFoodPaise,
                reference: b.reference ?? "",
                note: b.note ?? "",
                persons: b.persons,
              },
            })),
        })),
      );
      const w = words(q.search);
      const rows = parts
        .flatMap((p) => p.value.rows.map((r) => ({ hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName, ...r })))
        .filter((r) => matchesAll(w, [r.billNumber, r.guestName, r.detail.roomNumber, r.hotelName]))
        .sort((a, b) => (a.billDate < b.billDate ? 1 : a.billDate > b.billDate ? -1 : b.billNumber.localeCompare(a.billNumber)));
      return {
        ...listOut(session, "due-bills", q, rows, (r) => ({ d: r.billDate, h: r.hotelId, i: r.id }), "desc", unavailable),
        summary: { totalDuePaise: parts.reduce((t, p) => t + p.value.dues.totalPaise, 0), openBills: parts.reduce((t, p) => t + p.value.dues.openBills, 0), byHotel: parts.map((p) => ({ hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName, totalDuePaise: p.value.dues.totalPaise, openBills: p.value.dues.openBills })) },
      };
    },

    /** Accounts > Payment history: payments and advances received, newest first, each with a `detail` block. */
    async paymentHistory(session: VerifiedSession, q: ListQ) {
      const { parts, unavailable } = await gather(deps.memberships, session, "company", q.hotel, (s) =>
        read(s, (ctx) => {
          const bills = billMap(ctx);
          return ctx.lines
            .filter((l) => l.creditPaise > ZERO)
            .map((l) => {
              const line = ledgerLine(l, bills);
              const bill = line.billId ? bills.get(line.billId) : undefined;
              return {
                id: line.id,
                date: line.date,
                amountPaise: line.creditPaise,
                mode: line.mode ?? "",
                reference: line.ref ?? "",
                kind: (line.kind === "advance" ? "advance" : "payment") as "payment" | "advance",
                detail: { billNumber: bill ? bill.billNumber : "", guestName: line.guest ?? "", receipt: line.ref ?? "", note: line.note ?? "" },
              };
            });
        }),
      );
      const w = words(q.search);
      const rows = parts
        .flatMap((p) => p.value.map((r) => ({ hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName, ...r })))
        .filter((r) => matchesAll(w, [r.reference, r.mode, r.detail.billNumber, r.detail.guestName, r.detail.note, r.hotelName]))
        .sort(byDateDesc);
      return {
        ...listOut(session, "payment-history", q, rows, (r) => ({ d: r.date, h: r.hotelId, i: r.id }), "desc", unavailable),
        summary: { receivedPaise: rows.reduce((t, r) => t + r.amountPaise, 0), byHotel: parts.map((p) => ({ hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName, receivedPaise: p.value.reduce((t, r) => t + r.amountPaise, 0) })) },
      };
    },

    /** Accounts > Ledger: the running statement per hotel (each line's balance is that hotel's running balance), paged, searchable. */
    async ledgerPage(session: VerifiedSession, q: ListQ & { period: LedgerPeriod }) {
      const { parts, unavailable } = await gather(deps.memberships, session, "company", q.hotel, (s) =>
        read(s, (ctx) => {
          const w = ledgerWindow(ctx.lines, q.period, ctx.today);
          const bills = billMap(ctx);
          return { totals: totalsDto(ctx.lines), opening: n(w.openingPaise), closing: n(w.closingPaise), capped: w.capped, lines: [...w.lines].reverse().map((l) => ledgerLine(l, bills)) };
        }),
      );
      const w = words(q.search);
      // inside one day the statement's own order matters (each line's balance follows the one before), so the tie token is the line's position, newest first
      const position = new Map<object, string>();
      const rows = parts
        .flatMap((p) =>
          p.value.lines.map((l, index) => ({
            id: l.id,
            hotelId: p.hotel.hotelId,
            hotelName: p.hotel.hotelName,
            date: l.date,
            what: `${LEDGER_WORD[l.kind] ?? "Entry"}${l.ref ? ` ${l.ref}` : ""}`.trim(),
            debitPaise: l.debitPaise,
            creditPaise: l.creditPaise,
            balancePaise: l.balancePaise,
            detail: { kind: l.kind, ref: l.ref ?? "", guest: l.guest ?? "", room: l.room ?? "", mode: l.mode ?? "", note: l.note ?? "", billId: l.billId },
            index,
          })),
        )
        .map(({ index, ...row }) => (position.set(row, String(index).padStart(9, "0")), row))
        .filter((r) => matchesAll(w, [r.what, r.detail.ref, r.detail.guest, r.detail.room, r.detail.mode, r.detail.note, r.hotelName]))
        // newest first (decision 52); a stable sort keeps each hotel's own newest-first order within a day
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      const sum = (pick: (t: LedgerTotals) => number): number => parts.reduce((t, p) => t + pick(p.value.totals), 0);
      return {
        ...listOut(session, "ledger", q, rows, (r) => ({ d: r.date, h: r.hotelId, i: position.get(r) ?? "" }), "asc", unavailable),
        totals: { billedPaise: sum((t) => t.billedPaise), receivedPaise: sum((t) => t.receivedPaise), refundedPaise: sum((t) => t.refundedPaise), balancePaise: sum((t) => t.balancePaise) },
        byHotel: parts.map((p) => ({ hotelId: p.hotel.hotelId, hotelName: p.hotel.hotelName, openingPaise: p.value.opening, closingPaise: p.value.closing })),
        capped: parts.some((p) => p.value.capped),
      };
    },

    /** The company profile in ONE hotel (`hotel`, omitted = the first): the contact fields, and the prices set by the hotel, read-only. */
    async companyProfile(session: VerifiedSession, q: { hotel?: string }) {
      return companyProfileOf(session, q);
    },

    /**
     * The company changes its own CONTACT details. With the ONE common profile (platform 0132) they are written ONCE, to the central profile, and every hotel shows them
     * (`hotel` is not needed; the first save makes the profile from the hotel's record and links every hotel record of the login). Without the central tables: in ONE hotel's
     * record, as before (`hotel` required). The percentages are always the hotel's (the strict body refuses them). Answers the profile.
     */
    async updateCompanyProfile(session: VerifiedSession, q: { hotel?: string }, input: CompanyProfileBody, meta: RequestMeta) {
      const central = await centralUnit();
      if (central) {
        const one = await oneHotel(deps.memberships, session, "company", q.hotel === "all" ? undefined : q.hotel);
        const record = await read(one.session, (ctx) => ctx.company);
        const links = await membershipsOf(deps.memberships, session, "company");
        const clean = (v: string | undefined): string | null | undefined => (v === undefined ? undefined : v.trim() === "" ? null : v.trim());
        const { before, after } = await central.run(async (r) => {
          let c = (await r.companies.byUser(session.userId)) ?? (await r.companies.ofRecord(one.hotel.hotelId, record.id));
          if (!c) c = await r.companies.create(centralFieldsOf(record, session.userId));
          else if (c.userId === null) c = (await r.companies.update(c.id, { userId: session.userId })) ?? c;
          for (const m of links) await r.companies.link(m.hotelId, m.subjectId, c.id);
          const patch: Partial<CentralCompanyFields> = {
            email: clean(input.email)?.toLowerCase() ?? (input.email === undefined ? undefined : null),
            mobile: clean(input.mobile),
            landline: clean(input.landline),
            address: clean(input.address),
            pincode: clean(input.pincode),
            country: clean(input.country),
            gstin: input.gstin === undefined ? undefined : input.gstin.trim().toUpperCase() || null,
          };
          if (input.contacts !== undefined) patch.contacts = input.contacts.map((x) => ({ name: x.name.trim(), role: x.role.trim(), email: x.email.trim(), mobile: x.mobile.trim() }));
          if (input.mainContactName !== undefined) {
            const list = patch.contacts ?? c.contacts;
            const first = list[0] ?? { name: "", role: "Main contact", email: "", mobile: "" };
            patch.contacts = [{ ...first, name: input.mainContactName.trim() }, ...list.slice(1)];
            patch.mainContactName = input.mainContactName.trim() || null;
          } else if (patch.contacts !== undefined) patch.mainContactName = patch.contacts[0]?.name || null;
          const after = (await r.companies.update(c.id, patch)) ?? c;
          // the central history (M1(a)), in the same transaction: from which hotel, by the company's login, which fields
          const fields = companyFieldsChanged(c, after);
          // a GSTIN change keeps old -> new, masked to the last four (M1(c)); the company's own login may change it
          const gstin = fields.includes("gstin") ? { gstin: { from: maskGstin(c.gstin), to: maskGstin(after.gstin) } } : {};
          if (fields.length > 0) await r.history.record({ kind: "company", profileId: c.id, hotelId: one.hotel.hotelId, byUserId: session.userId, byName: after.mainContactName ?? after.name, via: "portal", fields, at: now(), traceId: meta.traceId, ...gstin });
          return { before: c, after };
        });
        if (JSON.stringify({ ...before, updatedAt: null }) !== JSON.stringify({ ...after, updatedAt: null })) {
          await read(one.session, (ctx, repos) => repos.systemLogs.write(portalLog(one.session, meta, { module: LOG_MODULE, action: "updated", entity: "Company profile", summary: `The company changed its contact details - ${after.name}`, subject: { id: ctx.company.id, label: after.name }, userName: after.name })));
        }
        return companyProfileOf(session, q);
      }
      if (q.hotel === undefined || q.hotel === "" || q.hotel === "all") throw new AppError("VALIDATION_FAILED", "Choose the hotel whose record you are changing.", { fields: { hotel: "Choose the hotel whose record you are changing." } });
      const one = await oneHotel(deps.memberships, session, "company", q.hotel);
      await read(one.session, async (ctx, repos) => {
        const patch: Partial<import("../../repos/companies").CompanyFields> = {};
        if (input.email !== undefined) patch.email = input.email.trim() === "" ? null : input.email.trim();
        if (input.mobile !== undefined) patch.mobileNumber = input.mobile.trim() === "" ? null : input.mobile.trim();
        if (input.landline !== undefined) patch.phoneNumber = input.landline.trim() === "" ? null : input.landline.trim();
        if (input.address !== undefined) patch.address = input.address.trim() === "" ? null : input.address.trim();
        if (input.pincode !== undefined) patch.pincode = input.pincode.trim() === "" ? null : input.pincode.trim();
        if (input.country !== undefined) patch.country = input.country.trim() === "" ? null : input.country.trim();
        if (input.gstin !== undefined) {
          const gst = input.gstin.trim().toUpperCase();
          if (gst !== "" && (await repos.companyProfiles.withGstNumber(gst, ctx.company.id))) throw new AppError("VALIDATION_FAILED", "Another company already has this GST number.", { fields: { gstin: "Another company already has this GST number." } });
          patch.gstNumber = gst === "" ? null : gst;
        }
        if (input.contacts !== undefined) patch.contacts = input.contacts.map((c) => ({ name: c.name.trim(), role: c.role.trim(), email: c.email.trim(), mobile: c.mobile.trim() }));
        if (input.mainContactName !== undefined) {
          const rest = (patch.contacts ?? ctx.company.contacts).slice(1);
          const first = (patch.contacts ?? ctx.company.contacts)[0] ?? { name: "", role: "Main contact", email: "", mobile: "" };
          patch.contacts = [{ ...first, name: input.mainContactName.trim() }, ...rest];
        }
        if (Object.keys(patch).length === 0) return;
        await repos.companyProfiles.update(ctx.company.id, patch, one.session.userId);
        await repos.systemLogs.write(portalLog(one.session, meta, { module: LOG_MODULE, action: "updated", entity: "Company profile", summary: `The company changed its contact details - ${ctx.company.name}`, subject: { id: ctx.company.id, label: ctx.company.name }, userName: ctx.company.name }));
      });
      return companyProfileOf(session, q);
    },
  };
}

export type CorporateService = ReturnType<typeof createCorporateService>;

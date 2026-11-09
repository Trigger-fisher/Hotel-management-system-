import "server-only";
import { billingCopy, GST_SAC, planLabel, typedGstRate, type BillingOptions, type BillList } from "@shared/dashboards/billing";
import type { Kpi } from "@shared/dashboards/common";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import type { AdvanceRecord, BillFields, BillFilter, BillingRepos, BillRecord, DebitSlot } from "../../repos/billing";
import { RepoError } from "../../repos/types";
import { unwrapVersioned } from "../../repos/unwrap";
import { istMoment, monthRange } from "../cash/ist";
import { canUseRecycleBin } from "../../auth/access";
import { createdEntry, deletedEntry, updatedEntry } from "../cash/syslog";
import { advanceLogFields, WHOLE_KEYS } from "./advanceDto";
import { advanceLabel, isUnused } from "./advanceRules";
import { fail } from "./advanceValidate";
import { BILL_EDIT_KEYS, BILL_WHOLE_KEYS, billDto, billLogFields, billPreview, settlementRecorded, SETTLEMENT_HELD_KEYS, SETTLEMENT_KEYS, type BillDto, type BillPreview } from "./billDto";
import { billLabel, debitBalances, excessReceipt, foodTotal, hotelTotal, isDebit, priceStay, rateOn, settleMath, takeAdvance } from "./billRules";
import { validateBill, validateSettle, type BillValues } from "./billValidate";
import { billingKit, BILLS_MODULE as MODULE, type BillingDeps, type WriteCtx } from "./kit";
import type { CompaniesRepos } from "../../repos/companies";
import { maskEmail } from "../../mail/mask";
import { billingQuirks, type BillingQuirks } from "./quirks";
import type { BillCreateInput, BillListInput, BillUpdateInput, SettleBodyInput } from "./schemas";

// Billing, Bills and the debit settlement: the service behind the routes. Every rule cites Pallav in docs/specs/billing-bills.md; the pure
// arithmetic is billRules.ts (golden-tested against real PHP). Each write is ONE unit: the bill, the advance it touches (read FOR UPDATE),
// the excess advance, every system-log and force-log line commit together or not at all. The four quirks MJ is asked about are switches
// (quirks.ts). The hotel comes from the session; another hotel's id is simply not found.

type BillDeps = BillingDeps & { quirks?: BillingQuirks };
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** A bill's own fields before the advance, the balances and the settlement are added (what prepareBill and the check-out work out). */
type BillDraft = Omit<BillFields, "billNumber" | "advanceId" | "advanceReceiptNumber" | "advanceGuestName" | "advanceHotelAmountSnapshot" | "advanceFoodAmountSnapshot" | "advanceDateSnapshot" | "advanceCompanySnapshot" | "advanceHotelAmountPaise" | "advanceFoodAmountPaise" | "advanceDeleteHotelAmountPaise" | "advanceDeleteFoodAmountPaise" | "debit" | "debitHotelAdvance" | "debitFoodAdvance" | "debitReferenceName" | "debitReferenceMobileNumber" | "debitInstruction" | "formattedAdvanceReceiptNumber" | "balanceHotelAmountPaise" | "balanceFoodAmountPaise" | "invoicePdfPath" | "foodInvoicePdfPath" | "hotelSac" | "foodSac">;

const PART = "bills.bills";
const DEBIT_PART = "bills.debit-bills";
const ZERO = BigInt(0);
const EMPTY_SLOT: DebitSlot = { date: null, hotelMode: null, foodMode: null, hotelPaise: null, foodPaise: null };
/** The hotel's GST default while none is set, as the check-out's (stayService.checkoutDefaults). */
const DEFAULT_GST = 5;
/** A stored or typed percent 0..28 as a number; null when absent or not one. */
const pct = (v: string | null | undefined): number | null => {
  const raw = (v ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n >= 0 && n <= 28 ? n : null;
};
/** Pallav keeps the advance's decimals as text in the snapshot ("5000.00"). */
const rupeesText = (p: bigint): string => `${p < ZERO ? "-" : ""}${(p < ZERO ? -p : p) / BigInt(100)}.${String((p < ZERO ? -p : p) % BigInt(100)).padStart(2, "0")}`;

type BillListResult = Omit<BillList, "page"> & { page: { items: BillDto[]; total: number; page: number; pageSize: number } };

export function createBillService(deps: BillDeps) {
  const { unit, catalog, now } = deps;
  const quirks = deps.quirks ?? billingQuirks;
  const kit = billingKit(deps);
  const { actorOf, locked, guard } = kit;
  const subject = (b: BillRecord) => ({ id: b.id, label: billLabel(b.billNumber, b.guestName) });

  async function dtoFor(repos: BillingRepos, rows: BillRecord[]): Promise<BillDto[]> {
    const companies = await repos.companies.names([...new Set(rows.flatMap((b) => (b.companyId ? [b.companyId] : [])))]);
    const stays = await repos.bills.guestsOf(rows.map((b) => b.id));
    return rows.map((b) => billDto(b, companies, stays));
  }

  async function load(repos: BillingRepos, id: string, options: { deleted?: boolean } = {}): Promise<BillRecord> {
    const b = await repos.bills.get(id, { deleted: options.deleted, forUpdate: true });
    if (!b) throw new AppError("NOT_FOUND");
    return b;
  }
  const checkVersion = (row: { version: number }, version: number): void => {
    if (row.version !== version) throw new AppError("CONFLICT", undefined, { currentVersion: row.version });
  };
  const numberTaken = (error: unknown): never => {
    if (error instanceof RepoError && error.kind === "unique") throw fail("billNo", "This bill number already exists.");
    throw error;
  };

  /**
   * prepareBill (:377-403): the lines, the totals worked out from them, the stay priced from the hotel's own meal plan rates. HMS (MJ, 5 Nov 2026):
   * the GST rate is stored with the bill, the rate the typed GST stands for (the bill's own stored rate first on an edit, then the hotel's
   * default at this moment, then the slabs), so a later change of the defaults never changes the bill. The amounts are the typed ones.
   */
  async function prepare(repos: BillingRepos, v: BillValues, was: BillRecord | null) {
    const priced = priceStay(v.stay, await repos.mealPlanRates.table());
    const defaults = await repos.hotelProfile.gstDefaults();
    const hotelRate = typedGstRate(paiseToNumber(v.hotel.roomPaise + v.hotel.planPaise + v.hotel.extraBedPaise + v.hotel.laundryPaise), paiseToNumber(v.hotel.gstPaise), [pct(was?.hotelGstPercent), pct(defaults.hotelPercent) ?? DEFAULT_GST]);
    const foodRate = typedGstRate(paiseToNumber(v.food.foodPaise + v.food.planPaise + v.food.laundryPaise), paiseToNumber(v.food.gstPaise), [pct(was?.foodGstPercent), pct(defaults.foodPercent) ?? DEFAULT_GST]);
    const fields: BillDraft = {
      billDate: v.billDate,
      companyId: v.companyId,
      guestName: v.guestName,
      mobileNumber: v.mobileNumber,
      roomNumber: v.roomNumber,
      grNumber: v.grNumber,
      guestAddress: v.guestAddress,
      guestGstin: v.guestGstin,
      persons: v.persons,
      arrivalAt: v.arrivalAt,
      departureAt: v.departureAt,
      hotelPlan: v.hotelPlan,
      hotelAmountPaise: v.hotel.roomPaise,
      hotelPlanAmountPaise: v.hotel.planPaise,
      hotelExtraBedAmountPaise: v.hotel.extraBedPaise,
      hotelLaundryAmountPaise: v.hotel.laundryPaise,
      hotelOtherAmountPaise: v.hotel.otherPaise,
      hotelGstPaise: v.hotel.gstPaise,
      hotelModeOfPayment: v.hotelMode,
      foodAmountPaise: v.food.foodPaise,
      foodPlanAmountPaise: v.food.planPaise,
      foodLaundryAmountPaise: v.food.laundryPaise,
      foodGstPaise: v.food.gstPaise,
      foodModeOfPayment: v.foodMode,
      totalHotelAmountPaise: hotelTotal(v.hotel),
      totalFoodAmountPaise: foodTotal(v.food),
      referenceName: v.referenceName,
      referenceMobileNumber: v.referenceMobileNumber,
      instruction: v.instruction,
      staySegments: priced.segments.length > 0 ? priced.segments : null,
      planFoodAmountPaise: priced.totalPaise,
      hotelGstPercent: hotelRate === null ? null : String(hotelRate),
      foodGstPercent: foodRate === null ? null : String(foodRate),
    };
    return fields;
  }

  const balancesFor = (f: { hotelModeOfPayment: string | null; foodModeOfPayment: string | null; totalHotelAmountPaise: bigint; totalFoodAmountPaise: bigint }, taken: { hotel: bigint; food: bigint }) =>
    debitBalances({ hotelMode: f.hotelModeOfPayment, foodMode: f.foodModeOfPayment, hotelTotalPaise: f.totalHotelAmountPaise, foodTotalPaise: f.totalFoodAmountPaise, takenHotelPaise: taken.hotel, takenFoodPaise: taken.food, ignoreAdvance: quirks.debitBalanceIgnoresAdvance });

  /** The bill's dates that a settlement fills: Pallav's action dates (BillMasterBill.php:25). */
  const slotDates = (was: readonly DebitSlot[], now: readonly DebitSlot[]) => was.map((s, i) => ({ was: s.date, now: now[i]?.date ?? null }));

  /**
   * THE one place a bill row is written with its advance (Bill Master's create AND the front office's check-out, ruled (f)): takes the
   * advance off (already read FOR UPDATE by the caller), writes the snapshots itself, works out the debit balances, creates the bill. The
   * caller checks numbers, years and permissions, and writes its own log line.
   */
  async function writeBill(repos: BillingRepos, session: VerifiedSession, fields: BillDraft & { billNumber: string }, advance: AdvanceRecord | null): Promise<BillRecord> {
    const taken = advance ? takeAdvance(advance, { hotelPaise: fields.totalHotelAmountPaise, foodPaise: fields.totalFoodAmountPaise }) : { hotelPaise: ZERO, foodPaise: ZERO, hotelLeftPaise: ZERO, foodLeftPaise: ZERO };
    const balances = balancesFor(fields, { hotel: taken.hotelPaise, food: taken.foodPaise });
    if (advance) {
      // only the advance's pending columns change, so a closed year's advance may be used (BillMasterAdvance.php:17-20)
      unwrapVersioned(await repos.advances.update(advance.id, advance.version, { hotelBalancePaise: taken.hotelLeftPaise, foodBalancePaise: taken.foodLeftPaise }, session.userId));
    }
    const companyName = advance?.companyId ? ((await repos.companies.names([advance.companyId])).get(advance.companyId) ?? null) : null;
    return repos.bills
      .create({
        ...fields,
        // the tax codes in force now stay with the bill (MJ, 5 Nov 2026); an edit never rewrites them
        hotelSac: GST_SAC.hotel,
        foodSac: GST_SAC.food,
        advanceId: advance?.id ?? null,
        // the snapshots are written HERE, at the moment the advance is taken off; the input cannot carry them
        advanceReceiptNumber: advance?.receiptNumber ?? null,
        advanceGuestName: advance?.guestName ?? null,
        advanceHotelAmountSnapshot: advance ? rupeesText(advance.hotelAmountPaise) : null,
        advanceFoodAmountSnapshot: advance ? rupeesText(advance.foodAmountPaise) : null,
        advanceDateSnapshot: advance?.paymentDate ?? null,
        advanceCompanySnapshot: companyName,
        advanceHotelAmountPaise: taken.hotelPaise,
        advanceFoodAmountPaise: taken.foodPaise,
        advanceDeleteHotelAmountPaise: taken.hotelPaise,
        advanceDeleteFoodAmountPaise: taken.foodPaise,
        balanceHotelAmountPaise: balances.hotelPaise,
        balanceFoodAmountPaise: balances.foodPaise,
        invoicePdfPath: null,
        foodInvoicePdfPath: null,
        debit: [EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT],
        debitHotelAdvance: null,
        debitFoodAdvance: null,
        debitReferenceName: null,
        debitReferenceMobileNumber: null,
        debitInstruction: null,
        formattedAdvanceReceiptNumber: null,
        createdBy: session.userId,
      })
      .catch(numberTaken);
  }

  return {
    /** For the front office's check-out: the same bill writer, inside the caller's unit (the caller holds the advance row FOR UPDATE). */
    writeBillInUnit: writeBill,

    /** The list screen (BillMasterController::bills, :303-322; bills.blade.php KPIs :80-95). */
    async list(session: VerifiedSession, q: BillListInput): Promise<BillListResult> {
      requirePermission(session, catalog, PART, "view");
      if (q.deleted === "only" && !canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      const month = monthRange(istMoment(now()).date);
      const words = (q.search ?? "").toLowerCase().split(/\s+/).filter((w) => w !== "");
      const filter: BillFilter = { from: q.from, to: q.to, month: q.month, mode: q.mode, company: q.companyId, words, deleted: q.deleted };
      return unit.run(session, async (repos) => {
        const listed = await repos.bills.list({ ...filter, state: q.tab === "all" ? undefined : q.tab, sort: q.sort, dir: q.dir, page: q.page, pageSize: q.pageSize });
        const byState = await repos.bills.countByState(filter);
        const figures = await repos.bills.figures(month.from, month.to);
        const options = await repos.bills.options();
        const names = await repos.companies.names(options.companyIds);
        const kpis: Kpi[] = [
          { id: "count", label: billingCopy.bills.kpi.count, value: figures.monthCount, kind: "count", trend: null, tone: "graphite", icon: "receipt" },
          { id: "billed", label: billingCopy.bills.kpi.billed, value: paiseToNumber(figures.monthBilledPaise), kind: "money", trend: null, tone: "success", icon: "wallet" },
          { id: "due", label: billingCopy.bills.kpi.due, value: paiseToNumber(figures.owedPaise), kind: "money", trend: null, tone: "warning", icon: "clock" },
          { id: "settled", label: billingCopy.bills.kpi.settled, value: paiseToNumber(figures.settledPaise), kind: "money", trend: null, tone: "info", icon: "check" },
        ];
        return {
          page: { items: await dtoFor(repos, listed.rows), total: listed.total, page: q.page, pageSize: q.pageSize },
          counts: { all: byState.paid + byState.due + byState.settled, ...byState },
          kpis,
          options: { modes: options.modes, companies: [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), months: options.months },
          all: figures.all,
        };
      });
    },

    /**
     * The bill form's lists: the hotel's plans (Master Data `hotel_plan`, Pallav _bill-fields.blade.php:13) with TODAY's meal rate per person
     * (meal_plan_rates, IST), and the payment modes (`payment_mode`). Replaces the apps' planRatePaise constant.
     */
    async options(session: VerifiedSession): Promise<BillingOptions> {
      // the bill form's people need these: the Bills part's view (a holder of only the part does not reach the module key)
      requirePermission(session, catalog, PART, "view");
      const today = istMoment(now()).date;
      return unit.run(session, async (repos) => {
        const rates = await repos.mealPlanRates.table();
        const plans = await repos.optionLists.items("hotel_plan");
        const modes = await repos.optionLists.items("payment_mode");
        return {
          plans: plans.map((p) => ({ code: p.value, label: p.label || planLabel(p.value), ratePaise: paiseToNumber(rateOn(rates, p.value, today)) })),
          paymentModes: modes.map((m) => m.value),
        };
      });
    },

    async get(session: VerifiedSession, id: string): Promise<BillDto> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const b = await repos.bills.get(id);
        if (!b) throw new AppError("NOT_FOUND");
        return (await dtoFor(repos, [b]))[0];
      });
    },

    /** The paper's fields as data (MJ: no PDF library). Never the stored invoice file paths. */
    async preview(session: VerifiedSession, id: string): Promise<BillPreview> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const b = await repos.bills.get(id);
        if (!b) throw new AppError("NOT_FOUND");
        const companies = await repos.companies.names(b.companyId ? [b.companyId] : []);
        return billPreview(b, await repos.hotelProfile.header(), companies, await repos.bills.guestsOf([b.id]));
      });
    },

    /**
     * The same bill data for the MAIL WORKER, which has no signed-in person: only the worker calls this, for a mail that a person with the right to see the bill queued
     * (emailInvoice), and the hotel is the mail's own. A bill removed since is not found.
     */
    async previewForMail(hotelId: string, id: string): Promise<BillPreview> {
      return unit.run({ hotelId, userId: "mail-worker" } as unknown as VerifiedSession, async (repos) => {
        const b = await repos.bills.get(id);
        if (!b) throw new AppError("NOT_FOUND");
        const companies = await repos.companies.names(b.companyId ? [b.companyId] : []);
        return billPreview(b, await repos.hotelProfile.header(), companies, await repos.bills.guestsOf([b.id]));
      });
    },

    /**
     * "Email bill": queues the bill as a PDF mail from THIS hotel's own email. Same permission as looking at the bill. The address is the one typed, else the guest's email
     * kept in the hotel's customers (found by the bill's mobile number); no address = 422 on `to`. The PDF is made when the mail is sent, not now. A log line names the
     * bill and a masked address.
     */
    async emailInvoice(session: VerifiedSession, id: string, input: { to?: string }, meta: RequestMeta): Promise<{ queued: true; to: string }> {
      requirePermission(session, catalog, PART, "view");
      if (!deps.mail) throw new AppError("CONFLICT", "Emailing a bill is not available on this server.");
      const mail = deps.mail;
      const actor = (await actorOf(session)).get(session.userId);
      const queued = await unit.run(session, async (repos) => {
        const b = await repos.bills.get(id);
        if (!b) throw new AppError("NOT_FOUND");
        let to = (input.to ?? "").trim().toLowerCase();
        if (to === "" && b.mobileNumber) {
          const customers = (repos as unknown as Partial<Pick<CompaniesRepos, "customers">>).customers;
          to = ((await customers?.byMobile(b.mobileNumber.replace(/\D/g, "").slice(-10)))?.email ?? "").trim().toLowerCase();
        }
        if (to === "") throw new AppError("VALIDATION_FAILED", "Enter the email address to send the bill to.", { fields: { to: "Enter the email address to send the bill to." } });
        if (to.length > 254 || !EMAIL_RE.test(to)) throw new AppError("VALIDATION_FAILED", "Enter a valid email address.", { fields: { to: "Enter a valid email address." } });
        const header = await repos.hotelProfile.header();
        await repos.systemLogs.write(updatedEntry(kit.logCtx({ session, meta, actor }), "Bill", subject(b), {}, { "Invoice emailed to": maskEmail(to) }, MODULE));
        return { to, number: b.billNumber, hotelName: header.name, guestName: b.guestName };
      });
      await mail.queue({ kind: "bill_invoice", hotelId: session.hotelId, toEmail: queued.to, payload: { name: queued.guestName, hotelName: queued.hotelName, number: queued.number, billId: id } });
      return { queued: true, to: queued.to };
    },

    /** storeBill (:405-454). */
    async create(session: VerifiedSession, input: BillCreateInput, meta: RequestMeta): Promise<BillDto> {
      requirePermission(session, catalog, PART, "create");
      const actor = (await actorOf(session)).get(session.userId);
      const moment = istMoment(now());
      const force = kit.force(session);
      return unit.run(session, async (repos) => {
        const f: WriteCtx = { repos, session, meta, actor };
        const v = await validateBill(input, { isNew: true, force, today: moment.date, companyExists: (cid) => repos.companies.exists(cid) });
        const billNumber = `${moment.date.slice(0, 4)} / ${v.billTyped}`;
        if (await repos.bills.byNumber(billNumber)) throw fail("billNo", "This bill number already exists.");
        const fields = await prepare(repos, v, null);

        // the advance taken off (:416-441): read FOR UPDATE, so two bills cannot spend the same balance
        let advance: AdvanceRecord | null = null;
        if (input.advanceId !== null) {
          // HMS deviation (§11.2): a missing OR recycle-binned advance is refused with the `exists` message
          advance = await repos.advances.get(input.advanceId, { forUpdate: true });
          if (!advance) throw fail("advanceId", "The selected advance id is invalid.");
          if (advance.hotelBalancePaise + advance.foodBalancePaise <= ZERO) throw fail("advanceId", `Advance ${advance.receiptNumber} has nothing left to take off.`);
        }
        await guard({ years: await repos.accountingYears.list(), was: null, now: v.billDate, action: "save" }, "billDate", f);
        const created = await writeBill(repos, session, { ...fields, billNumber }, advance);
        await repos.systemLogs.write(createdEntry(kit.logCtx(f), "Bill", subject(created), billLogFields(created, BILL_WHOLE_KEYS), MODULE));
        return (await dtoFor(repos, [created]))[0];
      });
    },

    /** updateBill (:456-476). The advance taken off is not re-applied; advanceId and billNo are ignored (§11.6). */
    async update(session: VerifiedSession, id: string, input: BillUpdateInput, meta: RequestMeta): Promise<BillDto> {
      requirePermission(session, catalog, PART, "edit");
      const actor = (await actorOf(session)).get(session.userId);
      const moment = istMoment(now());
      const force = kit.force(session);
      return unit.run(session, async (repos) => {
        const f: WriteCtx = { repos, session, meta, actor };
        const b = await load(repos, id);
        if (await locked(settlementRecorded(b), "A debit bill has already been generated for", f)) {
          throw new AppError("CONFLICT", "A debit bill has already been generated for this bill; it cannot be edited.");
        }
        checkVersion(b, input.version);
        const v = await validateBill(input, { isNew: false, force, today: moment.date, companyExists: (cid) => repos.companies.exists(cid) });
        const fields = await prepare(repos, v, b);
        const balances = balancesFor(fields, { hotel: b.advanceHotelAmountPaise, food: b.advanceFoodAmountPaise });
        await guard({ years: await repos.accountingYears.list(), was: b.billDate, now: v.billDate, action: "save", pending: { onlyPendingChanged: false, actionDates: [] } }, "billDate", f);
        const updated = unwrapVersioned(await repos.bills.update(b.id, input.version, { ...fields, balanceHotelAmountPaise: balances.hotelPaise, balanceFoodAmountPaise: balances.foodPaise }, session.userId));
        await repos.systemLogs.write(updatedEntry(kit.logCtx(f), "Bill", subject(updated), billLogFields(b, BILL_EDIT_KEYS, true), billLogFields(updated, BILL_EDIT_KEYS, true), MODULE));
        return (await dtoFor(repos, [updated]))[0];
      });
    },

    /** destroyBill (:478-496): the advance gets back what this bill took, then the bill goes to the recycle bin. */
    async remove(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, PART, "full");
      const actor = (await actorOf(session)).get(session.userId);
      return unit.run(session, async (repos) => {
        const f: WriteCtx = { repos, session, meta, actor };
        const b = await load(repos, id);
        if (await locked(settlementRecorded(b), "A debit bill has already been generated for", f)) {
          throw new AppError("CONFLICT", "A debit bill has already been generated for this bill; it cannot be deleted.");
        }
        checkVersion(b, version);
        await guard({ years: await repos.accountingYears.list(), was: b.billDate, now: null, action: "delete" }, "billDate", f);
        if (b.advanceId) {
          const advance = await repos.advances.get(b.advanceId, { forUpdate: true });
          // a recycle-binned advance is skipped, as Pallav's find() skips it
          if (advance) {
            unwrapVersioned(await repos.advances.update(advance.id, advance.version, { hotelBalancePaise: advance.hotelBalancePaise + b.advanceDeleteHotelAmountPaise, foodBalancePaise: advance.foodBalancePaise + b.advanceDeleteFoodAmountPaise }, session.userId));
          }
        }
        unwrapVersioned(await repos.bills.softDelete(b.id, version, session.userId));
        await repos.systemLogs.write(deletedEntry(kit.logCtx(f), "Bill", subject(b), billLogFields(b, BILL_WHOLE_KEYS), MODULE));
        return { id: b.id };
      });
    },

    /** storeDebitBill (:502-572): up to five instalments; an overpayment becomes an "Excessive / {bill}" advance. */
    async settle(session: VerifiedSession, id: string, input: SettleBodyInput, meta: RequestMeta): Promise<BillDto> {
      requirePermission(session, catalog, DEBIT_PART, "create");
      const actor = (await actorOf(session)).get(session.userId);
      const moment = istMoment(now());
      const force = kit.force(session);
      return unit.run(session, async (repos) => {
        const f: WriteCtx = { repos, session, meta, actor };
        const b = await load(repos, id);
        // H6 part payments: a settlement that left money owing takes further instalments (five in all); one that cleared the bill is final
        const recorded = settlementRecorded(b);
        const stillOwed = b.balanceHotelAmountPaise + b.balanceFoodAmountPaise > ZERO;
        if (await locked(recorded && !stillOwed, "Debit bill already recorded for this bill", f)) throw new AppError("CONFLICT", "Debit bill already recorded for this bill.");
        checkVersion(b, input.version);
        // quirk (b): Pallav lets a bill with no side on Debit be "settled"
        if (!quirks.settleNonDebitMakesExcess && !isDebit(b.hotelModeOfPayment) && !isDebit(b.foodModeOfPayment)) throw new AppError("CONFLICT", "This bill is not on debit.");
        const s = validateSettle(input, { force, today: moment.date });
        const kept = recorded ? b.debit.filter((slot) => slot.date !== null) : [];
        if (kept.length + s.slots.length > 5) throw new AppError("VALIDATION_FAILED", "Some details need fixing. Check the highlighted fields.", { fields: { installments: `Up to five installments in all; ${kept.length} already recorded.` } });
        const paid = s.slots.reduce((t, slot) => ({ hotelPaise: t.hotelPaise + (slot.hotelPaise ?? ZERO), foodPaise: t.foodPaise + (slot.foodPaise ?? ZERO) }), { hotelPaise: ZERO, foodPaise: ZERO });
        const math = settleMath({ hotelPaise: b.balanceHotelAmountPaise, foodPaise: b.balanceFoodAmountPaise }, paid);
        const merged = [...kept, ...s.slots];
        const slots = [0, 1, 2, 3, 4].map((i) => merged[i] ?? EMPTY_SLOT) as BillFields["debit"];
        // a further payment keeps the reference already written unless a new one is typed
        const referenceName = s.referenceName ?? (recorded ? b.debitReferenceName : null);
        const referenceMobileNumber = s.referenceMobileNumber ?? (recorded ? b.debitReferenceMobileNumber : null);
        const instruction = s.instruction ?? (recorded ? b.debitInstruction : null);
        const excess = math.excessHotelPaise > ZERO || math.excessFoodPaise > ZERO;
        const receipt = excess ? excessReceipt(b.billNumber) : null;
        await guard({ years: await repos.accountingYears.list(), was: b.billDate, now: b.billDate, action: "save", pending: { onlyPendingChanged: true, actionDates: slotDates(b.debit, slots) } }, "date", f);

        const settled = unwrapVersioned(
          await repos.bills.update(b.id, input.version, {
            debit: slots,
            debitReferenceName: referenceName,
            debitReferenceMobileNumber: referenceMobileNumber,
            debitInstruction: instruction,
            debitHotelAdvance: math.hotelAdvanceText,
            debitFoodAdvance: math.foodAdvanceText,
            balanceHotelAmountPaise: math.hotelLeftPaise,
            balanceFoodAmountPaise: math.foodLeftPaise,
            ...(receipt ? { formattedAdvanceReceiptNumber: receipt } : {}),
          }, session.userId),
        );
        await repos.systemLogs.write(createdEntry(kit.logCtx(f), recorded ? "Debit bill payment" : "Debit bill settlement", subject(settled), billLogFields(settled, SETTLEMENT_KEYS), MODULE));

        if (receipt) {
          // quirk (d): Pallav dates it the day it is recorded; corrected: the last instalment's date
          const lastDate = [...s.slots].reverse().find((slot) => slot.date !== null)?.date ?? moment.date;
          const paymentDate = quirks.excessAdvanceDatedToday ? moment.date : lastDate;
          await guard({ years: await repos.accountingYears.list(), was: null, now: paymentDate, action: "save" }, "date", f);
          const made = await repos.advances
            .create({
              receiptNumber: receipt,
              guestName: b.guestName,
              mobileNumber: b.mobileNumber,
              roomNumber: null,
              companyId: b.companyId,
              reservationId: null,
              paymentDate,
              hotelAmountPaise: math.excessHotelPaise,
              foodAmountPaise: math.excessFoodPaise,
              hotelMode: null,
              foodMode: null,
              referenceName: null,
              referenceMobileNumber: null,
              instruction: null,
              hotelBalancePaise: math.excessHotelPaise,
              foodBalancePaise: math.excessFoodPaise,
              totalPaise: math.excessHotelPaise + math.excessFoodPaise,
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
              if (error instanceof RepoError && error.kind === "unique") throw new AppError("CONFLICT", `An advance numbered ${receipt} already exists.`);
              throw error;
            });
          await repos.systemLogs.write(createdEntry(kit.logCtx(f), "Advance", { id: made.id, label: advanceLabel(made.receiptNumber, made.guestName) }, advanceLogFields(made, WHOLE_KEYS), MODULE));
        }
        return (await dtoFor(repos, [settled]))[0];
      });
    },

    /** destroyDebitBill (:574-610): the settlement is undone, the overpayment's advance(s) deleted. */
    async reverseSettlement(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<BillDto> {
      requirePermission(session, catalog, DEBIT_PART, "full");
      const actor = (await actorOf(session)).get(session.userId);
      return unit.run(session, async (repos) => {
        const f: WriteCtx = { repos, session, meta, actor };
        const b = await load(repos, id);
        // HMS deviation (§11.4)
        if (!settlementRecorded(b)) throw new AppError("CONFLICT", "This bill has no settlement to reverse.");
        checkVersion(b, version);
        const excess = b.formattedAdvanceReceiptNumber ? await repos.advances.allByReceipt(b.formattedAdvanceReceiptNumber) : [];
        // HMS deviation (§11.5): nothing is undone if the overpayment's advance was already used; checked before any change
        for (const a of excess) {
          const fresh = await repos.advances.get(a.id, { forUpdate: true });
          if (fresh && !isUnused(fresh)) throw new AppError("CONFLICT", "The advance made from the overpayment has already been used.");
        }
        const empty = [EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT] as BillFields["debit"];
        await guard({ years: await repos.accountingYears.list(), was: b.billDate, now: b.billDate, action: "save", pending: { onlyPendingChanged: true, actionDates: slotDates(b.debit, empty) } }, "date", f);

        for (const a of excess) {
          await guard({ years: await repos.accountingYears.list(), was: a.paymentDate, now: null, action: "delete" }, "date", f);
          unwrapVersioned(await repos.advances.softDelete(a.id, a.version, session.userId));
          await repos.systemLogs.write(deletedEntry(kit.logCtx(f), "Advance", { id: a.id, label: advanceLabel(a.receiptNumber, a.guestName) }, advanceLogFields(a, WHOLE_KEYS), MODULE));
        }
        // quirk (c): Pallav puts both totals back as owed, even on a side not on Debit (a total below zero stays at zero: the balance CHECK)
        const reset = quirks.reverseResetsNonDebit
          ? { hotelPaise: b.totalHotelAmountPaise < ZERO ? ZERO : b.totalHotelAmountPaise, foodPaise: b.totalFoodAmountPaise < ZERO ? ZERO : b.totalFoodAmountPaise }
          : balancesFor(b, { hotel: b.advanceHotelAmountPaise, food: b.advanceFoodAmountPaise });
        const updated = unwrapVersioned(
          await repos.bills.update(b.id, version, {
            debit: empty,
            formattedAdvanceReceiptNumber: null,
            debitHotelAdvance: null,
            debitFoodAdvance: null,
            debitReferenceName: null,
            debitReferenceMobileNumber: null,
            debitInstruction: null,
            balanceHotelAmountPaise: reset.hotelPaise,
            balanceFoodAmountPaise: reset.foodPaise,
          }, session.userId),
        );
        await repos.systemLogs.write(deletedEntry(kit.logCtx(f), "Debit bill settlement", subject(b), billLogFields(b, SETTLEMENT_HELD_KEYS), MODULE));
        return (await dtoFor(repos, [updated]))[0];
      });
    },

    /** Recycle bin (canUseRecycleBin). Restoring re-takes the advance money the delete gave back, or is refused (§11.8). */
    async restore(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<BillDto> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      const actor = (await actorOf(session)).get(session.userId);
      return unit.run(session, async (repos) => {
        const b = await load(repos, id, { deleted: true });
        checkVersion(b, version);
        // HMS deviation (§11.8, ruled): the delete gave the advance its money back, so a restore takes it again in the SAME unit, or is refused;
        // money is never counted twice (Pallav's restore puts the row back and nothing else)
        if (b.advanceId && (b.advanceDeleteHotelAmountPaise > ZERO || b.advanceDeleteFoodAmountPaise > ZERO)) {
          const advance = await repos.advances.get(b.advanceId, { forUpdate: true });
          if (!advance || advance.hotelBalancePaise < b.advanceDeleteHotelAmountPaise || advance.foodBalancePaise < b.advanceDeleteFoodAmountPaise) {
            throw new AppError("CONFLICT", "The advance no longer has enough left to restore this bill.");
          }
          unwrapVersioned(await repos.advances.update(advance.id, advance.version, { hotelBalancePaise: advance.hotelBalancePaise - b.advanceDeleteHotelAmountPaise, foodBalancePaise: advance.foodBalancePaise - b.advanceDeleteFoodAmountPaise }, session.userId));
        }
        const restored = unwrapVersioned(await repos.bills.restore(b.id, version, session.userId).catch(numberTaken));
        await repos.systemLogs.write(createdEntry(kit.logCtx({ session, meta, actor }), "Bill", subject(restored), { "Restored by": actor?.name ?? "System" }, "recycle-bin"));
        return (await dtoFor(repos, [restored]))[0];
      });
    },

    async purge(session: VerifiedSession, id: string): Promise<{ id: string }> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      return unit.run(session, async (repos) => {
        if (!(await repos.bills.purge(id))) throw new AppError("NOT_FOUND");
        return { id };
      });
    },
  };
}

export type BillService = ReturnType<typeof createBillService>;

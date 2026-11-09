import "server-only";
import { billingCopy, type AdvanceList, type AdvancePreview } from "@shared/dashboards/billing";
import type { Kpi } from "@shared/dashboards/common";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import { amountInWords } from "../../money/words";
import type { AdvanceFilter, AdvanceRecord, BillingRepos } from "../../repos/billing";
import { RepoError } from "../../repos/types";
import { unwrapVersioned } from "../../repos/unwrap";
import { istMoment, monthRange } from "../cash/ist";
import { canUseRecycleBin } from "../../auth/access";
import { canManage } from "../cash/rules";
import { createdEntry, deletedEntry, updatedEntry } from "../cash/syslog";
import { advanceDto, advanceLogFields, EDIT_KEYS, REFUND_HELD_KEYS, REFUND_KEYS, WHOLE_KEYS, type AdvanceDto } from "./advanceDto";
import { advanceLabel, advanceSides, isRefunded, isUnused, receiptNumber, refundMath, reversalMath } from "./advanceRules";
import { fail, validateAdvance, validateRefund } from "./advanceValidate";
import { billingKit, BILLS_MODULE as MODULE, type BillingDeps, type WriteCtx } from "./kit";
import { maskEmail } from "../../mail/mask";
import type { CompaniesRepos } from "../../repos/companies";
import type { AdvanceCreateInput, AdvanceListInput, AdvanceUpdateInput, RefundBodyInput } from "./schemas";

// Billing, Guest Advances: the service behind the routes. Every rule cites Pallav in docs/specs/billing-advances.md; the pure arithmetic is
// in advanceRules.ts (golden-tested against real PHP). Each write is ONE unit: the change, its system-log line and any force-log line commit
// together or not at all. The hotel comes from the session; another hotel's id is simply not found.

export type AdvanceDeps = BillingDeps;

const PART = "bills.advances";
const OPEN_LIMIT = 200;
const ZERO = BigInt(0);

type AdvanceListResult = Omit<AdvanceList, "page"> & { page: { items: AdvanceDto[]; total: number; page: number; pageSize: number } };

export function createAdvanceService(deps: AdvanceDeps) {
  const { unit, catalog, now } = deps;

  const kit = billingKit(deps);
  const { actorOf, locked, guard } = kit;
  const forceOn = (session: VerifiedSession): boolean => kit.force(session);
  const logCtx = (session: VerifiedSession, meta: RequestMeta, actor: WriteCtx["actor"]) => kit.logCtx({ session, meta, actor });
  const subject = (a: AdvanceRecord) => ({ id: a.id, label: advanceLabel(a.receiptNumber, a.guestName) });

  async function dtoFor(repos: BillingRepos, rows: AdvanceRecord[]): Promise<AdvanceDto[]> {
    const companies = await repos.companies.names([...new Set(rows.flatMap((a) => (a.companyId ? [a.companyId] : [])))]);
    const usedOn = await repos.bills.numbersByAdvance(rows.map((a) => a.id));
    return rows.map((a) => advanceDto(a, { companies, usedOn }));
  }

  /** A unique index refused the row (a receipt number taken by a restored or concurrent advance). */
  const receiptTaken = (error: unknown): never => {
    if (error instanceof RepoError && error.kind === "unique") throw fail("receiptNo", "This receipt number already exists.");
    throw error;
  };

  async function load(repos: BillingRepos, id: string, options: { deleted?: boolean } = {}): Promise<AdvanceRecord> {
    const a = await repos.advances.get(id, { deleted: options.deleted, forUpdate: true });
    if (!a) throw new AppError("NOT_FOUND");
    return a;
  }
  const checkVersion = (a: AdvanceRecord, version: number): void => {
    if (a.version !== version) throw new AppError("CONFLICT", undefined, { currentVersion: a.version });
  };

  return {
    /** The list screen (BillMasterController::advances, :117-130) with the filters, tabs and figures of ui-shared AdvanceList. */
    async list(session: VerifiedSession, q: AdvanceListInput): Promise<AdvanceListResult> {
      requirePermission(session, catalog, PART, "view");
      if (q.deleted === "only" && !canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      const month = monthRange(istMoment(now()).date);
      const words = (q.search ?? "").toLowerCase().split(/\s+/).filter((w) => w !== "");
      const filter: AdvanceFilter = { from: q.from, to: q.to, month: q.month, mode: q.mode, company: q.companyId, words, deleted: q.deleted };
      return unit.run(session, async (repos) => {
        const listed = await repos.advances.list({ ...filter, state: q.tab === "all" ? undefined : q.tab, sort: q.sort, dir: q.dir, page: q.page, pageSize: q.pageSize });
        const byState = await repos.advances.countByState(filter);
        const figures = await repos.advances.figures(month.from, month.to);
        const options = await repos.advances.options();
        const names = await repos.companies.names(options.companyIds);
        const kpis: Kpi[] = [
          { id: "month", label: billingCopy.advances.kpi.month, value: paiseToNumber(figures.monthTakenPaise), kind: "money", trend: null, tone: "graphite", icon: "wallet" },
          { id: "held", label: billingCopy.advances.kpi.held, value: paiseToNumber(figures.heldPaise), kind: "money", trend: null, tone: "success", icon: "lock" },
          { id: "unused", label: billingCopy.advances.kpi.unused, value: figures.unusedCount, kind: "count", trend: null, tone: "warning", icon: "clock" },
          { id: "refunded", label: billingCopy.advances.kpi.refunded, value: paiseToNumber(figures.refundedPaise), kind: "money", trend: null, tone: "danger", icon: "arrowUp" },
        ];
        return {
          page: { items: await dtoFor(repos, listed.rows), total: listed.total, page: q.page, pageSize: q.pageSize },
          counts: { all: byState.unused + byState.partly + byState.used + byState.refunded, ...byState },
          kpis,
          options: {
            modes: options.modes,
            companies: [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
            months: options.months,
          },
          all: figures.all,
        };
      });
    },

    async get(session: VerifiedSession, id: string): Promise<AdvanceDto> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const a = await repos.advances.get(id);
        if (!a) throw new AppError("NOT_FOUND");
        return (await dtoFor(repos, [a]))[0];
      });
    },

    /** The advance receipt as data (Pallav's receipt fields; MJ: no PDF library). A recycle-binned one only for recycle-bin users. */
    async preview(session: VerifiedSession, id: string): Promise<AdvancePreview> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const a = (await repos.advances.get(id)) ?? (canUseRecycleBin(session) ? await repos.advances.get(id, { deleted: true }) : null);
        if (!a) throw new AppError("NOT_FOUND");
        const header = await repos.hotelProfile.header();
        return {
          // the hotel's and the food business's GSTIN are hotel settings (MJ #20 A)
          header: { name: header.name, foodName: header.foodName, address: header.address ?? "", phone: header.phone ?? "", gstin: header.gstin, foodGstin: header.foodGstin },
          advance: (await dtoFor(repos, [a]))[0],
          amountWords: amountInWords(a.hotelAmountPaise + a.foodAmountPaise),
        };
      });
    },

    /** The receipt data for the MAIL WORKER (no signed-in person): only the worker calls it, for a mail queued by emailReceipt. A removed advance is not found. */
    async previewForMail(hotelId: string, id: string): Promise<AdvancePreview> {
      return unit.run({ hotelId, userId: "mail-worker" } as unknown as VerifiedSession, async (repos) => {
        const a = await repos.advances.get(id);
        if (!a) throw new AppError("NOT_FOUND");
        const header = await repos.hotelProfile.header();
        return {
          header: { name: header.name, foodName: header.foodName, address: header.address ?? "", phone: header.phone ?? "", gstin: header.gstin, foodGstin: header.foodGstin },
          advance: (await dtoFor(repos, [a]))[0],
          amountWords: amountInWords(a.hotelAmountPaise + a.foodAmountPaise),
        };
      });
    },

    /** "Email receipt": queues the advance receipt as a PDF mail from THIS hotel's own email. Same permission and address rules as emailing a bill (services/billing/billService.ts). */
    async emailReceipt(session: VerifiedSession, id: string, input: { to?: string }, meta: RequestMeta): Promise<{ queued: true; to: string }> {
      requirePermission(session, catalog, PART, "view");
      if (!deps.mail) throw new AppError("CONFLICT", "Emailing a receipt is not available on this server.");
      const mail = deps.mail;
      const actor = (await kit.actorOf(session)).get(session.userId);
      const queued = await unit.run(session, async (repos) => {
        const a = await repos.advances.get(id);
        if (!a) throw new AppError("NOT_FOUND");
        let to = (input.to ?? "").trim().toLowerCase();
        if (to === "" && a.mobileNumber) {
          const customers = (repos as unknown as Partial<Pick<CompaniesRepos, "customers">>).customers;
          to = ((await customers?.byMobile(a.mobileNumber.replace(/\D/g, "").slice(-10)))?.email ?? "").trim().toLowerCase();
        }
        if (to === "") throw new AppError("VALIDATION_FAILED", "Enter the email address to send the receipt to.", { fields: { to: "Enter the email address to send the receipt to." } });
        if (to.length > 254 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(to)) throw new AppError("VALIDATION_FAILED", "Enter a valid email address.", { fields: { to: "Enter a valid email address." } });
        const header = await repos.hotelProfile.header();
        await repos.systemLogs.write(updatedEntry(kit.logCtx({ session, meta, actor }), "Advance", { id: a.id, label: advanceLabel(a.receiptNumber, a.guestName) }, {}, { "Receipt emailed to": maskEmail(to) }, MODULE));
        return { to, number: a.receiptNumber, hotelName: header.name, guestName: a.guestName };
      });
      await mail.queue({ kind: "advance_receipt", hotelId: session.hotelId, toEmail: queued.to, payload: { name: queued.guestName, hotelName: queued.hotelName, number: queued.number, advanceId: id } });
      return { queued: true, to: queued.to };
    },

    /** Advances with money left, by guest name: the bill's "take off an advance" picker (:315-318). */
    async open(session: VerifiedSession): Promise<AdvanceDto[]> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => dtoFor(repos, await repos.advances.open(OPEN_LIMIT)));
    },

    /** storeAdvance (:132-167). */
    async create(session: VerifiedSession, input: AdvanceCreateInput, meta: RequestMeta): Promise<AdvanceDto> {
      requirePermission(session, catalog, PART, "create");
      const directory = await actorOf(session);
      const actor = directory.get(session.userId);
      const moment = istMoment(now());
      const force = forceOn(session);
      return unit.run(session, async (repos) => {
        const v = await validateAdvance(input, { isNew: true, force, today: moment.date, companyExists: (cid) => repos.companies.exists(cid) });
        const receipt = receiptNumber(moment.date.slice(0, 4), v.receiptTyped);
        if (await repos.advances.byReceipt(receipt)) throw fail("receiptNo", "This receipt number already exists.");
        const sides = advanceSides({ covers: input.covers, hotelPaise: v.hotelPaise, foodPaise: v.foodPaise, hotelMode: v.hotelMode, foodMode: v.foodMode });
        if (!sides.paid) throw fail("hotelPaise", "Enter how much the guest paid.");
        const f = { repos, session, meta, actor };
        await guard({ years: await repos.accountingYears.list(), was: null, now: v.paymentDate, action: "save" }, "paymentDate", f);

        const created = await repos.advances
          .create({
            receiptNumber: receipt,
            guestName: v.guestName,
            mobileNumber: v.mobileNumber,
            roomNumber: v.roomNumber,
            companyId: v.companyId,
            reservationId: null,
            paymentDate: v.paymentDate,
            hotelAmountPaise: sides.hotelAmountPaise,
            foodAmountPaise: sides.foodAmountPaise,
            hotelMode: sides.hotelMode,
            foodMode: sides.foodMode,
            referenceName: v.referenceName,
            referenceMobileNumber: v.referenceMobileNumber,
            instruction: v.instruction,
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
          .catch(receiptTaken);
        await repos.systemLogs.write(createdEntry(logCtx(session, meta, actor), "Advance", subject(created), advanceLogFields(created, WHOLE_KEYS), MODULE));
        return (await dtoFor(repos, [created]))[0];
      });
    },

    /** updateAdvance (:188-219). */
    async update(session: VerifiedSession, id: string, input: AdvanceUpdateInput, meta: RequestMeta): Promise<AdvanceDto> {
      requirePermission(session, catalog, PART, "edit");
      const directory = await actorOf(session);
      const actor = directory.get(session.userId);
      const moment = istMoment(now());
      const force = forceOn(session);
      return unit.run(session, async (repos) => {
        const a = await load(repos, id);
        const f = { repos, session, meta, actor };
        if (await locked(!isUnused(a) || isRefunded(a), "This advance has already been used or refunded", f)) {
          throw new AppError("CONFLICT", "This advance has already been used or refunded and cannot be edited.");
        }
        checkVersion(a, input.version);
        const v = await validateAdvance(input, { isNew: false, force, today: moment.date, companyExists: (cid) => repos.companies.exists(cid) });
        const sides = advanceSides({ covers: input.covers, hotelPaise: v.hotelPaise, foodPaise: v.foodPaise, hotelMode: v.hotelMode, foodMode: v.foodMode });
        if (!sides.paid) throw fail("hotelPaise", "Enter how much the guest paid.");
        // an edit always touches more than the pending columns, so a closed year's advance cannot be edited
        await guard({ years: await repos.accountingYears.list(), was: a.paymentDate, now: v.paymentDate, action: "save", pending: { onlyPendingChanged: false, actionDates: [] } }, "paymentDate", f);

        const updated = unwrapVersioned(
          await repos.advances.update(a.id, input.version, {
            guestName: v.guestName,
            mobileNumber: v.mobileNumber,
            roomNumber: v.roomNumber,
            companyId: v.companyId,
            paymentDate: v.paymentDate,
            hotelAmountPaise: sides.hotelAmountPaise,
            foodAmountPaise: sides.foodAmountPaise,
            hotelMode: sides.hotelMode,
            foodMode: sides.foodMode,
            referenceName: v.referenceName,
            referenceMobileNumber: v.referenceMobileNumber,
            instruction: v.instruction,
            hotelBalancePaise: sides.hotelBalancePaise,
            foodBalancePaise: sides.foodBalancePaise,
            totalPaise: sides.totalPaise,
          }, session.userId),
        );
        await repos.systemLogs.write(updatedEntry(logCtx(session, meta, actor), "Advance", subject(updated), advanceLogFields(a, EDIT_KEYS, true), advanceLogFields(updated, EDIT_KEYS, true), MODULE));
        return (await dtoFor(repos, [updated]))[0];
      });
    },

    /** destroyAdvance (:221-237): to the recycle bin. */
    async remove(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, PART, "full");
      return unit.run(session, async (repos) => {
        const a = await load(repos, id);
        const directory = await actorOf(session, [a.createdBy]);
        const actor = directory.get(session.userId);
        const f = { repos, session, meta, actor };
        if (await locked(!canManage(session, catalog, a.createdBy ? (directory.get(a.createdBy) ?? null) : null), "Not allowed to delete this record", f)) {
          throw new AppError("FORBIDDEN", "Not allowed to delete this record.");
        }
        if (await locked(!isUnused(a), "This advance has already been partly used and", f)) {
          throw new AppError("CONFLICT", "This advance has already been partly used and cannot be deleted.");
        }
        checkVersion(a, version);
        await guard({ years: await repos.accountingYears.list(), was: a.paymentDate, now: null, action: "delete" }, "paymentDate", f);
        unwrapVersioned(await repos.advances.softDelete(a.id, version, session.userId));
        await repos.systemLogs.write(deletedEntry(logCtx(session, meta, actor), "Advance", subject(a), advanceLogFields(a, WHOLE_KEYS), MODULE));
        return { id: a.id };
      });
    },

    /** refundAdvance (:239-272). */
    async refund(session: VerifiedSession, id: string, input: RefundBodyInput, meta: RequestMeta): Promise<AdvanceDto> {
      requirePermission(session, catalog, PART, "edit");
      const directory = await actorOf(session);
      const actor = directory.get(session.userId);
      const moment = istMoment(now());
      const force = forceOn(session);
      return unit.run(session, async (repos) => {
        const a = await load(repos, id);
        const f = { repos, session, meta, actor };
        if (await locked(isRefunded(a), "This advance has already been refunded", f)) throw new AppError("CONFLICT", "This advance has already been refunded.");
        checkVersion(a, input.version);
        const r = validateRefund(input, { force, today: moment.date });
        const math = refundMath(a, { hotelPaise: r.hotelRefundAmountPaise, foodPaise: r.foodRefundAmountPaise });
        // HMS deviation: refused even under force, the balance never goes below zero (docs/specs/billing-advances.md §6, §11)
        if (math.overBalance) {
          const field = (r.hotelRefundAmountPaise ?? ZERO) > a.hotelBalancePaise ? "hotelPaise" : "foodPaise";
          throw fail(field, "Refund amount cannot exceed the available advance balance.");
        }
        await guard(
          { years: await repos.accountingYears.list(), was: a.paymentDate, now: a.paymentDate, action: "save", pending: { onlyPendingChanged: true, actionDates: [{ was: a.refundPaymentDate, now: r.refundPaymentDate }] } },
          "date",
          f,
        );
        const updated = unwrapVersioned(await repos.advances.update(a.id, input.version, { ...r, hotelBalancePaise: math.hotelBalancePaise, foodBalancePaise: math.foodBalancePaise, totalPaise: math.totalPaise }, session.userId));
        await repos.systemLogs.write(createdEntry(logCtx(session, meta, actor), "Advance refund", subject(updated), advanceLogFields(updated, REFUND_KEYS), MODULE));
        return (await dtoFor(repos, [updated]))[0];
      });
    },

    /** destroyRefund (:274-297): the refund goes back onto the balances. */
    async undoRefund(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<AdvanceDto> {
      requirePermission(session, catalog, PART, "full");
      const directory = await actorOf(session);
      const actor = directory.get(session.userId);
      return unit.run(session, async (repos) => {
        const a = await load(repos, id);
        // HMS deviation: Pallav adds 0 and still logs a reversal; here there must be a refund to reverse
        if (!isRefunded(a)) throw new AppError("CONFLICT", "This advance has no refund to reverse.");
        checkVersion(a, version);
        const back = reversalMath(a);
        await guard(
          { years: await repos.accountingYears.list(), was: a.paymentDate, now: a.paymentDate, action: "save", pending: { onlyPendingChanged: true, actionDates: [{ was: a.refundPaymentDate, now: null }] } },
          "date",
          { repos, session, meta, actor },
        );
        const updated = unwrapVersioned(
          await repos.advances.update(a.id, version, {
            ...back,
            hotelRefundAmountPaise: null,
            foodRefundAmountPaise: null,
            hotelRefundMode: null,
            foodRefundMode: null,
            refundPaymentDate: null,
            refundGuestName: null,
            refundMobileNumber: null,
            refundInstruction: null,
          }, session.userId),
        );
        await repos.systemLogs.write(deletedEntry(logCtx(session, meta, actor), "Advance refund", subject(a), advanceLogFields(a, REFUND_HELD_KEYS), MODULE));
        return (await dtoFor(repos, [updated]))[0];
      });
    },

    /** Recycle bin: the hotel's SuperAdmin role only (Pallav RecycleBinController). */
    async restore(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<AdvanceDto> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      const directory = await actorOf(session);
      const actor = directory.get(session.userId);
      return unit.run(session, async (repos) => {
        const a = await load(repos, id, { deleted: true });
        checkVersion(a, version);
        // HMS (ruled): what live bills took off it, its balance and its refund may never add up to more than it was paid (no money twice)
        const taken = await repos.bills.takenFromAdvance(a.id);
        const held = (amount: bigint, balance: bigint, refund: bigint | null, used: bigint): boolean => used + balance + (refund ?? ZERO) <= amount;
        if (!held(a.hotelAmountPaise, a.hotelBalancePaise, a.hotelRefundAmountPaise, taken.hotelPaise) || !held(a.foodAmountPaise, a.foodBalancePaise, a.foodRefundAmountPaise, taken.foodPaise)) {
          throw new AppError("CONFLICT", "The bills that used this advance now claim more than it holds.");
        }
        const restored = unwrapVersioned(await repos.advances.restore(a.id, version, session.userId).catch(receiptTaken));
        await repos.systemLogs.write(createdEntry(logCtx(session, meta, actor), "Advance", subject(restored), { "Restored by": actor?.name ?? "System" }, "recycle-bin"));
        return (await dtoFor(repos, [restored]))[0];
      });
    },

    async purge(session: VerifiedSession, id: string): Promise<{ id: string }> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      return unit.run(session, async (repos) => {
        if (!(await repos.advances.purge(id))) throw new AppError("NOT_FOUND");
        return { id };
      });
    },
  };
}

export type AdvanceService = ReturnType<typeof createAdvanceService>;

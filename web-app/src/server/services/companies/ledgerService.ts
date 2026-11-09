import "server-only";
import type { LedgerAgeing, LedgerLine, LedgerOverview, LedgerPeriod, LedgerState, LedgerStatement, LedgerSummary } from "@shared/dashboards/companies";
import { assembleAgeing, ledgerKinds } from "@shared/dashboards/companies";
import type { Statement } from "@shared/dashboards/common";
import type { PayrollDoc } from "@shared/dashboards/payrollPay";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { paiseToNumber } from "../../money/paise";
import type { LedgerSummaryRow } from "../../repos/companies";
import { istMoment, monthRange } from "../cash/ist";
import type { CompaniesDeps } from "./context";
import type { createCompanyService } from "./companyService";
import { ledgerSummaryDoc } from "./profileDocuments";
import { statementDoc } from "./statementDocument";
import { buildLedger, ledgerPeriod, ledgerTotals, searchLedger, type Line } from "./ledger";

// The Company Ledger (Pallav CompanyLedgerController): the OVERVIEW from summaryByCompany() (one aggregate, no account rebuilt per request:
// ruled for scale), ONE company's account screen (Pallav's paged book, opening on its last page) and the STATEMENT for a period (decided
// shape: opening, rows, closing, totals; at most 5,000 rows). Spec: docs/specs/companies.md §5.

const PART = "companies.ledger";
const ZERO = BigInt(0);
export const STATEMENT_MAX_ROWS = 5000;
/** The longest statement period, in days (ruled: a span rule beside the row cap). */
export const STATEMENT_MAX_DAYS = 3 * 366;
/** How many companies the overview reads at most (a hotel has hundreds; the cap is logged when reached, never silent). */
const OVERVIEW_LIMIT = 10_000;

const n = paiseToNumber;
const stateOf = (balance: bigint): LedgerState => (balance > ZERO ? "owing" : balance < ZERO ? "credit" : "settled");

export function createLedgerService(deps: CompaniesDeps, companies: ReturnType<typeof createCompanyService>) {
  const { unit, catalog, now } = deps;

  const lineDto = (companyId: string, l: Line): LedgerLine => ({
    id: l.key,
    companyId,
    kind: l.kind,
    date: l.date,
    entry: l.entry,
    ref: l.ref,
    guest: l.guest,
    room: l.room,
    mode: l.mode,
    note: l.note,
    debitPaise: n(l.debitPaise),
    creditPaise: n(l.creditPaise),
    balancePaise: n(l.balancePaise),
  });

  /** CompanyLedgerController::range (:183-202): a quick period, or From/To typed in (an end before the start is swapped). */
  function range(q: { period: LedgerPeriod; from?: string; to?: string }): { period: LedgerPeriod; from: string | null; to: string | null } {
    if (q.from || q.to) {
      let [from, to] = [q.from ?? null, q.to ?? null];
      if (from && to && to < from) [from, to] = [to, from];
      return { period: "custom", from, to };
    }
    const today = istMoment(now()).date;
    const month = monthRange(today);
    if (q.period === "month") return { period: "month", from: month.from, to: month.to };
    if (q.period === "last") {
      const [y, m] = today.split("-").map(Number);
      const prev = monthRange(`${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}-01`);
      return { period: "last", from: prev.from, to: prev.to };
    }
    if (q.period === "year") return { period: "year", from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    return { period: "all", from: null, to: null };
  }

  return {
    /** The overview (:16-82): every company with its balance, who owes most first; from ONE aggregate (no account is built). */
    async overview(session: VerifiedSession, q: { search?: string; show: "all" | LedgerState; page: number; pageSize: number }): Promise<LedgerOverview> {
      requirePermission(session, catalog, PART, "view");
      const words = (q.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const monthFrom = monthRange(istMoment(now()).date).from;
      return unit.run(session, async (repos) => {
        const summaries = new Map((await repos.ledgerSource.summaryByCompany(monthFrom)).map((s) => [s.companyId, s]));
        const listed = await repos.companyProfiles.byName({ words, limit: OVERVIEW_LIMIT });
        const blank = (id: string): LedgerSummaryRow => ({ companyId: id, billedPaise: ZERO, receivedPaise: ZERO, refundedPaise: ZERO, balancePaise: ZERO, monthBilledPaise: ZERO, monthReceivedPaise: ZERO, lines: 0, lastDate: null, bills: 0, openBills: 0 });
        const all: LedgerSummary[] = listed
          .map((c) => ({ c, s: summaries.get(c.id) ?? blank(c.id) }))
          // who owes the most first, then those holding money with us, then the quiet ones (:56-61)
          .sort((a, b) => {
            const owesA = a.s.balancePaise > ZERO ? 1 : 0;
            const owesB = b.s.balancePaise > ZERO ? 1 : 0;
            if (owesA !== owesB) return owesB - owesA;
            const absA = a.s.balancePaise < ZERO ? -a.s.balancePaise : a.s.balancePaise;
            const absB = b.s.balancePaise < ZERO ? -b.s.balancePaise : b.s.balancePaise;
            if (absA !== absB) return absA > absB ? -1 : 1;
            if ((a.s.lines > 0) !== (b.s.lines > 0)) return a.s.lines > 0 ? -1 : 1;
            return a.c.name.toLowerCase().localeCompare(b.c.name.toLowerCase());
          })
          .map(({ c, s }) => {
            const owed = s.billedPaise + s.refundedPaise;
            return {
              companyId: c.id,
              companyName: c.name,
              gstNumber: c.gstNumber ?? "",
              billedPaise: n(s.billedPaise),
              receivedPaise: n(s.receivedPaise),
              refundedPaise: n(s.refundedPaise),
              balancePaise: n(s.balancePaise),
              state: stateOf(s.balancePaise),
              // company_ledger/index.blade.php:130-131; null when the account has no lines
              paidPercent: s.lines === 0 ? null : owed > ZERO ? Math.min(100, Math.floor((Number(s.receivedPaise) / Number(owed)) * 100)) : s.receivedPaise > ZERO ? 100 : 0,
              entries: s.lines,
              bills: s.bills,
              openBills: s.openBills,
              lastDate: s.lastDate,
            };
          });
        const counts = { all: all.length, owing: 0, credit: 0, settled: 0 };
        for (const r of all) counts[r.state] += 1;
        const shown = q.show === "all" ? all : all.filter((r) => r.state === q.show);
        // the figures on top count every company Bill Master knows, whatever the search (:69-79)
        const rows = [...summaries.values()];
        const owing = rows.filter((s) => s.balancePaise > ZERO);
        const holding = rows.filter((s) => s.balancePaise < ZERO);
        const sum = (list: LedgerSummaryRow[], f: (s: LedgerSummaryRow) => bigint): bigint => list.reduce((t, s) => t + f(s), ZERO);
        return {
          page: { items: shown.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: shown.length, page: q.page, pageSize: q.pageSize },
          all: shown,
          counts,
          stats: {
            owedPaise: n(sum(owing, (s) => s.balancePaise)),
            owing: owing.length,
            heldPaise: n(-sum(holding, (s) => s.balancePaise)),
            holding: holding.length,
            monthBilledPaise: n(sum(rows, (s) => s.monthBilledPaise)),
            monthReceivedPaise: n(sum(rows, (s) => s.monthReceivedPaise)),
          },
        };
      });
    },

    /** ONE company's account (:84-126): the period, its opening and closing, search, written like a book (opens on the last page). */
    async account(session: VerifiedSession, companyId: string, q: { period: LedgerPeriod; from?: string; to?: string; search?: string; page?: number; pageSize: number }): Promise<LedgerStatement> {
      requirePermission(session, catalog, PART, "view");
      const r = range(q);
      return unit.run(session, async (repos) => {
        const company = await repos.companyProfiles.get(companyId);
        if (!company) throw new AppError("NOT_FOUND");
        const src = await repos.ledgerSource.forCompany(companyId);
        const all = buildLedger(companyId, src.bills, src.advances);
        const view = ledgerPeriod(all, r.from, r.to);
        const t = ledgerTotals(view.lines);
        const found = q.search ? searchLedger(view.lines, q.search) : view.lines;
        const lastPage = Math.max(1, Math.ceil(found.length / q.pageSize));
        const page = q.page ? Math.min(q.page, lastPage) : lastPage;
        const lastPaid = [...all].reverse().find((l) => l.creditPaise > ZERO && l.kind !== "adjusted") ?? null;
        return {
          company: await companies.dtoOne(company),
          period: r.period,
          from: r.from,
          to: r.to,
          openingPaise: n(view.openingPaise),
          closingPaise: n(view.closingPaise),
          billedPaise: n(t.billedPaise),
          receivedPaise: n(t.receivedPaise),
          refundedPaise: n(t.refundedPaise),
          page: { items: found.slice((page - 1) * q.pageSize, page * q.pageSize).map((l) => lineDto(companyId, l)), total: found.length, page, pageSize: q.pageSize },
          periodLines: view.lines.map((l) => lineDto(companyId, l)),
          lastPaid: lastPaid ? lineDto(companyId, lastPaid) : null,
          openBills: src.bills.filter((b) => b.balanceHotelAmountPaise + b.balanceFoodAmountPaise > ZERO).length,
        };
      });
    },

    /** Receivables by age (H8): every company's bills still on account, in 30-day buckets from the bill date as of today (IST); most owed first. */
    async ageing(session: VerifiedSession): Promise<LedgerAgeing> {
      requirePermission(session, catalog, PART, "view");
      const asOf = istMoment(now()).date;
      return unit.run(session, async (repos) => {
        const open = await repos.ledgerSource.openBills();
        const ids = [...new Set(open.map((b) => b.companyId))];
        const names = new Map((await Promise.all(ids.map((id) => repos.companyProfiles.get(id)))).flatMap((c) => (c ? [[c.id, c.name] as const] : [])));
        return assembleAgeing(asOf, open.flatMap((b) => (names.has(b.companyId) ? [{ companyId: b.companyId, companyName: names.get(b.companyId) as string, billDate: b.billDate, balancePaise: n(b.balancePaise) }] : [])));
      });
    },

    /** The ageing report as a CSV file (Excel opens it): one line per company and a totals line. */
    async ageingCsv(session: VerifiedSession): Promise<{ bytes: Uint8Array; filename: string }> {
      const a = await this.ageing(session);
      const cell = (v: string | number): string => (typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`);
      const rupees = (paise: number): string => (paise / 100).toFixed(2);
      const lines = [["Company", "0 to 30 days (Rs)", "31 to 60 days (Rs)", "61 to 90 days (Rs)", "Over 90 days (Rs)", "Total due (Rs)", "Open bills"].map(cell).join(",")];
      for (const r of a.rows) lines.push([r.companyName, rupees(r.currentPaise), rupees(r.days31to60Paise), rupees(r.days61to90Paise), rupees(r.over90Paise), rupees(r.totalPaise), r.openBills].map(cell).join(","));
      const t = a.totals;
      lines.push(["Total", rupees(t.currentPaise), rupees(t.days31to60Paise), rupees(t.days61to90Paise), rupees(t.over90Paise), rupees(t.totalPaise), t.openBills].map(cell).join(","));
      return { bytes: new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`), filename: `receivables-ageing-${a.asOf}.csv` };
    },

    /** The statement (decided shape): one period, every row with its running balance from the server, at most 5,000 rows. */
    async statement(session: VerifiedSession, companyId: string, q: { from: string; to: string }): Promise<Statement<LedgerLine>> {
      requirePermission(session, catalog, PART, "view");
      if (q.to < q.from) throw new AppError("VALIDATION_FAILED", "The to date must be on or after the from date.", { fields: { to: "The to date must be on or after the from date." } });
      const days = (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000;
      if (days > STATEMENT_MAX_DAYS) throw new AppError("VALIDATION_FAILED", "Choose a period of at most three years.", { fields: { to: "Choose a period of at most three years." } });
      return unit.run(session, async (repos) => {
        if (!(await repos.companyProfiles.get(companyId))) throw new AppError("NOT_FOUND");
        const src = await repos.ledgerSource.forCompany(companyId);
        const view = ledgerPeriod(buildLedger(companyId, src.bills, src.advances), q.from, q.to);
        if (view.lines.length > STATEMENT_MAX_ROWS) {
          const message = `This period has ${view.lines.length.toLocaleString("en-IN")} entries, more than ${STATEMENT_MAX_ROWS.toLocaleString("en-IN")}: choose a shorter period.`;
          throw new AppError("VALIDATION_FAILED", message, { fields: { from: message } });
        }
        return {
          openingBalancePaise: n(view.openingPaise),
          rows: view.lines.map((l) => lineDto(companyId, l)),
          closingBalancePaise: n(view.closingPaise),
          totals: { debitPaise: n(view.lines.reduce((t, l) => t + l.debitPaise, ZERO)), creditPaise: n(view.lines.reduce((t, l) => t + l.creditPaise, ZERO)) },
        };
      });
    },

    /** The same statement as a CSV file (Excel opens it): opening line, one line per entry with the running balance, totals and closing lines. */
    async statementCsv(session: VerifiedSession, companyId: string, q: { from: string; to: string }): Promise<{ bytes: Uint8Array; filename: string }> {
      const s = await this.statement(session, companyId, q);
      const company = await unit.run(session, (repos) => repos.companyProfiles.get(companyId));
      if (!company) throw new AppError("NOT_FOUND");
      const cell = (v: string | number | null): string => (v === null ? "" : typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`);
      const rupees = (paise: number): string => (paise / 100).toFixed(2);
      const line = (cells: (string | number | null)[]): string => cells.map(cell).join(",");
      const lines = [line(["Date", "Entry", "Ref", "Guest", "Room", "Mode", "Note", "Debit (Rs)", "Credit (Rs)", "Balance (Rs)"])];
      lines.push(line([q.from, "Opening balance", null, null, null, null, null, null, null, rupees(s.openingBalancePaise)]));
      for (const r of s.rows) lines.push(line([r.date, ledgerKinds[r.kind].label, r.ref, r.guest, r.room, r.mode, r.note, rupees(r.debitPaise), rupees(r.creditPaise), rupees(r.balancePaise)]));
      lines.push(line([null, "Totals", null, null, null, null, null, rupees(s.totals.debitPaise), rupees(s.totals.creditPaise), null]));
      lines.push(line([q.to, "Closing balance", null, null, null, null, null, null, null, rupees(s.closingBalancePaise)]));
      // a BOM so Excel reads the names as UTF-8
      return { bytes: new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`), filename: `statement-${company.name}-${q.from}-${q.to}.csv` };
    },

    /** The overview as the document the PDF draws: every company the filter shows (its `all` list), with the same stats. */
    async summaryDocument(session: VerifiedSession, q: { search?: string; show: "all" | LedgerState }): Promise<{ doc: PayrollDoc; filename: string }> {
      const overview = await this.overview(session, { ...q, page: 1, pageSize: 100 });
      const header = await unit.run(session, (repos) => repos.hotelProfile.header());
      const today = istMoment(now()).date;
      return { doc: ledgerSummaryDoc(header, overview, today), filename: `company-ledger-${today}` };
    },

    /** The statement as the document the PDF draws (MJ #22): the SAME rows (this service's own statement), the hotel's header and the company's details. */
    async statementDocument(session: VerifiedSession, companyId: string, q: { from: string; to: string }): Promise<{ doc: PayrollDoc; filename: string }> {
      const s = await this.statement(session, companyId, q);
      const { header, company } = await unit.run(session, async (repos) => ({ header: await repos.hotelProfile.header(), company: await repos.companyProfiles.get(companyId) }));
      if (!company) throw new AppError("NOT_FOUND");
      return { doc: statementDoc(header, company, q, s), filename: `statement-${company.name}-${q.from}-${q.to}` };
    },
  };
}

export type LedgerService = ReturnType<typeof createLedgerService>;

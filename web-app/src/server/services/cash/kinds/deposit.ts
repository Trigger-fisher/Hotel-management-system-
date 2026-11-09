import "server-only";
import { cashBookShort, type CashBook, type DepositInput } from "@shared/dashboards/cash";
import type { CashDepositRecord, CashRepos } from "../../../repos/cashDeposit";
import type { EntryRepo } from "../../../repos/entries";
import { toDepositDto } from "../dto";
import type { EntryKind } from "../entryEngine";
import { dayMonthYear } from "../entryEngine";
import { validateDeposit } from "../validate";

/** The Master Data list that holds each book's depositors (Pallav CashLedger::DEPOSITOR_SETS). */
export const DEPOSITOR_SETS: Record<CashBook, string> = { hotel: "revenue_depositor_hotel", food: "revenue_depositor_food" };

/** A cash deposit: spec docs/specs/cash-revenue.md. */
export const depositKind: EntryKind<CashDepositRecord, DepositInput> = {
  name: "deposit",
  moduleKey: "revenue",
  logModule: "revenue",
  noun: "deposit",
  partKey: (book) => `revenue.${book}`,
  entity: (book) => `${cashBookShort[book]} deposit`,
  searchWords: ["deposit"],
  reassignOnEdit: false,
  forceEditLock: "Edited a closed revenue entry",
  repo: (repos: CashRepos) => repos.cashDeposits as unknown as EntryRepo<CashDepositRecord, never, never, never>,
  create: (repos, book, base, fields) => repos.cashDeposits.create(book, { ...base, depositor: fields.depositor as string, reason: fields.reason as string | null }),
  update: (repos, book, id, version, patch, actorId) => repos.cashDeposits.update(book, id, version, patch, actorId),
  async prepare({ repos, input, book, existing, canBackdate, today }) {
    const allowed = await repos.masterLists.activeValues(DEPOSITOR_SETS[book]);
    const clean = validateDeposit(input, { bookName: cashBookShort[book], allowedDepositors: allowed, keepName: existing?.depositor, canBackdate, today });
    return { stamp: clean.stamp, fields: { depositor: clean.depositor, reason: clean.reason }, amountPaise: clean.amountPaise };
  },
  searchRow: (r) => ({ depositor: r.depositor, reason: r.reason }),
  // what a deposit held, for the log line (Pallav: Depositor, Amount, Instruction, Date; amount in paise)
  held: (r) => ({ Depositor: r.depositor, "Amount (paise)": Number(r.amountPaise), Instruction: r.reason, Date: dayMonthYear(r.date) }),
  watched: (r) => ({ Date: r.date, Time: r.time, Depositor: r.depositor, Reason: r.reason, "Amount (paise)": Number(r.amountPaise) }),
  toDto: (r, ctx) => toDepositDto(r, ctx),
  sortKey: (r, token) => (token === "entryNo" ? r.entryNo : token === "amountPaise" ? r.amountPaise : token === "depositor" ? r.depositor.toLowerCase() : `${r.date} ${r.time}`),
};

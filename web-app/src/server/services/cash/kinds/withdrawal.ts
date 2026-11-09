import "server-only";
import { cashBookShort, type CashBook, type ExpenseInput } from "@shared/dashboards/cash";
import type { CashRepos } from "../../../repos/cashDeposit";
import type { EntryRepo } from "../../../repos/entries";
import type { CashWithdrawalRecord } from "../../../repos/expenses";
import { toWithdrawalDto } from "../expenseDto";
import type { EntryKind } from "../entryEngine";
import { dayMonthYear } from "../entryEngine";
import { validateWithdrawal } from "../validate";

/** The Master Data list of receiver names kept for each business (Pallav Support/CashPeople.php:20). */
export const RECEIVER_SETS: Record<CashBook, string> = { hotel: "cash_person_hotel", food: "cash_person_food" };

/** A cash withdrawal: spec docs/specs/cash-withdrawals.md. */
export const withdrawalKind: EntryKind<CashWithdrawalRecord, ExpenseInput> = {
  name: "withdrawal",
  moduleKey: "expense",
  logModule: "expense",
  noun: "entry",
  partKey: () => "expense.withdrawals",
  entity: (book) => `${cashBookShort[book]} Cash Withdrawal`,
  searchWords: ["Cash Withdrawal"],
  reassignOnEdit: true,
  forceEditLock: "Edited a closed expense entry",
  repo: (repos: CashRepos) => repos.cashWithdrawals as unknown as EntryRepo<CashWithdrawalRecord, never, never, never>,
  create: (repos, book, base, fields) => repos.cashWithdrawals.create(book, { ...base, withdrawer: fields.withdrawer as string, instruction: fields.instruction as string | null }),
  update: (repos, book, id, version, patch, actorId) => repos.cashWithdrawals.update(book, id, version, patch, actorId),
  async prepare({ repos, input, book, existing, canBackdate, today }) {
    const allowed = await repos.masterLists.activeValues(RECEIVER_SETS[book]);
    const clean = validateWithdrawal(
      { withdrawer: input.withdrawer, amountPaise: input.amountPaise, instruction: input.instruction, stamp: input.stamp },
      { bookName: cashBookShort[book], allowedReceivers: allowed, keepName: existing?.withdrawer, canBackdate, today },
    );
    return { stamp: clean.stamp, fields: { withdrawer: clean.withdrawer, instruction: clean.instruction }, amountPaise: clean.amountPaise };
  },
  searchRow: (r) => ({ withdrawer: r.withdrawer, instruction: r.instruction }),
  // Pallav: Date, Amount, Paid to (the withdrawer), What (the instruction); amount in paise (ExpenseController.php:471-476,536-538)
  held: (r) => ({ Date: dayMonthYear(r.date), "Amount (paise)": Number(r.amountPaise), "Paid to": r.withdrawer, What: r.instruction }),
  watched: (r) => ({ Date: r.date, Time: r.time, "Amount (paise)": Number(r.amountPaise), Withdrawer: r.withdrawer, Instruction: r.instruction }),
  toDto: (r, ctx) => toWithdrawalDto(r, ctx),
  sortKey: (r, token) => (token === "entryNo" ? r.entryNo : token === "amountPaise" ? r.amountPaise : token === "name" ? r.withdrawer.toLowerCase() : `${r.date} ${r.time}`),
};

import "server-only";
import { cashBookShort, type ExpenseInput } from "@shared/dashboards/cash";
import { AppError } from "../../../errors";
import type { CashRepos } from "../../../repos/cashDeposit";
import type { EntryRepo } from "../../../repos/entries";
import type { MiscExpenseRecord } from "../../../repos/expenses";
import { toMiscDto } from "../expenseDto";
import type { EntryKind } from "../entryEngine";
import { dayMonthYear } from "../entryEngine";
import { lineShapeErrors, resolveLines, summarize } from "../expenseLines";
import { failIfAny, instructionOf, stampOf, type Fields } from "../validate";

/** A miscellaneous expense with its lines: spec docs/specs/cash-expenses.md. */
export const miscKind: EntryKind<MiscExpenseRecord, ExpenseInput> = {
  name: "misc",
  moduleKey: "expense",
  logModule: "expense",
  noun: "entry",
  needsCatalog: true,
  partKey: () => "expense.misc",
  entity: (book) => `${cashBookShort[book]} Miscellaneous Expense`,
  searchWords: ["Miscellaneous Expense"],
  reassignOnEdit: true,
  forceEditLock: "Edited a closed expense entry",
  repo: (repos: CashRepos) => repos.miscExpenses as unknown as EntryRepo<MiscExpenseRecord, never, never, never>,
  create: (repos, book, base, fields) =>
    repos.miscExpenses.create(book, {
      ...base,
      expenseName: fields.expenseName as string,
      expenseHead: fields.expenseHead as string | null,
      instruction: fields.instruction as string | null,
      lines: fields.lines as never,
    }),
  update: (repos, book, id, version, patch, actorId) => repos.miscExpenses.update(book, id, version, patch, actorId),
  async prepare({ repos, input, book, existing, canBackdate, today }) {
    const fields: Fields = {};
    const shape = lineShapeErrors(input.lines);
    Object.assign(fields, shape);
    const instruction = instructionOf(input.instruction, 500, fields);
    const stamp = stampOf(input.stamp, { canBackdate, today }, fields);
    failIfAny(fields);

    const catalog = await repos.expenseCatalog.forBook(book);
    const lines = resolveLines(input.lines, catalog, existing?.lines ?? null);
    const total = lines.reduce((sum, l) => sum + l.totalPaise, BigInt(0));
    // "The total must be more than zero." (ExpenseController.php:433-435). Pallav lets force mode through; HMS does not, because the table's CHECK (amount_paise > 0) holds for everyone.
    if (total <= BigInt(0)) throw new AppError("VALIDATION_FAILED", undefined, { fields: { lines: "The total must be more than zero." } });
    const names = summarize(lines);
    return {
      stamp,
      fields: { expenseName: names.expenseName, expenseHead: names.expenseHead === "" ? null : names.expenseHead, instruction, lines },
      amountPaise: Number(total),
    };
  },
  searchRow: (r) => ({ expenseName: r.expenseName, expenseHead: r.expenseHead, instruction: r.instruction }),
  searchExtra: (r) => r.lines.flatMap((l) => [l.category, l.item]),
  // Pallav: Date, Amount, Paid to (none), What (the expense name); amount in paise
  held: (r) => ({ Date: dayMonthYear(r.date), "Amount (paise)": Number(r.amountPaise), "Paid to": null, What: r.expenseName }),
  watched: (r) => ({ Date: r.date, Time: r.time, "Amount (paise)": Number(r.amountPaise), Instruction: r.instruction, "Expense name": r.expenseName, "Expense head": r.expenseHead }),
  toDto: (r, ctx) => toMiscDto(r, ctx),
  sortKey: (r, token) => (token === "entryNo" ? r.entryNo : token === "amountPaise" ? r.amountPaise : token === "name" ? r.expenseName.toLowerCase() : `${r.date} ${r.time}`),
};

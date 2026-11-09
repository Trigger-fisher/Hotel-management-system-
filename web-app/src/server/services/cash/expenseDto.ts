import "server-only";
import type { CashExpense, ExpenseLine } from "@shared/dashboards/cash";
import { paiseToNumber } from "../../money/paise";
import type { CashWithdrawalRecord, MiscExpenseRecord, MiscLine } from "../../repos/expenses";
import type { EntryBase } from "../../repos/entries";
import type { DtoContext } from "./entryEngine";
import { istInstant } from "./ist";
import { displayName } from "./ports";

/**
 * An expense as the apps receive it (ui-shared CashExpense) plus `version` (optimistic locking; a contract request, docs/API.md): integer
 * paise, ISO dates, the recorder's name, and the fields only the server can work out (isLatest). Advances come later: `employee` and
 * `yearMonth` are null here.
 */
export type ExpenseDto = CashExpense & { version: number };

function base(r: EntryBase, ctx: DtoContext): Pick<ExpenseDto, "id" | "entryNo" | "at" | "recordedBy" | "createdAt" | "updatedAt" | "isLatest" | "version" | "book" | "amountPaise"> {
  const person = ctx.people.get(r.userId);
  return {
    id: r.id,
    version: r.version,
    entryNo: r.entryNo,
    at: istInstant(r.date, r.time).toISOString(),
    recordedBy: { id: r.userId, name: person ? displayName(person) : (r.fullName ?? "") },
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    isLatest: r.id === ctx.newestId,
    book: r.book,
    amountPaise: paiseToNumber(r.amountPaise),
  };
}

export function toWithdrawalDto(r: CashWithdrawalRecord, ctx: DtoContext): ExpenseDto {
  return { ...base(r, ctx), type: `${r.book}-withdrawal`, kind: "withdrawal", withdrawer: r.withdrawer, employee: null, yearMonth: null, lines: [], instruction: r.instruction };
}

/** A line whose item has left the catalogue (renamed away, removed, or older than the catalogue) is shown as "keep": it stays exactly as saved (Pallav lineData:214-232). */
function lineDto(l: MiscLine, ctx: DtoContext, book: EntryBase["book"]): ExpenseLine {
  const category = ctx.catalog?.[book].find((c) => c.id === l.categoryId);
  const live = Boolean(l.itemId && category?.items.some((it) => it.id === l.itemId));
  return {
    id: l.id,
    categoryId: live ? (l.categoryId as string) : "keep",
    categoryName: l.category,
    itemId: live ? (l.itemId as string) : "keep",
    itemName: l.item,
    pricing: l.pricing,
    quantity: l.quantity,
    pricePaise: paiseToNumber(l.pricePaise),
    totalPaise: paiseToNumber(l.totalPaise),
  };
}

export function toMiscDto(r: MiscExpenseRecord, ctx: DtoContext): ExpenseDto {
  return { ...base(r, ctx), type: `${r.book}-misc`, kind: "misc", withdrawer: null, employee: null, yearMonth: null, lines: r.lines.map((l) => lineDto(l, ctx, r.book)), instruction: r.instruction };
}

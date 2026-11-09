import "server-only";
import type { Paise } from "../money/paise";
import type { EntryBase, EntryRepo, NewEntryBase, CashBook } from "./entries";

// Daily Cash expenses: cash withdrawals and miscellaneous expenses (hotel and food books each), plus the catalogue the miscellaneous lines are
// priced from. Same generic repository as deposits; a withdrawal adds who took the cash, a miscellaneous expense adds its lines.

export interface CashWithdrawalRecord extends EntryBase {
  /** Who took the cash: a name from the book's receiver list in Master Data. */
  withdrawer: string;
  instruction: string | null;
}

export interface NewCashWithdrawal extends NewEntryBase {
  withdrawer: string;
  instruction: string | null;
}

export type CashWithdrawalPatch = Partial<Pick<NewCashWithdrawal, "date" | "time" | "withdrawer" | "amountPaise" | "amountInWords" | "instruction" | "userId" | "fullName">>;

export type CashWithdrawalSort = "entryNo" | "date" | "time" | "amountPaise" | "withdrawer";
export type CashWithdrawalRepo = EntryRepo<CashWithdrawalRecord, NewCashWithdrawal, CashWithdrawalPatch, CashWithdrawalSort>;

/** One line of a miscellaneous expense. The names and the price are copied onto the line when it is saved (Pallav Models/ExpenseLine.php). */
export interface MiscLine {
  id: string;
  /** null for a line kept from before the catalogue existed, or whose item has been removed. */
  categoryId: string | null;
  itemId: string | null;
  category: string;
  item: string;
  pricing: "listed" | "custom";
  /** Up to three decimals (2.5 kg). */
  quantity: number;
  pricePaise: Paise;
  totalPaise: Paise;
}

export type NewMiscLine = Omit<MiscLine, "id">;

export interface MiscExpenseRecord extends EntryBase {
  /** Short names built from the lines (Pallav ExpenseController::summary): "Milk, Eggs +1 more". */
  expenseName: string;
  expenseHead: string | null;
  instruction: string | null;
  lines: MiscLine[];
}

export interface NewMiscExpense extends NewEntryBase {
  expenseName: string;
  expenseHead: string | null;
  instruction: string | null;
  lines: NewMiscLine[];
}

export type MiscExpensePatch = Partial<Pick<NewMiscExpense, "date" | "time" | "expenseName" | "expenseHead" | "amountPaise" | "amountInWords" | "instruction" | "lines" | "userId" | "fullName">>;

export type MiscExpenseSort = "entryNo" | "date" | "time" | "amountPaise" | "expenseName";
/** Editing replaces every line (Pallav deletes the lines and creates the new ones, ExpenseController.php:514-518); soft delete KEEPS them (HMS fixes Pallav's loss of lines on delete). */
export type MiscExpenseRepo = EntryRepo<MiscExpenseRecord, NewMiscExpense, MiscExpensePatch, MiscExpenseSort>;

export interface CatalogItem {
  id: string;
  name: string;
  pricePaise: Paise;
}

export interface CatalogCategory {
  id: string;
  name: string;
  items: CatalogItem[];
}

/** The expense catalogue Master Data keeps for each business (Pallav Support/ExpenseCatalog.php), ordered by sort order then name. Read only here. */
export interface ExpenseCatalogRepo {
  forBook(book: CashBook): Promise<CatalogCategory[]>;
}

import "server-only";
import type { AccountingYearRepo, ForceLogRepo, MasterListRepo, SystemLogRepo } from "./cashSupport";
import type { EntryBase, EntryRepo, NewEntryBase } from "./entries";
import type { CashWithdrawalRepo, ExpenseCatalogRepo, MiscExpenseRepo } from "./expenses";

// Daily Cash revenue: the two deposit books (hotel_cash_deposits, food_cash_deposits). The generic entry repository (repos/entries.ts) does
// the work; a deposit adds a depositor and an instruction (Pallav keeps it in the `reason` column).
export type { CashBook } from "./entries";

export interface CashDepositRecord extends EntryBase {
  depositor: string;
  reason: string | null;
}

export interface NewCashDeposit extends NewEntryBase {
  depositor: string;
  reason: string | null;
}

/** A patch also carries who recorded it when an edit takes the entry over (expenses do; deposits never do). */
export type CashDepositPatch = Partial<Pick<NewCashDeposit, "date" | "time" | "depositor" | "amountPaise" | "amountInWords" | "reason" | "userId" | "fullName">>;

export const CASH_DEPOSIT_SORTS = ["entryNo", "date", "time", "amountPaise", "depositor"] as const;
export type CashDepositSort = (typeof CASH_DEPOSIT_SORTS)[number];

export type CashDepositRepo = EntryRepo<CashDepositRecord, NewCashDeposit, CashDepositPatch, CashDepositSort>;

/** What a cash service gets inside a unit. More repositories join this as modules are added. */
export interface CashRepos {
  cashDeposits: CashDepositRepo;
  cashWithdrawals: CashWithdrawalRepo;
  miscExpenses: MiscExpenseRepo;
  expenseCatalog: ExpenseCatalogRepo;
  masterLists: MasterListRepo;
  accountingYears: AccountingYearRepo;
  systemLogs: SystemLogRepo;
  forceLogs: ForceLogRepo;
}

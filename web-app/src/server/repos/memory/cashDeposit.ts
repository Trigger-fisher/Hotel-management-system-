import "server-only";
import { randomUUID } from "node:crypto";
import type { AccountingYear, ForceLogEntry, SystemLogEntry } from "../cashSupport";
import type { CashBook, CashDepositRecord, CashDepositRepo, CashRepos } from "../cashDeposit";
import type { CashWithdrawalRecord, CatalogCategory, MiscExpenseRecord, MiscLine } from "../expenses";
import { RepoError } from "../types";
import { memoryEntryRepo } from "./entries";
import { createMemoryUnit, MemoryStore } from "./store";

/** One hotel's cash tables. */
interface CashData {
  deposits: Record<CashBook, CashDepositRecord[]>;
  withdrawals: Record<CashBook, CashWithdrawalRecord[]>;
  misc: Record<CashBook, MiscExpenseRecord[]>;
  /** The expense catalogue by book (categories with their priced items). */
  catalog: Record<CashBook, CatalogCategory[]>;
  /** Master Data lists by set key: the ACTIVE values. */
  lists: Record<string, string[]>;
  years: AccountingYear[];
  systemLogs: SystemLogEntry[];
  forceLogs: ForceLogEntry[];
}

const emptyCashData = (): CashData => ({
  deposits: { hotel: [], food: [] },
  withdrawals: { hotel: [], food: [] },
  misc: { hotel: [], food: [] },
  catalog: { hotel: [], food: [] },
  lists: {},
  years: [],
  systemLogs: [],
  forceLogs: [],
});

const positive = (v: { amountPaise?: bigint }): void => {
  // the table's CHECK: amount_paise > 0
  if (v.amountPaise !== undefined && v.amountPaise <= BigInt(0)) throw new RepoError("check", "amount_paise > 0");
};
const notEmpty = (name: string, value: string | undefined): void => {
  if (value !== undefined && value.trim() === "") throw new RepoError("check", `${name} not empty`);
};

function memoryCashDeposits(data: CashData): CashDepositRepo {
  return memoryEntryRepo({
    rows: (book) => data.deposits[book],
    fieldsOf: (input) => ({ depositor: input.depositor, reason: input.reason }),
    check: (v) => {
      positive(v);
      notEmpty("depositor", "depositor" in v ? v.depositor : undefined);
    },
    searchable: (r) => [r.depositor, r.reason],
  });
}

function memoryCashWithdrawals(data: CashData): CashRepos["cashWithdrawals"] {
  return memoryEntryRepo({
    rows: (book) => data.withdrawals[book],
    fieldsOf: (input) => ({ withdrawer: input.withdrawer, instruction: input.instruction }),
    check: (v) => {
      positive(v);
      notEmpty("withdrawer", "withdrawer" in v ? v.withdrawer : undefined);
    },
    searchable: (r) => [r.withdrawer, r.instruction],
  });
}

const withIds = (lines: readonly Omit<MiscLine, "id">[]): MiscLine[] => lines.map((l) => ({ ...l, id: randomUUID() }));

function memoryMiscExpenses(data: CashData): CashRepos["miscExpenses"] {
  return memoryEntryRepo({
    rows: (book) => data.misc[book],
    fieldsOf: (input) => ({ expenseName: input.expenseName, expenseHead: input.expenseHead, instruction: input.instruction, lines: withIds(input.lines) }),
    check: (v) => {
      positive(v);
      notEmpty("expense_name", "expenseName" in v ? v.expenseName : undefined);
      for (const l of "lines" in v && v.lines ? v.lines : []) {
        if (l.quantity < 0 || l.pricePaise < BigInt(0) || l.totalPaise < BigInt(0)) throw new RepoError("check", "expense_lines CHECKs");
      }
    },
    // editing replaces every line (new ids), as Pallav deletes and recreates them
    apply: (row, patch) => {
      const { lines, ...rest } = patch;
      Object.assign(row, rest);
      if (lines) row.lines = withIds(lines);
    },
    searchable: (r) => [r.expenseName, r.expenseHead, r.instruction, ...r.lines.flatMap((l) => [l.category, l.item])],
  });
}

/** A store and a unit for the cash module, for tests and for running the app before the PostgreSQL repositories exist. */
export function createMemoryCash(): { store: MemoryStore<CashData>; unit: ReturnType<typeof createMemoryUnit<CashData, CashRepos>> } {
  const store = new MemoryStore<CashData>(emptyCashData);
  return {
    store,
    unit: createMemoryUnit(store, (data) => ({
      cashDeposits: memoryCashDeposits(data),
      cashWithdrawals: memoryCashWithdrawals(data),
      miscExpenses: memoryMiscExpenses(data),
      expenseCatalog: { forBook: async (book) => structuredClone(data.catalog[book]) },
      masterLists: { activeValues: async (key) => [...(data.lists[key] ?? [])] },
      accountingYears: { list: async () => data.years.map((y) => ({ ...y })).sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1)) },
      systemLogs: { write: async (entry) => void data.systemLogs.push(entry) },
      forceLogs: { write: async (entry) => void data.forceLogs.push(entry) },
    })),
  };
}

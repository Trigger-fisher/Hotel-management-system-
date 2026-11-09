import "server-only";
import type { CashBook, CashList, ExpenseInput } from "@shared/dashboards/cash";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { createEntryEngine } from "./entryEngine";
import type { EntryDeps } from "./entryEngine";
import type { ExpenseDto } from "./expenseDto";
import { miscKind } from "./kinds/misc";
import { withdrawalKind } from "./kinds/withdrawal";

// Daily Cash, Expenses: cash withdrawals and miscellaneous expenses (staff advances come with the Payroll slice). The same entry engine as
// Revenue, with the withdrawal and miscellaneous kinds. Specs: docs/specs/cash-withdrawals.md and cash-expenses.md.
type ExpenseDeps = EntryDeps;

export const EXPENSE_SORTS = ["at", "entryNo", "amountPaise", "name"] as const;
export type ExpenseSort = (typeof EXPENSE_SORTS)[number];
export const EXPENSE_KINDS = ["all", "withdrawal", "misc", "advance"] as const;

interface ExpenseListQuery {
  book: "all" | CashBook;
  kind: (typeof EXPENSE_KINDS)[number];
  search?: string;
  from?: string;
  to?: string;
  sort: ExpenseSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  deleted: "exclude" | "only";
}

export function createExpenseService(deps: ExpenseDeps) {
  const engine = createEntryEngine(deps, [withdrawalKind as never, miscKind as never]);
  const kindOf = (input: ExpenseInput): string => {
    if (input.kind === "advance") throw new AppError("VALIDATION_FAILED", undefined, { fields: { kind: "Staff advances are not available yet." } });
    return input.kind;
  };
  return {
    async list(session: VerifiedSession, query: ExpenseListQuery): Promise<CashList<ExpenseDto>> {
      // an advance filter shows nothing yet: the kind is not built (the numbers on top will include advances when it is)
      return (await engine.list(session, query)) as unknown as CashList<ExpenseDto>;
    },
    async get(session: VerifiedSession, id: string): Promise<ExpenseDto> {
      return (await engine.get(session, id)) as ExpenseDto;
    },
    async create(session: VerifiedSession, input: ExpenseInput, meta: RequestMeta): Promise<ExpenseDto> {
      return (await engine.create(session, kindOf(input), input, meta)) as ExpenseDto;
    },
    async update(session: VerifiedSession, id: string, input: ExpenseInput & { version: number }, meta: RequestMeta): Promise<ExpenseDto> {
      // the kind of a saved entry never changes: sending another kind is refused by the engine's book/kind check below
      const saved = (await engine.get(session, id)) as ExpenseDto;
      if (saved.kind !== input.kind) throw new AppError("VALIDATION_FAILED", undefined, { fields: { kind: "The kind of a saved entry cannot change." } });
      return (await engine.update(session, id, input, meta)) as ExpenseDto;
    },
    remove: (session: VerifiedSession, id: string, version: number, meta: RequestMeta) => engine.remove(session, id, version, meta),
    async restore(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<ExpenseDto> {
      return (await engine.restore(session, id, version, meta)) as ExpenseDto;
    },
    purge: (session: VerifiedSession, id: string) => engine.purge(session, id),
  };
}

export type ExpenseService = ReturnType<typeof createExpenseService>;

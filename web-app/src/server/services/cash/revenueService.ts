import "server-only";
import type { CashBook, CashDeposit, CashList, DepositInput } from "@shared/dashboards/cash";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import { createEntryEngine, type EntryDeps } from "./entryEngine";
import { depositKind } from "./kinds/deposit";

// Daily Cash, Revenue: the service behind the routes. All the rules (who may edit or delete, the stamp, the accounting-year lock, force mode,
// entry numbers, the version check, the recycle bin, the list and its numbers, the system-log line in the same unit) live ONCE in the entry
// engine (entryEngine.ts); this file only fixes the kind (kinds/deposit.ts) and the contract types. Spec: docs/specs/cash-revenue.md.
export type RevenueDeps = EntryDeps;

export const DEPOSIT_SORTS = ["at", "entryNo", "amountPaise", "depositor"] as const;
export type DepositSort = (typeof DEPOSIT_SORTS)[number];

interface DepositListQuery {
  book: "all" | CashBook;
  search?: string;
  from?: string;
  to?: string;
  sort: DepositSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  /** "only" = the recycle bin (the hotel's SuperAdmin role). */
  deleted: "exclude" | "only";
}

export function createRevenueService(deps: RevenueDeps) {
  const engine = createEntryEngine(deps, [depositKind as never]);
  return {
    async list(session: VerifiedSession, query: DepositListQuery): Promise<CashList<CashDeposit>> {
      return (await engine.list(session, query)) as unknown as CashList<CashDeposit>;
    },
    async get(session: VerifiedSession, id: string): Promise<CashDeposit> {
      return (await engine.get(session, id)) as CashDeposit;
    },
    async create(session: VerifiedSession, input: DepositInput, meta: RequestMeta): Promise<CashDeposit> {
      return (await engine.create(session, "deposit", input, meta)) as CashDeposit;
    },
    async update(session: VerifiedSession, id: string, input: DepositInput & { version: number }, meta: RequestMeta): Promise<CashDeposit> {
      return (await engine.update(session, id, input, meta)) as CashDeposit;
    },
    remove: (session: VerifiedSession, id: string, version: number, meta: RequestMeta) => engine.remove(session, id, version, meta),
    async restore(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<CashDeposit> {
      return (await engine.restore(session, id, version, meta)) as CashDeposit;
    },
    purge: (session: VerifiedSession, id: string) => engine.purge(session, id),
  };
}

export type RevenueService = ReturnType<typeof createRevenueService>;

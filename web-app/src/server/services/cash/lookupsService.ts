import "server-only";
import { shifts, type CashLookups } from "@shared/dashboards/cash";
import { can } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { CASH_BOOKS } from "../../repos/entries";
import { paiseToNumber } from "../../money/paise";
import type { EntryDeps } from "./entryEngine";
import { DEPOSITOR_SETS } from "./kinds/deposit";
import { RECEIVER_SETS } from "./kinds/withdrawal";

// The lists the Daily Cash forms are drawn from (ui-shared CashLookups): who may deposit and who may take cash (Master Data, ACTIVE names only),
// the expense catalogue with its prices, and the shifts. Read only; whoever may read Revenue or Expenses may read them (Pallav sends them
// with each screen: RevenueController::index, ExpenseController::index).
// Staff (for advances) is empty until the Payroll slice exists; the catalogue has no `unit` in Pallav (name and price only), so it is "".
export function createLookupsService(deps: EntryDeps) {
  return {
    async get(session: VerifiedSession): Promise<CashLookups> {
      if (!can(session, deps.catalog, "revenue", "view") && !can(session, deps.catalog, "expense", "view")) throw new AppError("FORBIDDEN");
      return deps.unit.run(session, async (repos) => {
        const depositors = { hotel: await repos.masterLists.activeValues(DEPOSITOR_SETS.hotel), food: await repos.masterLists.activeValues(DEPOSITOR_SETS.food) };
        const receivers = { hotel: await repos.masterLists.activeValues(RECEIVER_SETS.hotel), food: await repos.masterLists.activeValues(RECEIVER_SETS.food) };
        const catalogue: CashLookups["catalogue"] = [];
        for (const book of CASH_BOOKS) {
          for (const c of await repos.expenseCatalog.forBook(book)) {
            catalogue.push({ id: c.id, book, name: c.name, items: c.items.map((i) => ({ id: i.id, name: i.name, unit: "", pricePaise: paiseToNumber(i.pricePaise) })) });
          }
        }
        return { depositors, receivers, staff: [], catalogue, shifts };
      });
    },
  };
}

export type LookupsService = ReturnType<typeof createLookupsService>;

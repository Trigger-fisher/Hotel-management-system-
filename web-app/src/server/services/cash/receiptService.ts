import "server-only";
import { depositReceipt, expenseReceipt, type CashReceipt } from "@shared/dashboards/cash";
import type { VerifiedSession } from "../../auth/session";
import type { ExpenseService } from "./expenseService";
import type { RevenueService } from "./revenueService";

// The cash book's printed receipts (MJ #22 "open in PDF always"): a deposit's revenue receipt and an expense's receipt. The data is the SAME DTO the
// screen shows (the services' own get, so the permission and the 404 for another hotel are theirs) turned into the CashReceipt the preview draws with the
// shared helpers, so the PDF and the preview can never disagree. The name printed on top is the business of the book (hotel or food) from the hotel's
// settings. Shift handover receipts are not here (the handover module is not built).

interface ReceiptHeader {
  name: string;
  foodName: string;
}

interface CashReceiptDeps {
  revenue: () => RevenueService;
  expenses: () => ExpenseService;
  /** The business names printed on top (Settings general.site_name and the food business unit). */
  header: (session: VerifiedSession) => Promise<ReceiptHeader>;
}

export function createCashReceiptService(deps: CashReceiptDeps) {
  const nameFor = (h: ReceiptHeader, book: "hotel" | "food"): string => (book === "food" ? h.foodName || h.name : h.name);
  return {
    /** The revenue receipt of one deposit (module revenue, view). */
    async deposit(session: VerifiedSession, id: string): Promise<CashReceipt> {
      const d = await deps.revenue().get(session, id);
      return depositReceipt(d, nameFor(await deps.header(session), d.book));
    },
    /** The receipt of one withdrawal or miscellaneous expense (module expense, view). */
    async expense(session: VerifiedSession, id: string): Promise<CashReceipt> {
      const e = await deps.expenses().get(session, id);
      return expenseReceipt(e, nameFor(await deps.header(session), e.book));
    },
  };
}

export type CashReceiptService = ReturnType<typeof createCashReceiptService>;

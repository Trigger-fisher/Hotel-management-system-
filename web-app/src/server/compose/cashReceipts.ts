import "server-only";
import { createCashReceiptService, type CashReceiptService } from "../services/cash/receiptService";
import { billingDefaults } from "./billing";
import { getCashExpenses, getCashRevenue } from "./cash";

// The cash receipts (PDF): the cash services for the entry and the hotel unit for the business names on top (the same header a bill prints).
let service: CashReceiptService | null = null;

export function getCashReceipts(): CashReceiptService {
  service ??= createCashReceiptService({
    revenue: getCashRevenue,
    expenses: getCashExpenses,
    header: (session) => billingDefaults().unit.run(session, (repos) => repos.hotelProfile.header()),
  });
  return service;
}

/** Replaces the receipt service (tests). */
export function configureCashReceipts(next: CashReceiptService | null): void {
  service = next;
}

import "server-only";

// Four Pallav behaviours MJ is asked to confirm (docs/specs/billing-bills.md §12, the worked examples). Each is built exactly as Pallav
// behind one switch, so MJ's answer is a one-line change here. DEFAULT = Pallav's behaviour (true) except what MJ has answered: #21 (a) is fixed (false).
export interface BillingQuirks {
  /** (a) A debit side's balance is the whole side total, ignoring the advance taken off (BillMasterController.php:443-444, :467-468). false = total − taken, never below 0. */
  debitBalanceIgnoresAdvance: boolean;
  /** (b) A settlement may be recorded on a bill with no side on Debit; everything paid becomes an excess advance (:502-569). false = "This bill is not on debit." */
  settleNonDebitMakesExcess: boolean;
  /** (c) Reversing a settlement sets both balances to the totals, even on a side not on Debit (:602-603). false = the balances a new bill gets. */
  reverseResetsNonDebit: boolean;
  /** (d) The excess advance is dated the day the settlement is recorded (:556, now()). false = the last instalment's date. */
  excessAdvanceDatedToday: boolean;
}

export const PALLAV_QUIRKS: BillingQuirks = {
  debitBalanceIgnoresAdvance: true,
  settleNonDebitMakesExcess: true,
  reverseResetsNonDebit: true,
  excessAdvanceDatedToday: true,
};

/** What the hotel runs with. Change a line here when MJ answers #21. */
export const billingQuirks: BillingQuirks = {
  ...PALLAV_QUIRKS,
  // MJ #21 (a): FIXED. A debit side owes its total less what was taken off the advance, never below zero (Pallav overstated it).
  debitBalanceIgnoresAdvance: false,
};

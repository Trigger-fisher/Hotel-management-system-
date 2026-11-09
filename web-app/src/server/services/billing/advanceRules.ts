import "server-only";

// The pure rules of a guest advance, ported from Pallav and golden-tested against the real PHP (db/scripts/php/generate-billing-fixtures.php):
// the two sides and their balances (BillMasterController::advanceAmounts, :174-186), the states (BillMasterAdvance::isUnused/isRefunded,
// :46-55), the refund and its reversal (:256-265, :280-283), the receipt number (:150) and the log's label and field names (:45-95).
// Money is bigint paise; nothing here touches a repository. Spec: docs/specs/billing-advances.md.

const ZERO = BigInt(0);

export type Covers = "hotel" | "food" | "both";

interface SidesInput {
  covers: Covers;
  hotelPaise: bigint | null;
  foodPaise: bigint | null;
  hotelMode: string | null;
  foodMode: string | null;
}

export interface Sides {
  hotelAmountPaise: bigint;
  foodAmountPaise: bigint;
  hotelBalancePaise: bigint;
  foodBalancePaise: bigint;
  totalPaise: bigint;
  hotelMode: string | null;
  foodMode: string | null;
  /** false = nothing paid at all ("Enter how much the guest paid."). */
  paid: boolean;
}

/** advanceAmounts: a side the form did not send is 0 (never kept from before); balance = amount; a side of 0 or less has no mode. */
export function advanceSides(input: SidesInput): Sides {
  const hotel = input.covers === "food" ? ZERO : (input.hotelPaise ?? ZERO);
  const food = input.covers === "hotel" ? ZERO : (input.foodPaise ?? ZERO);
  const total = hotel + food;
  return {
    hotelAmountPaise: hotel,
    foodAmountPaise: food,
    hotelBalancePaise: hotel,
    foodBalancePaise: food,
    totalPaise: total,
    hotelMode: hotel > ZERO ? input.hotelMode : null,
    foodMode: food > ZERO ? input.foodMode : null,
    paid: total > ZERO,
  };
}

interface AdvanceMoney {
  hotelAmountPaise: bigint;
  foodAmountPaise: bigint;
  hotelBalancePaise: bigint;
  foodBalancePaise: bigint;
  refundPaymentDate: string | null;
}

/** BillMasterAdvance::isUnused: both balances still equal their amounts. */
export const isUnused = (a: AdvanceMoney): boolean => a.hotelAmountPaise === a.hotelBalancePaise && a.foodAmountPaise === a.foodBalancePaise;
/** BillMasterAdvance::isRefunded: a refund date is set. */
export const isRefunded = (a: Pick<AdvanceMoney, "refundPaymentDate">): boolean => a.refundPaymentDate !== null;

/** The screen's status (ui-shared advanceStatus): refunded, unused, partly (money left) or used. */
export function advanceState(a: AdvanceMoney): "unused" | "partly" | "used" | "refunded" {
  if (isRefunded(a)) return "refunded";
  if (isUnused(a)) return "unused";
  return a.hotelBalancePaise + a.foodBalancePaise > ZERO ? "partly" : "used";
}

interface RefundMath {
  /** A side's refund is above its balance ("Refund amount cannot exceed the available advance balance."). */
  overBalance: boolean;
  hotelBalancePaise: bigint;
  foodBalancePaise: bigint;
  /** Pallav sets `total` to the refunded amounts. */
  totalPaise: bigint;
}

/** :256-265. Balances go down by the refunds; nothing is clamped (the caller refuses overBalance, even under force: no negative balance). */
export function refundMath(balances: { hotelBalancePaise: bigint; foodBalancePaise: bigint }, refund: { hotelPaise: bigint | null; foodPaise: bigint | null }): RefundMath {
  const hotel = refund.hotelPaise ?? ZERO;
  const food = refund.foodPaise ?? ZERO;
  return {
    overBalance: hotel > balances.hotelBalancePaise || food > balances.foodBalancePaise,
    hotelBalancePaise: balances.hotelBalancePaise - hotel,
    foodBalancePaise: balances.foodBalancePaise - food,
    totalPaise: hotel + food,
  };
}

/** :280-283. The refund goes back onto the balances; `total` becomes the two restored balances. */
export function reversalMath(a: { hotelBalancePaise: bigint; foodBalancePaise: bigint; hotelRefundAmountPaise: bigint | null; foodRefundAmountPaise: bigint | null }): { hotelBalancePaise: bigint; foodBalancePaise: bigint; totalPaise: bigint } {
  const hotel = a.hotelBalancePaise + (a.hotelRefundAmountPaise ?? ZERO);
  const food = a.foodBalancePaise + (a.foodRefundAmountPaise ?? ZERO);
  return { hotelBalancePaise: hotel, foodBalancePaise: food, totalPaise: hotel + food };
}

/** :150 date('Y').' / '.$number: the CURRENT year (IST) in front of the typed number. */
export const receiptNumber = (year: string, typed: string): string => `${year} / ${typed.trim()}`;

/** The prefix of an advance made from an overpaid debit settlement (:549). */
const EXCESS_PREFIX = "Excessive / ";
export const fromBillNumber = (receipt: string): string | null => (receipt.startsWith(EXCESS_PREFIX) ? receipt.slice(EXCESS_PREFIX.length) : null);

/** :45-48 the log's label. */
export const advanceLabel = (receipt: string, guestName: string): string => `${receipt} (${guestName})`;

/** :90-95 / SystemLogger::fieldName: "hotel_refund_amount" reads as "Hotel refund amount". */
export const readableField = (column: string): string => {
  const words = column.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** max(0, x) for a balance a bill takes money off (B2: BillMasterController.php:438-439). */

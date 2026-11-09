import "server-only";
// The one money module. Money is a whole number of paise (1 rupee = 100 paise), held as a bigint so a
// product like "amount x percentage" can never lose precision. No floats anywhere in here.
//
// Rounding matches PHP's round() as Pallav uses it: halves go AWAY from zero (2.5 -> 3, -2.5 -> -3).
// Pallav computes in floats and rounds once at the end (round($x, 2)); here the same sum is done
// exactly and rounded once, so the results agree wherever the float was not off by noise.

export type Paise = bigint;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

// BigInt literals (1n) need a newer compile target than the shared tsconfig has, so constants are built once here.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);
const BPS_DENOMINATOR = BigInt(10000);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_DECIMAL_SCALE = 9;
const MAX_DECIMAL_LENGTH = 30;

const absBig = (n: bigint): bigint => (n < ZERO ? -n : n);

function pow10(exponent: number): bigint {
  let result = ONE;
  for (let i = 0; i < exponent; i++) result *= TEN;
  return result;
}

/** A whole number of paise from a bigint, a safe integer, or digits only ("12345", "-50"). Anything else throws. */
export function toPaise(value: bigint | number | string): Paise {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new MoneyError("Paise must be a whole number");
    return BigInt(value);
  }
  if (!/^-?\d{1,18}$/.test(value)) throw new MoneyError("Paise must be digits only");
  return BigInt(value);
}

/** For the JSON edge (the API sends paise as integers). Throws when the value cannot be held exactly. */
export function paiseToNumber(paise: Paise): number {
  if (absBig(paise) > MAX_SAFE) throw new MoneyError("Amount is too large for a JSON number");
  return Number(paise);
}

export const add = (a: Paise, b: Paise): Paise => a + b;
export const sub = (a: Paise, b: Paise): Paise => a - b;
export const negate = (a: Paise): Paise => -a;
export const abs = (a: Paise): Paise => absBig(a);
export const sum = (values: readonly Paise[]): Paise => values.reduce((total, v) => total + v, ZERO);
/** max(0, value): Pallav's "outstanding" and "balance" never go below zero (SalaryProcessing::outstanding). */
export const atLeastZero = (a: Paise): Paise => (a < ZERO ? ZERO : a);

/** numerator / denominator rounded to a whole number, halves away from zero (PHP round()). */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === ZERO) throw new MoneyError("Division by zero");
  const negative = numerator < ZERO !== denominator < ZERO;
  const n = absBig(numerator);
  const d = absBig(denominator);
  const quotient = (n * TWO + d) / (d * TWO);
  return negative ? -quotient : quotient;
}

interface Decimal {
  units: bigint;
  scale: number;
}

/** "18", "2.5", "-0.125" -> exact digits and a scale. Rejects exponents, spaces, commas and anything long. */
function parseDecimal(text: string): Decimal {
  if (text.length > MAX_DECIMAL_LENGTH) throw new MoneyError("Number is too long");
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new MoneyError("Not a plain decimal number");
  const fraction = match[3] ?? "";
  if (fraction.length > MAX_DECIMAL_SCALE) throw new MoneyError("Too many decimal places");
  const units = BigInt(`${match[2]}${fraction}`);
  return { units: match[1] === "-" ? -units : units, scale: fraction.length };
}

/** amount x a decimal factor ("2.5" nights, "1.125" kg): Stay::roomCharge, StayController amount = quantity x unit price. */
export function mulDecimal(amount: Paise, factor: string): Paise {
  const f = parseDecimal(factor);
  return divRound(amount * f.units, pow10(f.scale));
}

/** amount x percentage ("18", "2.5"): the percentage fields are numeric(5,2) on bills. */
export function percentOf(amount: Paise, percentage: string): Paise {
  const p = parseDecimal(percentage);
  return divRound(amount * p.units, HUNDRED * pow10(p.scale));
}

/** amount x basis points (1 bp = 0.01 %). */
export function mulBps(amount: Paise, basisPoints: number): Paise {
  if (!Number.isSafeInteger(basisPoints)) throw new MoneyError("Basis points must be a whole number");
  return divRound(amount * BigInt(basisPoints), BPS_DENOMINATOR);
}

/** amount x numerator / denominator with ONE rounding at the end (OvertimeCalculator: salary / days / hours x overtime). */
export function ratio(amount: Paise, numerator: bigint, denominator: bigint): Paise {
  return divRound(amount * numerator, denominator);
}

/**
 * amount x numerator / (denominator x multiplier), numbers given as decimal text, ONE rounding at the end.
 * Pallav: ExpenseController price = total / quantity; OvertimeCalculator = salary / days / hours x overtime.
 */
export function ratioDecimal(amount: Paise, numerator: string, denominator: string, denominatorMultiplier: bigint = ONE): Paise {
  const n = parseDecimal(numerator);
  const d = parseDecimal(denominator);
  return divRound(amount * n.units * pow10(d.scale), d.units * denominatorMultiplier * pow10(n.scale));
}

/** Rupees as text ("1234.565") to paise, rounded like PHP round($x, 2). Used by the Pallav data import. */
export function fromRupees(rupees: string): Paise {
  const r = parseDecimal(rupees);
  return divRound(r.units * HUNDRED, pow10(r.scale));
}

/** 123456 -> "1234.56", -5 -> "-0.05". Plain, for exports and the import check. */
export function toRupeeString(paise: Paise): string {
  const negative = paise < ZERO;
  const a = absBig(paise);
  const rupees = a / HUNDRED;
  const rest = (a % HUNDRED).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${rupees.toString()}.${rest}`;
}

/** Indian digit grouping: 1234567 -> "12,34,567". Same output as ui-shared formatINR. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** 12345600 -> "₹1,23,456.00"; negative -> "-₹500.00". */
export function formatInr(paise: Paise, options: { decimals?: boolean } = {}): string {
  const negative = paise < ZERO;
  const a = absBig(paise);
  const rupees = groupIndian((a / HUNDRED).toString());
  const rest = (a % HUNDRED).toString().padStart(2, "0");
  const body = options.decimals === false ? rupees : `${rupees}.${rest}`;
  return `${negative ? "-" : ""}₹${body}`;
}

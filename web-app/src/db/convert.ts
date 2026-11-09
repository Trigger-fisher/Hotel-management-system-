import "server-only";
// The ONE place PostgreSQL's values become numbers, big integers and moments, and back. The pool returns bigint and numeric as TEXT, date as
// text and timestamptz as a Date (db/pool.ts), so nothing is ever rounded or shifted by a driver guess.
//
//   * money is bigint paise: `toBigInt` is exact; `toSafeNumber` FAILS LOUDLY above Number.MAX_SAFE_INTEGER instead of rounding;
//   * numeric (percentages, quantities, hours) goes through `toDecimalNumber`, which refuses a value a double cannot hold exactly;
//   * timestamptz is UTC: `fromDbDateTime` / `toDbDateTime` convert to and from a Date (millisecond precision: the microseconds are
//     truncated on the way in, never rounded up into the next millisecond), and the session time zone is UTC on every connection;
//   * DATE and TIME stay strings ("2026-03-31", "18:30:00"): a calendar day has no zone.

const INTEGER_TEXT = /^-?\d+$/;
const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;
const DATETIME_TEXT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|[+-]00(?::?00)?)?$/;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionError";
  }
}

/** An integer column (bigint) as an exact bigint. Accepts the driver's text, a bigint, or a number that is a safe integer. */
export function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && INTEGER_TEXT.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new ConversionError("Not an exact integer");
}

/** A counter or an entry number as a number. Anything beyond 2^53 - 1 throws: it must never be rounded into a different number. */
export function toSafeNumber(value: unknown): number {
  const big = toBigInt(value);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER)) throw new ConversionError("The integer does not fit a number exactly");
  return Number(big);
}

/** A DECIMAL(p, s) as a number, only when the double is exactly what the text says (at most 15 significant digits). */
export function toDecimalNumber(value: unknown): number {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !DECIMAL_TEXT.test(text)) throw new ConversionError("Not a decimal number");
  const digits = text.replace(/^-/, "").replace(".", "").replace(/^0+(?=\d)/, "");
  if (digits.length > 15) throw new ConversionError("The decimal has too many digits for a number");
  const number = Number(text);
  if (!Number.isFinite(number)) throw new ConversionError("Not a decimal number");
  return number;
}

/** A number or bigint of paise as the exact text a bigint parameter takes (never an exponent, never a fraction). */
export function paiseParam(value: bigint | number): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new ConversionError("Paise must be a whole, safe integer");
    return String(value);
  }
  return value.toString();
}

/** A timestamptz as a Date (the driver returns a Date; text such as "2026-03-04 05:06:07.123456+00" is accepted too), truncated to the millisecond. */
export function fromDbDateTime(value: unknown): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ConversionError("Not a real moment");
    return value;
  }
  if (typeof value !== "string") throw new ConversionError("Not a timestamp");
  const m = DATETIME_TEXT.exec(value);
  if (!m) throw new ConversionError("Not a timestamp text");
  const ms = Number((m[7] ?? "").padEnd(3, "0").slice(0, 3) || "0");
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), ms));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== Number(m[2]) - 1) throw new ConversionError("Not a real moment");
  return date;
}

/** A Date -> an ISO-8601 UTC text ("2026-03-04T05:06:07.123Z") for a timestamptz parameter. Always text, so the driver's own zone logic never runs. */
export function toDbDateTime(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new ConversionError("Not a valid Date");
  return date.toISOString();
}

/** A DATE column's text, checked: "2026-03-31". */
export function toDbDate(value: unknown): string {
  if (typeof value !== "string" || !DATE_TEXT.test(value)) throw new ConversionError("Not a DATE text");
  return value;
}

/** The calendar day in India (IST = UTC+05:30, no daylight saving) of a moment, as "YYYY-MM-DD": the day Pallav's books use. */
export function istDay(date: Date): string {
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

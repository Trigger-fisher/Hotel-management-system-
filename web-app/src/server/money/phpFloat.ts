import "server-only";

// Pallav's payroll works in PHP floats (SalaryProcessor, OvertimeCalculator: (float) of decimal(…,2) columns, then round(…, 2)). To give the
// same rupees, HMS repeats the SAME float steps (JS numbers are the same IEEE doubles) and rounds with a line-by-line port of PHP 8.3's
// round() (ext/standard/math.c _php_math_round, mode HALF_UP): Pallav's live server runs PHP 8.3, which "pre-rounds" to 15 significant
// digits, so an exact decimal tie (1640.625) rounds UP where 8.4 rounds the float below it down. The generator
// db/scripts/php/generate-round-fixtures.php carries the same port; the golden tests compare against its 8.3 column.

const POW10 = [1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22];
const p10 = (p: number): number => (p < 0 || p > 22 ? Math.pow(10, p) : POW10[p]);
const halfUp = (v: number): number => (v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5));
const basic = (value: number, places: number): number => (places >= 0 ? value * p10(Math.abs(places)) : value / p10(Math.abs(places)));

/** PHP 8.3 round($value, $places). */
export function phpRound(value: number, places = 0): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const precisionPlaces = 14 - Math.floor(Math.log10(Math.abs(value)));
  const f1 = p10(Math.abs(places));
  let tmp: number;
  if (precisionPlaces > places && precisionPlaces - 15 < places) {
    let usePrecision = precisionPlaces < -(4 * 15) ? -(4 * 15) : precisionPlaces;
    // pre-round to 15 significant digits
    tmp = halfUp(basic(value, usePrecision));
    usePrecision = Math.max(-4 * 15, places - usePrecision);
    tmp = tmp / p10(Math.abs(usePrecision));
  } else {
    tmp = places >= 0 ? value * f1 : value / f1;
    if (Math.abs(tmp) >= 1e15) return value;
  }
  tmp = halfUp(tmp);
  if (Math.abs(places) < 23) tmp = places > 0 ? tmp / f1 : tmp * f1;
  return tmp;
}

/** A rupee float rounded to 2 places, as paise (exact: the float is already at 2 places). */
export const rupeesToPaise = (rupees: number): bigint => BigInt(Math.round(phpRound(rupees, 2) * 100));
/** Paise as the float PHP reads from a decimal(…,2) column ((float) "12345.67"). */
export const paiseToRupees = (paise: bigint): number => Number(paise) / 100;

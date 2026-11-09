// How Pallav's report pages print money and days (reports/partials/*.blade.php):
//   money: Pallav printed 'Rs 154,956.00'; HMS prints ₹ as on every page (formatINR, grouping from MONEY_GROUPING in format.ts)
//   Carbon::parse($d)->format('d M')                          -> "29 Sep"
import { formatDate, formatINR } from '@shared/dashboards/format';

/** 15495600 paise -> "₹154,956.00", as every other page prints money (MJ, 26 Oct 2026: one way of writing money; Pallav's report pages wrote "Rs "). */
export const rs = (paise: number): string => formatINR(paise);

/** "2026-09-29" -> "29 Sep". */
export const dm = (iso: string): string => formatDate(iso).slice(0, 6);

/** Pallav DailySheet/FoodPlanMonth shortRef(): "SR/26-27/1660" is how it is stored; the desk says "1660". */
export function shortRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const last = ref.split('/').pop()?.trim();
  return last || ref;
}

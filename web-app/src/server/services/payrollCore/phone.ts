import "server-only";
import type { PhoneCountry } from "@shared/dashboards/payrollCore";

// A port of Pallav's Support/PhoneCountries.php (golden: db/scripts/php/fixtures/payroll-core.json, every country's sample and edges run through
// REAL PHP). Numbers are stored as a dial code plus national digits, never one "+91..." string. PHP's preg_replace('/\D+/') and ctype_digit are
// ASCII here as in PHP. Spec: docs/specs/payroll-core.md §4.

export const DEFAULT_DIAL = "91";

type Row = readonly [iso: string, name: string, dial: string, min: number, max: number, lead: string | null, sample: string];

const LIST: readonly Row[] = [
  ["IN", "India", "91", 10, 10, "[6-9]", "98765 43210"],
  ["AE", "United Arab Emirates", "971", 9, 9, "5", "50 123 4567"],
  ["SA", "Saudi Arabia", "966", 9, 9, "5", "50 123 4567"],
  ["QA", "Qatar", "974", 8, 8, null, "3123 4567"],
  ["KW", "Kuwait", "965", 8, 8, null, "5000 0000"],
  ["OM", "Oman", "968", 8, 8, null, "9212 3456"],
  ["BH", "Bahrain", "973", 8, 8, null, "3600 1234"],
  ["NP", "Nepal", "977", 10, 10, "9", "98 1234 5678"],
  ["BD", "Bangladesh", "880", 10, 10, "1", "1712 345678"],
  ["LK", "Sri Lanka", "94", 9, 9, "7", "71 234 5678"],
  ["PK", "Pakistan", "92", 10, 10, "3", "301 2345678"],
  ["BT", "Bhutan", "975", 8, 8, null, "17 123 456"],
  ["MV", "Maldives", "960", 7, 7, null, "771 2345"],
  ["AF", "Afghanistan", "93", 9, 9, null, "70 123 4567"],
  ["US", "United States / Canada", "1", 10, 10, null, "201 555 0123"],
  ["GB", "United Kingdom", "44", 10, 10, "7", "7400 123456"],
  ["IE", "Ireland", "353", 9, 9, null, "85 012 3456"],
  ["AU", "Australia", "61", 9, 9, "4", "412 345 678"],
  ["NZ", "New Zealand", "64", 8, 10, null, "21 123 4567"],
  ["SG", "Singapore", "65", 8, 8, null, "8123 4567"],
  ["MY", "Malaysia", "60", 9, 10, null, "12 345 6789"],
  ["ID", "Indonesia", "62", 9, 12, null, "812 3456 789"],
  ["TH", "Thailand", "66", 9, 9, null, "81 234 5678"],
  ["PH", "Philippines", "63", 10, 10, null, "917 123 4567"],
  ["HK", "Hong Kong", "852", 8, 8, null, "5123 4567"],
  ["CN", "China", "86", 11, 11, null, "131 2345 6789"],
  ["JP", "Japan", "81", 10, 10, null, "90 1234 5678"],
  ["KR", "South Korea", "82", 9, 10, null, "10 1234 5678"],
  ["DE", "Germany", "49", 10, 11, null, "151 23456789"],
  ["FR", "France", "33", 9, 9, null, "6 12 34 56 78"],
  ["IT", "Italy", "39", 9, 10, null, "312 345 6789"],
  ["ES", "Spain", "34", 9, 9, null, "612 34 56 78"],
  ["NL", "Netherlands", "31", 9, 9, null, "6 12345678"],
  ["CH", "Switzerland", "41", 9, 9, null, "78 123 45 67"],
  ["SE", "Sweden", "46", 9, 9, null, "70 123 45 67"],
  ["RU", "Russia", "7", 10, 10, null, "912 345 6789"],
  ["ZA", "South Africa", "27", 9, 9, null, "71 123 4567"],
  ["KE", "Kenya", "254", 9, 9, null, "712 345678"],
  ["NG", "Nigeria", "234", 10, 10, null, "802 123 4567"],
  ["MU", "Mauritius", "230", 8, 8, null, "5251 2345"],
  ["BR", "Brazil", "55", 10, 11, null, "11 91234 5678"],
];

export interface Country {
  iso: string;
  name: string;
  dial: string;
  min: number;
  max: number;
  lead: string | null;
  sample: string;
}

const ALL: readonly Country[] = LIST.map(([iso, name, dial, min, max, lead, sample]) => ({ iso, name, dial, min, max, lead, sample }));
/** Longest dial code first, so "+9198..." is India and "+971..." the UAE (split :104-131). */
const BY_LENGTH = [...ALL.map((c) => c.dial)].sort((a, b) => b.length - a.length);
const IN_MESSAGE = "Enter a 10-digit mobile number starting with 6, 7, 8 or 9.";

const digitsOf = (s: string): string => s.replace(/[^0-9]+/g, "");
const wanted = (c: Country): string => (c.min === c.max ? String(c.min) : `${c.min} to ${c.max}`);

export const all = (): readonly Country[] => ALL;
export const dials = (): string[] => ALL.map((c) => c.dial);
export const find = (dial: string | null | undefined): Country | null => ALL.find((c) => c.dial === String(dial ?? "")) ?? null;

/** "+971 50 123 4567" → ["971", "501234567"]; null without a "+" or "00", or with no known code. */
export function split(raw: string): [string, string] | null {
  const r = raw.trim();
  if (!r.startsWith("+") && !r.startsWith("00")) return null;
  let digits = digitsOf(r);
  if (r.startsWith("00")) digits = digits.slice(2);
  for (const dial of BY_LENGTH) if (digits.startsWith(dial)) return [dial, digits.slice(dial.length)];
  return null;
}

/** normalise (:138-168): whatever was typed, as [dial, national digits]. A "+" names the country and wins over the selector. */
export function normalise(raw: string | null | undefined, selected?: string | null): [string, string] {
  const r = String(raw ?? "").trim();
  const dial = selected !== null && selected !== undefined && selected !== "" ? String(selected) : DEFAULT_DIAL;
  const parts = split(r);
  if (parts) return parts;
  let digits = digitsOf(r);
  const country = find(dial);
  if (country && digits !== "") {
    if (digits.length === country.max + 1 && digits.startsWith("0")) {
      // a trunk zero, as in 098765 43210
      digits = digits.slice(1);
    } else if (
      digits.startsWith(dial) &&
      digits.length >= dial.length + country.min &&
      digits.length <= dial.length + country.max &&
      !(digits.length >= country.min && digits.length <= country.max)
    ) {
      // the country code typed without its "+"
      digits = digits.slice(dial.length);
    }
  }
  return [dial, digits];
}

/** check (:171-196): the sentence saying what is wrong, or null. */
export function check(dial: string | null | undefined, national: string | null | undefined): string | null {
  const country = find(dial);
  if (!country) return "Choose a country code from the list.";
  const n = String(national ?? "");
  if (!/^[0-9]+$/.test(n) || n.length < country.min || n.length > country.max) {
    return country.iso === "IN" ? IN_MESSAGE : `Enter a valid ${country.name} number of ${wanted(country)} digits.`;
  }
  if (country.lead !== null && !new RegExp(`^${country.lead}`).test(n)) {
    return country.iso === "IN" ? IN_MESSAGE : `That does not look like a ${country.name} mobile number.`;
  }
  return null;
}

/** message (:199-210) */
export function message(dial: string | null | undefined): string {
  const c = find(dial) ?? find(DEFAULT_DIAL)!;
  return c.iso === "IN" ? IN_MESSAGE : `Enter a valid ${c.name} number of ${wanted(c)} digits.`;
}

/** pattern (:213-219): the same rule for the browser. */
export function pattern(dial: string | null | undefined): string {
  const c = find(dial) ?? find(DEFAULT_DIAL)!;
  return `${c.lead ?? "[0-9]"}[0-9]{${c.min - 1},${c.max - 1}}`;
}

/** format (:222-237): "+91 98765 43210" (India five and five), else "+{dial} {national}". */
export function format(dial: string | null | undefined, national: string | null | undefined): string {
  const n = String(national ?? "");
  if (n === "") return "";
  const d = find(dial) ? String(dial) : DEFAULT_DIAL;
  if (d === "91" && n.length === 10) return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
  return `+${d} ${n}`;
}

export const phoneCountries = (): PhoneCountry[] => ALL.map((c) => ({ ...c, pattern: pattern(c.dial), message: message(c.dial) }));

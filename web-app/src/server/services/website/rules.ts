import "server-only";

// The website's small text rules, ports of Pallav's Support/Site/Phone.php (normalize, display, guests) and Support/Site/Reference.php (the
// fiscal year and the reference text). Golden: db/scripts/php/generate-website-fixtures.php → fixtures/website.json. Spec: docs/specs/website.md.

/** Longest code first, so 971 is tried before a 1-digit code could wrongly match its first digit (Phone::CALLING_CODES). */
const CALLING_CODES = [
  "971", "972", "973", "974", "966", "968", "965", "962", "961", "963", "964",
  "880", "977", "960", "976", "975", "673",
  "86", "81", "82", "84", "65", "60", "66", "63", "62", "91", "92", "93", "94", "95", "98",
  "44", "49", "33", "39", "34", "31", "32", "41", "43", "46", "47", "45", "48", "30", "36", "61", "64", "20", "27", "55", "52", "54", "51", "57", "58",
  "1", "7",
];

const digitsOf = (s: string): string => s.replace(/[^0-9]/g, "");

/** Phone::normalize: a clean "+<countrycode><number>"; a bare 10-digit number is Indian; a redundant trunk "0" after a country code is dropped. */
export function normalizePhone(raw: string): string {
  const r = raw.trim();
  const hasPlus = r.startsWith("+");
  let digits = digitsOf(r);
  if (!hasPlus && digits.length === 10) digits = `91${digits}`;
  else if (hasPlus) {
    for (const code of CALLING_CODES) {
      if (digits.startsWith(code) && digits.charAt(code.length) === "0") {
        digits = code + digits.slice(code.length + 1);
        break;
      }
    }
  }
  return `+${digits}`;
}

/** Phone::display: "+919825735404" reads "+91 98257 35404"; anything else as it is. */
export function displayPhone(raw: string | null | undefined): string {
  const digits = digitsOf(raw ?? "");
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7, 12)}`;
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5, 10)}`;
  return raw ?? "";
}

/** Phone::guests: "3 Guests", or once the split is known "2 Guests + 1 Child". */
export function guestsLabel(total: number | null, children: number | null): string {
  const t = total ?? 0;
  const c = children ?? 0;
  if (t <= 0) return "";
  if (c <= 0) return `${t} Guest${t === 1 ? "" : "s"}`;
  const adults = Math.max(0, t - c);
  return `${adults} Guest${adults === 1 ? "" : "s"} + ${c} Child${c === 1 ? "" : "ren"}`;
}

/** The fiscal year an IST date belongs to: 1 April to 31 March (Reference::next :14-16). */
export function fiscalYearOf(day: string): number {
  const year = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) >= 4 ? year : year - 1;
}

/** "{prefix}-ddmmyyyy-00042" (Reference::next :35); Pallav's prefix is "HP" (Hotel Pallav): the hotel's own initials here. */
export function referenceText(prefix: string, day: string, serial: number): string {
  return `${prefix}-${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(0, 4)}-${String(serial).padStart(5, "0")}`;
}

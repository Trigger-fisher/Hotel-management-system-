// Display formats for every dashboard (MASTER section 8). Web and mobile use only these.
// Money is stored in paise (integer). Times are stored in UTC and shown in IST.

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Three languages (MJ, 3 Nov 2026): the month and weekday NAMES follow the language of the screen. Digits stay Latin (0-9) in every language and the order of
// day, month and year does not change. The language is set only by the browser's language store (web-app/src/lib/i18n/language.ts); the server, the PDFs and the
// emails never set it, so they stay English. Money is untouched (MONEY_GROUPING below).
const NAMES = {
  en: { months: EN_MONTHS, short: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], long: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
  hi: {
    months: ['जन॰', 'फ़र॰', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुल॰', 'अग॰', 'सित॰', 'अक्तू॰', 'नव॰', 'दिस॰'],
    short: ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'],
    long: ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'],
  },
  gu: {
    months: ['જાન્યુ', 'ફેબ્રુ', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટે', 'ઑક્ટો', 'નવે', 'ડિસે'],
    short: ['રવિ', 'સોમ', 'મંગળ', 'બુધ', 'ગુરુ', 'શુક્ર', 'શનિ'],
    long: ['રવિવાર', 'સોમવાર', 'મંગળવાર', 'બુધવાર', 'ગુરુવાર', 'શુક્રવાર', 'શનિવાર'],
  },
  fr: {
    months: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
    short: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
    long: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  },
  de: {
    months: ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'],
    short: ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'],
    long: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  },
} as const;

let displayLanguage: keyof typeof NAMES = 'en';

/** The language the dates are written in ('en' unless the browser's language store says otherwise). */
export function setDisplayLanguage(language: string): void {
  displayLanguage = language === 'hi' || language === 'gu' || language === 'fr' || language === 'de' ? language : 'en';
}

const monthNames = (): readonly string[] => NAMES[displayLanguage].months;
/**
 * ONE central switch for how rupee amounts are grouped (MJ: 100% same as Hotel Pallav, which prints western thousands:
 * 126,000.00). Flip to 'indian' for lakh grouping (1,26,000.00) everywhere, web, mobile and PDFs, by changing this value.
 */
export const MONEY_GROUPING: 'western' | 'indian' = 'western';

/** Digit grouping per MONEY_GROUPING: 1234567 -> "1,234,567" (western, Pallav) or "12,34,567" (indian). */
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  if (MONEY_GROUPING === 'western') return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** 12345600 paise -> "₹1,23,456.00". Negative -> "-₹500.00". */
export function formatINR(paise: number, opts: { decimals?: boolean } = {}): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100).toString();
  const p = (abs % 100).toString().padStart(2, '0');
  const body = opts.decimals === false ? groupIndian(rupees) : `${groupIndian(rupees)}.${p}`;
  return `${neg ? '-' : ''}₹${body}`;
}

/** A size on disk: 980 B, 12.4 KB, 38.5 MB, 1.2 GB (1024 steps, one decimal from KB up, none at or above 100). */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Math.max(0, bytes);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  const text = i === 0 ? String(Math.round(n)) : n >= 100 ? String(Math.round(n)) : n.toFixed(1);
  return `${text} ${units[i]}`;
}

/** Compact for KPI tiles: ₹1.2 L, ₹3.4 Cr, ₹950. */
export function formatINRCompact(paise: number): string {
  const r = paise / 100;
  const a = Math.abs(r);
  const sign = r < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)} L`;
  return `${sign}₹${groupIndian(Math.round(a).toString())}`;
}

interface IstParts { y: number; m: number; d: number; hh: number; mm: number }

function istParts(iso: string): IstParts {
  // IST is UTC+05:30 with no daylight saving, so a fixed offset is exact.
  const t = new Date(iso).getTime() + 330 * 60_000;
  const x = new Date(t);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), hh: x.getUTCHours(), mm: x.getUTCMinutes() };
}

/** "2026-10-04T10:00:00Z" or "2026-10-04" -> "04 Oct 2026". Plain dates (stay nights) are not shifted. */
export function formatDate(isoOrDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) {
    const [y, m, d] = isoOrDate.split('-');
    return `${d} ${monthNames()[Number(m) - 1] ?? ''} ${y}`;
  }
  const p = istParts(isoOrDate);
  return `${String(p.d).padStart(2, '0')} ${monthNames()[p.m] ?? ''} ${p.y}`;
}


/**
 * "Sat, 04 Oct 2026" (or "Saturday, 04 Oct 2026" with `long`; "Sat, 4 Oct 2026" with `padDay: false`) in IST. A plain date ("2026-10-04")
 * is that day as it stands; a timestamp is shifted to IST first, so a browser in another zone still shows the hotel's day.
 */
export function formatWeekdayDate(isoOrDate: string, { long = false, padDay = true }: { long?: boolean; padDay?: boolean } = {}): string {
  let y: number;
  let m: number;
  let d: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) {
    [y, m, d] = isoOrDate.split('-').map(Number) as [number, number, number];
    m -= 1;
  } else {
    ({ y, m, d } = istParts(isoOrDate));
  }
  const wd = new Date(Date.UTC(y, m, d)).getUTCDay();
  return `${(long ? NAMES[displayLanguage].long : NAMES[displayLanguage].short)[wd] ?? ''}, ${padDay ? String(d).padStart(2, '0') : d} ${monthNames()[m] ?? ''} ${y}`;
}

/** The hotel's wall clock (IST) at `ms`: today's date ("2026-10-10") and the hour (0-23), minute and second, for live clocks and greetings. */
export function istWallClock(ms: number = Date.now()): { date: string; hh: number; mm: number; ss: number } {
  const x = new Date(ms + 330 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`, hh: x.getUTCHours(), mm: x.getUTCMinutes(), ss: x.getUTCSeconds() };
}

/** "03:05:09 pm" (12-hour IST with seconds), for audit trails where the second matters. */
export function formatTimeSeconds(iso: string): string {
  const x = new Date(new Date(iso).getTime() + 330 * 60_000);
  const hh = x.getUTCHours();
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h12)}:${pad(x.getUTCMinutes())}:${pad(x.getUTCSeconds())} ${hh < 12 ? 'am' : 'pm'}`;
}

/** "3:05 pm" (12-hour IST). */
export function formatTime(iso: string): string {
  const p = istParts(iso);
  const h12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  return `${h12}:${String(p.mm).padStart(2, '0')} ${p.hh < 12 ? 'am' : 'pm'}`;
}

/** "04 Oct 2026, 3:05 pm". */
export function formatDateTime(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** "Oct 2026" for month pickers and payroll periods ("2026-10"). */
export function formatMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-');
  return `${monthNames()[Number(m) - 1] ?? ''} ${y}`;
}

/** A plain count with thousands separators (1,234), grouped like the money (`MONEY_GROUPING`). */
export function formatCount(n: number): string {
  return groupIndian(String(Math.round(Math.abs(n)))).replace(/^/, n < 0 ? '-' : '');
}

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 2026" for page titles and statements ("2026-10"). */
export function formatMonthLong(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-');
  return `${LONG_MONTHS[Number(m) - 1] ?? ''} ${y}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function upTo99(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = TENS[Math.floor(n / 10)] ?? '';
  const o = ONES[n % 10] ?? '';
  return o ? `${t} ${o}` : t;
}

function upTo999(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? upTo99(r) : ''].filter(Boolean).join(' ');
}

/** Indian words with Lakh/Crore: 12345600 paise -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only". */
export function amountInWords(paise: number): string {
  let n = Math.floor(Math.abs(paise) / 100);
  const ps = Math.abs(paise) % 100;
  if (n === 0 && ps === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${upTo999(crore)} Crore`);
  if (lakh) parts.push(`${upTo99(lakh)} Lakh`);
  if (thousand) parts.push(`${upTo99(thousand)} Thousand`);
  if (n) parts.push(upTo999(n));
  const rupees = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero';
  return ps ? `${rupees} and ${upTo99(ps)} Paise Only` : `${rupees} Only`;
}

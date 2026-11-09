// Small helpers shared by the company screens (no drawing here).

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** PHP's `now()->format('F Y')`: "October 2026". */
export function monthYear(at: Date = new Date()): string {
  return `${MONTHS_LONG[at.getMonth()]} ${at.getFullYear()}`;
}

/** Laravel's `Str::limit($text, $n)`: the first n characters, then "...". */
export function limit(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n).trimEnd()}...` : text;
}

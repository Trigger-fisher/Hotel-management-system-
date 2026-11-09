import "server-only";

// "Today", "now" and "this month" are in IST (Asia/Kolkata, UTC+05:30, no daylight saving). Pallav runs on its app timezone; HMS
// fixes it to IST (standard) so the answer never depends on the server's clock zone.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const pad = (n: number): string => String(n).padStart(2, "0");

export interface IstMoment {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM:SS */
  time: string;
}

export function istMoment(at: Date): IstMoment {
  const t = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`,
  };
}

/** The first and last day of the IST month a date belongs to. */
export function monthRange(date: string): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

/** The UTC instant of an IST date and time ("2026-10-05", "10:30:00"). */
export function istInstant(date: string, time: string): Date {
  const [h, m, s] = time.split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m, s ?? 0) - IST_OFFSET_MS);
}

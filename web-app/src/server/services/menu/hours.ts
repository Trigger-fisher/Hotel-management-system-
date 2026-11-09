import "server-only";
// The restaurant's ORDERING HOURS (decision 52): the hotel admin sets, per weekday, whether ordering is open and from when to when, plus one switch
// "accepting orders". A guest in the house may order now only inside an open period; outside it, only a scheduled order inside one. Kept as two keys in
// the hotel's settings (restaurant.accepting "1"/"0", restaurant.hours a JSON list of seven days, Monday first) so no table is needed. Never set =
// accepting, open all day, every day. Times are the hotel's clock (IST), 24-hour "HH:MM"; a period never crosses midnight (opens before closes).

export const HOURS_KEY = "restaurant.hours";
export const ACCEPTING_KEY = "restaurant.accepting";

export interface DayHours {
  /** 0 = Monday ... 6 = Sunday. */
  day: number;
  closed: boolean;
  opens: string;
  closes: string;
}
export interface RestaurantHours {
  accepting: boolean;
  days: DayHours[];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const OPEN_ALL_DAY: RestaurantHours = { accepting: true, days: Array.from({ length: 7 }, (_, day) => ({ day, closed: false, opens: "00:00", closes: "23:59" })) };

/** What the settings hold, read as hours (anything missing or damaged reads as open all day). */
export function hoursFromSettings(accepting: string | null | undefined, raw: string | null | undefined): RestaurantHours {
  let days = OPEN_ALL_DAY.days;
  try {
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(list) && list.length === 7) {
      const parsed = list.map((d, day) => ({ day, closed: Boolean((d as DayHours).closed), opens: String((d as DayHours).opens), closes: String((d as DayHours).closes) }));
      if (parsed.every((d) => d.closed || (HHMM.test(d.opens) && HHMM.test(d.closes) && minutes(d.opens) < minutes(d.closes)))) days = parsed;
    }
  } catch {
    // damaged: open all day
  }
  return { accepting: accepting === null || accepting === undefined || accepting === "" ? true : accepting === "1", days };
}

/** The settings values for these hours. */
export const hoursToSettings = (h: RestaurantHours): { accepting: string; hours: string } => ({ accepting: h.accepting ? "1" : "0", hours: JSON.stringify(h.days.map(({ closed, opens, closes }) => ({ closed, opens, closes }))) });

/** The hours as typed, checked: seven days 0..6 once each, an open day with opens before closes. Returns the message of the first problem, or the clean hours. */
export function checkHours(input: { accepting: boolean; days: { day: number; closed: boolean; opens: string; closes: string }[] }): { ok: true; hours: RestaurantHours } | { ok: false; message: string } {
  const byDay = new Map(input.days.map((d) => [d.day, d]));
  if (input.days.length !== 7 || byDay.size !== 7 || [0, 1, 2, 3, 4, 5, 6].some((d) => !byDay.has(d))) return { ok: false, message: "Give the hours for each of the seven days." };
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const days: DayHours[] = [];
  for (let day = 0; day < 7; day += 1) {
    const d = byDay.get(day) as DayHours;
    if (d.closed) {
      days.push({ day, closed: true, opens: "00:00", closes: "00:00" });
      continue;
    }
    if (!HHMM.test(d.opens) || !HHMM.test(d.closes)) return { ok: false, message: `${names[day]}: enter the times as 24-hour HH:MM, for example 07:30.` };
    if (minutes(d.opens) >= minutes(d.closes)) return { ok: false, message: `${names[day]}: the opening time must be before the closing time (a period cannot pass midnight).` };
    days.push({ day, closed: false, opens: d.opens, closes: d.closes });
  }
  return { ok: true, hours: { accepting: input.accepting, days } };
}

/** The IST weekday (0 = Monday) and minutes of the day of an instant. */
function istParts(at: Date): { day: number; minute: number; date: string } {
  const shifted = new Date(at.getTime() + 330 * 60_000);
  return { day: (shifted.getUTCDay() + 6) % 7, minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(), date: shifted.toISOString().slice(0, 10) };
}

/** Is ordering open at this instant (the switch on and inside the day's period)? */
export function isOpenAt(h: RestaurantHours, at: Date): boolean {
  if (!h.accepting) return false;
  const p = istParts(at);
  const d = h.days[p.day];
  return !d.closed && p.minute >= minutes(d.opens) && p.minute < minutes(d.closes);
}

/** The IST calendar date (YYYY-MM-DD) of an instant. */
export const istDateOf = (at: Date): string => istParts(at).date;

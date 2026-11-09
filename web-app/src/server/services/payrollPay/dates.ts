import "server-only";

// Carbon's date formats Pallav prints in sentences, on "YYYY-MM-DD" days (no time zone arithmetic: a day is a calendar day).
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** format('j F Y'): "5 October 2026" */
export const longDate = (day: string): string => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
/** format('d M Y'): "05 Sep 2026" */
export const shortDate = (day: string): string => `${day.slice(8, 10)} ${MONTHS[Number(day.slice(5, 7)) - 1].slice(0, 3)} ${day.slice(0, 4)}`;
/** format('d-m-Y'): "05-09-2026" */
export const dmy = (day: string): string => `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}`;
/** format('F Y'): "October 2026" */
export const monthYear = (day: string): string => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
export const monthOf = (day: string): string => day.slice(0, 7);
/** The month after a "YYYY-MM". */
export const nextMonth = (ym: string): string => (ym.slice(5, 7) === "12" ? `${Number(ym.slice(0, 4)) + 1}-01` : `${ym.slice(0, 4)}-${String(Number(ym.slice(5, 7)) + 1).padStart(2, "0")}`);
/** The first day of the month after the one a day is in. */
/** EmployeeMealPeriod::label (:56-59): "12 Aug 2026 - 05 Sep 2026" or "12 Aug 2026 - ongoing". */
export const periodLabel = (p: { startsOn: string; endsOn: string | null }): string => `${shortDate(p.startsOn)} - ${p.endsOn ? shortDate(p.endsOn) : "ongoing"}`;

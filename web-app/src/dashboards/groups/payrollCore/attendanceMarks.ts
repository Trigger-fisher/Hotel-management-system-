// The phone's Today view of attendance (MJ's attendance preview, 5 Nov 2026): one column of the month sheet, marked person by person, saved through the
// month save with only today's key changed. Pure, so a test can run it.
import type { AttendanceSaveRow, AttendanceSheet, AttendanceStatus } from '@shared/dashboards/payrollCore';

export interface TodayPerson {
  employeeId: string;
  name: string;
  code: string;
  designation: string;
  /** The key on the sheet for today ("P"), upper case; '' = not marked. */
  key: string;
}

/** The three big buttons (present, half day, absent) and the rest for the More sheet, from the hotel's own marks. */
export function quickMarks(statuses: readonly AttendanceStatus[]): { quick: AttendanceStatus[]; more: AttendanceStatus[]; present: AttendanceStatus | null } {
  const active = statuses.filter((s) => s.isActive);
  const pick = (pct: number, paid: boolean | null, prefer: string) =>
    active.find((s) => s.shortcutKey.toUpperCase() === prefer && s.attendancePercentage === pct) ??
    active.find((s) => s.attendancePercentage === pct && (paid === null || (s.statusType === 'Paid') === paid));
  const present = pick(100, true, 'P') ?? null;
  const half = pick(50, null, 'HD');
  const absent = pick(0, false, 'A');
  const quick = [present, half, absent].filter((s): s is AttendanceStatus => Boolean(s));
  const more = active.filter((s) => !quick.includes(s)).sort((a, b) => a.name.localeCompare(b.name));
  return { quick, more, present };
}

export function todayPeople(sheet: AttendanceSheet, dayIndex: number): TodayPerson[] {
  return sheet.rows.map((r) => ({ employeeId: r.employeeId, name: r.employeeName, code: r.employeeCode, designation: r.designation, key: (r.keys[dayIndex] ?? '').toUpperCase() }));
}

/** "Mark everyone present": the present key on every person still unmarked; marks already made stay. */
export function markAllPresent(marks: Readonly<Record<string, string>>, people: readonly TodayPerson[], presentKey: string): Record<string, string> {
  const next = { ...marks };
  for (const p of people) if (!(next[p.employeeId] ?? p.key)) next[p.employeeId] = presentKey.toUpperCase();
  return next;
}

export interface TodayCounts {
  present: number;
  half: number;
  absent: number;
  other: number;
  unmarked: number;
}

export function todayCounts(people: readonly TodayPerson[], marks: Readonly<Record<string, string>>, statuses: readonly AttendanceStatus[]): TodayCounts {
  const byKey = new Map(statuses.map((s) => [s.shortcutKey.toUpperCase(), s]));
  const c: TodayCounts = { present: 0, half: 0, absent: 0, other: 0, unmarked: 0 };
  for (const p of people) {
    const k = marks[p.employeeId] ?? p.key;
    const s = k ? byKey.get(k) : undefined;
    if (!s) c.unmarked += 1;
    else if (s.attendancePercentage === 100 && s.statusType === 'Paid' && (s.shortcutKey.toUpperCase() === 'P' || !/leave|off|holiday/i.test(s.name))) c.present += 1;
    else if (s.attendancePercentage === 50) c.half += 1;
    else if (s.attendancePercentage === 0) c.absent += 1;
    else c.other += 1;
  }
  return c;
}

/** The rows to send: only people whose mark changed, each with the whole month's keys and today's replaced (overtime left as it is). */
export function saveRows(sheet: AttendanceSheet, dayIndex: number, marks: Readonly<Record<string, string>>): AttendanceSaveRow[] {
  return sheet.rows.flatMap((r) => {
    const k = marks[r.employeeId];
    if (k === undefined || k === (r.keys[dayIndex] ?? '').toUpperCase()) return [];
    const days = Array.from({ length: sheet.daysInMonth }, (_, d) => (d === dayIndex ? k || null : (r.keys[d] ?? null)));
    return [{ employeeId: r.employeeId, days }];
  });
}

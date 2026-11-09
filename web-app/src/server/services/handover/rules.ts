import "server-only";
import { AppError } from "../../errors";
import type { DenominationKey, HandoverRecord } from "../../repos/handovers";
import { DENOMINATION_RUPEES, DENOMINATIONS } from "../../repos/handovers";
import { DATE_SHAPE, TIME_SHAPE, type Stamp } from "../cash/stamp";

// The pure rules of a Shift Handover, each a port of Pallav (ShiftHandoverController.php, Models/ShiftHandover.php), kept apart so each is unit-testable:
// the validation with Laravel's words, the totals, Pallav's list search, and the shift the clock is in.

export type Fields = Record<string, string>;
const chars = (s: string): number => Array.from(s).length;

/** ShiftHandover::SHIFT_HOURS: [from, to) on a 24-hour IST clock; night wraps past midnight. */
const SHIFT_HOURS: readonly [string, number, number][] = [
  ["morning", 6, 12],
  ["afternoon", 12, 17],
  ["evening", 17, 22],
  ["night", 22, 6],
];

/** ShiftHandover::shiftAt: the Master Data shift whose name contains the clock's word ("Morning Shift" still counts as morning), else null. */
export function shiftAt(time: string, shifts: readonly string[]): string | null {
  const hour = Number(time.slice(0, 2));
  for (const [word, from, to] of SHIFT_HOURS) {
    const inside = from < to ? hour >= from && hour < to : hour >= from || hour < to;
    if (!inside) continue;
    const hit = shifts.find((s) => s.toLowerCase().includes(word));
    if (hit) return hit;
  }
  return null;
}

/** payload(): each count times its rupee value, in paise; the grand total. */
export function totalsOf(counts: Record<DenominationKey, number>): bigint {
  return DENOMINATIONS.reduce((sum, d) => sum + BigInt(counts[d]) * BigInt(DENOMINATION_RUPEES[d] * 100), BigInt(0));
}

export interface HandoverFields {
  shift: string;
  handedToId: string;
  counts: Record<DenominationKey, number>;
  notes: string[];
  instructions: string[];
  stamp: { date: string; time: string } | null;
}

interface HandoverRuleContext {
  /** The ACTIVE values of Master Data `shift`; empty under force mode (Pallav: the list is only insisted on while force mode is off). */
  shifts: readonly string[];
  force: boolean;
  /** Ids of the active employees a shift can be handed to. */
  staffIds: ReadonlySet<string>;
  canBackdate: boolean;
  today: string;
}

interface CleanHandover {
  shift: string;
  employeeId: string;
  counts: Record<DenominationKey, number>;
  notes: string[];
  instructions: string[];
  stamp: Stamp | null;
}

/** ShiftHandoverController::rules() + payload(), Laravel 11's default wording; field names are the apps' (shift, handedToId, count.d500, notes, instructions, date, time). */
export function validateHandover(input: HandoverFields, ctx: HandoverRuleContext): CleanHandover {
  const fields: Fields = {};
  const shift = input.shift.trim();
  if (shift === "") fields.shift = "The shift field is required.";
  else if (chars(shift) > 20) fields.shift = "The shift field must not be greater than 20 characters.";
  else if (!ctx.force && ctx.shifts.length > 0 && !ctx.shifts.includes(shift)) fields.shift = "The selected shift is invalid.";

  const employeeId = input.handedToId.trim();
  if (employeeId === "") fields.handedToId = "The employee id field is required.";
  else if (!ctx.staffIds.has(employeeId)) fields.handedToId = "The selected employee id is invalid.";

  for (const d of DENOMINATIONS) {
    const n = input.counts[d];
    if (!Number.isInteger(n)) fields[`count.${d}`] = `The ${d} count field must be an integer.`;
    else if (n < 0) fields[`count.${d}`] = `The ${d} count field must be at least 0.`;
    else if (n > 1_000_000) fields[`count.${d}`] = `The ${d} count field must not be greater than 1000000.`;
  }

  if (input.notes.length > 100) fields.notes = "The notes field must not have more than 100 items.";
  else input.notes.forEach((n, i) => {
    if (!fields.notes && chars(n) > 5000) fields.notes = `The notes.${i} field must not be greater than 5000 characters.`;
  });
  if (input.instructions.length > 100) fields.instructions = "The instructions field must not have more than 100 items.";
  else input.instructions.forEach((n, i) => {
    if (!fields.instructions && chars(n) > 2000) fields.instructions = `The instructions.${i} field must not be greater than 2000 characters.`;
  });

  let stamp: Stamp | null = null;
  if (input.stamp !== null && ctx.canBackdate) {
    if (!DATE_SHAPE.test(input.stamp.date) || Number.isNaN(Date.parse(`${input.stamp.date}T00:00:00Z`))) fields.date = "The date field must be a valid date.";
    else if (input.stamp.date > ctx.today) fields.date = "The date field must be a date before or equal to today.";
    if (!TIME_SHAPE.test(input.stamp.time.trim())) fields.time = "The time field is required.";
    if (!fields.date && !fields.time) stamp = { date: input.stamp.date, time: input.stamp.time.trim() };
  }

  if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", undefined, { fields });
  return {
    shift,
    employeeId,
    counts: { ...input.counts },
    // HMS: notes are plain text (Pallav keeps a small safe-HTML subset through RichText::inline; no sanitizer library is allowed here)
    notes: input.notes.map((n) => n.trim()).filter((n) => n !== ""),
    instructions: input.instructions.map((n) => n.trim()).filter((n) => n !== ""),
    stamp,
  };
}

/** ShiftHandoverController::asDate: d-m-Y, d/m/Y or Y-m-d, only when the text is exactly that date. */
export function asDate(word: string): string | null {
  let m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(word);
  let y: number, mo: number, d: number;
  if (m) {
    if (word[2] !== word[5]) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(word);
    if (!m) return null;
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * ShiftHandoverController::search: every word must match something on the handover: who handed over (the name saved, or the person's name now), the
 * shift, a note or instruction, the amount in words (case ignored, like Pallav's collation), the entry number ("12", "#12"), the total in rupees
 * ("1,500") or the date (19-09-2026, 19/09/2026, 2026-09-19).
 */
export function matchesHandover(r: HandoverRecord, recorderName: string | null, text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystacks = [r.fullName, r.shift, JSON.stringify(r.notes), JSON.stringify(r.instructions), r.totalInWords, recorderName].map((v) => (v ?? "").toLowerCase());
  return words.every((word) => {
    const w = word.toLowerCase();
    if (haystacks.some((h) => h.includes(w))) return true;
    const number = word.replace(/[,₹#]/g, "");
    if (/^\d+$/.test(number) && Number(number) === r.entryNo) return true;
    if (number !== "" && /^-?\d+(\.\d+)?$/.test(number) && Number(number) * 100 === Number(r.totalPaise)) return true;
    const date = asDate(word);
    return date !== null && date === r.date;
  });
}

import "server-only";
import type { SystemLogEntry } from "../../repos/cashSupport";

// System log lines in Pallav's words (Support/SystemLogger.php): "Added X: label", "Changed X: label (Field, Field)", "Removed X: label",
// and for a change only the fields that moved, each as "was A, became B". HMS keeps money in the details in PAISE.
const limit = (value: string, n: number): string => (value.length > n ? `${value.slice(0, n - 3)}...` : value);

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return limit(String(value), 160);
};

/** SystemLogger::diff: field label -> "was X, became Y", only for fields whose value changed ("5" and 5.00 are the same number). */
export function diffDetails(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, string> {
  const same = (a: unknown, b: unknown): boolean => {
    if (typeof a === "number" && typeof b === "number") return a === b;
    return String(a ?? "") === String(b ?? "");
  };
  const out: Record<string, string> = {};
  for (const [field, now] of Object.entries(after)) {
    const was = before[field] ?? null;
    if (!same(was, now)) out[field] = `was ${show(was)}, became ${show(now)}`;
  }
  return out;
}

export interface LogContext {
  userId: string;
  userName: string;
  ip: string | null;
  traceId: string;
}

type Subject = { id: string; label: string };

const base = (c: LogContext, entity: string, s: Subject, module: string) => ({
  module,
  entity,
  subjectId: s.id,
  subjectLabel: s.label.slice(0, 255),
  userId: c.userId,
  userName: c.userName,
  ipAddress: c.ip,
  traceId: c.traceId,
});

export const createdEntry = (c: LogContext, entity: string, s: Subject, details: Record<string, unknown>, module = "revenue"): SystemLogEntry => ({
  ...base(c, entity, s, module),
  action: "created",
  summary: `Added ${entity}: ${s.label}`.slice(0, 500),
  details: Object.keys(details).length > 0 ? details : null,
});

export const deletedEntry = (c: LogContext, entity: string, s: Subject, details: Record<string, unknown>, module = "revenue"): SystemLogEntry => ({
  ...base(c, entity, s, module),
  action: "deleted",
  summary: `Removed ${entity}: ${s.label}`.slice(0, 500),
  details: Object.keys(details).length > 0 ? details : null,
});

export function updatedEntry(c: LogContext, entity: string, s: Subject, before: Record<string, unknown>, after: Record<string, unknown>, module = "revenue"): SystemLogEntry {
  const changes = diffDetails(before, after);
  const fields = Object.keys(changes);
  return {
    ...base(c, entity, s, module),
    action: "updated",
    summary: (fields.length > 0 ? `Changed ${entity}: ${s.label} (${fields.join(", ")})` : `Saved ${entity}: ${s.label} with no change`).slice(0, 500),
    // what moved, as Pallav writes it, plus the whole before and after for the audit trail (money in paise)
    details: fields.length > 0 ? { ...changes, before, after } : null,
  };
}

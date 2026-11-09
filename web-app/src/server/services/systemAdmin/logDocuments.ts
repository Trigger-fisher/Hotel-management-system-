import "server-only";
import type { PayrollDoc, PayrollLogEntry } from "@shared/dashboards/payrollPay";
import { istMoment } from "../cash/ist";
import type { ForceLogRowDto, SystemLogRowDto } from "./logService";

// The printed System Log and Force Log (Pallav system/log-pdf, system/force-log-pdf): the same rows the page shows, at most 400, with a line saying when
// more were left out. Drawn by the one DocumentRenderer as a PayrollDoc table.
const when = (iso: string): string => {
  const m = istMoment(new Date(iso));
  return `${m.date.slice(8, 10)}-${m.date.slice(5, 7)}-${m.date.slice(0, 4)} ${m.time.slice(0, 5)}`;
};

const note = (truncated: boolean, shown: number): PayrollDoc["blocks"] => (truncated ? [{ kind: "para", text: `Only the newest ${shown} lines are printed. Narrow the dates or filters to see the rest.` }] : []);

export function systemLogDoc(hotelName: string, rows: readonly SystemLogRowDto[], truncated: boolean): PayrollDoc {
  return {
    companyName: hotelName,
    companyLine: "",
    title: "System Log",
    subtitle: `${rows.length} line${rows.length === 1 ? "" : "s"}`,
    blocks: [
      ...note(truncated, rows.length),
      {
        kind: "table",
        columns: [
          { header: "When", align: "left" },
          { header: "Who", align: "left" },
          { header: "Where", align: "left" },
          { header: "What happened", align: "left" },
          { header: "Outcome", align: "left" },
        ],
        rows: rows.map((r) => [when(r.at), r.userName ?? "System", r.module, r.summary, r.status]),
      },
    ],
  };
}

export function forceLogDoc(hotelName: string, rows: readonly ForceLogRowDto[], truncated: boolean): PayrollDoc {
  return {
    companyName: hotelName,
    companyLine: "",
    title: "Force Log",
    subtitle: `${rows.length} line${rows.length === 1 ? "" : "s"}`,
    blocks: [
      ...note(truncated, rows.length),
      {
        kind: "table",
        columns: [
          { header: "When", align: "left" },
          { header: "Who", align: "left" },
          { header: "Where", align: "left" },
          { header: "What happened", align: "left" },
        ],
        rows: rows.map((r) => [when(r.at), r.userName ?? "System", r.module, r.summary]),
      },
    ],
  };
}

const ACTION_NAMES: Record<string, string> = { created: "Created", updated: "Updated", deleted: "Deleted", emailed: "Emailed", error: "Error" };

/**
 * The printed Payroll Log (Pallav payroll/pdf/log.blade.php): the same rows the page shows, at most 400, with the four counts on top, the filters in
 * words and a line when more were left out. One row per entry with its details beside it (Pallav draws a card per entry; the table is the one kit).
 */
export function payrollLogDoc(companyName: string | null, rows: readonly PayrollLogEntry[], truncated: boolean, filters: readonly string[]): PayrollDoc {
  const count = (pred: (r: PayrollLogEntry) => boolean): string => String(rows.filter(pred).length);
  return {
    companyName: companyName ?? "Hotel Pallav & Pallav Food",
    companyLine: companyName ? "" : "Payroll, every company",
    title: "Payroll Log",
    subtitle: rows.length === 0 ? "" : `${when(rows[rows.length - 1].at).slice(0, 10)} to ${when(rows[0].at).slice(0, 10)}`,
    blocks: [
      { kind: "kv", title: "", items: [{ label: "Entries", value: String(rows.length) }, { label: "Emails", value: count((r) => r.action === "emailed") }, { label: "Deletions", value: count((r) => r.action === "deleted") }, { label: "Problems", value: count((r) => r.status === "failed") }] },
      ...(filters.length > 0 ? [{ kind: "para" as const, text: `Filtered by: ${filters.join("  ·  ")}` }] : []),
      ...note(truncated, rows.length),
      {
        kind: "table",
        columns: [
          { header: "When", align: "left" },
          { header: "Who", align: "left" },
          { header: "What", align: "left" },
          { header: "What happened", align: "left" },
          { header: "Outcome", align: "left" },
          { header: "Details", align: "left" },
        ],
        rows: rows.map((r) => [when(r.at), r.userName || "System", companyName === null && r.companyName ? `${r.entity} (${r.companyName})` : r.entity, r.summary, r.status === "failed" ? "Failed" : (ACTION_NAMES[r.action] ?? r.action), r.details ?? ""]),
      },
    ],
  };
}
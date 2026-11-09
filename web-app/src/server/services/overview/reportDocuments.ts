import "server-only";
import { formatDate, formatINR, formatMonth } from "@shared/dashboards/format";
import type { DocBlock, PayrollDoc } from "@shared/dashboards/payrollPay";
import type { DailyReportDto, DayLineDto, FoodPlanMonthDto } from "./reportService";

// The Daily Report and the Food Plan Report as the structured documents the PDF renderer draws: the SAME figures as the screens (the DTOs the report service
// built), on the hotel's header. Pallav fits a day sheet to one page where it reasonably can; here the sheet runs as long as it runs (the page cap protects the
// renderer). Spec: docs/specs/overview.md §5.

export interface DocHeader {
  name: string;
  address: string | null;
  phone: string | null;
}

const line = (h: DocHeader): string => [h.address, h.phone ? `Phone ${h.phone}` : null].filter(Boolean).join(" · ");
const COLUMNS = [{ header: "Room", align: "left" as const }, { header: "Ref", align: "left" as const }, { header: "Particulars", align: "left" as const }, { header: "Mode", align: "left" as const }, { header: "Amount", align: "right" as const }];
const rows = (lines: readonly DayLineDto[]): string[][] => lines.map((l) => [l.room ?? "", l.ref ?? "", [l.particulars, l.note].filter(Boolean).join(" - ") + (l.fromAdvancePaise > 0 ? ` (${formatINR(l.fromAdvancePaise)} from advance)` : ""), l.mode, formatINR(l.amountPaise)]);

function section(blocks: DocBlock[], title: string, lines: readonly DayLineDto[], total?: number): void {
  if (lines.length === 0) return;
  blocks.push({ kind: "table", title, columns: COLUMNS, rows: rows(lines), ...(total !== undefined ? { footer: ["", "", `Total ${title.toLowerCase()}`, "", formatINR(total)] } : {}) });
}

export function dailyReportDoc(header: DocHeader, r: DailyReportDto): PayrollDoc {
  const t = r.totals;
  const blocks: DocBlock[] = [];
  section(blocks, "Cash received", r.cashIn, t.cashInPaise);
  section(blocks, "Cash paid out", r.cashOut, t.cashOutPaise);
  if (r.foodPlan.length > 0) {
    blocks.push({
      kind: "table",
      title: "Plan meals for tonight (paid to the food business)",
      columns: [{ header: "Room", align: "left" }, { header: "Bill", align: "left" }, { header: "Guest", align: "left" }, { header: "Plan", align: "left" }, { header: "Persons", align: "right" }, { header: "Rate", align: "right" }, { header: "Amount", align: "right" }],
      rows: r.foodPlan.map((f) => [f.room, f.bill, f.company ? `${f.guest} (${f.company})` : f.guest, f.plan, String(f.persons), formatINR(f.ratePaise), formatINR(f.amountPaise)]),
      footer: ["", "", "Total plan meals", "", "", "", formatINR(t.foodPlanPaise)],
    });
  }
  section(blocks, "Online and card", r.banked);
  section(blocks, "Bills left on credit", r.debit, t.debitPaise);
  section(blocks, "Complimentary", r.complimentary);
  blocks.push({
    kind: "kv",
    title: "The day",
    items: [
      { label: "Opening cash", value: formatINR(t.openingPaise) },
      { label: "Cash received", value: formatINR(t.cashInPaise) },
      { label: "Cash in the drawer", value: formatINR(t.cashOnHandPaise) },
      { label: "Cash paid out", value: formatINR(t.cashOutPaise) },
      { label: "Plan meals", value: formatINR(t.foodPlanPaise) },
      { label: "Online and card received", value: formatINR(t.bankedInPaise) },
      { label: "On credit", value: formatINR(t.debitPaise) },
      { label: "Revenue of the day", value: formatINR(t.revenuePaise) },
      { label: "Paid out of the day", value: formatINR(t.paidOutPaise) },
      { label: "Net of the day", value: formatINR(t.netPaise) },
    ],
  });
  blocks.push({ kind: "total", label: "Cash carried forward", value: formatINR(t.carryForwardPaise) });
  blocks.push({ kind: "signatures", items: [{ name: "", role: "Prepared by" }, { name: "", role: "Checked by" }] });
  return { companyName: header.name, companyLine: line(header), title: "Daily report", subtitle: formatDate(r.date), blocks };
}

export function foodPlanDoc(header: DocHeader, r: FoodPlanMonthDto): PayrollDoc {
  const blocks: DocBlock[] = [
    { kind: "kv", items: [{ label: "Month", value: formatMonth(r.month) }, ...(r.plan ? [{ label: "Plan", value: r.plan.toUpperCase() }] : []), { label: "Guests", value: String(r.totals.guests) }, { label: "Nights", value: String(r.totals.nights) }, { label: "Person-nights", value: String(r.totals.personNights) }] },
    {
      kind: "table",
      title: "Guests on a meal plan",
      columns: [{ header: "Room", align: "left" }, { header: "Bill", align: "left" }, { header: "Guest", align: "left" }, { header: "Stay", align: "left" }, { header: "Plan", align: "left" }, { header: "Nights", align: "right" }, { header: "Amount", align: "right" }],
      rows: r.rows.map((x) => [x.room, x.bill, x.company ? `${x.guest} (${x.company})` : x.guest, `${formatDate(x.arrival)} to ${formatDate(x.departure)}${x.outside > 0 ? ` (${x.outside} nights in another month)` : ""}`, x.plans.join(", "), String(x.nightCount), formatINR(x.amountPaise)]),
      footer: ["", "", "Total", "", "", String(r.totals.nights), formatINR(r.totals.amountPaise)],
    },
  ];
  if (r.byPlan.length > 0) {
    blocks.push({ kind: "table", title: "By plan", columns: [{ header: "Plan", align: "left" }, { header: "Rates", align: "left" }, { header: "Person-nights", align: "right" }, { header: "Amount", align: "right" }], rows: r.byPlan.map((p) => [p.plan, p.ratesPaise.map((x) => formatINR(x)).join(", "), String(p.personNights), formatINR(p.amountPaise)]) });
  }
  blocks.push({ kind: "total", label: "Owed to the food business for the month", value: formatINR(r.totals.amountPaise) });
  return { companyName: header.name, companyLine: line(header), title: "Food plan report", subtitle: formatMonth(r.month), blocks };
}

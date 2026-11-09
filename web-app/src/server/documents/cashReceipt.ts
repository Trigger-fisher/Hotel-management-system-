import "server-only";
import type { CashReceipt } from "@shared/dashboards/cash";
import { formatINR } from "@shared/dashboards/format";
import type { DocBlock } from "@shared/dashboards/payrollPay";
import { renderPayrollDoc } from "./payrollDoc";
import type { RenderedDocument } from "./renderer";

// The cash book's receipts and the shift handover (Pallav's receipt and handover prints): the CashReceipt the screen prints, drawn by the same renderer
// as the payroll documents. The cash module's routes build the CashReceipt from their own entry and call render("cashReceipt", ...).

export async function renderCashReceipt(r: CashReceipt): Promise<RenderedDocument> {
  const blocks: DocBlock[] = [{ kind: "kv", items: r.rows }];
  if (r.lines.length > 0) {
    blocks.push({
      kind: "table",
      title: "Items",
      columns: [
        { header: "Category", align: "left" },
        { header: "Item", align: "left" },
        { header: "Qty", align: "right" },
        { header: "Price", align: "right" },
        { header: "Total", align: "right" },
      ],
      rows: r.lines.map((l) => [l.category, l.item, l.quantity, l.price, l.total]),
    });
  }
  if (r.denominations.length > 0 || r.showCash) {
    blocks.push({
      kind: "table",
      title: "Cash counted",
      columns: [
        { header: "Denomination", align: "left" },
        { header: "Count", align: "right" },
        { header: "Total", align: "right" },
      ],
      rows: r.denominations.length > 0 ? r.denominations.map((d) => [d.label, d.count, d.total]) : [["Nothing counted", "", formatINR(0)]],
    });
  }
  for (const n of r.notes) blocks.push({ kind: "para", text: `Note: ${n}` });
  for (const i of r.instructions) blocks.push({ kind: "para", text: `Instruction: ${i}` });
  blocks.push({ kind: "total", label: r.totalLabel, value: formatINR(r.totalPaise), words: r.words });
  blocks.push({
    kind: "signatures",
    // the label above the name, as the payroll vouchers and slips sign ("Received by" over the person)
    items: [
      { name: r.signLeft.label, role: r.signLeft.name },
      { name: r.signRight.label, role: r.signRight.name },
    ],
  });
  return renderPayrollDoc({
    doc: { companyName: r.hotelName, companyLine: "", title: r.title, subtitle: `${r.kind} · ${r.number}`, blocks },
    filename: `${r.title}-${r.number}`,
    meta: [
      ["No.", r.number],
      ["Type", r.kind],
    ],
  });
}

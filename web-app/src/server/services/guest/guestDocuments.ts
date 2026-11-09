import "server-only";
import { formatINR } from "@shared/dashboards/format";
import type { DocBlock } from "@shared/dashboards/payrollPay";
import type { PayrollDocInput } from "../../documents/payrollDoc";
import type { GuestPaymentReceipt, GuestStatement } from "./guestService";

// The guest portal's own documents (round 3 c): a payment receipt and the statement, drawn by the shared document renderer from what the guest service decided the guest may see.
// (A bill and an advance receipt are the hotel's own prints, rendered from billing's preview.) Plain text only: the renderer writes the strings as they are.

const dateText = (iso: string): string => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export function paymentReceiptDoc(r: GuestPaymentReceipt): PayrollDocInput {
  const blocks: DocBlock[] = [
    { kind: "kv", items: [
      { label: "Received from", value: r.guestName },
      { label: "Mobile", value: r.mobile },
      { label: "Date", value: dateText(r.at) },
      { label: "For", value: r.billNumber ? `Bill ${r.billNumber} (${r.business})` : r.business },
      { label: "Details", value: r.title },
    ] },
    { kind: "total", label: "Amount received", value: formatINR(r.amountPaise) },
    { kind: "para", text: "This receipt is made from the hotel's records for your own copy. For a stamped receipt, please ask reception." },
  ];
  return { doc: { companyName: r.hotelName, companyLine: "", title: "Payment receipt", subtitle: r.billNumber ? `Bill ${r.billNumber}` : undefined, blocks }, filename: `Receipt-${r.billNumber ?? "payment"}`.replace(/[^A-Za-z0-9-]+/g, "-") };
}

export function statementDoc(s: GuestStatement): PayrollDocInput {
  const several = s.hotels.length > 1;
  const blocks: DocBlock[] = [
    { kind: "kv", items: [
      { label: "Guest", value: s.guestName },
      { label: "Mobile", value: s.mobile },
      { label: "Period", value: `${s.from} to ${s.to}` },
      ...(several ? [{ label: "Hotels", value: s.hotels.join(", ") }] : []),
    ] },
    s.lines.length === 0
      ? { kind: "para", text: "Nothing was charged or paid in this period." }
      : {
          kind: "table",
          title: "Charges and payments",
          columns: [
            { header: "Date", align: "left" },
            ...(several ? [{ header: "Hotel", align: "left" as const }] : []),
            { header: "What", align: "left" },
            { header: "Business", align: "left" },
            { header: "Charged", align: "right" },
            { header: "Paid", align: "right" },
          ],
          rows: s.lines.map((l) => [l.date, ...(several ? [l.hotelName] : []), l.title, l.business, l.kind === "charge" ? formatINR(l.amountPaise) : "", l.kind === "payment" ? formatINR(l.amountPaise) : ""]),
        },
    { kind: "kv", title: "Totals", items: [
      { label: "Charged", value: formatINR(s.chargesPaise) },
      { label: "Paid", value: formatINR(s.paymentsPaise) },
    ] },
  ];
  if (s.unavailable.length > 0) blocks.push({ kind: "para", text: `Not included (could not be reached): ${s.unavailable.map((u) => u.hotelName).join(", ")}.` });
  return { doc: { companyName: several ? "Your statement" : (s.hotels[0] ?? "Statement"), companyLine: "", title: "Statement", subtitle: `${s.from} to ${s.to}`, blocks }, filename: `Statement-${s.from}-${s.to}` };
}

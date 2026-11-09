import "server-only";
import type { CompanyProfile, Customer, LedgerOverview, LedgerSummary } from "@shared/dashboards/companies";
import { formatDate, formatINR } from "@shared/dashboards/format";
import type { DocBlock, PayrollDoc } from "@shared/dashboards/payrollPay";
import type { StatementHeader } from "./statementDocument";

// The company profile, the customer profile and the ledger summary as the structured documents the apps print and the PDF renderer draws: the SAME fields the
// screens show (the DTOs the services already built), on the hotel's header. Spec: docs/specs/documents.md.

const line = (header: StatementHeader): string => [header.address, header.phone ? `Phone ${header.phone}` : null, header.gstin ? `GSTIN ${header.gstin}` : null].filter(Boolean).join(" · ");
const shown = (items: { label: string; value: string | null | undefined }[]) => items.filter((i) => i.value !== null && i.value !== undefined && i.value !== "").map((i) => ({ label: i.label, value: String(i.value) }));
const pct = (v: number | null): string => (v === null ? "" : `${v}%`);

export function companyProfileDoc(header: StatementHeader, c: CompanyProfile): PayrollDoc {
  const blocks: DocBlock[] = [
    { kind: "kv", title: "Company", items: shown([{ label: "Name", value: c.name }, { label: "GST number", value: c.gstNumber }, { label: "Mobile", value: c.mobile }, { label: "Phone", value: c.phone }, { label: "Email", value: c.email }, { label: "Address", value: c.address }, { label: "Pincode", value: c.pincode }, { label: "Country", value: c.country }, { label: "Nationality", value: c.nationality }]) },
    { kind: "kv", title: "Billing terms", items: shown([{ label: "Discount", value: pct(c.discountPct) }, { label: "GST", value: pct(c.gstPct) }, { label: "TCS", value: pct(c.tcsPct) }, { label: "TDS", value: pct(c.tdsPct) }]) },
  ];
  if (c.contacts.length > 0) {
    blocks.push({ kind: "table", title: "Contacts", columns: [{ header: "Role", align: "left" }, { header: "Name", align: "left" }, { header: "Mobile", align: "left" }, { header: "Email", align: "left" }], rows: c.contacts.map((p) => [p.role, p.name, p.mobile, p.email]) });
  }
  if (c.instruction) blocks.push({ kind: "para", text: `Instruction: ${c.instruction}` });
  return { companyName: header.name, companyLine: line(header), title: "Company profile", subtitle: c.name, blocks };
}

const companiesWord = (n: number): string => `${n} ${n === 1 ? "company" : "companies"}`;

export function customerProfileDoc(header: StatementHeader, c: Customer): PayrollDoc {
  // Pallav's customer PDF (resources/views/customer/pdf.blade.php) prints the ID number in full, as the screen does
  const idNumber = c.idProofNumber ?? "";
  const blocks: DocBlock[] = [
    { kind: "kv", title: "Guest", items: shown([{ label: "Name", value: c.name }, { label: "Mobile", value: c.mobile }, { label: "Email", value: c.email }, { label: "Address", value: c.address }, { label: "City", value: c.city }, { label: "ID proof", value: c.idProofType ? `${c.idProofType}${idNumber ? ` ${idNumber}` : ""}` : "" }]) },
    { kind: "kv", title: "Portal", items: shown([{ label: "Sign-in", value: c.isActive ? "Allowed" : "Switched off" }, { label: "Added", value: c.source === "self" ? "Signed up on the website" : "Added by the hotel" }, { label: "Last sign-in", value: c.lastLoginAt ? formatDate(c.lastLoginAt.slice(0, 10)) : "" }]) },
  ];
  if (c.notes) blocks.push({ kind: "para", text: `Notes: ${c.notes}` });
  return { companyName: header.name, companyLine: line(header), title: "Guest profile", subtitle: c.name, blocks };
}

const stateText = (s: LedgerSummary): string => (s.state === "owing" ? "Owing" : s.state === "credit" ? "In credit" : "Settled");

export function ledgerSummaryDoc(header: StatementHeader, overview: Pick<LedgerOverview, "all" | "stats">, date: string): PayrollDoc {
  const rows = overview.all;
  const sum = (f: (r: LedgerSummary) => number): number => rows.reduce((a, r) => a + f(r), 0);
  const blocks: DocBlock[] = [
    {
      kind: "kv",
      items: shown([
        { label: "As on", value: formatDate(date) },
        { label: "Companies", value: String(rows.length) },
        { label: "Owed to the hotel", value: `${formatINR(overview.stats.owedPaise)} (${companiesWord(overview.stats.owing)})` },
        { label: "Held in advance", value: `${formatINR(overview.stats.heldPaise)} (${companiesWord(overview.stats.holding)})` },
        { label: "Billed this month", value: formatINR(overview.stats.monthBilledPaise) },
        { label: "Received this month", value: formatINR(overview.stats.monthReceivedPaise) },
      ]),
    },
    {
      kind: "table",
      title: "Company ledger",
      columns: [{ header: "Company", align: "left" }, { header: "Billed", align: "right" }, { header: "Received", align: "right" }, { header: "Refunded", align: "right" }, { header: "Balance", align: "right" }, { header: "Status", align: "left" }],
      rows: rows.map((r) => [r.companyName, formatINR(r.billedPaise), formatINR(r.receivedPaise), formatINR(r.refundedPaise), formatINR(r.balancePaise), stateText(r)]),
      footer: ["Total", formatINR(sum((r) => r.billedPaise)), formatINR(sum((r) => r.receivedPaise)), formatINR(sum((r) => r.refundedPaise)), formatINR(sum((r) => r.balancePaise)), ""],
    },
  ];
  return { companyName: header.name, companyLine: line(header), title: "Company ledger summary", subtitle: formatDate(date), blocks };
}

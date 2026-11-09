import "server-only";
import type { Statement } from "@shared/dashboards/common";
import type { LedgerLine } from "@shared/dashboards/companies";
import { amountInWords, formatDate, formatINR } from "@shared/dashboards/format";
import type { DocBlock, PayrollDoc } from "@shared/dashboards/payrollPay";

// The company statement as the structured document the apps print and the PDF renderer draws (MJ #22): the hotel's header, the company, the
// period's opening balance, every row with its running balance, the totals and the closing balance. Same rows as the screen's statement.

interface StatementCompany {
  name: string;
  gstNumber: string | null;
  address: string | null;
  mobileNumber: string | null;
}

export interface StatementHeader {
  name: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
}

const balanceText = (paise: number): string => (paise > 0 ? `${formatINR(paise)} Dr` : paise < 0 ? `${formatINR(-paise)} Cr` : formatINR(0));

export function statementDoc(header: StatementHeader, company: StatementCompany, q: { from: string; to: string }, s: Statement<LedgerLine>): PayrollDoc {
  const owes = s.closingBalancePaise > 0;
  const blocks: DocBlock[] = [
    {
      kind: "kv",
      items: [
        { label: "Company", value: company.name },
        { label: "GST number", value: company.gstNumber ?? "" },
        { label: "Address", value: company.address ?? "" },
        { label: "Mobile", value: company.mobileNumber ?? "" },
        { label: "Period", value: `${formatDate(q.from)} to ${formatDate(q.to)}` },
        { label: "Opening balance", value: balanceText(s.openingBalancePaise) },
      ].filter((i) => i.value !== ""),
    },
    {
      kind: "table",
      title: "Statement",
      columns: [
        { header: "Date", align: "left" },
        { header: "Reference", align: "left" },
        { header: "Guest / room", align: "left" },
        { header: "Mode", align: "left" },
        { header: "Debit", align: "right" },
        { header: "Credit", align: "right" },
        { header: "Balance", align: "right" },
      ],
      rows: s.rows.map((r) => [
        formatDate(r.date),
        r.ref,
        [r.guest, r.room ? `Room ${r.room}` : null].filter(Boolean).join(" · "),
        r.mode ?? "",
        r.debitPaise ? formatINR(r.debitPaise) : "",
        r.creditPaise ? formatINR(r.creditPaise) : "",
        balanceText(r.balancePaise),
      ]),
      footer: ["Total", "", "", "", formatINR(s.totals.debitPaise), formatINR(s.totals.creditPaise), balanceText(s.closingBalancePaise)],
    },
    { kind: "total", label: owes ? "Closing balance due" : "Closing balance", value: balanceText(s.closingBalancePaise), words: owes ? amountInWords(s.closingBalancePaise) : undefined },
  ];
  return {
    companyName: header.name,
    companyLine: [header.address, header.phone ? `Phone ${header.phone}` : null, header.gstin ? `GSTIN ${header.gstin}` : null].filter(Boolean).join(" · "),
    title: "Statement of Account",
    subtitle: company.name,
    blocks,
  };
}

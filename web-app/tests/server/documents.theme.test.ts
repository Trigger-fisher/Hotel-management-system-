// A restyle of the PDF kit changes how the documents LOOK, never what they say: every text a document draws, in order, is the same as in
// snapshots/documents-text.json (last rewritten for the industry-format redesign of 5 Nov 2026). Only the generated time in the footer is masked.
// After a deliberate change of wording: UPDATE_DOC_SNAPSHOT=1 rewrites the file (and the diff shows exactly what changed).
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { BillPreview } from "@shared/dashboards/billing";
import { formatINR } from "@shared/dashboards/format";
import { createDocumentRenderer, type DocumentKind } from "../../src/server/documents";
import { payrollLogDoc } from "../../src/server/services/systemAdmin/logDocuments";

const FILE = path.join(__dirname, "snapshots", "documents-text.json");
const renderer = createDocumentRenderer({ timeoutMs: 90_000 });

const header = { name: "Hotel Sunrise", foodName: "Sunrise Food", address: "150 Feet Ring Road, Rajkot", phone: "0281 245 6789", gstin: "24ABCDE1234F1Z5", foodGstin: "24ABCDE1234F2Z4" };
const bill = (over: Partial<BillPreview["bill"]> = {}): BillPreview => ({
  header,
  bill: {
    id: "b1", version: 1, entryNo: 1, billNo: "2026 / 1188", billDate: "2026-10-05", grNo: "GR-77", guestName: "Ravi Mehta", mobile: "9876543210", address: "Rajkot", gstin: "", companyId: null, companyName: null,
    roomNo: "204", persons: 2, arrivalAt: "2026-10-02T12:00:00Z", departureAt: "2026-10-05T05:30:00Z",
    hotel: { plan: "CP", roomPaise: 400000, planPaise: 50000, extraBedPaise: 80000, laundryPaise: 15050, vpoPaise: 7500, gstPaise: 66000, mode: "Cash" },
    food: { foodPaise: 120000, planPaise: 0, laundryPaise: 0, gstPaise: 6000, mode: "Cash" }, hotelGstPercent: null, foodGstPercent: null,
    hotelTotalPaise: 618550, foodTotalPaise: 126000, advance: { advanceId: "a1", receiptNo: "814", guestName: "Ravi Mehta", hotelPaise: 500000, foodPaise: 0 }, balanceHotelPaise: 0, balanceFoodPaise: 0,
    stay: [{ from: "2026-10-08", to: "2026-10-12", plan: "CP", persons: 2, nights: 4, ratePaise: null, amountPaise: 210000 }],
    planFoodOwedPaise: 210000, referenceName: "Mr Shah", referenceMobile: "9800000000", instruction: "Late checkout", settlement: null, createdAt: "2026-10-05T04:30:00Z",
    ...over,
  },
  hotelWords: "Six Thousand One Hundred Eighty Five Rupees And Fifty Paise Only",
  foodWords: "One Thousand Two Hundred Sixty Rupees Only",
});

const CASES: { name: string; kind: DocumentKind; data: unknown }[] = [
  { name: "bill: paid, hotel + food, advance, stay", kind: "bill", data: bill() },
  {
    name: "bill: on account, hotel only, company, odd GST",
    kind: "bill",
    data: bill({ companyName: "Acme Pvt Ltd", gstin: "24AAACA1111A1Z1", balanceHotelPaise: 618551, hotel: { plan: null, roomPaise: 552550, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 66001, mode: "Debit" }, food: { foodPaise: 0, planPaise: 0, laundryPaise: 0, gstPaise: 0, mode: null }, hotelTotalPaise: 618551, foodTotalPaise: 0, advance: null }),
  },
  {
    name: "bill: settled in instalments, no GSTIN",
    kind: "bill",
    data: { ...bill({ settlement: { installments: [{ date: "2026-10-06", hotelPaise: 300000, hotelMode: "UPI", foodPaise: 26000, foodMode: "Cash" }, { date: "2026-10-07", hotelPaise: 318550, hotelMode: "Card", foodPaise: 100000, foodMode: "UPI" }], referenceName: "", referenceMobile: "", instruction: "", excessReceiptNo: null, recordedAt: "2026-10-06T05:00:00Z" } }), header: { ...header, gstin: "", foodGstin: "" } },
  },
  {
    name: "advance receipt with a refund",
    kind: "advance",
    data: {
      header,
      advance: { receiptNo: "814", paymentDate: "2026-10-01", guestName: "Ravi Mehta", mobile: "9876543210", companyName: null, roomNo: "204", fromBillNo: null, hotelPaise: 500000, foodPaise: 20000, hotelMode: "upi", foodMode: "cash", hotelBalancePaise: 0, foodBalancePaise: 20000, usedOn: ["2026 / 1188"], refund: { date: "2026-10-06", toName: "Ravi Mehta", toMobile: "9876543210", hotelPaise: 0, hotelMode: null, foodPaise: 20000, foodMode: "cash", note: "Cancelled dinner" }, instruction: "", referenceName: "", referenceMobile: "" },
      amountWords: "Five Thousand Two Hundred Rupees Only",
    },
  },
  {
    name: "cash: shift handover",
    kind: "cashReceipt",
    data: {
      hotelName: "Hotel Sunrise, Rajkot", title: "Shift Handover", kind: "Night shift", number: "#0042", rows: [{ label: "Handed over by", value: "Ramesh Patel" }, { label: "Shift", value: "Night" }], lines: [],
      denominations: [{ label: "₹500 notes", count: "× 10", total: formatINR(500000) }, { label: "₹100 notes", count: "× 3", total: formatINR(30000) }], showCash: true, notes: ["Short by ₹10 explained"], instructions: ["Lock the safe"], totalLabel: "Total cash handed over", totalPaise: 530000,
      words: "Five Thousand Three Hundred Rupees Only", signLeft: { label: "Handed over by", name: "Ramesh Patel" }, signRight: { label: "Received by", name: "Neha Shah" },
    },
  },
  {
    name: "cash: expense with items",
    kind: "cashReceipt",
    data: {
      hotelName: "Hotel Sunrise", title: "Hotel Expense Receipt", kind: "Supplier", number: "#7", rows: [{ label: "Paid to", value: "Mahesh Traders" }],
      lines: [{ category: "Kitchen", item: "Oil", quantity: "2", price: formatINR(15000), total: formatINR(30000) }, { category: "Kitchen", item: "Rice 25 kg", quantity: "1", price: formatINR(180000), total: formatINR(180000) }], denominations: [], showCash: false, notes: [], instructions: [], totalLabel: "Amount paid out", totalPaise: 210000,
      words: "Two Thousand One Hundred Rupees Only", signLeft: { label: "Received by", name: "Mahesh" }, signRight: { label: "Authorised signatory", name: "Hotel Sunrise" },
    },
  },
  {
    name: "payroll: salary slip blocks",
    kind: "payrollDoc",
    data: {
      doc: {
        companyName: "Hotel Sunrise", companyLine: "150 Feet Ring Road, Rajkot", title: "Salary slip", subtitle: "October 2026",
        blocks: [
          { kind: "heading", text: "Pooja Desai" },
          { kind: "kv", title: "Employee", items: [{ label: "Code", value: "E-12" }, { label: "Department", value: "Front office" }, { label: "Account", value: "••••7890" }] },
          { kind: "table", title: "Earnings", columns: [{ header: "Head", align: "left" }, { header: "Amount", align: "right" }], rows: [["Basic", formatINR(1500000)], ["HRA", formatINR(300000)]], footer: ["Total", formatINR(1800000)] },
          { kind: "para", text: "Paid by bank transfer on 01 Nov 2026." },
          { kind: "total", label: "Net pay", value: formatINR(1750000), words: "Seventeen Thousand Five Hundred Rupees Only" },
          { kind: "signatures", items: [{ name: "Pooja Desai", role: "Employee" }, { name: "Hotel Sunrise", role: "Authorised signatory" }] },
        ],
      },
      filename: "slip",
    },
  },
  {
    name: "payroll: printed log",
    kind: "payrollDoc",
    data: {
      doc: payrollLogDoc(null, [{ id: "1", at: "2026-10-05T10:00:00.000Z", companyId: "c", companyName: "Hotel Pallav", userName: "Pooja", action: "emailed", entity: "Advance", subject: "", summary: "Emailed the slip", details: "Amount: 5000", status: "success" }] as never, false, []),
      filename: "payroll-log",
    },
  },
];

/** The drawn text with the moment of printing masked (it is the only thing that changes between two renders). */
const textOf = (lines: string[]): string[] => lines.map((l) => l.replace(/Generated \d{2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} [ap]m/, "Generated <time>"));

describe("the themed kit keeps every word and figure of every document", () => {
  test("each document draws exactly the text it drew before the restyle, in the same order, on the same number of pages", async () => {
    const now: Record<string, { pages: number; text: string[] }> = {};
    for (const c of CASES) {
      const d = await renderer.render(c.kind, c.data as never);
      assert.equal(Buffer.from(d.bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
      now[c.name] = { pages: d.pages, text: textOf(d.text) };
    }
    if (process.env.UPDATE_DOC_SNAPSHOT === "1" || !existsSync(FILE)) {
      writeFileSync(FILE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
      return;
    }
    const before = JSON.parse(readFileSync(FILE, "utf8")) as typeof now;
    assert.deepEqual(Object.keys(now), Object.keys(before));
    for (const name of Object.keys(before)) assert.deepEqual(now[name], before[name], name);
  });
});

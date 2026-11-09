// The printable documents (MJ #22, Backend Review/07-PDF-DECISION.md): the renderer port, the layout kit and the bill. A document draws the SAME
// figures as its preview DTO (the screen and the PDF cannot disagree), survives hostile text (very long names, Gujarati / Devanagari, control
// characters, 10k-character notes), refuses a runaway page count, queues renders and times out. Layout spec: docs/specs/documents.md.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BillPreview } from "@shared/dashboards/billing";
import { formatINR } from "@shared/dashboards/format";
import { createDocumentRenderer } from "../../src/server/documents";
import { slipAccount } from "../../src/server/services/payrollPay/documentService";
import { payrollLogDoc } from "../../src/server/services/systemAdmin/logDocuments";
import { slabRate, stateOfGstin } from "../../src/server/documents/gst";
import { clean, MAX_PAGES, paymentMode, put, startDocument } from "../../src/server/documents/kit";
import { issuerOf, letterReference } from "../../src/server/documents/payrollDoc";

const preview = (over: Partial<BillPreview["bill"]> = {}, header: Partial<BillPreview["header"]> = {}): BillPreview => ({
  header: { name: "Hotel Sunrise", foodName: "Sunrise Food", address: "150 Feet Ring Road, Rajkot", phone: "0281 245 6789", gstin: "24ABCDE1234F1Z5", foodGstin: "24ABCDE1234F2Z4", ...header },
  bill: {
    id: "b1", version: 1, entryNo: 1, billNo: "2026 / 1188", billDate: "2026-10-05", grNo: "GR-77", guestName: "Ravi Mehta", mobile: "9876543210", address: "Rajkot", gstin: "", companyId: null, companyName: null,
    roomNo: "204", persons: 2, arrivalAt: "2026-10-02T12:00:00Z", departureAt: "2026-10-05T05:30:00Z",
    hotel: { plan: "CP", roomPaise: 400000, planPaise: 50000, extraBedPaise: 80000, laundryPaise: 15050, vpoPaise: 7500, gstPaise: 66000, mode: "Cash" },
    food: { foodPaise: 120000, planPaise: 0, laundryPaise: 0, gstPaise: 6000, mode: "Cash" }, hotelGstPercent: null, foodGstPercent: null,
    hotelTotalPaise: 618550, foodTotalPaise: 126000, advance: { advanceId: "a1", receiptNo: "814", guestName: "Ravi Mehta", hotelPaise: 500000, foodPaise: 0 }, balanceHotelPaise: 0, balanceFoodPaise: 0,
    stay: [{ from: "2026-10-08", to: "2026-10-12", plan: "CP", persons: 2, nights: 4, ratePaise: null, amountPaise: 210000 }],
    planFoodOwedPaise: 210000, referenceName: "", referenceMobile: "", instruction: "", settlement: null, createdAt: "2026-10-05T04:30:00Z",
    ...over,
  },
  hotelWords: "Six Thousand One Hundred Eighty Five Rupees And Fifty Paise Only",
  foodWords: "One Thousand Two Hundred Sixty Rupees Only",
});

// A generous deadline: these tests prove WHAT is drawn (pages, text, bounds), never how fast; a loaded machine must not fail them. The deadline itself is tested below with 1 ms.
const renderer = createDocumentRenderer({ timeoutMs: 90_000 });
const magic = (b: Uint8Array): string => Buffer.from(b.subarray(0, 5)).toString("latin1");

describe("the bill", () => {
  test("a real PDF with the preview's figures, both GSTINs and the words; the file name from the bill number", async () => {
    const d = await renderer.render("bill", preview());
    assert.equal(magic(d.bytes), "%PDF-");
    assert.deepEqual([d.pages, d.filename], [1, "bill-2026-1188.pdf"]);
    const text = d.text.join("\n");
    for (const must of [formatINR(400000), formatINR(618550), formatINR(126000), formatINR(500000), formatINR(210000), "GSTIN 24ABCDE1234F1Z5", "GSTIN 24ABCDE1234F2Z4", "Hotel Sunrise", "Sunrise Food", "2026 / 1188", "Ravi Mehta", "Changing rate", "Six Thousand One Hundred Eighty Five Rupees And Fifty Paise Only", "05 Oct 2026"]) {
      assert.ok(text.includes(must), `missing: ${must}`);
    }
  });

  test("a bill on Debit prints the balance; a settled bill prints its instalments; no food part when there is no food", async () => {
    const owing = (await renderer.render("bill", preview({ balanceHotelPaise: 618550, hotel: { plan: null, roomPaise: 618550, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0, mode: "Debit" }, food: { foodPaise: 0, planPaise: 0, laundryPaise: 0, gstPaise: 0, mode: null }, foodTotalPaise: 0, advance: null }))).text.join("\n");
    assert.ok(owing.includes("Balance due (hotel)") && owing.includes("Hotel total (Debit)"));
    assert.ok(!owing.includes("Sunrise Food"));
    const settled = (await renderer.render("bill", preview({ settlement: { installments: [{ date: "2026-10-06", hotelPaise: 300000, hotelMode: "UPI", foodPaise: 0, foodMode: null }], referenceName: "", referenceMobile: "", instruction: "", excessReceiptNo: null, recordedAt: "2026-10-06T05:00:00Z" } }))).text.join("\n");
    assert.ok(settled.includes("Settlement") && settled.includes(formatINR(300000)) && settled.includes("06 Oct 2026"));
  });

  test("hostile text: a very long name, Gujarati and Devanagari, control characters and a 10,000-character note all render (cut at 600 characters a field)", async () => {
    const note = "નોંધ ".repeat(2500);
    const d = await renderer.render("bill", preview({ guestName: "ભાવેશ પટેલ / राजेश कुमार / " + "A".repeat(400) + "\u0000\u0007‮", address: "x".repeat(10_000), instruction: note, referenceName: "<script>alert(1)</script> {{ 7*7 }}" }));
    assert.equal(magic(d.bytes), "%PDF-");
    assert.ok(d.pages >= 1 && d.pages <= MAX_PAGES);
    const text = d.text.join("\n");
    assert.ok(!/[\u0000\u0007‮]/.test(text));
    assert.ok(text.includes("<script>alert(1)</script> {{ 7*7 }}"), "text is data, never markup");
    assert.ok(d.text.every((t) => Array.from(t).length <= 600), "one field never prints more than 600 characters");
  });

  test("a bill with many instalments runs onto more pages with the header row repeated and every page numbered", async () => {
    const installments = Array.from({ length: 140 }, (_, i) => ({ date: "2026-10-06", hotelPaise: 100 + i, hotelMode: "Cash" as const, foodPaise: 0, foodMode: null }));
    const d = await renderer.render("bill", preview({ settlement: { installments, referenceName: "", referenceMobile: "", instruction: "", excessReceiptNo: null, recordedAt: "2026-10-06T05:00:00Z" } }));
    assert.ok(d.pages >= 3);
    const text = d.text;
    assert.ok(text.includes(`Page 1 of ${d.pages}`) && text.includes(`Page ${d.pages} of ${d.pages}`));
    assert.ok(text.filter((t) => t === "Date").length >= d.pages - 1);
  });
});

describe("the cash receipt and the generic payroll document", () => {
  test("a handover receipt draws the counted notes, the notes and both signatures; an expense receipt draws its items and the amount in words", async () => {
    const handover = await renderer.render("cashReceipt", {
      hotelName: "Hotel Sunrise, Rajkot", title: "Shift Handover", kind: "Night shift", number: "#0042", rows: [{ label: "Handed over by", value: "Ramesh Patel" }, { label: "Shift", value: "Night" }], lines: [],
      denominations: [{ label: "₹500 notes", count: "× 10", total: formatINR(500000) }], showCash: true, notes: ["Short by ₹10 explained"], instructions: ["Lock the safe"], totalLabel: "Total cash handed over", totalPaise: 500000,
      words: "Five Thousand Rupees Only", signLeft: { label: "Handed over by", name: "Ramesh Patel" }, signRight: { label: "Received by", name: "Neha Shah" },
    });
    assert.equal(magic(handover.bytes), "%PDF-");
    const t = handover.text.join("|");
    for (const must of ["Shift Handover", "₹500 notes", "× 10", formatINR(500000), "Note: Short by ₹10 explained", "Instruction: Lock the safe", "Five Thousand Rupees Only", "Neha Shah"]) assert.ok(t.includes(must), `missing: ${must}`);
    const expense = await renderer.render("cashReceipt", {
      hotelName: "Hotel Sunrise", title: "Hotel Expense Receipt", kind: "Supplier", number: "#7", rows: [{ label: "Paid to", value: "Mahesh Traders" }],
      lines: [{ category: "Kitchen", item: "Oil", quantity: "2", price: formatINR(15000), total: formatINR(30000) }], denominations: [], showCash: false, notes: [], instructions: [], totalLabel: "Amount paid out", totalPaise: 30000,
      words: "Three Hundred Rupees Only", signLeft: { label: "Received by", name: "Mahesh" }, signRight: { label: "Authorised signatory", name: "Hotel Sunrise" },
    });
    assert.ok(expense.text.join("|").includes("Oil") && expense.filename.endsWith(".pdf"));
  });
});

describe("the kit and the renderer's guard rails", () => {
  test("clean drops control and direction-override characters and cuts at the limit", () => {
    assert.equal(clean("a\u0000b\u0007c‮d\n e\tf"), "abcd\n e\tf");
    assert.equal(clean("x".repeat(50), 10), "x".repeat(10));
    assert.equal(clean(null), "");
  });

  test("a document over the page cap is refused", async () => {
    const { doc, finish } = await startDocument({ title: "Runaway" });
    for (let i = 0; i <= MAX_PAGES; i++) {
      put(doc, `page ${i}`, 36, 36, 200);
      if (i < MAX_PAGES) doc.addPage();
    }
    await assert.rejects(finish(), /over 200 pages/);
  });

  test("renders queue up (two at a time here), a full queue is refused with a retry hint, and a slow one times out", async () => {
    const small = createDocumentRenderer({ concurrency: 1, maxQueued: 1 });
    const results = await Promise.allSettled([small.render("bill", preview()), small.render("bill", preview()), small.render("bill", preview())]);
    assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled", "rejected"]);
    const refused = (results[2] as PromiseRejectedResult).reason as { code: string; details?: { retryAfterSeconds?: number } };
    assert.deepEqual([refused.code, refused.details?.retryAfterSeconds], ["RATE_LIMITED", 5]);
    // the queue drained: a new render goes straight through
    assert.equal(magic((await small.render("bill", preview())).bytes), "%PDF-");
    const instant = createDocumentRenderer({ timeoutMs: 1 });
    await assert.rejects(instant.render("bill", preview({ address: "x".repeat(10_000), instruction: "y ".repeat(5000) })), /too long/);
  });
});

describe("the salary slip's account number (Pallav salary-slip.blade.php:239-240)", () => {
  test("bullets for all but the last four characters; a short number as it is; printed on the PDF without the full number", async () => {
    assert.deepEqual([slipAccount("001234567890"), slipAccount("1234"), slipAccount("12"), slipAccount(null)], ["••••••••7890", "1234", "12", ""]);
    const file = await renderer.render("payrollDoc", { doc: { companyName: "Hotel", companyLine: "", title: "Salary slip", subtitle: "x", blocks: [{ kind: "kv", title: "Bank", items: [{ label: "Account", value: slipAccount("001234567890") }] }] }, filename: "slip.pdf" } as never);
    const text = file.text.join("|");
    assert.ok(text.includes("7890") && !text.includes("001234567890"));
  });
});

describe("the industry format (5 Nov 2026)", () => {
  test("GST facts: the state of a GSTIN, a slab rate only when the GST is exactly one, payment modes as words", () => {
    assert.deepEqual([stateOfGstin("24ABCDE1234F1Z5"), stateOfGstin("27AAACA1111A1Z1"), stateOfGstin("99X"), stateOfGstin(null)], ["Gujarat (24)", "Maharashtra (27)", null, null]);
    assert.deepEqual([slabRate(1044000, 125280), slabRate(186000, 9300), slabRate(545050, 66000), slabRate(0, 100), slabRate(1000, 0)], [12, 5, null, null, null]);
    assert.deepEqual([paymentMode("upi"), paymentMode("cash"), paymentMode("Card"), paymentMode(null)], ["UPI", "Cash", "Card", ""]);
  });

  test("a hotel with a GSTIN prints a tax invoice: original for recipient, place of supply, reverse charge, SAC, rate, taxable value, CGST and SGST, both GSTINs, declaration", async () => {
    const d = await renderer.render("bill", preview({ gstin: "27AAACA1111A1Z1", companyName: "Acme Pvt Ltd", hotel: { plan: "CP", roomPaise: 900000, planPaise: 120000, extraBedPaise: 0, laundryPaise: 24000, vpoPaise: 15000, gstPaise: 125280, mode: "UPI" }, hotelTotalPaise: 1184280 }));
    const text = d.text.join("\n");
    for (const must of ["TAX INVOICE", "ORIGINAL FOR RECIPIENT", "Place of supply", "Gujarat (24)", "Reverse charge", "SAC", "996311", "996331", "12%", "6%", "Taxable value", formatINR(1044000), "CGST", "SGST", formatINR(62640), "V.P.O. (paid on your behalf, no GST)", "GSTIN 24ABCDE1234F1Z5", "27AAACA1111A1Z1  ·  Maharashtra (27)", "Declaration", "Authorised signatory", "This is a computer-generated document."]) {
      assert.ok(text.includes(must), `missing: ${must}`);
    }
    const plain = (await renderer.render("bill", preview({}, { gstin: null, foodGstin: null }))).text.join("\n");
    assert.ok(plain.includes("BILL") && !plain.includes("TAX INVOICE") && !plain.includes("996311") && !plain.includes("Declaration"));
  });

  test("the GST rate stored with the bill prints per part; an older bill without one keeps the slab, else no rate; nothing else on the paper moves", async () => {
    const rateCell = /^\d+(\.\d)?%$/;
    const old = (await renderer.render("bill", preview())).text;
    // hotel 660.00 on 5,450.50 is no slab (blank); food 60.00 on 1,200.00 is the 5% slab
    assert.deepEqual(old.filter((l) => rateCell.test(l.trim())), ["5%", "2.5%", "2.5%"]);
    const stored = (await renderer.render("bill", preview({ hotelGstPercent: 12, foodGstPercent: 18 }))).text;
    assert.deepEqual(stored.filter((l) => rateCell.test(l.trim())), ["12%", "12%", "12%", "12%", "6%", "6%", "18%", "9%", "9%"]);
    // every cell but the rate cells (blank without a rate) is the same text in the same place
    const masked = (lines: string[]) => lines.map((l) => (rateCell.test(l.trim()) ? "" : l.replace(/Generated .*$/, "Generated")));
    assert.deepEqual(masked(stored), masked(old));
    const half = (await renderer.render("bill", preview({ hotelGstPercent: 2.5, foodGstPercent: null }))).text;
    assert.deepEqual(half.filter((l) => /^\d+(\.\d+)?%$/.test(l.trim())), ["2.5%", "2.5%", "2.5%", "2.5%", "1.25%", "1.25%", "5%", "2.5%", "2.5%"]);
  });

  test("the tax invoice prints the HSN/SAC stored with the bill on every charge line of its part; a bill read without codes prints rooms 996311 and food 996331", async () => {
    const lines = (t: string[]) => t.map((l) => l.trim());
    const old = lines((await renderer.render("bill", preview())).text);
    assert.ok(old.includes("HSN/SAC"), "the column is headed HSN/SAC");
    // hotel: room, plan, extra bed, laundry (4 lines); food: food (1 line)
    assert.deepEqual([old.filter((l) => l === "996311").length, old.filter((l) => l === "996331").length], [4, 1]);
    const stored = lines((await renderer.render("bill", preview({ hotelSac: "996312", foodSac: "996332" }))).text);
    assert.deepEqual([stored.filter((l) => l === "996312").length, stored.filter((l) => l === "996332").length, stored.filter((l) => l === "996311" || l === "996331").length], [4, 1, 0], "a bill keeps the codes it was made with");
    const plain = lines((await renderer.render("bill", preview({}, { gstin: null, foodGstin: null }))).text);
    assert.ok(!plain.includes("HSN/SAC") && !plain.includes("996311"), "a plain bill (no GSTIN) is no GST invoice: no codes");
  });

  test("a letter takes the business-letter layout: reference, date, addressee, subject, signatory; no computer-generated line", async () => {
    assert.equal(letterReference("joining-letter-1a2b3c4d", new Date("2026-11-05T06:00:00Z")), "JL/2026/1A2B3C4D");
    assert.equal(letterReference("experience-letter-9f", new Date("2026-12-31T20:00:00Z")), "EL/2027/9F");
    assert.equal(letterReference("salary-slip-E-12"), null);
    const doc = {
      companyName: "Shreeji Hospitality LLP", companyLine: "12 Station Road, Anand", title: "Joining Letter",
      blocks: [
        { kind: "kv", items: [{ label: "Date", value: "5 November 2026" }, { label: "To", value: "Ritesh Parmar" }, { label: "", value: "Anand" }] },
        { kind: "heading", text: "Appointment" },
        { kind: "para", text: "Dear Ritesh," },
        { kind: "signatures", items: [{ name: "Hemant Patel", role: "Partner · Shreeji Hospitality LLP" }] },
      ],
    };
    const text = (await renderer.render("payrollDoc", { doc, filename: "joining-letter-1a2b3c4d" } as never)).text;
    for (const must of ["Date: 5 November 2026", "To", "Ritesh Parmar", "JOINING LETTER", "Subject: Appointment", "Yours faithfully,", "For Shreeji Hospitality LLP", "Hemant Patel"]) assert.ok(text.includes(must), `missing: ${must}`);
    assert.ok(text.some((t) => /^Ref\. JL\/\d{4}\/1A2B3C4D$/.test(t)));
    assert.ok(!text.includes("This is a computer-generated document."));
  });

  test("the services' one-line header splits back into address, phone and GSTIN; earnings and deductions print side by side", async () => {
    assert.deepEqual(issuerOf({ companyName: "H", companyLine: "1 Road, Anand · Phone 02692 250 410 · GSTIN 24ABCDE1234F1Z5" }), { name: "H", address: "1 Road, Anand", phone: "02692 250 410", gstin: "24ABCDE1234F1Z5" });
    assert.deepEqual(issuerOf({ companyName: "H", companyLine: "" }), { name: "H", address: "", phone: null, gstin: null });
    const table = (title: string) => ({ kind: "table", title, columns: [{ header: "Component", align: "left" }, { header: "Amount", align: "right" }], rows: [["Basic", formatINR(1500000)]], footer: ["Total", formatINR(1500000)] });
    const text = (await renderer.render("payrollDoc", { doc: { companyName: "H", companyLine: "", title: "Salary Slip", subtitle: "Pay period Oct 2026", blocks: [table("Earnings"), table("Deductions")] }, filename: "slip" } as never)).text;
    assert.ok(text.includes("Earnings") && text.includes("Deductions") && text.includes("SALARY SLIP") && text.includes("Pay period Oct 2026"));
    assert.equal(text.indexOf("Deductions"), text.indexOf("Earnings") + 1, "the two headings are drawn on one line, before either table");
  });
});

describe("the printed payroll log", () => {
  test("the four counts, the filters in words, the truncation note, one row per entry with its details", async () => {
    const row = (at: string, action: string, status: string, summary: string, company: string) => ({ id: at, at, companyId: "c", companyName: company, userName: "Pooja", action, entity: "Advance", subject: "", summary, details: "Amount: 5000", status }) as never;
    const rows = [row("2026-10-05T10:00:00.000Z", "emailed", "success", "Emailed the slip", "Hotel Pallav"), row("2026-10-04T10:00:00.000Z", "deleted", "failed", "Deleted an advance", "Pallav Food")];
    const file = await renderer.render("payrollDoc", { doc: payrollLogDoc(null, rows, true, ["Problems", "search \"slip\""]), filename: "payroll-log" } as never);
    const text = file.text.join("|");
    for (const must of ["Payroll Log", "Entries", "Emails", "Deletions", "Problems", "Filtered by: Problems", "Only the newest 2 lines are printed", "Emailed the slip", "Deleted an advance", "Failed", "Amount: 5000", "Advance (Pallav Food)"]) assert.ok(text.includes(must), `missing: ${must}`);
  });
});
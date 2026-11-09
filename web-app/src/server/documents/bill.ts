import "server-only";
import { billSac, type BillPreview } from "@shared/dashboards/billing";
import { formatDate, formatDateTime } from "@shared/dashboards/format";
import { percent, slabRate, stateOfGstin } from "./gst";
import { band, clean, COLOR, CONTENT_WIDTH, formatINR, heightOf, inWords, letterhead, PAGE, pageCount, panels, paymentMode, put, room, signatures, smallPrint, startDocument, table, totals } from "./kit";
import type { RenderedDocument } from "./renderer";

// The guest's bill as it prints (Pallav's invoice): a GST tax invoice when the hotel has a GSTIN, the hotel part and the food part each with their own GSTIN,
// SAC, rate, taxable value, CGST and SGST and total in words. The data is the SAME BillPreview the screen shows, so the two cannot disagree; nothing is
// recalculated except what a tax invoice must show and the bill does not store (taxable value, place of supply, the rate of an older bill). Layout spec: docs/specs/documents.md.

/** "2 adults, 1 child (Name, Name)": the persons who stayed, with the names where the stay kept them; the plain figure for a bill that knows no more. */
function personsText(b: BillPreview["bill"] & { guests?: { adults: number; children: number; names: string[] } }): string | null {
  const g = b.guests;
  if (!g) return b.persons === null ? null : String(b.persons);
  const part = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  const counts = [part(g.adults, "adult", "adults"), ...(g.children > 0 ? [part(g.children, "child", "children")] : [])].join(", ");
  return g.names.length > 0 ? `${counts} (${g.names.join(", ")})` : counts;
}
const mode = paymentMode;

/** The GST as CGST and SGST, half each (an intra-state stay: the place of supply of a hotel is where it stands), on one line when it cannot be halved to the paisa. */
function gstRows(gstPaise: number, rate: number | null, withCodes: boolean): string[][] {
  const half = rate === null ? "" : percent(rate / 2);
  const row = (label: string, paise: number, r: string): string[] => (withCodes ? [label, "", r, formatINR(paise)] : [label, formatINR(paise)]);
  if (gstPaise % 2 !== 0) return [row("CGST + SGST", gstPaise, rate === null ? "" : percent(rate))];
  return [row("CGST", gstPaise / 2, half), row("SGST", gstPaise / 2, half)];
}

interface Charge {
  label: string;
  paise: number;
}

/**
 * One business's part: its charges with SAC and rate, the taxable value, the GST split and anything paid on the guest's behalf (outside GST).
 * The rate is the one stored with the bill; an older bill without one shows the slab its GST is, else no rate.
 */
function chargeRows(charges: readonly Charge[], gstPaise: number, storedRate: number | null, sac: string, paidOut: Charge | null, withCodes: boolean): string[][] {
  const taxable = charges.reduce((a, c) => a + c.paise, 0);
  const rate = storedRate ?? slabRate(taxable, gstPaise);
  if (!withCodes) return [...charges.map((c) => [c.label, formatINR(c.paise)]), ...(paidOut ? [[paidOut.label, formatINR(paidOut.paise)]] : []), ...gstRows(gstPaise, rate, false)];
  return [
    ...charges.map((c) => [c.label, sac, rate === null ? "" : percent(rate), formatINR(c.paise)]),
    ["Taxable value", "", "", formatINR(taxable)],
    ...gstRows(gstPaise, rate, true),
    ...(paidOut ? [[`${paidOut.label} (paid on your behalf, no GST)`, "", "", formatINR(paidOut.paise)]] : []),
  ];
}

const PLAIN_COLUMNS = [
  { label: "Particulars", width: 60 },
  { label: "Amount", width: 20, align: "right" as const },
];
const TAX_COLUMNS = [
  { label: "Description", width: 50 },
  { label: "HSN/SAC", width: 10 },
  { label: "GST rate", width: 10, align: "right" as const },
  { label: "Amount", width: 16, align: "right" as const },
];

export async function renderBill(data: BillPreview): Promise<RenderedDocument> {
  const { header: h, bill: b } = data;
  const sac = billSac(b);
  const { doc, finish } = await startDocument({ title: `Bill ${b.billNo}` });
  // a hotel registered for GST hands the guest a tax invoice; the words on the paper say so
  const taxInvoice = !!h.gstin;
  const supply = stateOfGstin(h.gstin);
  // the state of the bill, before any figure: paid, or how much is still due (the company it is due from is in "Billed to")
  const due = b.balanceHotelPaise + b.balanceFoodPaise;
  const status = due > 0 ? `Balance due ${formatINR(due)}` : "Paid in full";
  let y = letterhead(
    doc,
    { name: h.name, address: h.address, phone: h.phone, gstin: h.gstin },
    {
      title: taxInvoice ? "Tax Invoice" : "Bill",
      copy: taxInvoice ? "Original for recipient" : undefined,
      meta: [
        [taxInvoice ? "Invoice No." : "Bill No.", b.billNo],
        ["Date", formatDate(b.billDate)],
        ["Place of supply", taxInvoice ? supply : null],
        ["Reverse charge", taxInvoice ? "No" : null],
        ["Status", status],
      ],
    },
  );
  y = panels(doc, y, [
    {
      title: "Billed to",
      rows: [
        ["Company", b.companyName],
        ["Guest", b.guestName],
        ["Address", b.address],
        ["Mobile", b.mobile],
        ["GSTIN", b.gstin ? [b.gstin, stateOfGstin(b.gstin)].filter(Boolean).join("  ·  ") : null],
      ],
    },
    {
      title: "Stay",
      rows: [
        ["Room", b.roomNo],
        ["GR No.", b.grNo],
        ["Persons", personsText(b)],
        ["Arrival", b.arrivalAt ? formatDateTime(b.arrivalAt) : null],
        ["Departure", b.departureAt ? formatDateTime(b.departureAt) : null],
      ],
    },
  ]);
  if (b.stay.length > 0) {
    y = table(
      doc,
      y,
      [
        { label: "From", width: 14 },
        { label: "To", width: 14 },
        { label: "Nights", width: 8, align: "right" },
        { label: "Plan", width: 14 },
        { label: "Persons", width: 9, align: "right" },
        { label: "Rate", width: 14, align: "right" },
        { label: "Amount", width: 16, align: "right" },
      ],
      b.stay.map((s) => [formatDate(s.from), formatDate(s.to), String(s.nights), s.plan ?? "", String(s.persons), s.ratePaise === null ? "Changing rate" : formatINR(s.ratePaise), formatINR(s.amountPaise)]),
    );
  }

  const hotel = b.hotel;
  const hotelCharges: Charge[] = [
    { label: "Room tariff", paise: hotel.roomPaise },
    ...(hotel.planPaise ? [{ label: `Meal plan${hotel.plan ? ` (${hotel.plan})` : ""}`, paise: hotel.planPaise }] : []),
    ...(hotel.extraBedPaise ? [{ label: "Extra bed", paise: hotel.extraBedPaise }] : []),
    ...(hotel.laundryPaise ? [{ label: "Laundry", paise: hotel.laundryPaise }] : []),
  ];
  y = band(doc, y + 2, h.name, h.gstin ? `GSTIN ${h.gstin}` : "", false);
  y = table(doc, y, taxInvoice ? TAX_COLUMNS : PLAIN_COLUMNS, chargeRows(hotelCharges, hotel.gstPaise, b.hotelGstPercent ?? null, sac.hotel, hotel.vpoPaise ? { label: "V.P.O.", paise: hotel.vpoPaise } : null, taxInvoice));
  y = totals(doc, y, [{ label: `Hotel total${hotel.mode ? ` (${mode(hotel.mode)})` : ""}`, paise: b.hotelTotalPaise, strong: true }]);
  y = inWords(doc, y, data.hotelWords, b.hotelTotalPaise);

  const food = b.food;
  if (b.foodTotalPaise > 0 || food.foodPaise > 0) {
    const foodCharges: Charge[] = [
      { label: "Food", paise: food.foodPaise },
      ...(food.planPaise ? [{ label: "Meal plan", paise: food.planPaise }] : []),
      ...(food.laundryPaise ? [{ label: "Laundry", paise: food.laundryPaise }] : []),
    ];
    y = band(doc, y + 2, h.foodName, h.foodGstin ? `GSTIN ${h.foodGstin}` : "", false);
    y = table(doc, y, taxInvoice ? TAX_COLUMNS : PLAIN_COLUMNS, chargeRows(foodCharges, food.gstPaise, b.foodGstPercent ?? null, sac.food, null, taxInvoice));
    y = totals(doc, y, [{ label: `Food total${food.mode ? ` (${mode(food.mode)})` : ""}`, paise: b.foodTotalPaise, strong: true }]);
    y = inWords(doc, y, data.foodWords, b.foodTotalPaise);
  }

  // the summary every guest looks for: both businesses together, what an advance already covered, what is still due
  const grand = b.hotelTotalPaise + b.foodTotalPaise;
  const advance = b.advance ? b.advance.hotelPaise + b.advance.foodPaise : 0;
  // what was settled at checkout: whatever the bill total, the advance and the open balance do not account for
  const paidNow = Math.max(0, grand - advance - due);
  const paidModes = Array.from(new Set([hotel.mode, food.mode].filter((m): m is string => !!m && m.toLowerCase() !== "debit").map(mode)));
  y = band(doc, y + 2, "Summary", "Thank you for staying with us.");
  const summaryTop = y;
  const pagesBefore = pageCount(doc);
  y = totals(doc, y, [
    { label: b.foodTotalPaise > 0 || food.foodPaise > 0 ? "Bill total (hotel + food)" : "Bill total", paise: grand, strong: true },
    ...(b.advance ? [{ label: `Less advance receipt ${b.advance.receiptNo}`, paise: -advance }] : []),
    ...(paidNow > 0 ? [{ label: `Less paid at checkout${paidModes.length ? ` (${paidModes.join(" / ")})` : ""}`, paise: -paidNow }] : []),
    ...(due > 0 ? [{ label: b.balanceHotelPaise > 0 && b.balanceFoodPaise > 0 ? "Balance due" : b.balanceHotelPaise > 0 ? "Balance due (hotel)" : "Balance due (food)", paise: due, strong: true }] : [{ label: "Balance due", paise: 0 }]),
  ]);
  // the notes and the declaration sit in the free space left of the summary
  const notes = [b.instruction ? `Instruction: ${b.instruction}` : "", b.referenceName ? `Reference: ${b.referenceName}${b.referenceMobile ? ` (${b.referenceMobile})` : ""}` : ""].filter(Boolean);
  const leftW = CONTENT_WIDTH * 0.4;
  let left = pageCount(doc) === pagesBefore ? summaryTop : PAGE.margin;
  for (const n of notes) {
    left = room(doc, left, heightOf(doc, n, leftW, { size: 8.5 }) + 3);
    left += put(doc, clean(n), PAGE.margin, left, leftW, { size: 8.5, color: COLOR.muted }) + 3;
  }
  if (taxInvoice) left = smallPrint(doc, left + 3, "Declaration", ["We declare that this invoice shows the actual price of the services described and that all particulars are true and correct."], leftW);
  y = Math.max(y, left);

  if (b.settlement && b.settlement.installments.length > 0) {
    y = band(doc, y + 4, "Settlement", "", false);
    y = table(
      doc,
      y,
      [
        { label: "Date", width: 16 },
        { label: "Hotel", width: 16, align: "right" },
        { label: "Mode", width: 12 },
        { label: "Food", width: 16, align: "right" },
        { label: "Mode", width: 12 },
      ],
      b.settlement.installments.map((i) => [formatDate(i.date), formatINR(i.hotelPaise), mode(i.hotelMode), formatINR(i.foodPaise), mode(i.foodMode)]),
    );
  }

  signatures(doc, y,["Guest signature", `For ${h.name}\nAuthorised signatory`]);
  const out = await finish();
  return { ...out, filename: `bill-${b.billNo.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}.pdf` };
}

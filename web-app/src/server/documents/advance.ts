import "server-only";
import type { AdvancePreview } from "@shared/dashboards/billing";
import { formatDate } from "@shared/dashboards/format";
import { band, clean, COLOR, CONTENT_WIDTH, facts, formatINR, inWords, letterhead, PAGE, panels, paymentMode, put, signatures, startDocument, table, totals } from "./kit";
import type { RenderedDocument } from "./renderer";

// The advance RECEIPT (Pallav's advance voucher): the hotel's letterhead, who paid, what was taken per business with its mode of payment, the amount in
// words, what was used and refunded. Same data as the screen's AdvancePreview.

const mode = paymentMode;

export async function renderAdvance(data: AdvancePreview): Promise<RenderedDocument> {
  const { header: h, advance: a } = data;
  const { doc, finish } = await startDocument({ title: `Advance receipt ${a.receiptNo}` });
  let y = letterhead(
    doc,
    { name: h.name, address: h.address, phone: h.phone, gstin: h.gstin },
    {
      title: "Advance receipt",
      meta: [
        ["Receipt No.", a.receiptNo],
        ["Date", formatDate(a.paymentDate)],
      ],
    },
  );
  y = panels(doc, y, [
    {
      title: "Received from",
      rows: [
        ["Name", a.guestName],
        ["Company", a.companyName],
        ["Mobile", a.mobile],
      ],
    },
    {
      title: "For",
      rows: [
        ["Room", a.roomNo],
        ["From bill", a.fromBillNo],
        ["Taken off", a.usedOn.length > 0 ? `Bill${a.usedOn.length > 1 ? "s" : ""} ${a.usedOn.join(", ")}` : "Not used yet"],
      ],
    },
  ]);
  const rows: string[][] = [];
  if (a.hotelPaise > 0) rows.push([h.name, mode(a.hotelMode), formatINR(a.hotelPaise)]);
  if (a.foodPaise > 0) rows.push([h.foodName, mode(a.foodMode), formatINR(a.foodPaise)]);
  y = table(
    doc,
    y,
    [
      { label: "Towards", width: 50 },
      { label: "Mode of payment", width: 18 },
      { label: "Amount", width: 20, align: "right" },
    ],
    rows,
  );
  y = totals(doc, y, [{ label: "Advance received", paise: a.hotelPaise + a.foodPaise, strong: true }]);
  y = inWords(doc, y, data.amountWords, a.hotelPaise + a.foodPaise);
  y = totals(doc, y, [{ label: "Still to use", paise: a.hotelBalancePaise + a.foodBalancePaise }]);
  if (a.refund) {
    y = band(doc, y + 4, "Refunded", formatDate(a.refund.date));
    y = facts(doc, y, [
      ["Refunded to", a.refund.toName],
      ["Mobile", a.refund.toMobile],
      ["Hotel", a.refund.hotelPaise > 0 ? `${formatINR(a.refund.hotelPaise)} (${mode(a.refund.hotelMode)})` : null],
      ["Food", a.refund.foodPaise > 0 ? `${formatINR(a.refund.foodPaise)} (${mode(a.refund.foodMode)})` : null],
      ["Note", a.refund.note],
    ]);
  }
  const notes = [a.instruction ? `Instruction: ${a.instruction}` : "", a.referenceName ? `Reference: ${a.referenceName}${a.referenceMobile ? ` (${a.referenceMobile})` : ""}` : ""].filter(Boolean);
  for (const n of notes) y += put(doc, clean(n), PAGE.margin, y, CONTENT_WIDTH, { size: 8.5, color: COLOR.muted }) + 3;
  y += put(doc, "This advance is adjusted against the final bill. Please keep this receipt.", PAGE.margin, y + 4, CONTENT_WIDTH, { size: 7.5, color: COLOR.muted });
  signatures(doc, y + 4, ["Guest signature", `For ${h.name}\nAuthorised signatory`]);
  const out = await finish();
  return { ...out, filename: `advance-${a.receiptNo.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}.pdf` };
}

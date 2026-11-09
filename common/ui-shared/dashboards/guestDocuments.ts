// The guest portal's documents as PDFs (round 3 c, rebuilt on main 18 Oct 2026; docs/BACKEND.md "Guest documents"). Each is a GET that answers a PDF (open it in a new tab or
// download it). Refusals answer JSON with a sentence: 404 (not the guest's own), 409 (the running stay bill: "This bill is still running: its PDF is ready after check-out ..."),
// 422 (`hotel` missing for a guest linked to several hotels, or a bad period), 429 (30 documents in 10 minutes). All take `?hotel=` (the hotel the document belongs to).

const q = (params: Record<string, string | undefined>): string => {
  const s = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
  return s ? `?${s}` : '';
};

/** One of the guest's own ISSUED bills (GuestBill.id, e.g. "<uuid>.hotel"), as the hotel prints it. */
export const guestBillPdfPath = (billId: string, hotelId?: string): string => `/api/v1/guest/bills/${encodeURIComponent(billId)}/pdf${q({ hotel: hotelId })}`;

/** The receipt for one PAYMENT line of the history (HistoryItem.id with kind 'payment': an advance prints as the hotel's advance receipt). */
export const guestReceiptPdfPath = (historyItemId: string, hotelId?: string): string => `/api/v1/guest/history/${encodeURIComponent(historyItemId)}/receipt${q({ hotel: hotelId })}`;

/** The statement for a period (YYYY-MM-DD, IST, at most a year); without a hotel it covers every linked hotel (a hotel that cannot be reached is named on it). */
export const guestStatementPdfPath = (from: string, to: string, hotelId?: string): string => `/api/v1/guest/history/statement${q({ from, to, hotel: hotelId })}`;

export const STATEMENT_MAX_DAYS = 366;

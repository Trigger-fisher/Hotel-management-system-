// Whether the company can pay online: only when the server says the hotel's payment gateway is Working (set up by the Super Admin in the Set-up centre).
// The server marks it as `onlinePayment: true` on the bill (BillDetail), the Bills summary (DueBillsPage.summary) and the home (CorpDashboard); until it
// does, nobody can pay online (the real server answers 422 and the demo's bills 409), so no Pay button is drawn and each place says how to pay instead.
export const corporateCanPayOnline = (from: object | null | undefined): boolean =>
  (from as { onlinePayment?: unknown } | null | undefined)?.onlinePayment === true;

export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;

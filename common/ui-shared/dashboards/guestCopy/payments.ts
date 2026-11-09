// Decision 71: the words of Payments (the second segment of Bills: payments, charges, the statement sheet). Owned by the Payments page.
// Rules: "Sign in" never "Log in"; money ₹126,000.00; dates 25 Oct 2026.
export const paymentsCopy = {
  title: 'Payments',
  /** The line under the large title: what is in the list. */
  status: (payments: number, charges: number) =>
    `${payments === 1 ? '1 payment' : `${payments} payments`} · ${charges === 1 ? '1 charge' : `${charges} charges`}`,
  kinds: { label: 'Show', payments: 'Payments', charges: 'Charges' },
  search: 'Search payments and charges',
  getStatement: 'Get statement',
  receipt: 'Receipt (PDF)',
  receiptLabel: (title: string, amount: string) => `${title}, ${amount}. Open the receipt (PDF)`,
  cancelled: 'Cancelled',
  billRef: (no: string) => `Bill ${no}`,
  /** MJ, 26 Oct 2026: each payment opens as a drop-down with its details and the receipt. */
  details: {
    show: (title: string, amount: string) => `${title}, ${amount}. Show the details`,
    paidOn: 'Paid on',
    amount: 'Amount',
    towards: 'Paid towards',
    business: { hotel: 'Room and hotel bill', food: 'Restaurant bill' },
    bill: 'Bill',
    hotel: 'Hotel',
    status: 'Status',
    statusText: { paid: 'Received', on_bill: 'On your bill', cancelled: 'Cancelled' },
    download: 'Download receipt',
    noReceipt: 'A cancelled payment has no receipt.',
  },
  empty: {
    payments: { title: 'No payments yet', body: 'The payments you make show here, each with its receipt.' },
    charges: { title: 'Nothing added to your bill yet', body: 'Room nights, food and services charged to your bill show here.' },
  },
  summary: {
    title: 'Paid so far',
    count: (n: number) => (n === 1 ? '1 payment on this list' : `${n} payments on this list`),
    latest: 'Latest payment',
  },
  help: {
    title: 'Questions about a payment?',
    body: 'Reception can explain any charge or resend a receipt.',
  },
  statement: {
    title: 'Get a statement',
    intro: 'Every charge and payment in a period, as a PDF.',
    from: 'From',
    to: 'To',
    covers: (from: string, to: string) => `Covers ${from} to ${to}.`,
    allHotels: 'Covers every hotel you have stayed with.',
    oneHotel: (hotel: string) => `For ${hotel} only.`,
    download: 'Download PDF',
    cancel: 'Cancel',
    backwards: 'The end date must be on or after the start date.',
    tooLong: 'A statement covers at most one year. Choose a shorter period.',
    missing: 'Choose both dates.',
  },
} as const;

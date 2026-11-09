// Decision 71: the words of Bills and one bill (filter chips, stay groups, the action bar, the pay sheet, the one-bill page). Owned by the Bills page; the
// kit's segments (MoneySegments) read `segments` and the kit's PaySheet stub reads `pay`. Rules: "Sign in" never "Log in"; money ₹126,000.00; dates 25 Oct 2026.
export const billsCopy = {
  title: 'Bills',
  search: 'Search bills by number, hotel or room',
  segments: { bills: 'Bills', payments: 'Payments' },

  /** The line under the large title. */
  status: {
    owing: (amount: string, n: number) => `${amount} to pay · ${n === 1 ? '1 bill' : `${n} bills`}`,
    clear: 'All paid · nothing to pay right now',
    none: 'Bills from your stays',
  },

  /** The filter chips (counts come from the server). */
  filters: {
    label: 'Show bills',
    open: 'To pay',
    paid: 'Paid',
    cancelled: 'Cancelled',
    all: 'All',
  },

  /** Empty lists, one per chip. */
  empty: {
    allTitle: 'No bills yet',
    allBody: 'Bills from your stays show here.',
    openTitle: 'Nothing to pay right now',
    openBody: 'Every bill is paid. Thank you.',
    paidTitle: 'No paid bills yet',
    paidBody: 'Bills you have paid show here.',
    cancelledTitle: 'No cancelled bills',
    cancelledBody: 'A bill the hotel cancels shows here.',
    seeAll: 'See all bills',
  },

  /** The list. */
  list: {
    count: (n: number) => (n === 1 ? '1 bill' : `${n} bills`),
    groupsLabel: 'Bills by stay',
  },

  /** The side card's link to a statement (opens Payments with the statement sheet). */
  statement: {
    title: 'Get a statement',
    sub: 'Every charge and payment for a period, as a PDF',
  },

  /** The action bar over the tab bar. */
  bar: {
    label: 'Pay your bills',
    summary: (n: number, amount: string) => `${n === 1 ? '1 bill' : `${n} bills`} · ${amount}`,
    overdue: (amount: string) => `${amount} overdue`,
    pay: 'Pay',
    atReception: (amount: string) => `${amount} to pay at the front desk`,
    call: 'Call',
  },

  pay: {
    title: 'Pay bills',
    confirm: (amount: string) => `Pay ${amount}`,
    count: (n: number) => (n === 1 ? '1 bill' : `${n} bills`),
    total: 'Total to pay',
    note: 'Secure payment by Razorpay. Each business is paid into its own account, with a receipt for each.',
    paid: (amount: string) => `Paid ${amount}. Receipts sent to your email.`,
    atReception: (amount: string) => `${amount} to pay at the front desk`,
    refusedCall: 'Call reception to pay',
    cancel: 'Not now',
  },

  /** One bill. */
  bill: {
    titleNo: (no: string) => `Bill ${no}`,
    running: 'Running bill',
    toPay: 'To pay',
    paid: 'Paid',
    cancelled: 'Cancelled',
    overdueSince: (date: string) => `Overdue · was due ${date}`,
    payBy: (date: string) => `Pay by ${date}`,
    payAtCheckout: 'Pay at check-out',
    paidOf: (paid: string, total: string) => `${paid} paid of ${total}`,
    totalLine: (total: string) => `Bill total ${total}`,
    cancelledNote: 'This bill was cancelled. Nothing is due.',
    runningNote: 'Your final bill is ready at check-out. Charges are added here as your stay goes on.',
    facts: 'Bill details',
    billedBy: 'Billed by',
    gstin: 'GSTIN',
    room: 'Room',
    stay: 'Stay',
    persons: 'Persons',
    issued: 'Issued',
    hotel: 'Hotel',
    charges: 'Charges',
    noCharges: 'Nothing charged on this bill yet.',
    subtotal: 'Subtotal',
    gst: 'GST',
    total: 'Bill total',
    payments: 'Payments',
    noPayments: 'No payments yet.',
    balance: 'Still to pay',
    inWords: 'Amount in words',
    actions: 'Bill actions',
    pay: (amount: string) => `Pay ${amount}`,
    atReception: (amount: string) => `${amount} to pay at the front desk`,
    callReception: 'Call reception',
    download: 'Download PDF',
    email: 'Email me a copy',
    sending: 'Sending…',
    emailed: (email: string) => `A copy is on its way to ${email}.`,
    needEmail: 'Add your email in Account to get a copy by email.',
    addEmail: 'Add email',
    notFoundTitle: "This bill isn't available",
    notFoundBody: 'It may belong to another hotel, or it was removed.',
    backToBills: 'Back to bills',
    pdfTitle: 'Bill PDF',
    pdfBody: 'Open the bill as the hotel prints it, with its GST details.',
  },
} as const;

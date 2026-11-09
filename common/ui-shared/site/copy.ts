// All text on the public EasyHotelSolutions website (MJ, 2 Nov 2026): the product page at "/" for a signed-out visitor and the pages below it (sitePages).
// Rules as in ui-shared/auth/copy.ts: always "Sign in" (never "Log in"). Only what the product really does is claimed here: no customer names, no numbers
// about customers, no prices, no screens that are not built (those are marked "Coming soon"). The sample names and figures in the drawings are labelled as samples.

/** The website's own pages (app/<path>/page.tsx). The proxy marks them so a signed-in visitor still gets the website, not the dashboard shell. */
export const sitePages = ['/features', '/solutions', '/integrations', '/pricing', '/about', '/contact', '/privacy', '/terms'] as const;

export const siteCopy = {
  /** The website is the default page: "/" for a signed-out visitor (web-app/src/app/page.tsx). A signed-in person's "/" stays their dashboard home. */
  path: '/',
  /** The sign-in page (web-app/src/app/login/page.tsx). A signed-in person who opens it is sent to their dashboard at "/". */
  signInPath: '/login',
  /** The demo form. */
  demoPath: '/contact',
  /** The public address, for the share card, the canonical links and the sitemap. */
  url: 'https://www.easyhotelsolutions.in',
  title: 'EasyHotelSolutions · Hotel management software for Indian hotels',
  description: 'Reservations, front desk, GST billing, cash, companies and payroll in one system. Every hotel’s data stays in its own sealed space.',
  brand: { mark: 'E', name: 'EasyHotelSolutions' },
  signIn: 'Sign in',
  /** The link on the sign-in page that leads to this website. */
  toWebsite: 'Visit our website',

  /** Where a visitor can also write: change it here and every link follows. */
  contactEmail: 'sales@easyhotelsolutions.in',
  demo: 'Book a demo',

  nav: [
    { href: '/features', label: 'Features' },
    { href: '/solutions', label: 'Solutions' },
    { href: '/integrations', label: 'Integrations' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/about', label: 'About' },
  ],

  footer: {
    rights: 'All rights reserved.',
    columns: [
      { title: 'Product', links: [{ href: '/features', label: 'Features' }, { href: '/integrations', label: 'Integrations' }, { href: '/pricing', label: 'Pricing' }] },
      { title: 'Who it is for', links: [{ href: '/solutions#independent', label: 'Independent hotels' }, { href: '/solutions#groups', label: 'Hotel groups' }, { href: '/solutions#teams', label: 'Hotel teams' }] },
      { title: 'Company', links: [{ href: '/about', label: 'About' }, { href: '/contact', label: 'Contact' }, { href: '/login', label: 'Sign in' }] },
      { title: 'Legal', links: [{ href: '/privacy', label: 'Privacy policy' }, { href: '/terms', label: 'Terms of service' }] },
    ],
  },

  sample: 'Sample data',

  hero: {
    eyebrow: 'Hotel management software for India',
    title: 'Run your hotel from one calm screen.',
    body: 'Reservations, front desk, GST billing, cash, companies and payroll in one system. Every hotel’s data stays in its own sealed space.',
    secondary: 'See the features',
    note: 'We set it up with your own rooms, rates and team.',
  },

  proof: [
    { value: 'One system', label: 'front desk to payroll' },
    { value: 'GST ready', label: 'bills and summaries' },
    { value: 'Sealed data', label: 'each hotel kept apart' },
    { value: 'Any device', label: 'phone, tablet, desktop' },
  ],

  tour: {
    eyebrow: 'The product',
    title: 'See how the day runs.',
    items: [
      {
        id: 'desk',
        title: 'The front desk knows what is happening today.',
        body: 'Every room is on one board: vacant, occupied, being cleaned. Arrivals and departures are listed, and a check-in or check-out is a tap away.',
        points: ['Room board by floor', 'Arrivals and departures for today', 'Walk-in check-in in a few taps'],
      },
      {
        id: 'gst',
        title: 'Type a GST number. The company fills itself in.',
        body: 'Add a company by its GSTIN and the name and address come from the GST record, saved so the next lookup is free. Bills carry GST, and the summary is ready when your accountant asks.',
        points: ['Company details fetched from the GSTIN', 'GST on every bill', 'GST summary for filing'],
      },
      {
        id: 'cash',
        title: 'Cash that adds up before anyone goes home.',
        body: 'Revenue, expenses and the shift handover sit together, so the drawer is checked against the books at the end of every shift.',
        points: ['Revenue and expenses by day', 'Shift handover with the count', 'Every change recorded with who made it'],
      },
    ],
  },

  highlights: {
    eyebrow: 'What it does',
    title: 'Everything the day asks of you, in one place.',
    more: 'All features',
    items: [
      { icon: 'grid', title: 'Front desk and room board', body: 'Every room at a glance. Check guests in and out in a few taps.' },
      { icon: 'receipt', title: 'Billing with GST', body: 'Bills, advances and GST summaries ready for filing.' },
      { icon: 'cash', title: 'Cash that adds up', body: 'Revenue, expenses and shift handover, checked every shift.' },
      { icon: 'building', title: 'Companies and ledgers', body: 'Corporate profiles, statements and what each company owes.' },
      { icon: 'people', title: 'Staff and payroll', body: 'Attendance, salary, advances and letters.' },
      { icon: 'globe', title: 'Your hotel’s website', body: 'Rooms, rates, gallery and booking enquiries from the same screen.' },
    ],
  },

  security: {
    eyebrow: 'Built to be trusted',
    title: 'Your hotel’s data is yours alone.',
    body: 'A hotel’s bookings, guests and bills live in that hotel’s own sealed space. No other hotel can reach them, and neither can a bug in another hotel’s screen.',
    items: [
      { title: 'Sealed per hotel', body: 'Every hotel has its own separate data space.' },
      { title: 'Roles and permissions', body: 'Owners, managers and staff each see only what they should.' },
      { title: 'A record of every change', body: 'Who did what, and when, in an activity log nobody can quietly edit.' },
      { title: 'A locked vault', body: 'Passwords and bank details are stored encrypted and shown only when asked for, and each time is recorded.' },
    ],
  },

  steps: {
    eyebrow: 'How it starts',
    title: 'Live in three steps.',
    items: [
      { title: 'We set up your hotel', body: 'Rooms, rates, taxes and your own address, entered with you once.' },
      { title: 'Your team signs in', body: 'Each person gets a role: owner, front desk, accounts. They see only what their job needs.' },
      { title: 'You run the day', body: 'Check-ins, bills, cash and reports, with every change recorded.' },
    ],
  },

  faq: {
    eyebrow: 'Questions',
    title: 'Before you ask.',
    items: [
      { q: 'Does it handle GST?', a: 'Yes. Bills carry GST, there is a GST summary for filing, and when you add a company you can type its GST number and have the name and address filled in from the GST record.' },
      { q: 'Is my hotel’s data kept apart from other hotels?', a: 'Yes. Every hotel has its own sealed data space. A person signed in to one hotel cannot see another hotel’s guests, bookings or bills.' },
      { q: 'Do I need to install anything?', a: 'No. It opens in the browser on a phone, a tablet or a computer, and follows the device’s day or night setting.' },
      { q: 'Can my staff see only their part?', a: 'Yes. Each person gets a role, and the menu shows only what that role may open. Every change is recorded with who made it.' },
      { q: 'Can I run more than one hotel?', a: 'Yes. A hotel group gets one console for all its properties, while each hotel’s data stays separate.' },
      { q: 'Can guests take online payments?', a: 'Not yet. Online payments through each hotel’s own Razorpay account are being built; the hotel’s keys can already be saved. Until then, payments are recorded at the desk.' },
      { q: 'How do I get started?', a: 'Book a demo. We set it up with your own rooms, rates and team, so you see your hotel in it, not a sample.' },
    ],
  },

  cta: {
    title: 'See it running on your own hotel.',
    body: 'Tell us about your property and we will set up a demo with your rooms and rates.',
  },
} as const;

export type SiteCopy = typeof siteCopy;

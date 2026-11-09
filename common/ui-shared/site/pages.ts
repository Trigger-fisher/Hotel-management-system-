// The text of the website's own pages (app/features, solutions, integrations, pricing, about, contact, privacy, terms). Same rules as site/copy.ts: only what the product does,
// "Coming soon" on what is not built, no prices and no customer claims. Legal text: plain words, the data the product really keeps and the services it really uses.

export interface SitePageMeta {
  path: string;
  title: string;
  description: string;
}

export const featuresPage = {
  meta: { path: '/features', title: 'Features · EasyHotelSolutions', description: 'Front desk, reservations, GST billing, cash, companies, payroll, reports, guest portals and your hotel’s website in one system.' },
  eyebrow: 'Features',
  title: 'One system for the whole hotel.',
  lead: 'Every part of the day, from the first booking to the last bill and the month’s payroll, in the same place, with the same people and the same records.',
  groups: [
    {
      id: 'front-desk', icon: 'grid', title: 'Front desk', body: 'The desk sees today at a glance and does the day’s work in a few taps.',
      items: [
        { title: 'Room board', body: 'Every room by floor: vacant, occupied, being cleaned or out of order, with who is in it and when they leave.' },
        { title: 'Reservations', body: 'Bookings with dates, rooms, rate and advance. Website enquiries become reservations once confirmed.' },
        { title: 'Check-in and check-out', body: 'Walk-in or from a reservation, with the guest’s ID photo kept on the stay.' },
        { title: 'In-house guests', body: 'Who is staying, their account so far, room moves and extra charges.' },
      ],
    },
    {
      id: 'billing', icon: 'receipt', title: 'Billing and cash', body: 'Bills that are right the first time, and cash that is checked every shift.',
      items: [
        { title: 'Bills with GST', body: 'Room, dining and other charges on one bill, with GST worked out and a PDF ready to share.' },
        { title: 'Advances', body: 'Money taken before arrival, kept against the booking and set off on the bill.' },
        { title: 'Revenue and expenses', body: 'What came in and what went out, by day and by mode of payment.' },
        { title: 'Shift handover', body: 'The drawer counted and handed over, matched against the books.' },
      ],
    },
    {
      id: 'companies', icon: 'building', title: 'Companies and customers', body: 'Corporate business kept straight, with less typing.',
      items: [
        { title: 'Company profiles from the GSTIN', body: 'Type the GST number and the company’s name, address and status are filled in from the GST record.' },
        { title: 'Ledgers and statements', body: 'What each company owes, its bills and payments, and statements to send.' },
        { title: 'Customers', body: 'Guests who come back, with their stays and bills in one place.' },
        { title: 'Email campaigns', body: 'Offers and notices to your customers, with unsubscribes respected.' },
      ],
    },
    {
      id: 'guests', icon: 'phone', title: 'Guest services', body: 'What guests ask for, handled and recorded.',
      items: [
        { title: 'Dining orders', body: 'Orders from guests’ rooms, sent to the kitchen and charged to the stay.' },
        { title: 'Guest requests', body: 'Towels, repairs, wake-up calls: logged and tracked until done.' },
        { title: 'Guest messages', body: 'Messages from the guest portal, answered from the desk.' },
        { title: 'Email inbox', body: 'The hotel’s email arrives inside the system and is answered from it, so every conversation stays on record.' },
      ],
    },
    {
      id: 'staff', icon: 'people', title: 'Staff and payroll', body: 'The team’s month, without a separate spreadsheet.',
      items: [
        { title: 'Attendance', body: 'Days present and leave for every person.' },
        { title: 'Salary', body: 'Monthly salary worked out from attendance, with advances set off.' },
        { title: 'Letters', body: 'Salary slips and staff letters as PDFs.' },
      ],
    },
    {
      id: 'reports', icon: 'calendar', title: 'Reports', body: 'The numbers owners and accountants ask for.',
      items: [
        { title: 'Daily report', body: 'The day’s rooms, revenue and cash on one page.' },
        { title: 'Occupancy', body: 'How full the hotel was over the period you choose.' },
        { title: 'Meal plans', body: 'Who is on which plan, for the kitchen.' },
        { title: 'GST summary', body: 'Tax by rate and by period, ready for filing.' },
      ],
    },
    {
      id: 'website', icon: 'globe', title: 'Your hotel’s website', body: 'Your own website, kept up to date from the same screen.',
      items: [
        { title: 'Rooms, rates and calendar', body: 'Room types, plans and prices by date, shown to visitors as you set them.' },
        { title: 'Gallery and content', body: 'Photos, descriptions, services, house rules and places nearby.' },
        { title: 'Booking enquiries', body: 'Visitors ask for dates; you confirm or decline from the desk.' },
        { title: 'Google reviews', body: 'Your best Google reviews shown on the site.' },
      ],
    },
    {
      id: 'portals', icon: 'mail', title: 'Guest and company portals', body: 'Guests and companies help themselves.',
      items: [
        { title: 'Guest portal', body: 'Guests see their stay and bills, order food and send requests from their phone.' },
        { title: 'Company portal', body: 'Companies see their bills, statements and what they owe.' },
      ],
    },
    {
      id: 'admin', icon: 'shield', title: 'Control and security', body: 'The owner decides who sees what, and every change is on record.',
      items: [
        { title: 'Roles and permissions', body: 'Owner, manager, front desk, accounts or your own roles, each with only what it needs.' },
        { title: 'Activity log', body: 'Who changed what, and when, for every record.' },
        { title: 'Sealed hotel data', body: 'Each hotel’s data in its own space, out of reach of every other hotel.' },
        { title: 'Accounting years', body: 'Books closed by year, so last year’s figures stay as they were filed.' },
      ],
    },
  ],
} as const;

export const solutionsPage = {
  meta: { path: '/solutions', title: 'Solutions · EasyHotelSolutions', description: 'For independent hotels, hotel groups with several properties, and the teams who run them every day.' },
  eyebrow: 'Solutions',
  title: 'Made for the way your hotel is run.',
  lead: 'One hotel or many, a small team or a large one: the same system, set up around how you work.',
  items: [
    {
      id: 'independent', title: 'Independent hotels', body: 'For owners and managers who want the whole day under control without a heavy system or a long training.',
      points: ['Front desk, billing and cash from the first day', 'GST bills and summaries without extra software', 'Your own website managed from the same screen', 'Works on the phone in your pocket'],
    },
    {
      id: 'groups', title: 'Hotel groups and multi-property operators', body: 'For groups that run several properties and want one view of all of them, while each hotel keeps its own books.',
      points: ['One group console for every property', 'Each hotel’s data kept in its own sealed space', 'Hotel admins appointed for each property', 'Group mail kept with the group'],
    },
    {
      id: 'teams', title: 'Hotel management teams', body: 'For the people at the desk, in accounts and in the back office, each with a screen made for their job.',
      points: ['Front desk: room board, check-in, check-out', 'Accounts: bills, cash, ledgers, GST', 'Back office: payroll, letters, reports', 'Owners: the daily report and every change on record'],
    },
  ],
} as const;

export const integrationsPage = {
  meta: { path: '/integrations', title: 'Integrations · EasyHotelSolutions', description: 'Email, GST records, Google Maps and reviews today; online payments through each hotel’s own Razorpay account and WhatsApp coming soon.' },
  eyebrow: 'Integrations',
  title: 'Connected to the services hotels use.',
  lead: 'What is connected today, and what is being built. We list only what works.',
  live: 'Available',
  soon: 'Coming soon',
  groups: [
    {
      title: 'Communication',
      items: [
        { name: 'Email: your own mailbox', status: 'live', body: 'Connect the hotel’s mailbox (Gmail or any mail server) to send bills and read replies inside the system.' },
        { name: 'Email: hosted sending and receiving', status: 'live', body: 'Hotel email sent and received through Amazon SES, with bounces and complaints handled automatically.' },
        { name: 'WhatsApp', status: 'soon', body: 'Guest messages and confirmations on WhatsApp, kept with the stay.' },
      ],
    },
    {
      title: 'Tax and compliance',
      items: [
        { name: 'GST records', status: 'live', body: 'A company’s name, address and status fetched from its GSTIN, and saved so the next lookup is free.' },
      ],
    },
    {
      title: 'Payments',
      items: [
        { name: 'Razorpay', status: 'soon', body: 'Online payments into each hotel’s own Razorpay account, never through ours. Each hotel’s keys are already kept apart and can be saved today.' },
      ],
    },
    {
      title: 'Website',
      items: [
        { name: 'Google Maps and reviews', status: 'live', body: 'Your location on the map and your best Google reviews on your hotel’s website.' },
      ],
    },
    {
      title: 'Accounting',
      items: [
        { name: 'Accounting software', status: 'soon', body: 'Not connected yet. The GST summary and ledgers are ready for your accountant today. Tell us which software you use.' },
      ],
    },
  ],
} as const;

export const pricingPage = {
  meta: { path: '/pricing', title: 'Pricing · EasyHotelSolutions', description: 'Plans for a single hotel and for hotel groups, quoted for your property.' },
  eyebrow: 'Pricing',
  title: 'A plan for one hotel or many.',
  lead: 'The price depends on the number of rooms and properties. Tell us about your hotel and we will send you a quote.',
  quote: 'Quoted for your hotel',
  plans: [
    { id: 'hotel', name: 'Hotel', for: 'One property', body: 'Everything a single hotel needs to run the day.', cta: 'Get a quote' },
    { id: 'group', name: 'Group', for: 'Two or more properties', body: 'Every hotel feature, plus one console across all your properties.', cta: 'Get a quote', featured: true },
  ],
  compareTitle: 'Compare the plans',
  rows: [
    { label: 'Front desk, reservations and room board', hotel: true, group: true },
    { label: 'Bills with GST, advances and GST summary', hotel: true, group: true },
    { label: 'Revenue, expenses and shift handover', hotel: true, group: true },
    { label: 'Companies, ledgers and GSTIN fill-in', hotel: true, group: true },
    { label: 'Staff attendance and payroll', hotel: true, group: true },
    { label: 'Reports: daily, occupancy, meal plans, GST', hotel: true, group: true },
    { label: 'Guest and company portals', hotel: true, group: true },
    { label: 'Your hotel’s website', hotel: true, group: true },
    { label: 'Email inbox inside the system', hotel: true, group: true },
    { label: 'Roles, permissions and activity log', hotel: true, group: true },
    { label: 'Group console across properties', hotel: false, group: true },
    { label: 'Hotel admins for each property', hotel: false, group: true },
    { label: 'Group mail', hotel: false, group: true },
  ],
  included: { title: 'Every plan includes', items: ['Set-up of your rooms, rates and taxes with you', 'Your team’s sign-ins and roles', 'Each hotel’s data in its own sealed space', 'Updates as new features are released'] },
} as const;

export const aboutPage = {
  meta: { path: '/about', title: 'About · EasyHotelSolutions', description: 'Why we build EasyHotelSolutions, and what we believe hotel software should be.' },
  eyebrow: 'About',
  title: 'Hotel software that stays out of the way.',
  lead: 'EasyHotelSolutions is hotel management software made for hotels in India: their GST, their rupees, their way of running a front desk.',
  sections: [
    { title: 'Why we build it', body: 'Many hotels still run the day on a register, a spreadsheet and a chat group, or on software that needs a long training and a separate tool for every part of the job. We want one calm system that the whole team can use from the first day.' },
    { title: 'What we believe', body: 'A hotel’s data belongs to the hotel, so each hotel gets its own sealed space. Every change should be on record, so nothing goes missing quietly. And software should do the typing it can: a GST number should fill in the company, and a bill should add itself up.' },
    { title: 'How we work', body: 'We set each hotel up with its own rooms, rates and team, and we keep improving the product with the hotels that use it. What is not built yet is marked as coming soon, never sold as ready.' },
  ],
  values: [
    { title: 'Simple first', body: 'If a screen needs explaining, we change the screen.' },
    { title: 'Data kept apart', body: 'One hotel never sees another hotel’s guests, bookings or bills.' },
    { title: 'Honest about what is ready', body: 'We only advertise what works today.' },
  ],
} as const;

export const contactPage = {
  meta: { path: '/contact', title: 'Book a demo · EasyHotelSolutions', description: 'Tell us about your hotel and we will set up a demo with your own rooms and rates.' },
  eyebrow: 'Book a demo',
  title: 'See it on your own hotel.',
  lead: 'Tell us a little about your property. We will call you to set up a demo with your rooms and rates.',
  next: { title: 'What happens next', items: ['We call you to understand how your hotel runs.', 'We set up a demo with your own rooms and rates.', 'You and your team try it before you decide.'] },
  emailTitle: 'Prefer email?',
  form: {
    name: 'Your name', email: 'Work email', phone: 'Phone', hotelName: 'Hotel name', city: 'City', rooms: 'Number of rooms', properties: 'Number of properties',
    message: 'Anything we should know?', messageHint: 'Optional. The software you use today, what you want to change.',
    optional: 'Optional', submit: 'Request a demo', sending: 'Sending…',
    consent: 'We use these details only to contact you about a demo. See our',
    privacyLink: 'privacy policy',
    done: { title: 'Thank you. We have your request.', body: 'We will call or email you soon to set up the demo.' },
    failed: 'Your request could not be sent. Please try again, or email us.',
    tooMany: 'Too many requests from this connection. Please try again later, or email us.',
  },
} as const;

/** One section of a legal page: a heading and its paragraphs or points. */
export interface LegalSection {
  title: string;
  paras?: readonly string[];
  points?: readonly string[];
}

export const privacyPage = {
  meta: { path: '/privacy', title: 'Privacy policy · EasyHotelSolutions', description: 'What information EasyHotelSolutions keeps, why, and the choices you have.' },
  title: 'Privacy policy',
  updated: '2 November 2026',
  intro: 'This policy explains what information EasyHotelSolutions keeps, why we keep it, who we share it with and the choices you have. It covers this website and the EasyHotelSolutions hotel management software.',
  sections: [
    {
      title: 'Who we are',
      paras: ['EasyHotelSolutions provides hotel management software to hotels and hotel groups. For the information a hotel keeps about its own guests, staff and customers, the hotel decides what is kept and why; we keep and process it on the hotel’s behalf and on its instructions.'],
    },
    {
      title: 'What we keep',
      points: [
        'Demo requests: the name, email, phone, hotel name, city and message you send through our demo form.',
        'Accounts: the name, email, username and role of each person who signs in, and a record of sign-ins.',
        'Hotel records: the bookings, guests, bills, companies, staff and other records a hotel enters into the software.',
        'Activity: a record of changes made in the software, with who made them and when, so a hotel can see what happened.',
      ],
    },
    {
      title: 'Why we keep it',
      points: [
        'To answer a demo request and set up a demo.',
        'To provide the software to the hotels that use it, keep it secure and fix problems.',
        'To meet legal and tax requirements, such as keeping bills for the period the law requires.',
      ],
      paras: ['We do not sell personal information, and we do not use a hotel’s guest records for our own marketing.'],
    },
    {
      title: 'How we keep it safe',
      points: [
        'Each hotel’s records are kept in that hotel’s own separate data space.',
        'People see only what their role allows, and changes are recorded.',
        'Passwords are never stored as typed; secrets such as service keys are stored encrypted.',
        'Information travels over encrypted connections.',
      ],
    },
    {
      title: 'Who we share it with',
      paras: ['We use a small number of service providers to run the software, only for that purpose: hosting and databases, email delivery, and the GST record lookup a hotel asks for. They act on our instructions. We may also share information when the law requires it.'],
    },
    {
      title: 'Cookies',
      paras: ['The software uses a cookie to keep you signed in and to remember screen preferences such as day or night mode. This website does not use advertising cookies.'],
    },
    {
      title: 'How long we keep it',
      paras: ['A hotel’s records are kept while the hotel uses the software and for as long as the law requires afterwards. Demo requests are kept while we are in contact and are removed on request.'],
    },
    {
      title: 'Your choices',
      paras: ['You can ask us what information we hold about you, ask us to correct it, or ask us to delete it where the law allows, under the Digital Personal Data Protection Act, 2023 and other laws that apply. If your information was entered by a hotel, we will pass your request to that hotel.'],
    },
    {
      title: 'Contact',
      paras: ['For any question about this policy or your information, email us at the address below. We may update this policy; the date at the top shows when it last changed.'],
    },
  ] as readonly LegalSection[],
} as const;

export const termsPage = {
  meta: { path: '/terms', title: 'Terms of service · EasyHotelSolutions', description: 'The terms on which EasyHotelSolutions provides its hotel management software and website.' },
  title: 'Terms of service',
  updated: '2 November 2026',
  intro: 'These terms apply to this website and to the EasyHotelSolutions hotel management software. A hotel’s order or agreement with us may add to them; where the two differ, the agreement applies.',
  sections: [
    {
      title: 'Using the software',
      points: [
        'A hotel or hotel group is given access for its own business. It is responsible for who it lets sign in and what they do.',
        'Keep sign-in details private, and tell us at once if you think someone else has used them.',
        'Do not try to reach another hotel’s data, break the software’s security, or use it to send unwanted mail.',
      ],
    },
    {
      title: 'Your data',
      paras: ['The records a hotel enters belong to that hotel. We keep and process them only to provide the software, as our privacy policy describes. A hotel can ask for its records when it stops using the software.'],
    },
    {
      title: 'Taxes and bills',
      paras: ['The software works out taxes from the rates and settings a hotel enters. The hotel remains responsible for checking its bills and filings and for the accuracy of what it enters.'],
    },
    {
      title: 'Availability and changes',
      paras: ['We work to keep the software available and secure, and we improve it over time. Features marked as coming soon are not yet available and may change.'],
    },
    {
      title: 'Payment',
      paras: ['Fees, if any, are set out in the hotel’s quote or agreement. Where a fee is not paid, we may limit access after notice.'],
    },
    {
      title: 'Liability',
      paras: ['To the extent the law allows, we are not liable for indirect losses or for loss caused by information a user entered or by a user’s own actions. Nothing in these terms limits liability that cannot be limited by law.'],
    },
    {
      title: 'Ending use',
      paras: ['A hotel may stop using the software as its agreement allows. We may suspend access that breaks these terms or puts other hotels at risk.'],
    },
    {
      title: 'Law',
      paras: ['These terms are governed by the laws of India.'],
    },
    {
      title: 'Contact',
      paras: ['Questions about these terms: email us at the address below.'],
    },
  ] as readonly LegalSection[],
} as const;

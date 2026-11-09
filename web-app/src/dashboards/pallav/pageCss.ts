// Which of Pallav's page stylesheets each screen loads (from the @push('styles') blocks of its Blade views),
// in Pallav's own order. Night mode (pms-dark.css) is always last; assets.ts places it.

const LISTS = ['shift-handover.css'];

// Decision 71: the guest portal's sheets. guest-glass.css is the foundation (tokens, glass, the shell's guest look, the kit's components, motion, accessibility);
// each guest page owns one sheet after it (Home, Room service, Bills and one bill, Payments, Account). All five load on every guest page and in the hotel's
// portal preview, so a page never waits for its sheet and nothing moves when the guest changes tab.
const GUEST_SHEETS = ['pms-dash.css', 'portal.css', 'shift-handover.css', 'bill-master.css', 'guest-glass.css', 'portal-icons.css', 'guest-home.css', 'guest-order.css', 'guest-bills.css', 'guest-payments.css', 'guest-account.css'];

/** First match wins; ids are our view ids. */
const RULES: [prefix: string, sheets: string[]][] = [
  // Conversations (decision 66): the list look plus the hub's own sheet (three panes, bubbles, the mail paper), the hotel's and the platform's.
  ['hotel.conversations', ['shift-handover.css', 'conversations.css']],
  ['hotel.conversation', ['shift-handover.css', 'conversations.css']],
  ['platform.conversations', ['shift-handover.css', 'conversations.css']],
  ['platform.conversation', ['shift-handover.css', 'conversations.css']],
  ['hotel.email', ['shift-handover.css', 'conversations.css']],
  ['hotel.emailThread', ['shift-handover.css', 'conversations.css']],
  ['hotel.whatsapp', ['shift-handover.css', 'conversations.css']],
  ['hotel.whatsappThread', ['shift-handover.css', 'conversations.css']],
  ['platform.email', ['shift-handover.css', 'conversations.css']],
  ['platform.emailThread', ['shift-handover.css', 'conversations.css']],
  ['platform.myMailbox', ['shift-handover.css', 'conversations.css']],
  ['platform.myMailboxThread', ['shift-handover.css', 'conversations.css']],
  ['hotel.myMailbox', ['shift-handover.css', 'conversations.css']],
  ['hotel.myMailboxThread', ['shift-handover.css', 'conversations.css']],
  ['group.myMailbox', ['shift-handover.css', 'conversations.css']],
  ['group.myMailboxThread', ['shift-handover.css', 'conversations.css']],
  ['group.email', ['shift-handover.css', 'conversations.css']],
  ['group.emailThread', ['shift-handover.css', 'conversations.css']],
  ['platform.whatsapp', ['shift-handover.css', 'conversations.css']],
  ['platform.whatsappThread', ['shift-handover.css', 'conversations.css']],
  // Platform console (docs/plans/PLAN-PLATFORM-CONSOLE.md)
  ['platform.overview', ['dashboard.css']],
  ['platform.hotels', ['shift-handover.css', 'bill-master.css']],
  // Announcements: the same list look as Hotels (the state pill and the left-aligned card table come from bill-master.css)
  ['platform.announcements', ['shift-handover.css', 'bill-master.css']],
  ['platform.hotelMail', ['shift-handover.css', 'settings.css']],
  // a hotel's and a group's Integrations wizards use the choice cards of cashbook.css and the mail form of settings.css
  ['platform.hotel', ['shift-handover.css', 'pms-payroll.css', 'cashbook.css', 'settings.css']],
  ['platform.invitations', ['shift-handover.css', 'bill-master.css', 'cashbook.css']],
  ['platform.groups', ['shift-handover.css', 'bill-master.css']],
  ['platform.group', ['shift-handover.css', 'pms-payroll.css', 'cashbook.css', 'settings.css']],
  ['platform.admins', ['shift-handover.css', 'bill-master.css', 'profile.css']],
  ['platform.profile', ['shift-handover.css', 'profile.css', 'password.css']],
  // Super Admin extras part 1 (A7): lists with the filter bar; the audit log and sign-ins use the System Log's filter and search sheets.
  ['platform.users', ['shift-handover.css', 'bill-master.css', 'profile.css']],
  ['platform.audit', ['shift-handover.css', 'bill-master.css', 'profile.css', 'system-log.css']],
  ['platform.signins', ['shift-handover.css', 'bill-master.css', 'profile.css', 'system-log.css']],
  ['platform.demoRequests', ['shift-handover.css', 'bill-master.css', 'profile.css', 'system-log.css']],
  ['platform.vault', ['shift-handover.css', 'pms-payroll.css']],
  // Super Admin extras part 2 (A8): platform staff like Hotel admins, health on System health's sheet, settings on Settings' sheet.
  ['platform.staff', ['shift-handover.css', 'bill-master.css', 'profile.css']],
  ['platform.health', ['shift-handover.css', 'system-health.css']],
  ['platform.settings', ['shift-handover.css', 'settings.css']],
  ['platform.archived', ['shift-handover.css', 'bill-master.css']],
  // Possible duplicates: the Hotels list look (state pills, cards) plus the toolbar of the Archived list.
  ['platform.duplicates', ['shift-handover.css', 'bill-master.css', 'profile.css']],
  // Central: the same lists and details as All users, on the same sheets.
  ['platform.central', ['shift-handover.css', 'bill-master.css', 'profile.css']],
  // Group console (Group Hotel Admin): the same pages as the Platform console's, on the same sheets.
  ['group.overview', ['dashboard.css']],
  // Invite a hotel is the Invitations page with its invite form open: the same sheets
  ['group.hotels.invite', ['shift-handover.css', 'bill-master.css', 'cashbook.css']],
  ['group.hotels', ['shift-handover.css', 'bill-master.css']],
  // one hotel and the payments page are built on the home's sections and queue (.hd, .hd-sec, .hm-*)
  ['group.hotel', ['dashboard.css', 'shift-handover.css', 'pms-payroll.css']],
  ['group.invitations', ['shift-handover.css', 'bill-master.css', 'cashbook.css']],
  ['group.admins', ['shift-handover.css', 'bill-master.css', 'profile.css']],
  ['group.payments', ['dashboard.css', 'cashbook.css', 'shift-handover.css', 'company.css', 'settings.css']],
  ['group.profile', ['shift-handover.css', 'profile.css', 'password.css']],
  ['hotel.dashboard', ['dashboard.css']],
  ['hotel.billing.advances', ['shift-handover.css', 'cashbook.css', 'bill-master.css']],
  ['hotel.billing', ['shift-handover.css', 'bill-master.css']],
  ['hotel.cash.handover', ['shift-handover.css']],
  ['hotel.cash', ['cashbook.css']],
  ['hotel.co.ledger', ['cashbook.css', 'shift-handover.css', 'company-ledger.css']],
  ['hotel.co.statement', ['cashbook.css', 'shift-handover.css', 'company-ledger.css']],
  ['hotel.co.marketing', ['cashbook.css', 'shift-handover.css', 'company.css', 'settings.css']],
  ['hotel.co.customers', ['cashbook.css', 'shift-handover.css', 'company.css', 'settings.css']],
  ['hotel.co.notifications', ['cashbook.css', 'shift-handover.css', 'company.css', 'settings.css']],
  ['hotel.co.notification', ['cashbook.css', 'shift-handover.css', 'company.css', 'settings.css']],
  ['hotel.co', ['cashbook.css', 'shift-handover.css', 'company.css']],
  ['hotel.fo', ['shift-handover.css', 'website-admin.css', 'front-office.css', 'bill-master.css']],
  ['hotel.reports', ['shift-handover.css', 'payroll-look.css']],
  ['hotel.books', ['shift-handover.css', 'bill-master.css']],
  ['hotel.payroll.staffEmails', ['shift-handover.css', 'payroll-look.css', 'profile.css', 'system-log.css', 'staff-emails.css']],
  ['hotel.payroll.log', ['shift-handover.css', 'payroll-look.css', 'profile.css', 'system-log.css']],
  ['hotel.payroll', ['shift-handover.css', 'payroll-look.css']],
  ['hotel.web', ['shift-handover.css', 'website-admin.css']],
  ['hotel.admin.profile', ['shift-handover.css', 'profile.css', 'password.css']],
  ['hotel.admin.users', ['shift-handover.css', 'profile.css', 'access.css']],
  ['hotel.admin.roles', ['access.css']],
  ['hotel.admin.masters', ['shift-handover.css', 'cashbook.css', 'catalog.css', 'bill-master.css']],
  // The guest portal preview draws the guest screens in the hotel shell: the guest sheets give their own blocks (.gg-*) their layout; their look stays under body.hms-guest, so the preview keeps the hotel's look.
  ['hotel.admin.guestPortal', GUEST_SHEETS],
  ['hotel.admin.companyPortal', ['pms-dash.css', 'portal.css', 'shift-handover.css', 'bill-master.css']],
  // Settings > Email's Reading block and Test connection, and Settings > WhatsApp, use the Conversations sheet's .cv-settings, .cv-test, .cv-wa-* and .cv-setup-card (decision 66).
  ['hotel.admin.settings', ['settings.css', 'conversations.css']],
  ['hotel.admin.payments', ['cashbook.css', 'shift-handover.css', 'company.css', 'settings.css']],
  ['hotel.admin.system', ['system-health.css']],
  ['hotel.admin.log', ['shift-handover.css', 'profile.css', 'system-log.css']],
  ['hotel.admin.forceLog', ['shift-handover.css', 'profile.css', 'system-log.css']],
  // Decisions 70 and 71: the guest portal's Full Transparent look (HMS's own sheets, the look under body.hms-guest), last so they follow the sheets they restyle.
  ['guest', GUEST_SHEETS],
  // MJ, 26 Oct 2026: the company portal takes the Full Transparent look too (guest-glass.css under body.hms-glass), last so it follows the sheets it restyles.
  ['corporate.myProfile', ['shift-handover.css', 'profile.css', 'password.css', 'guest-glass.css', 'portal-icons.css']],
  ['corporate', ['pms-dash.css', 'portal.css', 'shift-handover.css', 'bill-master.css', 'guest-glass.css', 'portal-icons.css']],
];

/** MJ, 26 Oct 2026 ("the same instructions for all users"): every dashboard takes the Full Transparent look and the premium icons, after the sheets they restyle. */
const GLASS = ['guest-glass.css', 'portal-icons.css'];

export function pageSheetsFor(viewId: string): string[] {
  const own = RULES.find(([prefix]) => viewId === prefix || viewId.startsWith(`${prefix}.`))?.[1] ?? LISTS;
  // a list that already names them keeps its order (the guest page sheets come after guest-glass.css)
  return [...own, ...GLASS.filter((s) => !own.includes(s))];
}

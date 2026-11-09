// Menu for each dashboard. Owned by the Lead: module agents never edit this file.
// View ids are the keys each module registers its screens under.
// Source: Hotel Pallav app (MJ 2026-10-05): guest portal -> Guest dashboard,
// company portal -> Corporate dashboard, everything else -> Hotel dashboard (for now).

import type { Role } from '../auth/types';
import { guestCopy } from './guest';

export type DashboardKind = 'guest' | 'corporate' | 'hotel' | 'platform' | 'group';

export interface NavItem {
  /** Unique view id, e.g. "hotel.revenue". */
  id: string;
  label: string;
  /** Icon name from each app's dashboard icon set. */
  icon: string;
  /** Module group that owns the screen (folder name in each app). */
  group: string;
  /** Hotel Admin only (Hotel User sees it only when granted; mock shows all to Hotel Admin). */
  adminOnly?: boolean;
  /** Reachable (a button, the user card, the accounting-year selector) but not listed in the menu, as in Pallav. */
  hidden?: boolean;
  /** Switched off (not in the product document): not in the menu and not openable by address either. The page code stays. */
  off?: boolean;
  /** Planned, not delivered (the product document's Upcoming label): listed with an "Upcoming" tag. A page of its own, or a placeholder when there is none yet. */
  upcoming?: boolean;
  /** The page's own title in the header when it differs from the menu label (Pallav: "Bill Master - Bills"). */
  pageTitle?: string;
  /** Platform console: shown to the Super Admin only (a Platform Admin does not see it). */
  superOnly?: boolean;
  /**
   * My mailbox (platform 0178, 0179): shown to every STAFF login (the account roles of mailboxAccess.ts), never to a guest or a company login. In the hotel dashboard it is for the hotel's own
   * staff: the Super Admin, Platform Admins and Group Admins only reach a hotel by a visit, and their own mailbox is in their own console.
   */
  staffOnly?: boolean;
  /**
   * A hotel's private page (Conversations, decision 66, C4): never shown to Super Admin or Platform Admin in the hotel dashboard, not even during a visit.
   * A Group Hotel Admin's visit still opens it (read only).
   */
  hotelPrivate?: boolean;
  /** One Email entry for several mailboxes (MJ, 5 Nov 2026): open-able when any of these page ids is (the shared inbox, My mailbox). */
  opensWith?: readonly string[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Which dashboard each role opens (MJ, 5 Nov 2026: every kind of user is a different user, never mixed). The Super Admin and the Platform Admin open the
 * Platform console, the Group Hotel Admin the Group console, the Hotel Admin and the Hotel User their hotel, the guest and the company their portals.
 * A console user reaches a hotel only by a visit from the console (RoleDashboard Console, with the visit banner), never by default.
 */
export const dashboardForRole: Partial<Record<Role, DashboardKind>> = {
  guest_user: 'guest',
  corporate_user: 'corporate',
  hotel_admin: 'hotel',
  hotel_user: 'hotel',
  super_admin: 'platform',
  platform_admin: 'platform',
  group_hotel_admin: 'group',
};

export const dashboardTitle: Record<DashboardKind, { name: string; tagline: string }> = {
  guest: { name: 'Guest Portal', tagline: 'Your stays and bills' },
  corporate: { name: 'Company Portal', tagline: "Your company's stays and bills" },
  hotel: { name: 'Hotel', tagline: 'Hotel Management Suite' },
  platform: { name: 'Platform', tagline: 'Hotels and administrators' },
  group: { name: 'Group', tagline: 'Your group of hotels' },
};

/** The mock Platform console logins (Platform Admin, Super Admin); every super_admin and platform_admin opens it, these are the demo's named ones. */
export const platformConsoleUsers: readonly string[] = ['platform', 'superadmin', 'mihir'];

/** The mock Group console logins (Group Hotel Admin Kavita Desai of Sunrise Group; `group` and `groupadmin` are the same person). */
export const groupConsoleUsers: readonly string[] = ['groupadmin', 'group'];

/**
 * Which dashboard a signed-in user opens: the ROLE alone, the same against the demo and the real server (dashboardForRole), so a Super Admin is never
 * put inside a hotel. The two other arguments stay for the callers and no longer change the answer.
 */
export function dashboardKindFor(role: Role, _apiIsMock?: boolean, _username?: string | null): DashboardKind | undefined {
  return dashboardForRole[role];
}

export const nav: Record<DashboardKind, NavSection[]> = {
  // Guest portal (decisions 70 and 71, MJ 26 Oct 2026): what a guest does during a stay first (Home, Room service), then money (Bills, Payments), then the account.
  // One name per page everywhere (sidebar, phone tab bar, page title, Home buttons); the labels are guestCopy.nav. Payments stays a normal menu item (no drill
  // parent): the Bills | Payments segments switch between two menu pages, so neither gets a Back arrow. Phones show four tabs (Home, Room service, Bills, Account).
  guest: [
    {
      title: 'Your stay',
      items: [
        { id: 'guest.home', label: guestCopy.nav.home, icon: 'house', group: 'guest' },
        { id: 'guest.order', label: guestCopy.nav.order, icon: 'cup-hot', group: 'guest' },
      ],
    },
    {
      title: 'Money',
      items: [
        { id: 'guest.bills', label: guestCopy.nav.bills, icon: 'receipt', group: 'guest' },
        { id: 'guest.history', label: guestCopy.nav.payments, icon: 'wallet2', group: 'guest' },
        // a live page that sat under "Coming soon" (MJ, 5 Nov 2026): raising a problem with a payment
        { id: 'guest.support', label: 'Help with a payment', icon: 'headset', group: 'guest' },
      ],
    },
    { title: 'Account', items: [{ id: 'guest.profile', label: guestCopy.nav.account, icon: 'person-circle', group: 'guest' }] },
  ],
  // Company portal (MJ, 26 Oct 2026: one plain name per page, the same in the menu, the phone tabs and the page title): Overview and Notices; Accounts:
  // Bills, Payments, Statement; Company.
  corporate: [
    {
      title: 'Overview',
      items: [
        { id: 'corporate.dashboard', label: 'Overview', icon: 'grid-1x2', group: 'corporate' },
        { id: 'corporate.notifications', label: 'Notices', icon: 'bell', group: 'corporate' },
      ],
    },
    {
      title: 'Accounts',
      items: [
        { id: 'corporate.bills', label: 'Bills', icon: 'receipt', group: 'corporate' },
        { id: 'corporate.payments', label: 'Payments', icon: 'wallet2', group: 'corporate' },
        { id: 'corporate.ledger', label: 'Statement', icon: 'journal-text', group: 'corporate' },
        { id: 'corporate.support', label: 'Support', icon: 'headset', group: 'corporate' },
      ],
    },
    {
      title: 'Company',
      items: [
        { id: 'corporate.profile', label: 'Company', icon: 'building', group: 'corporate' },
        { id: 'corporate.myProfile', label: 'My profile', icon: 'person-circle', group: 'corporate', hidden: true },
      ],
    },
  ],
  // The hotel's menu (MJ, 26 Oct 2026: "research, rename and restructure, make every page user friendly"; reordered 2 Nov 2026). Ordered by the day's work, as hotel
  // systems (Cloudbeds, Mews, Opera, eZee) order theirs: today's overview, the front desk, the guests' needs and messages, billing, cash, companies, marketing, staff,
  // reports, the website, then settings and the logs. Only pages that work are in the working sections; every planned page waits in "Coming soon" at the foot.
  // Plain names in sentence case, the same word in the menu, the page title and the phone bar; first drawn from Pallav's sidebar (docs/design/ui-review/15).
  hotel: [
    {
      title: 'Overview',
      items: [
        { id: 'hotel.dashboard', label: 'Overview', icon: 'grid-1x2', group: 'overview' },
        // Reachable from the dashboard and the accounting-year selector, not listed (Pallav).
        { id: 'hotel.reports', label: 'Reports', icon: 'file-earmark-text', group: 'overview', hidden: true },
        { id: 'hotel.books', label: 'Accounting years', icon: 'journal-bookmark', group: 'overview', adminOnly: true, hidden: true },
      ],
    },
    {
      title: 'Front desk',
      items: [
        { id: 'hotel.fo.board', label: 'Room board', icon: 'grid-3x3-gap', group: 'frontOffice' },
        { id: 'hotel.fo.reservations', label: 'Reservations', icon: 'calendar-plus', group: 'frontOffice' },
        { id: 'hotel.fo.inHouse', label: 'In-house guests', icon: 'house-heart', group: 'frontOffice' },
        { id: 'hotel.fo.rooms', label: 'Rooms', icon: 'door-open', group: 'frontOffice' },
        // The page stays; it opens from the "Walk-in check-in" button, not the menu.
        { id: 'hotel.fo.checkIn', label: 'Check-in', icon: 'box-arrow-in-right', pageTitle: 'Check in', group: 'frontOffice', hidden: true },
      ],
    },
    {
      title: 'Guest services',
      items: [
        { id: 'hotel.fo.roomOrders', label: 'Dining orders', icon: 'cup-straw', group: 'frontOffice' },
        { id: 'hotel.fo.requests', label: 'Guest requests', icon: 'hand-index', group: 'frontOffice' },
      ],
    },
    {
      title: 'Messages',
      items: [
        // nothing sends to Guest messages any more (MJ, 5 Nov 2026): out of the menu; an old link still shows the answers already given
        { id: 'hotel.fo.guestMessages', label: 'Guest messages', icon: 'chat-dots', group: 'frontOffice', hidden: true },
        // ONE Email entry (MJ, 5 Nov 2026): a switch inside between the hotel's inbox and the person's own mailbox, showing only the boxes this person has (the hotel's inbox stays
        // away from Super and Platform Admin visits through hotel.conversations' hotelPrivate). params: { box: 'shared' | 'mine', id } for one conversation.
        { id: 'hotel.email', label: 'Email', icon: 'envelope', group: 'conversations', opensWith: ['hotel.conversations', 'hotel.myMailbox'] },
        // WhatsApp is on in the menu (MJ, 4 Nov 2026) now that the number is connected; it shows "not connected yet" until WhatsApp is switched on and the hotel has a number. Its own right (platform 0186).
        { id: 'hotel.whatsapp', label: 'WhatsApp', icon: 'whatsapp', group: 'conversations', hotelPrivate: true },
        { id: 'hotel.emailThread', label: 'Email', icon: 'envelope', pageTitle: 'Email', group: 'conversations', hidden: true, opensWith: ['hotel.conversations', 'hotel.myMailbox'] },
        { id: 'hotel.whatsappThread', label: 'WhatsApp', icon: 'whatsapp', pageTitle: 'WhatsApp', group: 'conversations', hidden: true, hotelPrivate: true },
        // My mailbox (platform 0179): an old address that opens Email on the person's own mailbox. Hotel staff only here (the platform and group consoles have their own).
        { id: 'hotel.myMailbox', label: 'My mailbox', icon: 'envelope-open', pageTitle: 'Email', group: 'conversations', hidden: true, staffOnly: true },
        { id: 'hotel.myMailboxThread', label: 'My mailbox', icon: 'envelope-open', pageTitle: 'Email', group: 'conversations', hidden: true, staffOnly: true },
        // old addresses of the combined inbox: they open the Email page (and its conversation)
        { id: 'hotel.conversations', label: 'Conversations', icon: 'chat-left-text', group: 'conversations', hidden: true, hotelPrivate: true },
        { id: 'hotel.conversation', label: 'Conversation', icon: 'chat-left-text', pageTitle: 'Conversations', group: 'conversations', hidden: true, hotelPrivate: true },
      ],
    },
    {
      title: 'Billing',
      items: [
        { id: 'hotel.billing.bills', label: 'Bills', icon: 'receipt', group: 'billing' },
        { id: 'hotel.billing.advances', label: 'Advances', icon: 'piggy-bank', group: 'billing' },
      ],
    },
    {
      title: 'Cash',
      items: [
        { id: 'hotel.cash.revenue', label: 'Revenue', icon: 'cash-stack', group: 'cash' },
        { id: 'hotel.cash.expenses', label: 'Expenses', icon: 'cart3', group: 'cash' },
        { id: 'hotel.cash.handover', label: 'Handover', icon: 'arrow-left-right', group: 'cash' },
      ],
    },
    {
      title: 'Companies',
      items: [
        { id: 'hotel.co.profiles', label: 'Companies', icon: 'building', group: 'companies' },
        { id: 'hotel.co.ledger', label: 'Ledger', icon: 'journal-text', group: 'companies' },
        { id: 'hotel.co.notifications', label: 'Notices', icon: 'bell', group: 'companies' },
      ],
    },
    {
      title: 'Customers and marketing',
      items: [
        { id: 'hotel.co.customers', label: 'Customers', icon: 'person-lines-fill', group: 'companies' },
        { id: 'hotel.co.marketing', label: 'Email campaigns', icon: 'send', group: 'companies' },
      ],
    },
    {
      title: 'Staff',
      items: [{ id: 'hotel.payroll.home', label: 'Payroll', icon: 'briefcase', group: 'payrollCore' }],
    },
    {
      title: 'Reports',
      items: [
        { id: 'hotel.reports.daily', label: 'Daily report', icon: 'clipboard-data', group: 'overview' },
        { id: 'hotel.reports.occupancy', label: 'Occupancy', icon: 'pie-chart', group: 'overview' },
        { id: 'hotel.reports.gst', label: 'GST summary', icon: 'percent', group: 'overview' },
        { id: 'hotel.reports.foodPlan', label: 'Meal plans', icon: 'egg-fried', group: 'overview' },
      ],
    },
    {
      title: 'Website',
      items: [
        { id: 'hotel.web.overview', label: 'Website', icon: 'globe2', group: 'website', adminOnly: true },
        { id: 'hotel.web.enquiries', label: 'Enquiries', icon: 'inbox', group: 'website', adminOnly: true },
      ],
    },
    {
      title: 'Settings',
      items: [
        { id: 'hotel.admin.settings', label: 'Hotel settings', icon: 'gear', group: 'admin', adminOnly: true },
        // switched back on (MJ, 2 Nov 2026): payments by webhook, refunds, payment links and settlements are built; the page itself is for the Super Admin only
        { id: 'hotel.admin.payments', label: 'Online payments', icon: 'credit-card-2-front', group: 'admin' },
        { id: 'hotel.admin.masters', label: 'Lists and rates', icon: 'list-check', group: 'admin', adminOnly: true },
        { id: 'hotel.admin.users', label: 'Users', icon: 'people', group: 'admin', adminOnly: true },
        { id: 'hotel.admin.roles', label: 'Roles', icon: 'key', group: 'admin', adminOnly: true },
        { id: 'hotel.admin.guestPortal', label: 'Guest portal', icon: 'phone', group: 'admin', adminOnly: true },
        { id: 'hotel.admin.companyPortal', label: 'Company portal', icon: 'building-check', group: 'admin', adminOnly: true },
        // My profile is the user card at the foot of the sidebar, not a list entry.
        { id: 'hotel.admin.profile', label: 'My profile', icon: 'person-gear', group: 'admin', hidden: true },
      ],
    },
    {
      title: 'Logs and health',
      items: [
        { id: 'hotel.admin.log', label: 'Activity log', icon: 'clock-history', group: 'admin', adminOnly: true },
        { id: 'hotel.admin.forceLog', label: 'Override log', icon: 'lightning-charge', group: 'admin', adminOnly: true },
        { id: 'hotel.admin.system', label: 'System health', icon: 'heart-pulse', group: 'admin', adminOnly: true },
      ],
    },
  ],
  // Platform console (Platform Admin, Super Admin): docs/plans/PLAN-PLATFORM-CONSOLE.md. Pallav sidebar look. Reordered 2 Nov 2026 (MJ): the hotels and their
  // vault first, then sales (demo requests, invitations), messages, running the platform, security; WhatsApp waits in "Coming soon".
  platform: [
    { title: 'Overview', items: [{ id: 'platform.overview', label: 'Overview', icon: 'grid-1x2', group: 'platform' }] },
    {
      title: 'Hotels',
      items: [
        { id: 'platform.hotels', label: 'Hotels', icon: 'buildings', group: 'platform' },
        { id: 'platform.groups', label: 'Groups', icon: 'diagram-3', group: 'platform' },
        { id: 'platform.admins', label: 'Hotel admins', icon: 'person-gear', group: 'platform' },
        { id: 'platform.archived', label: 'Archived hotels', icon: 'archive', group: 'platform', superOnly: true },
        // params: { id }
        { id: 'platform.hotel', label: 'Hotel details', icon: 'buildings', pageTitle: 'Hotel details', group: 'platform', hidden: true },
        // params: { id }
        { id: 'platform.group', label: 'Group details', icon: 'diagram-3', pageTitle: 'Group details', group: 'platform', hidden: true },
      ],
    },
    {
      title: 'New hotels',
      items: [
        // the website's demo form (platform 0169): before a hotel is invited
        { id: 'platform.demoRequests', label: 'Demo requests', icon: 'person-plus', group: 'platform', superOnly: true },
        { id: 'platform.invitations', label: 'Invitations', icon: 'envelope-paper', group: 'platform' },
      ],
    },
    // The inbox (MJ, 5 Nov 2026: separate what is mixed): the platform's own Email and WhatsApp and the person's own mailbox, Super Admin and Platform Admin alike.
    // Notices to the hotels and their mail set-up are not messages to answer: they live under "Tell the hotels". params: { id } for one conversation.
    {
      title: 'Inbox',
      items: [
        // ONE Email entry (MJ, 5 Nov 2026): a switch inside between the platform inbox and the person's own mailbox. params: { box: 'shared' | 'mine', id }
        { id: 'platform.email', label: 'Email', icon: 'envelope', group: 'conversations' },
        // the platform line's WhatsApp chat (Super Admin and Platform Admin), on in the menu since 4 Nov 2026 (MJ)
        { id: 'platform.whatsapp', label: 'WhatsApp', icon: 'whatsapp', group: 'conversations' },
        // My mailbox (platform 0178, 0179): old addresses that open Email on the person's own mailbox
        { id: 'platform.myMailbox', label: 'My mailbox', icon: 'envelope-open', pageTitle: 'Email', group: 'conversations', hidden: true, staffOnly: true },
        { id: 'platform.myMailboxThread', label: 'My mailbox', icon: 'envelope-open', pageTitle: 'Email', group: 'conversations', hidden: true, staffOnly: true },
        { id: 'platform.emailThread', label: 'Email', icon: 'envelope', pageTitle: 'Email', group: 'conversations', hidden: true },
        { id: 'platform.whatsappThread', label: 'WhatsApp', icon: 'whatsapp', pageTitle: 'WhatsApp', group: 'conversations', hidden: true },
        { id: 'platform.conversations', label: 'Conversations', icon: 'chat-left-text', group: 'conversations', hidden: true },
        { id: 'platform.conversation', label: 'Conversation', icon: 'chat-left-text', pageTitle: 'Conversations', group: 'conversations', hidden: true },
      ],
    },
    // Central (MJ, 3 Nov 2026): what the platform keeps once for all hotels, read only, as tabs: Logins, Guest profiles, Company profiles, GST records, GST lookups and (Super Admin)
    // Possible duplicates. params: { tab } to open on a tab.
    { title: 'Central', items: [{ id: 'platform.central', label: 'Central', icon: 'database', group: 'platform' }] },
    // What the platform says to every hotel, and how each hotel's mail goes out: the Super Admin only.
    {
      title: 'Tell the hotels',
      items: [
        { id: 'platform.announcements', label: 'Announcements', icon: 'megaphone', group: 'platform', superOnly: true },
        { id: 'platform.hotelMail', label: 'Hotel and group mail', icon: 'envelope-at', group: 'platform', superOnly: true },
      ],
    },
    // Super Admin extras (A7, A8): hidden from a Platform Admin by superOnly. Running the platform, then watching it.
    {
      title: 'Platform',
      items: [
        // the platform's own outside services (mail, WhatsApp, API access, backups, photo storage) and every hotel's state; a hotel is set up on its page, Integrations tab (MJ, 5 Nov 2026). params: { step, hotelId }
        { id: 'platform.setup', label: 'Set-up centre', icon: 'tools', group: 'platform', superOnly: true },
        { id: 'platform.staff', label: 'Platform admins', icon: 'person-fill-gear', group: 'platform', superOnly: true },
        { id: 'platform.users', label: 'All users', icon: 'people-fill', group: 'platform', superOnly: true },
        { id: 'platform.settings', label: 'Platform settings', icon: 'sliders', group: 'platform', superOnly: true },
      ],
    },
    {
      title: 'Security and health',
      items: [
        { id: 'platform.audit', label: 'Audit log', icon: 'clipboard-check', group: 'platform', superOnly: true },
        { id: 'platform.signins', label: 'Sign-in history', icon: 'box-arrow-in-right', group: 'platform', superOnly: true },
        { id: 'platform.health', label: 'Platform health', icon: 'heart-pulse', group: 'platform', superOnly: true },
      ],
    },
    // My Profile is not in the sidebar (MJ, 18 Oct, as in the group console and the portals): user chip, top-bar menu, phone More sheet
    // Possible duplicates is now the last tab of Central (B's profileReview contract: the same person entered twice, one guest or company profile shared by mobile, email or GSTIN; Super
    // Admin only, 403 for others). Its old address still opens Central on that tab.
    // My vault (platform 0190; MJ, 5 Nov 2026): the Super Admin's own personal items. A hotel's vault is a tab of that hotel's page.
    { title: 'Account', items: [{ id: 'platform.vault', label: 'My vault', icon: 'shield-lock', pageTitle: 'My vault', group: 'platform', superOnly: true }, { id: 'platform.duplicates', label: 'Possible duplicates', icon: 'intersect', pageTitle: 'Central', group: 'platform', superOnly: true, hidden: true }, { id: 'platform.profile', label: 'My profile', icon: 'person-circle', group: 'platform', hidden: true }] },
    // NOT in any menu: 'platform.onboarding' is the PUBLIC onboarding form opened from the invitation link (?invite=<token>), no sign-in.
  ],
  // Group console (Group Hotel Admin): only the member hotels of its own group. docs/plans/PLAN-PLATFORM-CONSOLE.md (A6).
  group: [
    { title: 'Overview', items: [{ id: 'group.overview', label: 'Overview', icon: 'grid-1x2', group: 'group' }] },
    {
      title: 'Hotels',
      items: [
        { id: 'group.hotels', label: 'Hotels', icon: 'buildings', group: 'group' },
        { id: 'group.hotels.invite', label: 'Invite hotel', icon: 'envelope-plus', pageTitle: 'Invite hotel', group: 'group', hidden: true },
        // params: { id }
        { id: 'group.hotel', label: 'Hotel details', icon: 'buildings', pageTitle: 'Hotel details', group: 'group', hidden: true },
        { id: 'group.payments', label: 'Online payments', icon: 'credit-card-2-front', group: 'group' },
        { id: 'group.invitations', label: 'Invitations', icon: 'envelope-paper', group: 'group' },
        { id: 'group.admins', label: 'Hotel admins', icon: 'person-gear', group: 'group' },
      ],
    },
    {
      title: 'Mail',
      items: [
        // ONE Email entry (MJ, 5 Nov 2026): the group's inbox (platform 0166) and the Group Admin's own mailbox behind one switch. params: { box: 'shared' | 'mine', id }
        { id: 'group.email', label: 'Email', icon: 'envelope', group: 'conversations' },
        { id: 'group.emailThread', label: 'Email', icon: 'envelope', pageTitle: 'Email', group: 'conversations', hidden: true },
        // old addresses that open Email on the person's own mailbox
        { id: 'group.myMailbox', label: 'My mailbox', icon: 'envelope-open', pageTitle: 'Email', group: 'conversations', hidden: true, staffOnly: true },
        { id: 'group.myMailboxThread', label: 'My mailbox', icon: 'envelope-open', pageTitle: 'Email', group: 'conversations', hidden: true, staffOnly: true },
      ],
    },
    // My Profile is not in the group console's sidebar (MJ, 18 Oct, as in the portals): it opens from the user chip, the top-bar menu and the phone More sheet
    { title: 'Account', items: [{ id: 'group.profile', label: 'My profile', icon: 'person-circle', group: 'group', hidden: true }] },
  ],
};

/**
 * Sub-menus (second panel on web, a list screen on mobile). Payroll has many screens,
 * so it opens its own sub-menu, like the Pallav app. Website admin too.
 */
export const subNav: Record<string, NavSection[]> = {
  // Pallav payroll rail (app/Support/PayrollContext.php): company, then 8 sections.
  'hotel.payroll.home': [
    {
      title: 'Company',
      items: [
        // The company switcher card is the home; the listing stays reachable.
        { id: 'hotel.payroll.companies', label: 'Companies', icon: 'building', group: 'payrollCore', hidden: true },
        { id: 'hotel.payroll.dashboard', label: 'Overview', icon: 'grid-1x2', group: 'payrollCore' },
      ],
    },
    {
      title: 'Staff and attendance',
      items: [
        { id: 'hotel.payroll.staff', label: 'Staff', icon: 'person-vcard', group: 'payrollCore' },
        { id: 'hotel.payroll.attendance', label: 'Attendance', icon: 'calendar-check', group: 'payrollCore' },
        { id: 'hotel.payroll.resignations', label: 'Resignations', icon: 'person-dash', group: 'payrollPay' },
        { id: 'hotel.payroll.staffEmails', label: 'Staff emails', icon: 'envelope', group: 'payrollCore' },
      ],
    },
    {
      title: 'Pay changes',
      items: [
        { id: 'hotel.payroll.salaryUpdate', label: 'Salary changes', icon: 'graph-up-arrow', group: 'payrollPay' },
        { id: 'hotel.payroll.advances', label: 'Staff advances', icon: 'piggy-bank', group: 'payrollPay' },
        { id: 'hotel.payroll.bonus', label: 'Bonus and incentives', icon: 'gift', group: 'payrollPay' },
        { id: 'hotel.payroll.meals', label: 'Staff meals', icon: 'cup-hot', group: 'payrollPay' },
      ],
    },
    {
      title: 'Salary',
      items: [
        { id: 'hotel.payroll.salaryPayments', label: 'Salary payments', icon: 'wallet', group: 'payrollPay' },
        { id: 'hotel.payroll.salarySlips', label: 'Payslips', icon: 'file-earmark-spreadsheet', group: 'payrollPay' },
      ],
    },
    {
      title: 'Reports',
      items: [
        { id: 'hotel.payroll.reports', label: 'Monthly report', icon: 'bar-chart', group: 'payrollPay' },
        { id: 'hotel.payroll.periodReport', label: 'Period report', icon: 'calendar-range', group: 'payrollPay' },
      ],
    },
    {
      title: 'Letters',
      items: [
        { id: 'hotel.payroll.joiningLetter', label: 'Joining letter', icon: 'file-earmark-plus', group: 'payrollPay' },
        { id: 'hotel.payroll.experienceLetter', label: 'Experience letter', icon: 'award', group: 'payrollPay' },
      ],
    },
    {
      title: 'Setup',
      items: [
        { id: 'hotel.payroll.attendanceStatuses', label: 'Attendance marks', icon: 'tag', group: 'payrollCore' },
        { id: 'hotel.payroll.deductions', label: 'Deduction types', icon: 'dash-circle', group: 'payrollCore' },
        { id: 'hotel.payroll.mealPrice', label: 'Meal price', icon: 'currency-rupee', group: 'payrollPay' },
      ],
    },
    {
      title: 'Administration',
      items: [
        { id: 'hotel.payroll.master', label: 'Payroll settings', icon: 'sliders', group: 'payrollPay', adminOnly: true },
        { id: 'hotel.payroll.log', label: 'Payroll log', icon: 'clock-history', group: 'payrollPay', adminOnly: true },
      ],
    },
  ],
  'hotel.web.overview': [
    {
      title: 'Website',
      items: [
        { id: 'hotel.web.overview', label: 'Overview', icon: 'globe2', group: 'website' },
        { id: 'hotel.web.enquiries', label: 'Enquiries', icon: 'inbox', group: 'website' },
        { id: 'hotel.web.rooms', label: 'Rooms', icon: 'door-open', pageTitle: 'Website rooms', group: 'website' },
        { id: 'hotel.web.rates', label: 'Rates', icon: 'tag', group: 'website' },
        { id: 'hotel.web.calendar', label: 'Calendar', icon: 'calendar', pageTitle: 'Rates and rooms calendar', group: 'website' },
        { id: 'hotel.web.gallery', label: 'Gallery', icon: 'image', pageTitle: 'Website gallery', group: 'website' },
        { id: 'hotel.web.content', label: 'Content', icon: 'card-text', pageTitle: 'Website content', group: 'website' },
        { id: 'hotel.web.services', label: 'Services', icon: 'stars', pageTitle: 'Website services', group: 'website' },
        { id: 'hotel.web.policies', label: 'House rules', icon: 'journal-check', group: 'website' },
        { id: 'hotel.web.nearby', label: 'Nearby', icon: 'geo-alt', pageTitle: 'Nearby places', group: 'website' },
        { id: 'hotel.web.settings', label: 'Settings', icon: 'gear', pageTitle: 'Website settings', group: 'website' },
      ],
    },
  ],
};

/**
 * Drill-in views (a detail or a form, not in any menu) and the menu entry they belong to. The shell highlights that entry,
 * shows its title and its second panel, also when the view is opened straight from the search (no list opened before).
 */
export const drillParent: Record<string, string> = {
  'hotel.co.statement': 'hotel.co.ledger',
  'hotel.co.notification': 'hotel.co.notifications',
  'hotel.fo.reservation': 'hotel.fo.reservations',
  'hotel.fo.reservationForm': 'hotel.fo.reservations',
  'hotel.fo.stay': 'hotel.fo.inHouse',
  'hotel.web.enquiry': 'hotel.web.enquiries',
  'hotel.web.roomForm': 'hotel.web.rooms',
  'guest.bill': 'guest.bills',
  'corporate.bill': 'corporate.bills',
  'platform.hotel': 'platform.hotels',
  'platform.group': 'platform.groups',
  'platform.duplicates': 'platform.central',
  'group.hotel': 'group.hotels',
  'group.hotels.invite': 'group.hotels',
  // one Email entry per console (MJ, 5 Nov 2026): the old addresses of My mailbox and of the combined inbox open Email
  'hotel.conversation': 'hotel.email',
  'hotel.conversations': 'hotel.email',
  'hotel.emailThread': 'hotel.email',
  'hotel.whatsappThread': 'hotel.whatsapp',
  'platform.emailThread': 'platform.email',
  'platform.myMailbox': 'platform.email',
  'platform.myMailboxThread': 'platform.email',
  'hotel.myMailbox': 'hotel.email',
  'hotel.myMailboxThread': 'hotel.email',
  'group.emailThread': 'group.email',
  'group.myMailbox': 'group.email',
  'group.myMailboxThread': 'group.email',
  'platform.whatsappThread': 'platform.whatsapp',
  'platform.conversation': 'platform.email',
  'platform.conversations': 'platform.email',
};

/** Module groups: one folder per group in each app, one agent per group. */
export const moduleGroups = [
  'guest', 'corporate', 'overview', 'frontOffice', 'billing', 'cash',
  'companies', 'payrollCore', 'payrollPay', 'website', 'admin', 'platform', 'group', 'conversations',
] as const;
export type ModuleGroup = (typeof moduleGroups)[number];

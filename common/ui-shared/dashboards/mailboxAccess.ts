// Who has a personal mailbox (platform 0178, 0179; MJ, 3 Nov 2026: "all users", chosen as option B): every STAFF login. This is the ONE table, used by the server (the gate of every
// my-mailbox route, the delivery of received mail) and by the dashboards (the sidebar item). It looks at the ACCOUNT role only, never at a hotel permission role, so a custom role a hotel
// makes needs nothing. A guest and a company login have none. To change who has a mailbox, change this list and the tests that name it.
import type { Role } from '../auth/types';

export const MAILBOX_ROLES = ['super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user'] as const satisfies readonly Role[];
export type MailboxRole = (typeof MAILBOX_ROLES)[number];

/** Does this account role have a personal mailbox? */
export const hasMailbox = (role: string): role is MailboxRole => (MAILBOX_ROLES as readonly string[]).includes(role);

/** Staff who work from their own console (the platform's and the group's): their mailbox opens there, never inside a hotel they are only visiting. */
export const CONSOLE_MAILBOX_ROLES: readonly MailboxRole[] = ['super_admin', 'platform_admin', 'group_hotel_admin'];

export type EmailBox = 'shared' | 'mine';

/** Roles that never see a shared inbox (MJ, 5 Nov 2026: "superadmin will only have his email, no others"): only their own mailbox and the extra addresses given to them. */
export const OWN_MAILBOX_ONLY_ROLES: readonly MailboxRole[] = ['super_admin'];

/** The boxes of the ONE Email page of a console, in order. A hotel's inbox stays away from Platform Admin visits and follows the hotel's Email right (`hotelInboxRight`). */
export function emailBoxesOf(home: 'hotel' | 'platform' | 'group', role: string, hotelInboxRight: boolean): EmailBox[] {
  const shared = (OWN_MAILBOX_ONLY_ROLES as readonly string[]).includes(role) ? false : home === 'hotel' ? role !== 'platform_admin' && hotelInboxRight : true;
  const mine = hasMailbox(role) && !(home === 'hotel' && (CONSOLE_MAILBOX_ROLES as readonly string[]).includes(role));
  return [...(shared ? (['shared'] as const) : []), ...(mine ? (['mine'] as const) : [])];
}

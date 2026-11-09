// Notifications (MJ, 18 Oct 2026, docs/plans/NOTIFICATIONS-PLAN-2026-10-18.md): the hotel sends a short plain-text notice to one, a few or all of its companies; the
// company reads it in its portal (sidebar, bell, unread badge). Two sides over one table: the HOTEL side (Companies > Notifications: send, history, who read it, withdraw;
// `NotificationsApi`, paths under /companies/notifications) and the COMPANY PORTAL side (`PortalNotificationsApi`, paths under /corporate/notifications). Contract of
// docs/BACKEND.md "Notifications". `audience` is kept for the guest portal later; only companies exist today.
import type { createNotificationsMock, createPortalNotificationsMock } from './notifications.mock';
import type { PortalCursorQuery, PortalPartial } from './portalHotels';

export const NOTIFICATION_TITLE_MAX = 120;
export const NOTIFICATION_BODY_MAX = 2000;
/** Sends per hour per person (the 21st answers 429 with Retry-After). */
export const NOTIFICATION_SENDS_PER_HOUR = 20;
/** "Also email" refuses a send that would write more addresses than this (one hotel mail per address). */
export const NOTIFICATION_EMAIL_CAP = 500;

export type NotificationPriority = 'normal' | 'important';
export type NotificationAudienceKind = 'one' | 'selected' | 'all';
/** Computed: withdrawn, else expired (its last day is before today, IST), else active. */
export type NotificationStatus = 'active' | 'withdrawn' | 'expired';
/** What "also email" did for one company: a mail was queued, the company had no usable address (or unsubscribed), or the tick was off. */
export type NotificationEmailStatus = 'none' | 'queued' | 'skipped';

/** The company pages a notice may point at (the portal's view ids). `corporate.bill` needs `linkId` (a bill of that one company); the others take none. */
export const NOTIFICATION_LINK_VIEWS = ['corporate.bills', 'corporate.bill', 'corporate.payments', 'corporate.ledger', 'corporate.profile'] as const;
export type NotificationLinkView = (typeof NOTIFICATION_LINK_VIEWS)[number];

/** A row of the hotel's history. */
export interface Notification {
  id: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  audienceKind: NotificationAudienceKind;
  /** "All companies (14)", "Tata Consultancy Services", "3 companies". */
  audienceLabel: string;
  targetCount: number;
  /** In-app delivery is immediate, so this equals targetCount; kept apart for the email counts below. */
  deliveredCount: number;
  readCount: number;
  /** YYYY-MM-DD (IST): the last day it shows. */
  expiresAt: string | null;
  withdrawnAt: string | null;
  alsoEmail: boolean;
  linkView: NotificationLinkView | null;
  linkId: string | null;
  createdAt: string;
  createdBy: string;
  status: NotificationStatus;
}

export interface NotificationTarget {
  companyId: string;
  companyName: string;
  readAt: string | null;
  /** null when "also email" was off. */
  emailStatus: NotificationEmailStatus | null;
}

/** One notification with the companies it went to and who has read it. */
export interface NotificationDetail extends Notification {
  targets: NotificationTarget[];
  emailQueued: number;
  emailSkipped: number;
}

export interface NotificationInput {
  /** Company ids from the picker, or 'all' for every live company. At least one. */
  companyIds: string[] | 'all';
  title: string;
  body: string;
  priority?: NotificationPriority;
  /** YYYY-MM-DD, today or later. */
  expiresAt?: string | null;
  alsoEmail?: boolean;
  linkView?: NotificationLinkView | null;
  linkId?: string | null;
}

export interface NotificationListQuery {
  search?: string;
  status?: NotificationStatus;
  page?: number;
  pageSize?: number;
}

export interface NotificationPage {
  items: Notification[];
  total: number;
  page: number;
  pageSize: number;
}

/** What the company portal shows. `hotelId`/`hotelName` say which hotel sent it (the portal may be linked to several). */
export interface PortalNotification {
  id: string;
  hotelId: string;
  hotelName: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  createdAt: string;
  readAt: string | null;
  linkView: NotificationLinkView | null;
  linkId: string | null;
}

export interface PortalNotificationQuery extends PortalCursorQuery {
  /** Only the ones not read yet. */
  unread?: boolean;
  /** Only the ones already read (the Earlier tab). */
  read?: boolean;
  /** Words in the title or the text (MJ, 26 Oct 2026). */
  search?: string;
  /** A hotel id or 'all' (the default). */
  hotel?: string;
  page?: number;
  pageSize?: number;
}

export interface PortalNotificationPage extends PortalPartial {
  items: PortalNotification[];
  total: number;
  page: number;
  pageSize: number;
  /** Unread over the hotels asked for (the badge), not just this page. */
  unread: number;
}

export type NotificationsApi = ReturnType<typeof createNotificationsMock>;
export type PortalNotificationsApi = ReturnType<typeof createPortalNotificationsMock>;

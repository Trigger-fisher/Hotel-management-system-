import "server-only";
import type { Addressee, CompaniesRepos } from "./companies";
import type { ListResult, Page } from "./types";

// Notifications (HMS, MJ 18 Oct 2026, docs/plans/NOTIFICATIONS-PLAN-2026-10-18.md): the hotel sends a short plain-text notice to one, a few or all of its companies;
// the company reads it in its portal. In the hotel's own database (notifications, notification_targets). Plain records, no SQL. Rules every implementation keeps:
// the targets are a SNAPSHOT taken at send time (one row per company, unique); a notification is never edited, only withdrawn (kept in the history); a company sees
// only its own targets, and not the withdrawn or expired ones; "read" keeps the FIRST time it was read (reading twice changes nothing). The status is computed:
// withdrawn, else expired (expires_at is before today in IST), else active. Spec: docs/BACKEND.md "Notifications".

export type NotificationPriority = "normal" | "important";
export type NotificationAudienceKind = "one" | "selected" | "all";
export type NotificationEmailStatus = "none" | "queued" | "skipped";
export type NotificationStatus = "active" | "withdrawn" | "expired";

export interface NotificationFields {
  audienceKind: NotificationAudienceKind;
  title: string;
  body: string;
  priority: NotificationPriority;
  /** A company page the notice points at (a view id and a record id), both or neither. */
  linkView: string | null;
  linkId: string | null;
  /** The last day it shows (YYYY-MM-DD, IST); null = never expires. */
  expiresAt: string | null;
  alsoEmail: boolean;
}

export interface NotificationRecord extends NotificationFields {
  id: string;
  targetCount: number;
  withdrawnAt: Date | null;
  withdrawnBy: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/** A history row: the record and how many of its companies have read it. */
export interface NotificationSummary extends NotificationRecord {
  readCount: number;
}

/** One company a notification went to. */
export interface NotificationTargetRecord {
  companyId: string;
  companyName: string;
  readAt: Date | null;
  emailStatus: NotificationEmailStatus;
}

/** What one company sees: the notification and that company's own read mark. */
export interface PortalNotificationRecord {
  id: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  linkView: string | null;
  linkId: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export interface NotificationRepo {
  /** Writes the notification (created at `at`) and one target per company (in chunks), the whole thing in the caller's transaction. */
  create(input: NotificationFields & { createdBy: string }, targets: readonly { companyId: string; emailStatus: NotificationEmailStatus }[], at: Date): Promise<NotificationRecord>;
  get(id: string): Promise<NotificationSummary | null>;
  /** The companies it went to, by company name, with their read marks. */
  targets(id: string): Promise<NotificationTargetRecord[]>;
  /** The history, newest first. Every word in the title or the text; `status` is the computed one; `today` is the IST date (YYYY-MM-DD). */
  list(query: { words?: readonly string[]; status?: NotificationStatus; today: string } & Page): Promise<ListResult<NotificationSummary>>;
  /** Marks it withdrawn at `at`. Null when it does not exist; an already withdrawn one is returned as it is. */
  withdraw(id: string, actorId: string, at: Date): Promise<NotificationRecord | null>;
  /** Which of these ids are live company profiles (not deleted). With no ids: every live company. */
  liveCompanyIds(ids?: readonly string[]): Promise<string[]>;
  /** Each company's usable addresses (its own and its contacts', lower case, once, opt-outs left out). A company with none is absent from the map. */
  emailsOf(companyIds: readonly string[]): Promise<Map<string, Addressee[]>>;

  /* ---- the company portal's side (always one company: the caller passes the account's own company id) ---- */
  /** Newest first; withdrawn and expired ones left out; `unread` only the ones not read yet. `through`: only the rows created at or before that moment (a cursor's start); `total` ignores it. */
  /** search: words in the title or the text (MJ, 26 Oct 2026: a search box on every list). */
  forCompany(companyId: string, query: { unread?: boolean; read?: boolean; today: string; through?: Date; search?: string } & Page): Promise<ListResult<PortalNotificationRecord>>;
  unreadCount(companyId: string, today: string): Promise<number>;
  /** Marks one read (the first read time stays). False when the company has no such live notification. */
  markRead(companyId: string, notificationId: string, at: Date, today: string): Promise<boolean>;
  /** Marks every unread live one read; returns how many it changed. */
  markAllRead(companyId: string, at: Date, today: string): Promise<number>;
}

/** What the staff service gets inside a unit: the companies' repositories (the picker, the profile e-mail addresses, settings, logs) and the notifications. */
export interface NotificationsRepos extends CompaniesRepos {
  notifications: NotificationRepo;
}

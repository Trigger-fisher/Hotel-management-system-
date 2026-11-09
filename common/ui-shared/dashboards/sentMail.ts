// The Email pages' "Sent through Amazon SES" list (MJ, 1 Nov 2026): Amazon SES only sends, so there is no inbox to read; instead the page lists every email the system sent through it. A hotel's
// Email page lists that hotel's mail (invoices, receipts, guest answers, its daily summary); the platform's Email page lists everything, with the hotel named. Only who, what kind, when and how it
// went: never the text of a mail, a code or a link.

export type SentMailStatus = 'sent' | 'pending' | 'failed';
export const SENT_MAIL_STATUSES = ['all', 'sent', 'pending', 'failed'] as const;
export type SentMailFilter = (typeof SENT_MAIL_STATUSES)[number];

export interface SentMailRow {
  id: string;
  /** The address it was sent to. */
  to: string;
  /** The kind of mail in plain words ("Bill invoice", "Password reset"). */
  label: string;
  /** The hotel it belongs to (shown on the platform's page); null = a platform mail. */
  hotel: string | null;
  /** When it was sent, or queued while it has not gone yet (ISO). */
  at: string;
  status: SentMailStatus;
  attempts: number;
  /** Why a failed mail failed, in the system's own sentence; null otherwise. */
  problem: string | null;
}

export interface SentMailPage {
  rows: SentMailRow[];
  total: number;
  page: number;
  size: number;
}

export interface SentMailQuery {
  search?: string;
  status?: SentMailFilter;
  page?: number;
  size?: 25 | 50 | 100;
}

/** The plain-words name of each kind of mail. */
export const SENT_MAIL_KINDS: Record<string, string> = {
  login_code: 'Sign-in code',
  reset_code: 'Password reset code',
  reset_link: 'Password reset',
  password_changed: 'Password changed notice',
  email_changed: 'Email changed notice',
  account_locked: 'Account locked notice',
  account_blocked: 'Account blocked notice',
  new_device: 'New device notice',
  temp_password: 'Temporary password',
  admin_reset: 'Password reset by an admin',
  invitation: 'Invitation',
  onboarding_waiting: 'Onboarding: waiting',
  onboarding_approved: 'Onboarding: approved',
  onboarding_rejected: 'Onboarding: declined',
  enquiry_confirmed: 'Enquiry confirmed',
  enquiry_declined: 'Enquiry declined',
  enquiry_new: 'New enquiry',
  daily_summary: 'Daily summary',
  campaign: 'Email campaign',
  notification: 'Notification',
  bill_invoice: 'Bill invoice',
  advance_receipt: 'Advance receipt',
};

export const sentMailCopy = {
  title: 'Sent through Amazon SES',
  hotelAbout: 'Amazon SES only sends mail, so there is no inbox to read here. This is every email sent for your hotel: who it went to, what it was and how it went.',
  platformAbout: 'Amazon SES only sends mail, so there is no inbox to read here. This is every email the system sent, for every hotel and for the platform.',
  searchPlaceholder: 'Search an address or a kind of mail',
  filters: { all: 'All', sent: 'Sent', pending: 'Waiting', failed: 'Failed' } as Record<SentMailFilter, string>,
  columns: { to: 'To', kind: 'What', hotel: 'Hotel', when: 'When', status: 'Status' },
  statuses: { sent: 'Sent', pending: 'Waiting to go', failed: 'Failed' } as Record<SentMailStatus, string>,
  platformMail: 'Platform',
  empty: 'No email has been sent yet.',
  noMatch: 'Nothing matches.',
  loadFailed: 'The list could not be loaded.',
  attempts: (n: number) => (n === 1 ? '1 try' : `${n} tries`),
} as const;

export const SENT_MAIL_PAGE_SIZE = 25;

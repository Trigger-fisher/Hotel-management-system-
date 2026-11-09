// Deliverability (Super Admin > Platform settings > Mail > "Bounces and holds"; platform migration 0130; MAIL-PROVIDERS-50K plan). The contract the screen, the HTTP adapter and
// the mock share. The mail services report bounces and complaints to the platform's webhooks; those addresses are kept off every later campaign (the suppression list), and a
// hotel whose bounce or complaint rate passes the limits has its campaign mail put on HOLD until the Super Admin releases it. System mail (codes, invoices) is never held.
import type { DashResult } from './common';

export type SuppressionReason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual';
export type HoldReason = 'bounces' | 'complaints' | 'manual';

export interface MailSuppression {
  id: string;
  email: string;
  /** null = every hotel */
  hotelId: string | null;
  hotelName: string | null;
  reason: SuppressionReason;
  source: 'ses' | 'brevo' | 'manual';
  detail: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface MailHold {
  hotelId: string;
  hotelName: string;
  /** true while held; false once released (kept so the Super Admin sees what happened) */
  held: boolean;
  reason: HoldReason;
  detail: string;
  heldAt: string;
  /** null = held automatically */
  heldByName: string | null;
  releasedAt: string | null;
  releasedByName: string | null;
  releaseReason: string | null;
}

export interface MailSafetyView {
  /** false while platform migration 0130 is not applied: nothing can be listed or changed yet. */
  ready: boolean;
  holds: MailHold[];
  suppressions: MailSuppression[];
  /** Pass back as `cursor` for the next page; null = no more. */
  nextCursor: string | null;
  /** The addresses to paste into Amazon SNS (for SES) and into Brevo's webhook settings; they carry a secret key, so they are shown to the Super Admin only. null = no public address configured. */
  webhooks: { ses: string; brevo: string } | null;
  /** After "Replace key": until when the OLD address still works (ISO), per provider; null = only the address above works. */
  previousKeyUntil: { ses: string | null; brevo: string | null };
  /** The Amazon SNS topic SES reports are taken from (pinned by the first signed report); null = none yet. Reports from any other topic are refused. */
  snsTopicArn: string | null;
  limits: { windowDays: number; minSent: number; bounceRatePct: number; complaintMinSent: number; complaintRatePct: number };
}

export interface MailSafetyApi {
  view(query?: { search?: string; cursor?: string }): Promise<DashResult<MailSafetyView>>;
  /** Suppresses an address by hand: for every hotel (hotelId null) or one. */
  suppress(input: { email: string; hotelId: string | null }): Promise<DashResult<{ suppressed: boolean }>>;
  unsuppress(id: string): Promise<DashResult<{ removed: boolean }>>;
  /** Holds a hotel's campaign mail by hand, with a reason. */
  hold(hotelId: string, reason: string): Promise<DashResult<{ held: boolean }>>;
  /** Releases a held hotel, with a reason. Its rates are counted again from the next day. */
  release(hotelId: string, reason: string): Promise<DashResult<{ released: boolean }>>;
  /** POST /platform/mail-safety/webhooks/{provider}/rotate: a new secret key for ONE provider's address; the old address keeps working until `previousUntil` (one day). */
  rotateKey(provider: 'ses' | 'brevo'): Promise<DashResult<{ provider: 'ses' | 'brevo'; previousUntil: string }>>;
}

export const MAIL_SAFETY_LIMITS = { reasonMin: 3, reasonMax: 300, pageSize: 50 } as const;

export const mailSafetyCopy = {
  title: 'Bounces and holds',
  intro: 'Mail services tell EasyHotelSolutions when a mail bounced or was marked as spam. Those addresses get no more campaign mail, and a hotel whose rates pass the limits has its campaign mail held until you release it. Sign-in codes, invoices and other system mail always go.',
  notReady: 'Run the platform database update 0130 first (Neon SQL file NEON-SQL-0130). Until then bounces are not recorded and no hotel is held.',
  limits: (l: MailSafetyView['limits']) => `Over the last ${l.windowDays} days, a hotel is held when bounces pass ${l.bounceRatePct}% of at least ${l.minSent} mails, or complaints pass ${l.complaintRatePct}% of at least ${l.complaintMinSent} mails.`,
  webhooksTitle: 'Where the mail services send their reports',
  webhookSes: 'Amazon SES: create an SNS topic, subscribe this address (HTTPS), and choose the topic for Bounce and Complaint notifications of your SES identity. The subscription is confirmed automatically.',
  webhookBrevo: 'Brevo: Transactional > Settings > Webhooks > Add a webhook with this address; tick Hard bounce, Soft bounce, Spam, Blocked, Invalid email and Unsubscribed.',
  webhookSecret: 'These addresses carry a secret key. Do not share them anywhere else.',
  noWebhooks: 'Set HMS_PUBLIC_URL on the server to see the webhook addresses.',
  rotate: 'Replace key',
  rotateAsk: (service: string) => `Make a new address for ${service}? Paste the new address into ${service} today: the old one stops working after one day.`,
  rotated: (until: string) => `New address made. The old one works until ${until}.`,
  previousUntil: (until: string) => `The previous address still works until ${until}.`,
  snsTopic: (arn: string) => `Reports are taken only from the SNS topic ${arn}.`,
  snsTopicNone: 'The first signed report from Amazon SNS sets the topic; reports from any other topic are refused after that.',
  holdsTitle: 'Hotels on hold',
  noHolds: 'No hotel is held.',
  held: 'Held',
  released: 'Released',
  automatic: 'Automatically',
  releaseAsk: 'Why release this hotel?',
  holdAsk: 'Why hold this hotel\'s campaign mail?',
  suppressionsTitle: 'Suppressed addresses',
  noSuppressions: 'No address is suppressed.',
  everyHotel: 'Every hotel',
  addTitle: 'Suppress an address',
  addHint: 'Leave the hotel empty to keep the address off every hotel\'s campaigns.',
  reason: { bounce: 'Bounced', complaint: 'Marked as spam', unsubscribe: 'Unsubscribed', manual: 'Added by hand' } as Record<SuppressionReason, string>,
  holdReason: { bounces: 'Too many bounces', complaints: 'Too many complaints', manual: 'Held by hand' } as Record<HoldReason, string>,
  source: { ses: 'Amazon SES', brevo: 'Brevo', manual: 'Super Admin' } as Record<MailSuppression['source'], string>,
};

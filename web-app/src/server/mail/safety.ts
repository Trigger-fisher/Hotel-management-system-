import "server-only";
// When a hotel's campaign mail is put on HOLD (platform migration 0130, MAIL-PROVIDERS-50K plan). The mail services judge a sender by its bounce and complaint rates (Amazon SES
// reviews an account at a 5% bounce rate or a 0.1% complaint rate and may stop it at 10% or 0.5%), and one hotel mailing a bad list could get the whole platform's sending stopped.
// So the rates of each hotel are counted from what the services report (webhooks, services/platform/mailEvents.ts) against what it sent, and a hotel past a limit is held: its
// campaign mail stops (system mail, codes and invoices, still goes) until the Super Admin releases it. Pure rules, no database.

export const HOLD_LIMITS = {
  /** The rates are counted over the last this many days (today included). */
  windowDays: 7,
  /** Fewer mails than this in the window: too few to judge bounces, never held for them. */
  minSent: 200,
  /** Bounces / sent above this holds the hotel. */
  bounceRate: 0.05,
  /** Fewer mails than this in the window: too few to judge complaints (one complaint in 200 mails is not a pattern). */
  complaintMinSent: 1000,
  /** Complaints / sent above this holds the hotel. */
  complaintRate: 0.001,
} as const;

export interface MailRates {
  sent: number;
  bounced: number;
  complained: number;
}

const pct = (n: number): string => `${(Math.round(n * 1000) / 10).toString()}%`;

/** Held or not, and why in words ("bounces 7.5% of 400 mails"); null = within the limits (or too few mails to judge). */
export function holdVerdict(r: MailRates): { reason: "bounces" | "complaints"; detail: string } | null {
  if (r.sent < HOLD_LIMITS.minSent) return null;
  const bounce = r.bounced / r.sent;
  const complaint = r.complained / r.sent;
  if (r.sent >= HOLD_LIMITS.complaintMinSent && complaint > HOLD_LIMITS.complaintRate) return { reason: "complaints", detail: `complaints ${pct(complaint)} of ${r.sent} mails in ${HOLD_LIMITS.windowDays} days (limit ${pct(HOLD_LIMITS.complaintRate)})` };
  if (bounce > HOLD_LIMITS.bounceRate) return { reason: "bounces", detail: `bounces ${pct(bounce)} of ${r.sent} mails in ${HOLD_LIMITS.windowDays} days (limit ${pct(HOLD_LIMITS.bounceRate)})` };
  return null;
}

const DAY_MS = 86_400_000;
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The first UTC day the rates are counted from: the window's first day, or, after the Super Admin released a hold, the day AFTER the release when that is later (the day's
 * counts cannot be split, so the release day is left out rather than holding the hotel again at once).
 */
export function rateWindowStart(now: Date, countedFrom: Date | null): string {
  const windowStart = dayOf(new Date(now.getTime() - (HOLD_LIMITS.windowDays - 1) * DAY_MS));
  if (!countedFrom) return windowStart;
  const afterRelease = dayOf(new Date(countedFrom.getTime() + DAY_MS));
  return afterRelease > windowStart ? afterRelease : windowStart;
}

/** Our Message-ID for an outbox row: the mail services report it back with a bounce or complaint, so the event finds its hotel. */
export const messageIdOf = (outboxId: string): string => `<hms.${outboxId}@mail.hms>`;

/** The outbox row a Message-ID (ours, from messageIdOf) names; null for any other. */
export function outboxIdOfMessageId(messageId: string | null | undefined): string | null {
  const m = /<?hms\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@mail\.hms>?/i.exec(messageId ?? "");
  return m ? m[1].toLowerCase() : null;
}

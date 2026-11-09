import "server-only";
// Which mail server sends which kind of mail (MJ's rule, 17 Oct 2026, docs/plans/MAIL-ROUTING-PLAN-2026-10-17.md): mail the SYSTEM sends (sign-in codes, resets, invitations,
// onboarding) goes from the PLATFORM email (Platform settings > Mail); invoices and every mail that carries a hotel's data go from THAT HOTEL's own email (Settings > Email).
// This one table is the rule: the outbox refuses a hotel kind without a hotel and a platform kind with one, and a test fails when a kind has no entry here.

export const MAIL_ROUTE = {
  login_code: "platform",
  reset_code: "platform",
  reset_link: "platform",
  password_changed: "platform",
  email_changed: "platform",
  account_locked: "platform",
  account_blocked: "platform",
  new_device: "platform",
  temp_password: "platform",
  admin_reset: "platform",
  invitation: "platform",
  onboarding_waiting: "platform",
  onboarding_approved: "platform",
  onboarding_rejected: "platform",
  enquiry_confirmed: "hotel",
  enquiry_declined: "hotel",
  enquiry_new: "hotel",
  daily_summary: "hotel",
  campaign: "hotel",
  notification: "hotel",
  bill_invoice: "hotel",
  advance_receipt: "hotel",
} as const satisfies Record<string, "platform" | "hotel">;

export type MailKind = keyof typeof MAIL_ROUTE;
export const MAIL_KINDS = Object.keys(MAIL_ROUTE) as MailKind[];

// The LANE of each kind (MAIL-PROVIDERS-50K plan, 18 Oct 2026). The worker always serves the "system" lane first (codes, resets, security notices, invitations, invoices, receipts,
// enquiry answers, the daily summary): a campaign of 50,000 mails sits in the "bulk" lane and can never delay a sign-in code. `satisfies Record<MailKind, MailLane>` makes a new kind without
// a lane a compile error; a test also fails. The SQL indexes of migration 0126 name the bulk kind literally (`kind = 'campaign'`), so a second bulk kind needs a new migration.
export type MailLane = "system" | "bulk";
export const MAIL_LANE = {
  login_code: "system",
  reset_code: "system",
  reset_link: "system",
  password_changed: "system",
  email_changed: "system",
  account_locked: "system",
  account_blocked: "system",
  new_device: "system",
  temp_password: "system",
  admin_reset: "system",
  invitation: "system",
  onboarding_waiting: "system",
  onboarding_approved: "system",
  onboarding_rejected: "system",
  enquiry_confirmed: "system",
  enquiry_declined: "system",
  enquiry_new: "system",
  daily_summary: "system",
  campaign: "bulk",
  notification: "system",
  bill_invoice: "system",
  advance_receipt: "system",
} as const satisfies Record<MailKind, MailLane>;
export const BULK_KINDS = MAIL_KINDS.filter((k) => MAIL_LANE[k] === "bulk");
export const laneOf = (kind: string): MailLane => (MAIL_LANE as Record<string, MailLane | undefined>)[kind] ?? "system";

/** A programming mistake, never a user's: a hotel kind queued without its hotel, or a platform kind with one. Thrown before anything is written. */
export class MailRouteError extends Error {
  constructor(kind: string, problem: "hotel_required" | "hotel_forbidden" | "unknown_kind") {
    super(problem === "unknown_kind" ? `Mail kind "${kind}" has no route (add it to MAIL_ROUTE)` : problem === "hotel_required" ? `Mail kind "${kind}" carries a hotel's data and must name its hotel` : `Mail kind "${kind}" is system mail and must not name a hotel`);
    this.name = "MailRouteError";
  }
}

export function assertMailRoute(kind: string, hotelId: string | null | undefined): void {
  const route = (MAIL_ROUTE as Record<string, "platform" | "hotel" | undefined>)[kind];
  if (!route) throw new MailRouteError(kind, "unknown_kind");
  if (route === "hotel" && !hotelId) throw new MailRouteError(kind, "hotel_required");
  if (route === "platform" && hotelId) throw new MailRouteError(kind, "hotel_forbidden");
}
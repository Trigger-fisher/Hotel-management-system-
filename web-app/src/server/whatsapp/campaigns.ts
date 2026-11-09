import "server-only";
import { AppError } from "../errors";
import type { SendResult } from "./send";

// WhatsApp campaigns (phase 6): one APPROVED message sent to the guests who agreed, a few at a time, through the same sender as every other message (so its checks, the daily limit and STOP all apply).
// This file is the rules and the runner; the hotel's tables are in hotel 0058, the list of running campaigns in platform 0185.
export type CampaignStatus = "draft" | "running" | "paused" | "done" | "cancelled";
export type RecipientState = "queued" | "sent" | "failed" | "skipped";

export interface CampaignAudience {
  /** Only guests who stayed within this many days; absent = every guest who agreed. */
  stayedWithinDays?: number;
}

export interface CampaignRecord {
  id: string;
  name: string;
  templateId: string;
  audience: CampaignAudience;
  variables: string[];
  status: CampaignStatus;
  statusReason: string | null;
  recipientCount: number;
  sent: number;
  failed: number;
  skipped: number;
  createdBy: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface CampaignRecipient {
  id: string;
  phoneDigits: string;
  guestName: string | null;
}

/** The numbers sent per sweep per campaign: a campaign is spread over many minutes, never a burst. */
export const BATCH_SIZE = 20;
export const CAMPAIGN_NAME_MAX = 120;
export const MAX_AUDIENCE_DAYS = 3650;

/** Checks a campaign's fields; throws a plain sentence on the first problem. */
export function checkCampaign(input: { name: string; audience: CampaignAudience; variables: readonly string[] }): { name: string; audience: CampaignAudience; variables: string[] } {
  const name = input.name.trim();
  if (name.length < 1 || name.length > CAMPAIGN_NAME_MAX) throw new AppError("VALIDATION_FAILED", "Give the campaign a short name.", { fields: { name: "Give the campaign a short name." } });
  const days = input.audience.stayedWithinDays;
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > MAX_AUDIENCE_DAYS)) throw new AppError("VALIDATION_FAILED", "Choose a number of days between 1 and 3650.", { fields: { audience: "Choose a number of days between 1 and 3650." } });
  const variables = input.variables.map((v) => v.trim());
  if (variables.some((v) => v.length > 60)) throw new AppError("VALIDATION_FAILED", "A value is longer than 60 characters.", { fields: { variables: "A value is longer than 60 characters." } });
  return { name, audience: days === undefined ? {} : { stayedWithinDays: days }, variables };
}

/** The values of a template's blanks for one guest: `{guest_name}` becomes the guest's name (their first word, or "there" when unknown). */
export function valuesFor(variables: readonly string[], guestName: string | null): string[] {
  const first = (guestName ?? "").trim().split(/\s+/)[0] || "there";
  return variables.map((v) => v.replace(/\{guest_name\}/g, first));
}

/** What to do with the campaign after one send: keep going, wait (try again later), stop everything for now, or note the guest and go on. */
export type Verdict = { kind: "sent" } | { kind: "skip"; reason: string } | { kind: "wait"; reason: string; minutes: number } | { kind: "pause"; reason: string };

/** How a sender result changes the campaign. A refusal about THIS guest (opted out, no agreement, not a number) skips the guest; one about the hotel or the day stops or waits. */
export function verdictOf(r: SendResult): Verdict {
  if (r.status === "sent" || r.status === "duplicate") return { kind: "sent" };
  switch (r.code) {
    case "daily_cap_reached":
      return { kind: "wait", reason: r.code, minutes: 12 * 60 };
    case "kill_switch_off":
    case "hotel_paused":
    case "line_not_active":
    case "no_line":
      return { kind: "wait", reason: r.code, minutes: 15 };
    case "marketing_not_allowed":
    case "template_not_approved":
    case "line_token_unreadable":
    case "token_invalid":
      return { kind: "pause", reason: r.code };
    default:
      // retryable faults wait a little; everything else is about this guest
      return r.status === "retry" ? { kind: "wait", reason: r.code, minutes: 5 } : r.status === "unknown" ? { kind: "skip", reason: "unknown_outcome" } : { kind: "skip", reason: r.code || "failed" };
  }
}

export const PAUSE_TEXT: Readonly<Record<string, string>> = {
  marketing_not_allowed: "Marketing messages are not allowed on this number, so the campaign is paused.",
  template_not_approved: "The campaign's message is not approved (any more), so the campaign is paused.",
  line_token_unreadable: "The WhatsApp connection needs the platform team's attention, so the campaign is paused.",
  token_invalid: "The WhatsApp connection is no longer valid, so the campaign is paused.",
};

import "server-only";
import type { Unit } from "../../repos/types";
import type { CampaignRunRecord } from "../../repos/auth";
import type { CompaniesRepos } from "../../repos/companies";
import type { MailPayload } from "../auth/mail";
import { campaignPayload, templateOf, type MarketingPorts } from "./marketingService";

// The campaign feeder (hotel migration 0044, platform 0130; MAIL-PROVIDERS-50K plan). The mail worker calls it before its passes (compose/mail.ts drain): for each campaign in the
// platform's running list it moves the next recipients into the outbox, so a 50,000-address campaign never sits in the queue at once:
//  - at most FEED_AHEAD campaign mails of a hotel wait in the queue (the worker sends them at the mail service's pace, then the feeder adds more);
//  - never more than the hotel may still send today (its mail service's daily limit, its own limit and the Super Admin's cap, less what it sent today and what waits);
//  - a hotel whose campaign mail the platform holds gets nothing; a paused campaign gets nothing;
//  - an address that unsubscribed or was suppressed since the campaign began is skipped (counted as left out);
//  - when every recipient was queued and none of its mails waits any more, the campaign is 'sent' and leaves the list; a campaign that is cancelled, gone, or still a draft (its
//    send failed after it was listed) leaves the list too.
// A recipient is marked queued in the hotel's transaction BEFORE its mail is put in the outbox, so a failure between the two loses that mail rather than sending it twice.

/** Campaign mails of one hotel that may wait in the queue at once. */
export const FEED_AHEAD = 200;
const SYSTEM_USER = "00000000-0000-4000-8000-0000000000e1";

export interface FeedPorts extends Pick<MarketingPorts, "publicUrl" | "secret" | "suppressedAmong"> {
  runs(): Promise<CampaignRunRecord[]>;
  setRunState(hotelId: string, campaignId: string, state: "sending" | "paused"): Promise<void>;
  endRun(hotelId: string, campaignId: string): Promise<void>;
  /** Hotels whose campaign mail the platform holds. */
  held(hotelIds: readonly string[]): Promise<Set<string>>;
  /** Campaign mails waiting in the queue (pending or sending), by hotel. */
  waiting(hotelIds: readonly string[]): Promise<Map<string, number>>;
  /** How many more mails the hotel may send today (Infinity = no daily limit); what waits in the queue is NOT yet taken off. */
  allowance(hotelId: string): Promise<number>;
  /** Mails of this campaign still waiting in the queue. */
  pending(hotelId: string, template: string): Promise<number>;
  /** The campaign's mails into the outbox (kind 'campaign', the hotel's mail server). */
  enqueue(hotelId: string, rows: readonly { to: string; template: string; payload: MailPayload }[]): Promise<void>;
  /** The hotel's companies unit (the campaign and its recipients live in the hotel's schema). */
  hotel: Unit<CompaniesRepos>;
}

export interface FeedResult {
  /** Mails moved into the outbox. */
  fed: number;
  /** Campaigns that finished (sent) in this round. */
  finished: number;
  /** Recipients skipped (unsubscribed or suppressed meanwhile). */
  skipped: number;
}

type Step = { end: boolean; finished?: boolean; paused?: boolean; mails?: { to: string; template: string; payload: MailPayload }[]; skipped?: number };

/** One round over the running campaigns. A campaign that fails is left for the next round; it never stops the others. */
export async function feedCampaigns(ports: FeedPorts, now: () => Date): Promise<FeedResult> {
  const out: FeedResult = { fed: 0, finished: 0, skipped: 0 };
  const runs = (await ports.runs()).filter((r) => r.state === "sending");
  if (runs.length === 0) return out;
  const hotels = [...new Set(runs.map((r) => r.hotelId))];
  const held = await ports.held(hotels);
  const waiting = await ports.waiting(hotels);
  for (const run of runs) {
    if (held.has(run.hotelId)) continue;
    try {
      const inQueue = waiting.get(run.hotelId) ?? 0;
      const take = Math.max(0, Math.min(FEED_AHEAD - inQueue, (await ports.allowance(run.hotelId)) - inQueue));
      const template = templateOf(run.campaignId);
      const step: Step = await ports.hotel.run({ hotelId: run.hotelId, userId: SYSTEM_USER, visit: undefined }, async (repos) => {
        const c = await repos.marketing.get(run.campaignId, { forUpdate: true });
        if (!c || c.status === "draft" || c.status === "sent" || c.status === "cancelled") return { end: true };
        if (c.status === "paused") return { end: false, paused: true };
        const next = take > 0 ? await repos.marketing.nextRecipients(c.id, Math.floor(take)) : [];
        if (next.length === 0) {
          const anyLeft = (await repos.marketing.nextRecipients(c.id, 1)).length > 0;
          if (!anyLeft && (await ports.pending(run.hotelId, template)) === 0) {
            await repos.marketing.setStatus(c.id, "sent", now(), null);
            return { end: true, finished: true };
          }
          return { end: false };
        }
        const emails = next.map((r) => r.email.toLowerCase());
        const optedOut = await repos.marketing.optedOutAmong(emails);
        const suppressed = await ports.suppressedAmong(run.hotelId, emails);
        const skipOut = next.filter((r) => optedOut.has(r.email.toLowerCase()));
        const skipSup = next.filter((r) => !optedOut.has(r.email.toLowerCase()) && suppressed.has(r.email.toLowerCase()));
        const send = next.filter((r) => !optedOut.has(r.email.toLowerCase()) && !suppressed.has(r.email.toLowerCase()));
        await repos.marketing.markSkipped(c.id, skipOut.map((r) => r.id), "opted_out");
        await repos.marketing.markSkipped(c.id, skipSup.map((r) => r.id), "suppressed");
        await repos.marketing.markQueued(c.id, send.map((r) => r.id), now());
        const hotelName = (await repos.hotelProfile.header()).name;
        return { end: false, skipped: skipOut.length + skipSup.length, mails: send.map((r) => ({ to: r.email, template, payload: campaignPayload(ports, run.hotelId, hotelName, c, r) })) };
      });
      if (step.mails && step.mails.length > 0) {
        await ports.enqueue(run.hotelId, step.mails);
        out.fed += step.mails.length;
        waiting.set(run.hotelId, inQueue + step.mails.length);
      }
      out.skipped += step.skipped ?? 0;
      if (step.finished) out.finished += 1;
      if (step.end) await ports.endRun(run.hotelId, run.campaignId);
      else if (step.paused) await ports.setRunState(run.hotelId, run.campaignId, "paused");
    } catch {
      // this campaign waits for the next round; the others go on
    }
  }
  return out;
}

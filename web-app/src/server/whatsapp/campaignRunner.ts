import "server-only";
import type { Unit } from "../repos/types";
import { BATCH_SIZE, PAUSE_TEXT, valuesFor, verdictOf, type CampaignRecord } from "./campaigns";
import type { CampaignStore } from "./campaignStore";
import type { SendRequest, SendResult } from "./send";

// The campaign runner (phase 6): each call takes the next few guests of ONE running campaign and sends the approved message to them through the sender, so the sender's checks (STOP, consent, the daily
// limit, the hotel's pause, the switches) decide each guest. The sender is never called inside a database transaction: the guests are read, then sent to one by one, and each result is written on its own.
// A guest's row id is the message id, so a call repeated after a crash never sends a second time. The sweep (below) finds the running campaigns through the short platform list.
export interface CampaignRepos {
  campaigns: CampaignStore;
}

export interface CampaignRunnerDeps {
  unit: Unit<CampaignRepos>;
  sender: { send(request: SendRequest): Promise<SendResult> };
  now?: () => Date;
}

export type StepOutcome =
  | { kind: "gone" }
  | { kind: "inactive" }
  | { kind: "done"; sent: number }
  | { kind: "more"; sent: number }
  | { kind: "wait"; sent: number; minutes: number; reason: string }
  | { kind: "paused"; sent: number; reason: string };

/** The session the runner works in for one hotel (no person). */
export const runnerSession = (hotelId: string) => ({ hotelId, userId: "campaign-runner", visit: undefined, scope: undefined });

export async function stepCampaign(deps: CampaignRunnerDeps, hotelId: string, campaignId: string): Promise<StepOutcome> {
  const clock = deps.now ?? (() => new Date());
  const session = runnerSession(hotelId);

  const start = await deps.unit.run(session, async ({ campaigns }) => {
    const c = await campaigns.get(campaignId);
    if (!c) return { kind: "gone" } as const;
    if (c.status !== "running") return { kind: "inactive" } as const;
    const template = await campaigns.template(c.templateId);
    if (!template || template.status !== "approved") {
      await campaigns.setStatus(c.id, ["running"], "paused", PAUSE_TEXT.template_not_approved, clock());
      return { kind: "paused", sent: 0, reason: "template_not_approved" } as const;
    }
    const batch = await campaigns.batch(c.id, BATCH_SIZE);
    if (batch.length === 0) {
      await campaigns.setStatus(c.id, ["running"], "done", null, clock());
      return { kind: "done", sent: 0 } as const;
    }
    return { kind: "go", c, template, batch } as const;
  });
  if (start.kind !== "go") return start;

  const { c, template, batch } = start as { c: CampaignRecord; template: NonNullable<Awaited<ReturnType<CampaignStore["template"]>>>; batch: Awaited<ReturnType<CampaignStore["batch"]>> };
  let sent = 0;
  for (const r of batch) {
    let result: SendResult;
    try {
      result = await deps.sender.send({ id: r.id, scope: { kind: "hotel", hotelId }, to: r.phoneDigits, content: { kind: "template", name: template.name, language: template.language, variables: valuesFor(c.variables, r.guestName) }, by: { id: c.createdBy }, origin: "automatic" });
    } catch {
      // the sender never throws on purpose; if it does, the guest stays queued and the campaign waits a little
      return { kind: "wait", sent, minutes: 5, reason: "sender_error" };
    }
    const verdict = verdictOf(result);
    if (verdict.kind === "sent") {
      await deps.unit.run(session, ({ campaigns }) => campaigns.mark(c.id, r.id, "sent", null, clock()));
      sent += 1;
    } else if (verdict.kind === "skip") {
      await deps.unit.run(session, ({ campaigns }) => campaigns.mark(c.id, r.id, result.status === "failed" ? "failed" : "skipped", verdict.reason, clock()));
    } else if (verdict.kind === "wait") {
      return { kind: "wait", sent, minutes: verdict.minutes, reason: verdict.reason };
    } else {
      await deps.unit.run(session, ({ campaigns }) => campaigns.setStatus(c.id, ["running"], "paused", PAUSE_TEXT[verdict.reason] ?? "The campaign is paused.", clock()));
      return { kind: "paused", sent, reason: verdict.reason };
    }
  }
  const left = await deps.unit.run(session, async ({ campaigns }) => {
    const n = await campaigns.queued(c.id);
    if (n === 0) await campaigns.setStatus(c.id, ["running"], "done", null, clock());
    return n;
  });
  return left === 0 ? { kind: "done", sent } : { kind: "more", sent };
}

/** The short list of running campaigns the sweep works from (platform 0185). */
export interface CampaignRunsStore {
  due(now: Date, limit: number): Promise<{ hotelId: string; campaignId: string }[]>;
  schedule(hotelId: string, campaignId: string, at: Date): Promise<void>;
  remove(hotelId: string, campaignId: string): Promise<void>;
}

export function createMemoryCampaignRuns(): CampaignRunsStore & { rows: { hotelId: string; campaignId: string; at: Date }[] } {
  const rows: { hotelId: string; campaignId: string; at: Date }[] = [];
  return {
    rows,
    async due(now, limit) {
      return rows.filter((r) => r.at.getTime() <= now.getTime()).slice(0, limit).map(({ hotelId, campaignId }) => ({ hotelId, campaignId }));
    },
    async schedule(hotelId, campaignId, at) {
      const r = rows.find((x) => x.hotelId === hotelId && x.campaignId === campaignId);
      if (r) r.at = at;
      else rows.push({ hotelId, campaignId, at });
    },
    async remove(hotelId, campaignId) {
      const i = rows.findIndex((x) => x.hotelId === hotelId && x.campaignId === campaignId);
      if (i >= 0) rows.splice(i, 1);
    },
  };
}

export interface SweepCampaignsResult {
  campaigns: number;
  sent: number;
}

/** One sweep's turn: every running campaign that is due takes its next few guests. A campaign that failed to run never stops the others. */
export async function sweepCampaigns(deps: CampaignRunnerDeps & { runs: CampaignRunsStore }, limit = 20): Promise<SweepCampaignsResult> {
  const clock = deps.now ?? (() => new Date());
  const due = await deps.runs.due(clock(), limit);
  let sent = 0;
  for (const d of due) {
    try {
      const out = await stepCampaign(deps, d.hotelId, d.campaignId);
      if ("sent" in out) sent += out.sent;
      if (out.kind === "more") await deps.runs.schedule(d.hotelId, d.campaignId, new Date(clock().getTime() + 60_000));
      else if (out.kind === "wait") await deps.runs.schedule(d.hotelId, d.campaignId, new Date(clock().getTime() + out.minutes * 60_000));
      else await deps.runs.remove(d.hotelId, d.campaignId);
    } catch {
      // try again in five minutes; the others go on
      await deps.runs.schedule(d.hotelId, d.campaignId, new Date(clock().getTime() + 5 * 60_000)).catch(() => undefined);
    }
  }
  return { campaigns: due.length, sent };
}

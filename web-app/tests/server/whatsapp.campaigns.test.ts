// WhatsApp campaigns (4 Nov 2026): the checks, the audience, a campaign sent through the sender a few guests at a time, the waits and pauses, the sweep. Memory stores and a scripted sender.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.campaigns.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { AppError } from "@/server/errors";
import { BATCH_SIZE, checkCampaign, valuesFor, verdictOf } from "@/server/whatsapp/campaigns";
import { createMemoryCampaignRuns, stepCampaign, sweepCampaigns } from "@/server/whatsapp/campaignRunner";
import { createMemoryCampaignStore, type CampaignTemplate } from "@/server/whatsapp/campaignStore";
import type { SendRequest, SendResult } from "@/server/whatsapp/send";

const HOTEL = "00000000-0000-4000-8000-0000000000b1";
const T0 = new Date("2026-11-04T10:00:00Z");
const TEMPLATE: CampaignTemplate = { id: "tpl1", name: "diwali_offer", language: "en", status: "approved", category: "marketing", blanks: 1 };
const sent = (r: Partial<SendResult> = {}): SendResult => ({ ok: true, status: "sent", code: "", message: "Sent.", ...r });
const refused = (code: string): SendResult => ({ ok: false, status: "refused", code, message: "x" });

type Guest = NonNullable<Parameters<typeof createMemoryCampaignStore>[0]>[number];
const guests = (n: number): Guest[] => Array.from({ length: n }, (_, i) => ({ name: `Guest ${i + 1}`, digits: `9198000000${String(i).padStart(2, "0")}`, agreed: true, lastStayDaysAgo: 10 + i }));
const build = (g: Guest[] = guests(3), template = TEMPLATE) => {
  const store = createMemoryCampaignStore(g, [template], () => T0);
  const calls: SendRequest[] = [];
  let script: (req: SendRequest) => SendResult = () => sent();
  const unit = { run: async (_s: unknown, work: (r: { campaigns: typeof store }) => Promise<unknown>) => work({ campaigns: store }) } as never;
  const sender = { send: async (req: SendRequest) => (calls.push(req), script(req)) };
  const start = async (variables = ["{guest_name}"]) => {
    const c = await store.create({ name: "Diwali", templateId: "tpl1", audience: {}, variables }, "u1");
    await store.enroll(c.id, {});
    await store.setStatus(c.id, ["draft"], "running", null, T0);
    return c;
  };
  return { store, calls, sender, unit, start, setScript: (f: (req: SendRequest) => SendResult) => void (script = f), deps: { unit, sender, now: () => T0 } };
};

describe("campaign rules", () => {
  test("a campaign's fields are checked; a guest's name fills the blank; each sender answer has a verdict", () => {
    const bad = (input: Parameters<typeof checkCampaign>[0]) => assert.throws(() => checkCampaign(input), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_FAILED");
    bad({ name: " ", audience: {}, variables: [] });
    bad({ name: "x", audience: { stayedWithinDays: 0 }, variables: [] });
    bad({ name: "x", audience: {}, variables: ["y".repeat(61)] });
    assert.deepEqual(checkCampaign({ name: " Diwali ", audience: { stayedWithinDays: 90 }, variables: [" a "] }), { name: "Diwali", audience: { stayedWithinDays: 90 }, variables: ["a"] });
    assert.deepEqual(valuesFor(["Hello {guest_name}", "10%"], "Asha Patel"), ["Hello Asha", "10%"]);
    assert.deepEqual(valuesFor(["{guest_name}"], null), ["there"]);
    assert.equal(verdictOf(sent()).kind, "sent");
    assert.equal(verdictOf(refused("opted_out")).kind, "skip");
    assert.deepEqual(verdictOf(refused("daily_cap_reached")), { kind: "wait", reason: "daily_cap_reached", minutes: 720 });
    assert.equal(verdictOf(refused("marketing_not_allowed")).kind, "pause");
    assert.equal(verdictOf({ ok: false, status: "retry", code: "rate_limited", message: "x" }).kind, "wait");
  });

  test("the audience is who agreed and is not opted out, narrowed by recent stays; enrolling fixes it", async () => {
    const g = [...guests(3), { name: "No", digits: "919800000099", agreed: false }, { name: "Stop", digits: "919800000098", agreed: true, optedOut: true }, { name: "Old", digits: "919800000097", agreed: true, lastStayDaysAgo: 400 }];
    const { store } = build(g);
    assert.equal(await store.audienceSize({}), 4);
    assert.equal(await store.audienceSize({ stayedWithinDays: 30 }), 3);
  });
});

describe("running a campaign", () => {
  test("every guest is sent the approved message with their own values; the id of a send is the guest's row id; the campaign ends done", async () => {
    const t = build();
    const c = await t.start();
    const out = await stepCampaign(t.deps, HOTEL, c.id);
    assert.deepEqual(out, { kind: "done", sent: 3 });
    assert.deepEqual(t.calls.map((x) => (x.content.kind === "template" ? x.content.variables : [])), [["Guest"], ["Guest"], ["Guest"]]);
    assert.deepEqual(t.calls.map((x) => x.id), t.store.recipients.map((r) => r.id));
    assert.ok(t.calls.every((x) => x.origin === "automatic" && x.scope.kind === "hotel" && x.by.id === "u1"));
    const after = await t.store.get(c.id);
    assert.deepEqual([after?.status, after?.sent, after?.recipientCount], ["done", 3, 3]);
    assert.deepEqual(await stepCampaign(t.deps, HOTEL, c.id), { kind: "inactive" });
  });

  test("a guest the sender refuses is skipped and the others still get theirs", async () => {
    const t = build();
    const c = await t.start();
    t.setScript((req) => (req.to.endsWith("01") ? refused("opted_out") : sent()));
    assert.deepEqual(await stepCampaign(t.deps, HOTEL, c.id), { kind: "done", sent: 2 });
    const after = await t.store.get(c.id);
    assert.deepEqual([after?.sent, after?.skipped, after?.status], [2, 1, "done"]);
    assert.equal(t.store.recipients.find((r) => r.phoneDigits.endsWith("01"))?.reason, "opted_out");
  });

  test("the daily limit waits (the rest stay queued); a not-allowed marketing message pauses the campaign; a message that lost its approval pauses it before any send", async () => {
    const t = build(guests(4));
    const c = await t.start();
    let n = 0;
    t.setScript(() => (++n > 2 ? refused("daily_cap_reached") : sent()));
    assert.deepEqual(await stepCampaign(t.deps, HOTEL, c.id), { kind: "wait", sent: 2, minutes: 720, reason: "daily_cap_reached" });
    assert.equal(await t.store.queued(c.id), 2);
    assert.equal((await t.store.get(c.id))?.status, "running");
    t.setScript(() => refused("marketing_not_allowed"));
    const paused = await stepCampaign(t.deps, HOTEL, c.id);
    assert.deepEqual([paused.kind, (await t.store.get(c.id))?.status], ["paused", "paused"]);
    assert.match((await t.store.get(c.id))?.statusReason ?? "", /not allowed/);

    const lost = build(guests(2), { ...TEMPLATE, status: "paused" });
    const c2 = await lost.start();
    assert.equal((await stepCampaign(lost.deps, HOTEL, c2.id)).kind, "paused");
    assert.equal(lost.calls.length, 0);
  });

  test("a large audience goes out a batch at a time", async () => {
    const t = build(guests(BATCH_SIZE + 5));
    const c = await t.start();
    assert.deepEqual(await stepCampaign(t.deps, HOTEL, c.id), { kind: "more", sent: BATCH_SIZE });
    assert.deepEqual(await stepCampaign(t.deps, HOTEL, c.id), { kind: "done", sent: 5 });
  });
});

describe("the sweep", () => {
  test("a due campaign takes its next batch and is scheduled again; a finished or waiting one is removed or delayed; a failing one never stops the others", async () => {
    const t = build(guests(BATCH_SIZE + 1));
    const c = await t.start();
    const runs = createMemoryCampaignRuns();
    await runs.schedule(HOTEL, c.id, T0);
    await runs.schedule(HOTEL, "00000000-0000-4000-8000-0000000000ff", T0);
    const r1 = await sweepCampaigns({ ...t.deps, runs });
    assert.deepEqual([r1.campaigns, r1.sent], [2, BATCH_SIZE]);
    assert.equal(runs.rows.find((r) => r.campaignId === c.id)?.at.getTime(), T0.getTime() + 60_000, "more to send: again in a minute");
    assert.equal(runs.rows.some((r) => r.campaignId === "00000000-0000-4000-8000-0000000000ff"), false, "a campaign that is gone leaves the list");
    // not due yet: nothing happens
    assert.equal((await sweepCampaigns({ ...t.deps, runs })).campaigns, 0);
    const later = { ...t.deps, runs, now: () => new Date(T0.getTime() + 61_000) };
    assert.deepEqual((await sweepCampaigns(later)).sent, 1);
    assert.equal(runs.rows.length, 0);
  });
});

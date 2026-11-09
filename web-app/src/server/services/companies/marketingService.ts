import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { campaignDuration, campaignText, companiesCopy, CAMPAIGN_BODY_MAX, CAMPAIGN_SUBJECT_MAX, type Campaign, type CampaignAudience, type CampaignEstimate, type MarketingOverview } from "@shared/dashboards/companies";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { Addressee, CampaignRecord, CompaniesRepos } from "../../repos/companies";
import type { MailPayload } from "../auth/mail";
import { mailWake } from "../auth/mailWake";
import type { Person } from "../cash/ports";
import { createdEntry, deletedEntry, updatedEntry, type LogContext } from "../cash/syslog";
import { Check } from "../frontOffice/validate";
import { COMPANIES_LOG, type CompaniesDeps } from "./context";
import type { CampaignBody } from "./schemas";

// Email marketing (HMS, replaces the CRM): a campaign is a subject, a plain-text message and an audience, sent through the hotel's OWN mail server (outbox kind 'campaign',
// hotel id set; mail/hotelSmtp.ts) with the message written for each person (`{name}`), the hotel's sign-off and that person's unsubscribe link. Spec: docs/specs/companies.md §4.
// The campaign engine (hotel migration 0044, platform 0130; MAIL-PROVIDERS-50K plan, session A's slice H2 built by claude-d3): sending no longer queues every mail at once.
//  - estimate(): who it goes to now (opt-outs and the platform's suppressed addresses left out) and about how long at the mail service's pace; the screen shows it and the
//    hotel confirms that NUMBER; send() refuses when the audience has changed since (CONFLICT with the new number).
//  - send(): the campaign becomes 'sending' with its recipients kept (none queued yet) and is registered in the platform's list of running campaigns; the mail worker's feeder
//    (campaignFeed.ts) moves the next recipients into the outbox a little at a time, within what the hotel may send today, until all went (then 'sent').
//  - pause() / resume(): the feeder stops / starts again (a few mails already in the queue may still go); cancel(): the rest is never sent and the mails still waiting in the
//    queue are closed as CANCELLED.
// How the mails stand (sent, failed, waiting) is read from the outbox by the campaign's template name. An address that opens its unsubscribe link is kept in the hotel's
// opt-outs and left out of every later audience (and skipped by the feeder if the campaign is still going).

const MODULE = "companies";
const LIST_LIMIT = 100;
/** A hotel can set up its mail server with these two; without them nothing can go out (mail/hotelSmtp.ts hotelSmtpFromSettings). */
const SYSTEM_USER = "00000000-0000-4000-8000-0000000000e1";

/** What the service needs from the platform: the outbox, the suppression list and holds, the running campaigns, the mail service's limits, addresses and keys. */
export interface MarketingPorts {
  /** One outbox row through the hotel's own mail server; `template` names the campaign ('campaign-<id>') so its counts can be read back. Used for the test mail. */
  enqueue(hotelId: string, to: string, template: string, payload: MailPayload): Promise<void>;
  /** How the mails with these templates stand (outbox.countByTemplate). */
  deliveries(hotelId: string, templates: readonly string[]): Promise<Map<string, { pending: number; sent: number; failed: number }>>;
  /** The platform account's email address (a test mail goes there). */
  emailOf(userId: string): Promise<string | null>;
  /** Where people open the app (HMS_PUBLIC_URL), for the unsubscribe links. */
  publicUrl: string;
  /** The server's signing key (HMS_HASH_KEY): the unsubscribe link carries a signature, so nobody can unsubscribe someone else by guessing. */
  secret(): Buffer;
  /** Which of these addresses are on the platform's suppression list for this hotel (platform 0130). */
  suppressedAmong(hotelId: string, emails: readonly string[]): Promise<Set<string>>;
  /** Why the platform holds this hotel's campaign mail, or null. */
  heldReason(hotelId: string): Promise<string | null>;
  /** What the hotel's mail service allows (0 = no fixed limit). */
  limits(hotelId: string): Promise<{ perSecond: number; perDay: number }>;
  /** The platform's list of running campaigns (the feeder's work list). */
  runs: { start(hotelId: string, campaignId: string): Promise<void>; setState(hotelId: string, campaignId: string, state: "sending" | "paused"): Promise<void>; end(hotelId: string, campaignId: string): Promise<void> };
  /** Closes the campaign's mails still waiting in the queue as CANCELLED; how many. */
  cancelQueued(hotelId: string, template: string): Promise<number>;
}

export const templateOf = (campaignId: string): string => `campaign-${campaignId}`;

/** The unsubscribe signature of one address at one hotel: 32 url-safe characters of an HMAC under the server key. */
export function unsubscribeToken(secret: Buffer, hotelId: string, email: string): string {
  return createHmac("sha256", secret).update(`${hotelId}\n${email.trim().toLowerCase()}`).digest("base64url").slice(0, 32);
}

export function unsubscribeUrl(publicUrl: string, secret: Buffer, hotelId: string, email: string): string {
  const base = publicUrl.replace(/\/+$/, "");
  const e = email.trim().toLowerCase();
  return `${base}/api/v1/public/unsubscribe?h=${encodeURIComponent(hotelId)}&e=${encodeURIComponent(e)}&t=${unsubscribeToken(secret, hotelId, e)}`;
}

/** One person's campaign mail: the message written for them, the hotel's sign-off, their unsubscribe link. The service (test mail) and the feeder use it. */
export function campaignPayload(ports: Pick<MarketingPorts, "publicUrl" | "secret">, hotelId: string, hotelName: string, c: Pick<CampaignRecord, "subject" | "body">, to: Addressee): MailPayload {
  return { name: to.name || "Guest", hotelName, subject: c.subject, text: campaignText(c.body, to.name, hotelName), unsubscribeUrl: unsubscribeUrl(ports.publicUrl, ports.secret(), hotelId, to.email) };
}

export function createMarketingService(deps: CompaniesDeps, ports: MarketingPorts) {
  const { unit, catalog, people, now } = deps;
  const logCtx = (session: VerifiedSession, meta: RequestMeta, actor: Person | undefined): LogContext => ({ userId: session.userId, userName: actor?.name ?? "System", ip: meta.ip, traceId: meta.traceId });

  async function dtos(session: VerifiedSession, rows: CampaignRecord[]): Promise<Campaign[]> {
    const names = await people.get([...new Set(rows.map((r) => r.createdBy).filter((x): x is string => x !== null))]);
    const begun = rows.filter((r) => r.status !== "draft");
    const counts = begun.length ? await ports.deliveries(session.hotelId, begun.map((r) => templateOf(r.id))) : new Map<string, { pending: number; sent: number; failed: number }>();
    return rows.map((r) => {
      const c = counts.get(templateOf(r.id)) ?? { pending: 0, sent: 0, failed: 0 };
      return {
        id: r.id,
        subject: r.subject,
        body: r.body,
        audience: r.audience,
        status: r.status,
        recipients: r.recipients,
        queued: r.queued,
        leftOut: r.leftOut,
        delivered: c.sent,
        failed: c.failed,
        pending: c.pending,
        sentAt: r.sentAt ? r.sentAt.toISOString() : null,
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        createdBy: r.createdBy ? (names.get(r.createdBy)?.name ?? "") : "",
      };
    });
  }

  function validated(input: CampaignBody): { subject: string; body: string; audience: CampaignAudience } {
    const c = new Check(false);
    const subject = c.required("subject", "subject", input.subject);
    c.max("subject", "subject", subject, CAMPAIGN_SUBJECT_MAX);
    const body = c.required("body", "message", input.body);
    c.max("body", "message", body, CAMPAIGN_BODY_MAX);
    c.done();
    return { subject: (subject ?? "").trim(), body: (body ?? "").trim(), audience: input.audience };
  }

  // A hotel no longer sets up a mail server: its mail goes out through the platform's Amazon SES (its own address, made by itself) unless the Super Admin gave it accounts of its own, so mail can
  // always go out (the router, mail/hotelSmtp.ts, picks the account).
  async function mailReady(_repos: CompaniesRepos): Promise<boolean> {
    return true;
  }

  async function loadDraft(repos: CompaniesRepos, id: string): Promise<CampaignRecord> {
    const c = await repos.marketing.get(id, { forUpdate: true });
    if (!c) throw new AppError("NOT_FOUND");
    if (c.status !== "draft") throw new AppError("CONFLICT", "This campaign was already sent.", { fields: { status: "A sent campaign cannot be changed." } });
    return c;
  }

  /** The audience as it is now, with the platform's suppressed addresses left out (the hotel's own opt-outs are left out by the query). */
  async function reachable(session: VerifiedSession, repos: CompaniesRepos, audience: CampaignAudience): Promise<{ keep: Addressee[]; leftOut: number }> {
    const all = await repos.marketing.audience(audience);
    const suppressed = all.length ? await ports.suppressedAmong(session.hotelId, all.map((a) => a.email)) : new Set<string>();
    const keep = all.filter((a) => !suppressed.has(a.email.toLowerCase()));
    return { keep, leftOut: all.length - keep.length };
  }

  /** A campaign that is sending or paused, locked; anything else is a CONFLICT with this sentence. */
  async function loadRunning(repos: CompaniesRepos, id: string, allowed: readonly CampaignRecord["status"][], refusal: string): Promise<CampaignRecord> {
    const c = await repos.marketing.get(id, { forUpdate: true });
    if (!c) throw new AppError("NOT_FOUND");
    if (!allowed.includes(c.status)) throw new AppError("CONFLICT", refusal, { fields: { status: refusal } });
    return c;
  }

  async function logChange(session: VerifiedSession, meta: RequestMeta, repos: CompaniesRepos, c: CampaignRecord, summary: string): Promise<void> {
    const names = await people.get([session.userId]);
    await repos.systemLogs.write({ ...updatedEntry(logCtx(session, meta, names.get(session.userId)), "Campaign", { id: c.id, label: c.subject }, {}, {}, COMPANIES_LOG), summary });
  }

  return {
    /** The page: the campaigns (newest first), the audience sizes, the opt-outs, whether mail can go out, where a test goes, and a hold of the platform. */
    async overview(session: VerifiedSession): Promise<MarketingOverview> {
      requirePermission(session, catalog, MODULE, "view");
      const [myEmail, held, rest] = await Promise.all([
        ports.emailOf(session.userId),
        ports.heldReason(session.hotelId).catch(() => null),
        unit.run(session, async (repos) => ({
          rows: await repos.marketing.list(LIST_LIMIT),
          audience: await repos.marketing.audienceCounts(),
          optOuts: await repos.marketing.optOuts(),
          mailReady: await mailReady(repos),
        })),
      ]);
      return { campaigns: await dtos(session, rest.rows), audience: rest.audience, optOuts: rest.optOuts, mailReady: rest.mailReady, myEmail, held };
    },

    async create(session: VerifiedSession, input: CampaignBody, meta: RequestMeta): Promise<Campaign> {
      requirePermission(session, catalog, MODULE, "edit");
      const fields = validated(input);
      return unit.run(session, async (repos) => {
        const c = await repos.marketing.create({ ...fields, createdBy: session.userId });
        const names = await people.get([session.userId]);
        await repos.systemLogs.write(createdEntry(logCtx(session, meta, names.get(session.userId)), "Campaign", { id: c.id, label: c.subject }, { Audience: c.audience }, COMPANIES_LOG));
        return (await dtos(session, [c]))[0];
      });
    },

    async update(session: VerifiedSession, id: string, input: CampaignBody, meta: RequestMeta): Promise<Campaign> {
      requirePermission(session, catalog, MODULE, "edit");
      const fields = validated(input);
      return unit.run(session, async (repos) => {
        const before = await loadDraft(repos, id);
        const c = (await repos.marketing.update(id, fields, session.userId)) ?? before;
        const names = await people.get([session.userId]);
        await repos.systemLogs.write(updatedEntry(logCtx(session, meta, names.get(session.userId)), "Campaign", { id: c.id, label: c.subject }, { Subject: before.subject, Audience: before.audience }, { Subject: c.subject, Audience: c.audience }, COMPANIES_LOG));
        return (await dtos(session, [c]))[0];
      });
    },

    /** Drafts only: a sent campaign is the record of what went out. */
    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, MODULE, "edit");
      return unit.run(session, async (repos) => {
        const c = await loadDraft(repos, id);
        await repos.marketing.delete(id);
        const names = await people.get([session.userId]);
        await repos.systemLogs.write(deletedEntry(logCtx(session, meta, names.get(session.userId)), "Campaign", { id: c.id, label: c.subject }, { Audience: c.audience }, COMPANIES_LOG));
        return { id };
      });
    },

    /** What sending a draft takes now: the addresses, those left out, the mail service's pace, about how long, and whether the platform holds the hotel's campaign mail. */
    async estimate(session: VerifiedSession, id: string): Promise<CampaignEstimate> {
      requirePermission(session, catalog, MODULE, "edit");
      const found = await unit.run(session, async (repos) => {
        const c = await repos.marketing.get(id);
        if (!c) throw new AppError("NOT_FOUND");
        if (c.status !== "draft") throw new AppError("CONFLICT", "This campaign was already sent.", { fields: { status: "A sent campaign cannot be sent again." } });
        return reachable(session, repos, c.audience);
      });
      const [limits, held] = await Promise.all([ports.limits(session.hotelId).catch(() => ({ perSecond: 0, perDay: 0 })), ports.heldReason(session.hotelId).catch(() => null)]);
      const perSecond = limits.perSecond > 0 ? limits.perSecond : null;
      const perDay = limits.perDay > 0 ? limits.perDay : null;
      return { recipients: found.keep.length, leftOut: found.leftOut, perSecond, perDay, ...campaignDuration(found.keep.length, perSecond, perDay), held: held !== null };
    },

    /**
     * Starts sending a draft to `expected` addresses (the number the hotel confirmed after estimate()). The audience is read again now; a different number is a CONFLICT that
     * names the new one. The campaign is registered in the platform's running list FIRST (a send that then fails leaves only a run the feeder clears), then marked sending with
     * its recipients in the hotel's own transaction. Nothing is queued here: the feeder does that at the mail service's pace.
     */
    async send(session: VerifiedSession, id: string, expected: number, meta: RequestMeta): Promise<Campaign> {
      requirePermission(session, catalog, MODULE, "edit");
      const c = await unit.run(session, async (repos) => {
        const draft = await loadDraft(repos, id);
        if (!(await mailReady(repos))) throw new AppError("VALIDATION_FAILED", "Set up your mail server under Settings > Email before sending a campaign.", { fields: { mail: "Set up your mail server under Settings > Email first." } });
        const { keep, leftOut } = await reachable(session, repos, draft.audience);
        if (keep.length === 0) throw new AppError("VALIDATION_FAILED", "Nobody in this audience has an email address.", { fields: { audience: "Nobody in this audience has an email address." } });
        if (keep.length !== expected) throw new AppError("CONFLICT", companiesCopy.marketing.changed(keep.length), { fields: { expected: companiesCopy.marketing.changed(keep.length) } });
        await ports.runs.start(session.hotelId, id);
        const started = (await repos.marketing.begin(id, keep, leftOut, now(), session.userId)) ?? draft;
        await logChange(session, meta, repos, started, `Started sending "${started.subject}" to ${keep.length} ${keep.length === 1 ? "address" : "addresses"}${leftOut ? ` (${leftOut} left out)` : ""}`);
        return started;
      });
      mailWake.touch();
      return (await dtos(session, [c]))[0];
    },

    /** Sending -> paused: the feeder moves nothing more into the queue until resumed (mails already in the queue may still go). */
    async pause(session: VerifiedSession, id: string, meta: RequestMeta): Promise<Campaign> {
      requirePermission(session, catalog, MODULE, "edit");
      const c = await unit.run(session, async (repos) => {
        await loadRunning(repos, id, ["sending"], "Only a campaign that is sending can be paused.");
        const paused = (await repos.marketing.setStatus(id, "paused", now(), session.userId)) as CampaignRecord;
        await logChange(session, meta, repos, paused, `Paused "${paused.subject}"`);
        return paused;
      });
      await ports.runs.setState(session.hotelId, id, "paused").catch(() => undefined);
      return (await dtos(session, [c]))[0];
    },

    /** Paused -> sending again. */
    async resume(session: VerifiedSession, id: string, meta: RequestMeta): Promise<Campaign> {
      requirePermission(session, catalog, MODULE, "edit");
      const c = await unit.run(session, async (repos) => {
        await loadRunning(repos, id, ["paused"], "Only a paused campaign can be resumed.");
        await ports.runs.start(session.hotelId, id);
        const resumed = (await repos.marketing.setStatus(id, "sending", now(), session.userId)) as CampaignRecord;
        await logChange(session, meta, repos, resumed, `Resumed "${resumed.subject}"`);
        return resumed;
      });
      mailWake.touch();
      return (await dtos(session, [c]))[0];
    },

    /** Sending or paused -> cancelled: the rest is never sent; the campaign's mails still waiting in the queue are closed as CANCELLED. */
    async cancel(session: VerifiedSession, id: string, meta: RequestMeta): Promise<Campaign> {
      requirePermission(session, catalog, MODULE, "edit");
      const c = await unit.run(session, async (repos) => {
        await loadRunning(repos, id, ["sending", "paused"], "Only a campaign that is sending or paused can be cancelled.");
        const cancelled = (await repos.marketing.setStatus(id, "cancelled", now(), session.userId)) as CampaignRecord;
        await logChange(session, meta, repos, cancelled, `Cancelled "${cancelled.subject}" after ${cancelled.queued} of ${cancelled.recipients} were queued`);
        return cancelled;
      });
      await ports.cancelQueued(session.hotelId, templateOf(id)).catch(() => undefined);
      await ports.runs.end(session.hotelId, id).catch(() => undefined);
      return (await dtos(session, [c]))[0];
    },

    /** One mail of the campaign, as a guest would get it, to the signed-in person's own address. */
    async test(session: VerifiedSession, id: string): Promise<{ to: string }> {
      requirePermission(session, catalog, MODULE, "edit");
      const to = await ports.emailOf(session.userId);
      if (!to) throw new AppError("VALIDATION_FAILED", "Your account has no email address, so a test cannot be sent to you.", { fields: { to: "Your account has no email address." } });
      const found = await unit.run(session, async (repos) => {
        const c = await repos.marketing.get(id);
        if (!c) throw new AppError("NOT_FOUND");
        if (!(await mailReady(repos))) throw new AppError("VALIDATION_FAILED", "Set up your mail server under Settings > Email before sending a test.", { fields: { mail: "Set up your mail server under Settings > Email first." } });
        const names = await people.get([session.userId]);
        return { c, hotelName: (await repos.hotelProfile.header()).name, name: names.get(session.userId)?.name ?? "" };
      });
      await ports.enqueue(session.hotelId, to, "campaign-test", campaignPayload(ports, session.hotelId, found.hotelName, found.c, { email: to, name: found.name }));
      mailWake.touch();
      return { to };
    },

    /** The link's signature only (nothing is recorded): the page that OPENS the link asks first (security review L3), a wrong link is a 404. */
    checkUnsubscribe(q: { h: string; e: string; t: string }): { email: string } {
      const email = q.e.trim().toLowerCase();
      const want = Buffer.from(unsubscribeToken(ports.secret(), q.h, email));
      const got = Buffer.from(q.t);
      if (want.length !== got.length || !timingSafeEqual(want, got)) throw new AppError("NOT_FOUND");
      return { email };
    },

    /** The link in every campaign mail (public, no sign-in): a valid signature records the opt-out (POST: the page's button or a mail program's one-click); a wrong one is refused. Twice is fine. */
    async unsubscribe(q: { h: string; e: string; t: string }): Promise<{ email: string }> {
      const { email } = this.checkUnsubscribe(q);
      await unit.run({ hotelId: q.h, userId: SYSTEM_USER, visit: undefined }, (repos) => repos.marketing.optOut(email));
      return { email };
    },
  };
}

export type MarketingService = ReturnType<typeof createMarketingService>;

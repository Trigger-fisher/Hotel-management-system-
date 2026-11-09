import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { MAIL_SAFETY_LIMITS, type MailHold, type MailSafetyView, type MailSuppression } from "@shared/dashboards/mailSafety";
import type { VerifiedSession } from "../../auth/session";
import { hmacHex } from "../../crypto/hash";
import { AppError } from "../../errors";
import type { MailEvent } from "../../mail/events";
import { HOLD_LIMITS, holdVerdict, outboxIdOfMessageId, rateWindowStart } from "../../mail/safety";
import type { MailHoldRecord, SuppressionRecord } from "../../repos/auth";
import type { PlatformConsoleRepos } from "../../repos/platformConsole";
import { auditRow, createGate, type AuditInput, type PlatformMeta } from "./access";
import type { ConsoleDeps } from "./context";

// Deliverability (platform migration 0130; MAIL-PROVIDERS-50K plan; session A's slice H1, built by claude-d3):
//  - record(): what the mail services report to the public webhooks (routes app/api/v1/public/mail-events/*): a hard bounce suppresses the address for every hotel, a complaint
//    or an unsubscribe for the hotel that sent the mail; bounces and complaints are counted per hotel and day; a hotel whose rates pass the limits (mail/safety.ts) is put on hold
//    (its campaign mail stops; system mail still goes), with an audit row "Mail safety (automatic)". The hotel of an event is found through our Message-ID (the outbox row), else
//    through the newest mail sent to that address in the last 30 days.
//  - the Super Admin's panel (Platform settings > Mail > Bounces and holds): the holds and the suppression list, the webhook addresses, and suppress / lift / hold / release by
//    hand, each an audit row.

export const mailSuppressBody = z.strictObject({ email: z.string().trim().toLowerCase().min(3).max(254).email(), hotelId: z.string().uuid().nullable() });
export const mailHoldBody = z.strictObject({ reason: z.string().trim().min(MAIL_SAFETY_LIMITS.reasonMin).max(MAIL_SAFETY_LIMITS.reasonMax) });

/** Events in one webhook call are capped (a service batches at most a few hundred). */
const MAX_EVENTS = 500;
const LOOKBACK_MS = 30 * 86_400_000;
const AUTOMATIC = "Mail safety (automatic)";

/**
 * The secret part of a webhook address: an HMAC of the provider (and its key GENERATION) under the server key, so it cannot be guessed. Generation 0 is the first key (the same
 * value as before rotation existed); the Super Admin replaces one provider's key on its own (rotateWebhookKey), and the old one keeps working for a day so the service can be
 * changed over. Nothing secret is stored: only the generation number (platform_settings mail.webhook_<provider>).
 */
export const webhookKey = (hashKey: Buffer, provider: "ses" | "brevo", generation = 0): string => hmacHex(hashKey, "mail-webhook", generation === 0 ? [provider] : [provider, String(generation)]).slice(0, 32);
/** How long a replaced webhook key still opens its door. */
export const WEBHOOK_KEY_GRACE_MS = 24 * 3_600_000;
/** The keyed hash a webhook delivery is remembered by (platform.mail_event_receipts): the service's own id, never the mail. */
export const eventKeyOf = (hashKey: Buffer, provider: "ses" | "brevo", parts: readonly string[]): string => hmacHex(hashKey, "mail-event", [provider, ...parts]);

const GENERATION_KEY = (provider: "ses" | "brevo"): string => `mail.webhook_${provider}`;
/** The Amazon SNS topic the SES reports come from: pinned by the first signed message (or after the SES key is replaced), then every other topic is refused. */
const TOPIC_KEY = "mail.sns_topic_arn";
interface Generation {
  gen: number;
  /** While the previous key still works (ISO); null = only the current one. */
  previousUntil: string | null;
}
const generationOf = (rows: readonly { key: string; value: unknown }[], provider: "ses" | "brevo"): Generation => {
  const v = rows.find((r) => r.key === GENERATION_KEY(provider))?.value as Partial<Generation> | undefined;
  return { gen: Number.isInteger(v?.gen) && (v?.gen as number) >= 0 ? (v?.gen as number) : 0, previousUntil: typeof v?.previousUntil === "string" ? v.previousUntil : null };
};
const topicOf = (rows: readonly { key: string; value: unknown }[]): string | null => {
  const v = rows.find((r) => r.key === TOPIC_KEY)?.value;
  return typeof v === "string" && v !== "" ? v : null;
};
const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const cursorOf = (r: SuppressionRecord): string => Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString("base64url");
function readCursor(raw: string | undefined): { at: Date; id: string } | undefined {
  if (!raw) return undefined;
  const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const at = new Date(iso ?? "");
  if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id ?? "")) throw new AppError("VALIDATION_FAILED", undefined, { fields: { cursor: "Not a page of this list." } });
  return { at, id: id as string };
}

export function createMailSafetyService(deps: ConsoleDeps & { hashKey: Buffer; webhookBase: string | null }) {
  const { unit, now } = deps;
  const gate = deps.gate ?? createGate(unit, now);

  async function names(repos: PlatformConsoleRepos, userIds: (string | null)[], hotelIds: (string | null)[], at: Date) {
    const people = new Map<string, string>();
    const hotels = new Map<string, string>();
    for (const id of new Set(userIds.filter((x): x is string => !!x))) people.set(id, (await repos.accounts.get(id))?.displayName ?? "Unknown");
    for (const id of new Set(hotelIds.filter((x): x is string => !!x))) hotels.set(id, (await repos.hotels.get(id, at))?.name ?? "Unknown hotel");
    return { people, hotels };
  }

  const holdDto = (h: MailHoldRecord, n: Awaited<ReturnType<typeof names>>): MailHold => ({
    hotelId: h.hotelId, hotelName: n.hotels.get(h.hotelId) ?? "Unknown hotel", held: h.releasedAt === null, reason: h.reason, detail: h.detail, heldAt: h.heldAt.toISOString(),
    heldByName: h.heldBy ? (n.people.get(h.heldBy) ?? "Unknown") : null, releasedAt: h.releasedAt ? h.releasedAt.toISOString() : null,
    releasedByName: h.releasedBy ? (n.people.get(h.releasedBy) ?? "Unknown") : null, releaseReason: h.releaseReason,
  });
  const suppressionDto = (s: SuppressionRecord, n: Awaited<ReturnType<typeof names>>): MailSuppression => ({
    id: s.id, email: s.email, hotelId: s.hotelId, hotelName: s.hotelId ? (n.hotels.get(s.hotelId) ?? "Unknown hotel") : null, reason: s.reason, source: s.source, detail: s.detail,
    createdAt: s.createdAt.toISOString(), createdByName: s.createdBy ? (n.people.get(s.createdBy) ?? "Unknown") : null,
  });

  /** A hotel past the limits is held (once); the audit row names the rates. Returns true when it was held now. */
  async function checkHold(repos: PlatformConsoleRepos, hotelId: string, at: Date): Promise<boolean> {
    const hold = await repos.auth.mailSafety.hold(hotelId);
    if (hold && hold.releasedAt === null) return false;
    const verdict = holdVerdict(await repos.auth.mailSafety.rates(hotelId, rateWindowStart(at, hold?.countedFrom ?? null)));
    if (!verdict) return false;
    if (!(await repos.auth.mailSafety.putOnHold({ hotelId, reason: verdict.reason, detail: verdict.detail, heldBy: null }, at))) return false;
    const hotel = await repos.hotels.get(hotelId, at);
    await repos.audit.write(auditRow({ userId: null, name: AUTOMATIC, role: null }, { traceId: "mail-events", ip: null, userAgent: null }, { action: "mail_hold", entity: "hotel", entityId: hotelId, hotelId, targetLabel: hotel?.name ?? null, reason: verdict.detail }, "success", at));
    return true;
  }

  return {
    /**
     * The webhook's secret key (a segment of its PATH, never the query: a query string lands in access logs), compared in constant time: the current generation, or the one
     * before while its day of grace lasts. A wrong or missing key is a 404 (the address is not there for anyone without it).
     */
    async checkWebhookKey(provider: "ses" | "brevo", key: string | undefined): Promise<{ previous: boolean }> {
      const got = key ?? "";
      const g = generationOf(await unit.run((repos) => repos.settings.all()), provider);
      if (same(webhookKey(deps.hashKey, provider, g.gen), got)) return { previous: false };
      if (g.gen > 0 && g.previousUntil !== null && Date.parse(g.previousUntil) > now().getTime() && same(webhookKey(deps.hashKey, provider, g.gen - 1), got)) return { previous: true };
      throw new AppError("NOT_FOUND");
    },

    /**
     * The SNS topic of a signed SES message: the first message through the CURRENT address pins it (platform_settings mail.sns_topic_arn); afterwards a message of any other
     * topic is refused (403), so a leaked address cannot be fed from somebody else's AWS account. Replacing the key keeps the pin, and the previous address (its day of grace)
     * can never set it: a topic that is not pinned yet is refused to it (R3-4).
     */
    async checkSnsTopic(topicArn: string, via: { previous: boolean } = { previous: false }): Promise<void> {
      await unit.run(async (repos) => {
        const pinned = topicOf(await repos.settings.all());
        if (pinned === null) {
          if (via.previous) throw new AppError("FORBIDDEN", "The previous address cannot set the Amazon SNS topic: use the new address.");
          await repos.settings.set(TOPIC_KEY, topicArn, null, now());
          return;
        }
        if (pinned !== topicArn) throw new AppError("FORBIDDEN", "This Amazon SNS topic is not the one the platform takes reports from.");
      });
    },

    /**
     * One delivery of the webhook: each batch is one SNS message or one Brevo event, named by the service's own id parts (`id`) and remembered by their keyed hash
     * (eventKeyOf). A batch received before (a repeated delivery or a replay) is left out, so a bounce or a complaint counts once. Returns how many events were recorded and
     * how many batches were repeats.
     */
    async receive(provider: "ses" | "brevo", input: readonly { id: readonly string[]; events: readonly MailEvent[] }[]): Promise<{ recorded: number; held: number; repeated: number }> {
      if (input.length === 0) return { recorded: 0, held: 0, repeated: 0 };
      const batches = input.map((b) => ({ key: eventKeyOf(deps.hashKey, provider, b.id), events: b.events }));
      const fresh = await unit.run((repos) => repos.auth.mailSafety.receive(provider, batches.map((b) => b.key), now()));
      const taken = batches.filter((b) => fresh.has(b.key));
      const done = await this.record(provider, taken.flatMap((b) => b.events));
      return { ...done, repeated: batches.length - taken.length };
    },

    /** The Super Admin replaces one provider's webhook key (the other keeps its own); the old key works one more day. The SNS topic pin stays (R3-4). */
    async rotateWebhookKey(session: VerifiedSession, provider: "ses" | "brevo", meta: PlatformMeta): Promise<{ provider: "ses" | "brevo"; previousUntil: string }> {
      const label = provider === "ses" ? "Amazon SES" : "Brevo";
      const probe: AuditInput = { action: "settings_updated", entity: "platform", entityId: null, targetLabel: `Mail report address (${label})` };
      await gate.superWrite(session, meta, probe);
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const at = now();
        const g = generationOf(await repos.settings.all(), provider);
        const previousUntil = new Date(at.getTime() + WEBHOOK_KEY_GRACE_MS).toISOString();
        await repos.settings.set(GENERATION_KEY(provider), { gen: g.gen + 1, previousUntil }, actor.userId, at);
        await gate.audit(repos, actor, meta, { ...probe, reason: `New secret key; the old address works until ${previousUntil.slice(0, 16).replace("T", " ")} UTC${provider === "ses" ? "; the SNS topic stays as pinned" : ""}` });
        return { provider, previousUntil };
      });
    },

    /** The webhook's events, recorded: suppressions, counts, and a hold where the rates say so. Returns how many events were used. */
    async record(provider: "ses" | "brevo", events: readonly MailEvent[]): Promise<{ recorded: number; held: number }> {
      const used = events.slice(0, MAX_EVENTS);
      if (used.length === 0) return { recorded: 0, held: 0 };
      return unit.run(async (repos) => {
        const at = now();
        const day = at.toISOString().slice(0, 10);
        const since = new Date(at.getTime() - LOOKBACK_MS);
        const counts = new Map<string, { bounced: number; complained: number }>();
        const touched = new Set<string>();
        for (const e of used) {
          const outboxId = outboxIdOfMessageId(e.messageId);
          let hotelId: string | null | undefined = outboxId ? await repos.auth.outbox.hotelOf(outboxId) : undefined;
          if (hotelId === undefined) hotelId = await repos.auth.outbox.lastHotelMailedTo(e.email, since);
          const scope = hotelId ?? "platform";
          const c = counts.get(scope) ?? { bounced: 0, complained: 0 };
          if (e.kind === "bounce") {
            // only a hard bounce counts toward the rate and suppresses (a full mailbox may work tomorrow)
            if (!e.permanent) continue;
            c.bounced += 1;
            await repos.auth.mailSafety.suppress({ email: e.email, hotelId: null, reason: "bounce", source: provider, detail: e.detail, createdBy: null }, at);
          } else if (e.kind === "complaint") {
            c.complained += 1;
            await repos.auth.mailSafety.suppress({ email: e.email, hotelId: hotelId ?? null, reason: "complaint", source: provider, detail: e.detail, createdBy: null }, at);
          } else {
            // an unsubscribe through the service: off that hotel's campaigns (without a hotel it cannot be placed, so it is left out)
            if (hotelId) await repos.auth.mailSafety.suppress({ email: e.email, hotelId, reason: "unsubscribe", source: provider, detail: e.detail, createdBy: null }, at);
            continue;
          }
          counts.set(scope, c);
          if (hotelId) touched.add(hotelId);
        }
        await repos.auth.mailSafety.addEvents([...counts.entries()].map(([scope, c]) => ({ scope, day, bounced: c.bounced, complained: c.complained })));
        let held = 0;
        for (const hotelId of touched) if (await checkHold(repos, hotelId, at)) held += 1;
        return { recorded: used.length, held };
      });
    },

    /** The Super Admin's panel. */
    async view(session: VerifiedSession, query: { search?: string; cursor?: string } = {}): Promise<MailSafetyView> {
      gate.superRead(session);
      const before = readCursor(query.cursor);
      return unit.run(async (repos) => {
        await gate.actor(repos, session);
        const at = now();
        const holds = await repos.auth.mailSafety.holds();
        const rows = await repos.auth.mailSafety.suppressions({ ...(query.search ? { search: query.search.slice(0, 254) } : {}), limit: MAIL_SAFETY_LIMITS.pageSize + 1, ...(before ? { before } : {}) });
        const page = rows.slice(0, MAIL_SAFETY_LIMITS.pageSize);
        const n = await names(repos, [...holds.flatMap((h) => [h.heldBy, h.releasedBy]), ...page.map((s) => s.createdBy)], [...holds.map((h) => h.hotelId), ...page.map((s) => s.hotelId)], at);
        const base = deps.webhookBase ? deps.webhookBase.replace(/\/+$/, "") : null;
        const key = deps.hashKey;
        const settings = await repos.settings.all();
        const ses = generationOf(settings, "ses");
        const brevo = generationOf(settings, "brevo");
        const graceOf = (g: Generation): string | null => (g.gen > 0 && g.previousUntil && Date.parse(g.previousUntil) > at.getTime() ? g.previousUntil : null);
        return {
          ready: await repos.auth.mailSafety.ready(),
          holds: holds.map((h) => holdDto(h, n)),
          suppressions: page.map((s) => suppressionDto(s, n)),
          nextCursor: rows.length > MAIL_SAFETY_LIMITS.pageSize ? cursorOf(page[page.length - 1] as SuppressionRecord) : null,
          // the key is a PATH segment (a query string is written to access logs); an API key never sees it, not even a read key (security review round 3, R3-3)
          webhooks: base && !session.token ? { ses: `${base}/api/v1/public/mail-events/ses/${webhookKey(key, "ses", ses.gen)}`, brevo: `${base}/api/v1/public/mail-events/brevo/${webhookKey(key, "brevo", brevo.gen)}` } : null,
          previousKeyUntil: { ses: graceOf(ses), brevo: graceOf(brevo) },
          snsTopicArn: topicOf(settings),
          limits: { windowDays: HOLD_LIMITS.windowDays, minSent: HOLD_LIMITS.minSent, bounceRatePct: HOLD_LIMITS.bounceRate * 100, complaintMinSent: HOLD_LIMITS.complaintMinSent, complaintRatePct: Math.round(HOLD_LIMITS.complaintRate * 1000) / 10 },
        };
      });
    },

    async suppress(session: VerifiedSession, input: z.infer<typeof mailSuppressBody>, meta: PlatformMeta): Promise<{ suppressed: boolean }> {
      const probe: AuditInput = { action: "mail_suppressed", entity: input.hotelId ? "hotel" : "platform", entityId: input.hotelId, hotelId: input.hotelId, targetLabel: input.email };
      await gate.superWrite(session, meta, probe);
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const at = now();
        if (!(await repos.auth.mailSafety.ready())) throw new AppError("CONFLICT", "Run the platform database update 0130 first.");
        if (input.hotelId && !(await repos.hotels.get(input.hotelId, at))) throw new AppError("VALIDATION_FAILED", undefined, { fields: { hotelId: "No such hotel." } });
        const suppressed = await repos.auth.mailSafety.suppress({ email: input.email, hotelId: input.hotelId, reason: "manual", source: "manual", detail: null, createdBy: actor.userId }, at);
        if (suppressed) await gate.audit(repos, actor, meta, probe);
        return { suppressed };
      });
    },

    async unsuppress(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<{ removed: boolean }> {
      const probe: AuditInput = { action: "mail_unsuppressed", entity: "platform", entityId: null };
      await gate.superWrite(session, meta, probe);
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const row = await repos.auth.mailSafety.unsuppress(id);
        if (!row) throw new AppError("NOT_FOUND");
        await gate.audit(repos, actor, meta, { ...probe, entity: row.hotelId ? "hotel" : "platform", entityId: row.hotelId, hotelId: row.hotelId, targetLabel: row.email, reason: `was: ${row.reason}` });
        return { removed: true };
      });
    },

    async hold(session: VerifiedSession, hotelId: string, reason: string, meta: PlatformMeta): Promise<{ held: boolean }> {
      const probe: AuditInput = { action: "mail_hold", entity: "hotel", entityId: hotelId, hotelId, reason };
      await gate.superWrite(session, meta, probe);
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const at = now();
        if (!(await repos.auth.mailSafety.ready())) throw new AppError("CONFLICT", "Run the platform database update 0130 first.");
        const hotel = await repos.hotels.get(hotelId, at);
        if (!hotel) throw new AppError("NOT_FOUND", "No such hotel.");
        const held = await repos.auth.mailSafety.putOnHold({ hotelId, reason: "manual", detail: reason, heldBy: actor.userId }, at);
        if (!held) throw new AppError("CONFLICT", "This hotel's campaign mail is already held.");
        await gate.audit(repos, actor, meta, { ...probe, targetLabel: hotel.name });
        return { held };
      });
    },

    async release(session: VerifiedSession, hotelId: string, reason: string, meta: PlatformMeta): Promise<{ released: boolean }> {
      const probe: AuditInput = { action: "mail_hold_released", entity: "hotel", entityId: hotelId, hotelId, reason };
      await gate.superWrite(session, meta, probe);
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const at = now();
        const released = await repos.auth.mailSafety.release(hotelId, actor.userId, reason, at);
        if (!released) throw new AppError("CONFLICT", "This hotel's campaign mail is not held.");
        await gate.audit(repos, actor, meta, { ...probe, targetLabel: (await repos.hotels.get(hotelId, at))?.name ?? null });
        return { released };
      });
    },
  };
}

export type MailSafetyService = ReturnType<typeof createMailSafetyService>;

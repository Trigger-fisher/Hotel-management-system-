import "server-only";
import { isIP } from "node:net";
import { z } from "zod";
import type { ApiAccessView, ApiKey, ApiKeyCreated } from "@shared/dashboards/apiAccess";
import { API_ACCESS_LIMITS } from "@shared/dashboards/apiAccess";
import { formatDate } from "@shared/dashboards/format";
import { hashApiToken, newApiToken } from "../../auth/apiTokens";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { ApiTokenRow } from "../../repos/auth";
import type { PlatformConsoleRepos } from "../../repos/platformConsole";
import { auditRow, createGate, platformMeta, type AuditInput, type PlatformMeta } from "./access";
import type { ConsoleDeps } from "./context";

// API access keys (Super Admin > Platform settings > API access; platform migration 0129; docs/plans/API-ACCESS-TOKENS-PLAN-2026-10-18.md). Super Admin only, and only from the browser:
// a call made WITH a key is refused here (and by the wrapper's deny list before that), so a key can never make, see or revoke keys. The key is made here, returned once, and only its keyed
// hash is stored. Every choice the form makes is checked again here (the database CHECKs repeat the hard ones): a FULL key needs the Super Admin's switch on, a reason and a second
// confirmation, at least one IP address and a life of at most 24 hours; test mode is on unless switched off with its own reason. Each action is an audit row; the wrapper's key
// events (a write, a refused call, a first use from a new address) are written here too, under the actor name "API token: <name>".

const LIMITS = API_ACCESS_LIMITS;
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const apiKeyCreateBody = z.strictObject({
  name: text(1, LIMITS.nameMax),
  level: z.enum(["read", "full", "ai"]),
  scope: z.enum(["platform", "hotel", "all"]),
  hotelId: z.string().uuid().nullable().optional(),
  // not asked for an AI key: it has no short life (stored as 10 years, shown as "No expiry")
  expiresInHours: z.number().int().optional(),
  ipAllow: z.array(z.string().trim().min(2).max(45)).max(LIMITS.maxIps),
  reason: text(LIMITS.reasonMin, LIMITS.reasonMax).nullable().optional(),
  confirmFull: z.boolean().optional(),
  testMode: z.boolean().optional(),
  testModeOffReason: text(LIMITS.reasonMin, LIMITS.reasonMax).nullable().optional(),
  callsPerMinute: z.number().int().optional(),
});
export const apiKeyRevokeAllBody = z.strictObject({ reason: text(LIMITS.reasonMin, LIMITS.reasonMax) });
export const apiFullAccessBody = z.strictObject({ enabled: z.boolean(), reason: text(LIMITS.reasonMin, LIMITS.reasonMax), confirm: z.boolean() });

type CreateInput = z.infer<typeof apiKeyCreateBody>;
type KeyEvent = { kind: "write"; status: number } | { kind: "refused"; why: string } | { kind: "new_ip" };

const field = (name: string, message: string): AppError => new AppError("VALIDATION_FAILED", undefined, { fields: { [name]: message } });
const short = (s: string, max: number): string => (Array.from(s).length > max ? `${Array.from(s).slice(0, max - 1).join("")}…` : s);

export function createApiTokenService(deps: ConsoleDeps & { hashKey: Buffer }) {
  const { unit, now } = deps;
  const gate = deps.gate ?? createGate(unit, now);

  /** Management is for a person in the browser: never for a call made with a key. */
  function browserOnly(session: VerifiedSession): void {
    if (session.client === "token") throw new AppError("FORBIDDEN", "API keys are managed in the browser by the Super Admin, never with a key.");
  }

  function statusOf(row: ApiTokenRow, at: Date): ApiKey["status"] {
    if (row.revokedAt !== null) return "revoked";
    return row.expiresAt <= at ? "expired" : "active";
  }

  async function dto(repos: PlatformConsoleRepos, rows: ApiTokenRow[], at: Date): Promise<ApiKey[]> {
    const names = new Map<string, string>();
    const hotels = new Map<string, string>();
    for (const row of rows) {
      if (!names.has(row.createdBy)) names.set(row.createdBy, (await repos.accounts.get(row.createdBy))?.displayName ?? "Unknown");
      if (row.hotelId && !hotels.has(row.hotelId)) hotels.set(row.hotelId, (await repos.hotels.get(row.hotelId, at))?.name ?? "Unknown hotel");
    }
    const today = at.toISOString().slice(0, 10);
    return rows.map((row) => ({
      id: row.id, name: row.name, prefix: row.prefix, level: row.level, scope: row.scope, hotelId: row.hotelId, hotelName: row.hotelId ? hotels.get(row.hotelId) ?? null : null,
      ipAllow: row.ipAllow, testMode: row.testMode, callsPerMinute: row.callsPerMinute, reason: row.reason, createdByName: names.get(row.createdBy) ?? "Unknown",
      createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      expiresInHours: statusOf(row, at) === "active" ? Math.max(0, Math.floor((row.expiresAt.getTime() - at.getTime()) / 3_600_000)) : 0, lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null, lastIp: row.lastIp,
      callsToday: row.callsDay === today ? row.callsCount : 0, ipSeen: row.ipSeen, status: statusOf(row, at), revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    }));
  }

  async function fullAccessView(repos: PlatformConsoleRepos): Promise<ApiAccessView["fullAccess"]> {
    const s = await repos.auth.apiTokens.accessSettings();
    const by = s.changedBy ? await repos.accounts.get(s.changedBy) : null;
    return { enabled: s.fullAccessEnabled, changedAt: s.changedAt ? s.changedAt.toISOString() : null, changedByName: by?.displayName ?? null, reason: s.reason };
  }

  /** The server's own check of the form (the database repeats the hard rules). */
  function checkCreate(input: CreateInput): void {
    const full = input.level === "full";
    const ai = input.level === "ai";
    if (!ai) {
      const hours = full ? LIMITS.fullExpiryHours : LIMITS.readExpiryHours;
      if (input.expiresInHours === undefined || !(hours as readonly number[]).includes(input.expiresInHours)) throw field("expiresInHours", full ? "A full access key lives 1, 6 or 24 hours." : "A read only key lives 1, 7 or 30 days.");
    }
    for (const ip of input.ipAllow) if (isIP(ip) === 0) throw field("ipAllow", `Not an IP address: ${short(ip, 45)}`);
    if (new Set(input.ipAllow).size !== input.ipAllow.length) throw field("ipAllow", "An address is listed twice.");
    if (input.scope === "hotel" && !input.hotelId) throw field("hotelId", "Choose the hotel.");
    if (input.scope !== "hotel" && input.hotelId) throw field("hotelId", "Only a one-hotel key names a hotel.");
    if (ai) {
      // the AI key: the console and every hotel, read only, no short life; it says who it is for and may be limited to the developer's addresses
      if (input.scope !== "all") throw field("scope", "An AI key reaches the console and every hotel.");
      if (!input.reason) throw field("reason", "Say who this AI key is for.");
      if (input.confirmFull !== true) throw field("confirmFull", "Confirm that this key can read all data.");
      const rate = input.callsPerMinute ?? LIMITS.aiCallsPerMinute.default;
      if (rate < LIMITS.aiCallsPerMinute.min || rate > LIMITS.aiCallsPerMinute.max) throw field("callsPerMinute", `Between ${LIMITS.aiCallsPerMinute.min} and ${LIMITS.aiCallsPerMinute.max} calls a minute.`);
      if (input.testMode === false) throw field("testMode", "Test mode is for full access keys.");
      return;
    }
    if (!full) {
      if (input.callsPerMinute !== undefined && input.callsPerMinute !== LIMITS.readCallsPerMinute) throw field("callsPerMinute", "A read only key makes at most 60 calls a minute.");
      if (input.testMode === false) throw field("testMode", "Test mode is for full access keys.");
      return;
    }
    if (input.confirmFull !== true) throw field("confirmFull", "Confirm that this key can change real data.");
    if (!input.reason) throw field("reason", "Say why this full access key is needed.");
    if (input.ipAllow.length < 1) throw field("ipAllow", "A full access key needs at least one IP address.");
    const rate = input.callsPerMinute ?? LIMITS.fullCallsPerMinute.default;
    if (rate < LIMITS.fullCallsPerMinute.min || rate > LIMITS.fullCallsPerMinute.max) throw field("callsPerMinute", `Between ${LIMITS.fullCallsPerMinute.min} and ${LIMITS.fullCallsPerMinute.max} calls a minute.`);
    if (input.testMode === false && !input.testModeOffReason) throw field("testModeOffReason", "Say why test mode is turned off.");
  }

  return {
    async view(session: VerifiedSession): Promise<ApiAccessView> {
      browserOnly(session);
      gate.superRead(session);
      return unit.run(async (repos) => {
        await gate.actor(repos, session);
        const at = now();
        const rows = await repos.auth.apiTokens.list();
        return { keys: await dto(repos, rows, at), fullAccess: await fullAccessView(repos), activeCount: await repos.auth.apiTokens.countActive(at), maxActive: LIMITS.maxActive };
      });
    },

    /**
     * Test a key (the Set-up centre's API step, MJ 5 Nov 2026): the Super Admin pastes the key just shown and gets a plain answer, "This key works for <hotel>", or why it does not.
     * The key is looked up by its keyed hash only; nothing is stored or logged.
     */
    async test(session: VerifiedSession, token: string): Promise<{ ok: boolean; message: string }> {
      browserOnly(session);
      gate.superRead(session);
      const at = now();
      return unit.run(async (repos) => {
        await gate.actor(repos, session);
        const key = /^\S{20,200}$/.test(token.trim()) ? await repos.auth.apiTokens.byHash(hashApiToken(deps.hashKey, token.trim())) : null;
        if (!key) return { ok: false, message: "This is not a key of this platform. Copy the whole key again; it is shown once, when it is made." };
        if (key.revokedAt) return { ok: false, message: `The key "${key.name}" was revoked. Make a new one.` };
        if (key.expiresAt.getTime() <= at.getTime()) return { ok: false, message: `The key "${key.name}" has expired. Make a new one.` };
        const where = key.scope === "hotel" && key.hotelId ? ((await repos.hotels.get(key.hotelId, at))?.name ?? "its hotel") : key.scope === "all" ? "the platform and every hotel" : "the platform";
        const can = key.level === "full" ? "read and change data" : "read data";
        return { ok: true, message: `This key works for ${where}: it may ${can}${key.testMode ? ", in test mode" : ""}, until ${formatDate(key.expiresAt.toISOString())}.` };
      });
    },

    async create(session: VerifiedSession, input: CreateInput, meta: PlatformMeta): Promise<ApiKeyCreated> {
      browserOnly(session);
      const probe: AuditInput = { action: "api_token_created", entity: "platform", entityId: null, targetLabel: input.name };
      await gate.superWrite(session, meta, probe);
      checkCreate(input);
      const { token, prefix } = newApiToken();
      const tokenHash = hashApiToken(deps.hashKey, token);
      const made = await unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const at = now();
        if (input.level === "full" && !(await repos.auth.apiTokens.accessSettings()).fullAccessEnabled) throw new AppError("CONFLICT", "Turn on \"Allow full access keys\" first.");
        if ((await repos.auth.apiTokens.countActive(at)) >= LIMITS.maxActive) throw new AppError("CONFLICT", `At most ${LIMITS.maxActive} keys can be active. Revoke one first.`);
        if (input.hotelId) {
          const hotel = await repos.hotels.get(input.hotelId, at);
          if (!hotel || !["active", "suspended"].includes(String(hotel.status))) throw field("hotelId", "No such live hotel.");
        }
        const full = input.level === "full";
        const ai = input.level === "ai";
        const row = await repos.auth.apiTokens.insert({
          name: input.name, tokenHash, prefix, level: input.level, scope: input.scope, hotelId: input.hotelId ?? null, ipAllow: input.ipAllow, reason: full ? (input.reason ?? null) : (input.reason ?? null),
          testMode: full ? input.testMode !== false : true, testModeOffReason: full && input.testMode === false ? (input.testModeOffReason ?? null) : null,
          callsPerMinute: ai ? (input.callsPerMinute ?? LIMITS.aiCallsPerMinute.default) : full ? (input.callsPerMinute ?? LIMITS.fullCallsPerMinute.default) : LIMITS.readCallsPerMinute, createdBy: actor.userId,
          expiresAt: new Date(at.getTime() + (ai ? LIMITS.aiExpiryHours : (input.expiresInHours as number)) * 3_600_000),
        }, at);
        // the audit row names the key and its choices, never the key
        await gate.audit(repos, actor, meta, {
          ...probe, entityId: row.id, reason: input.reason ?? null,
          after: { level: row.level, scope: row.scope, hotelId: row.hotelId, expiresAt: row.expiresAt.toISOString(), ipAllow: row.ipAllow.length, testMode: row.testMode, callsPerMinute: row.callsPerMinute, prefix: row.prefix },
        });
        return (await dto(repos, [row], at))[0]!;
      });
      return { key: token, apiKey: made };
    },

    async revoke(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<{ revoked: boolean }> {
      browserOnly(session);
      const probe: AuditInput = { action: "api_token_revoked", entity: "platform", entityId: id };
      await gate.superWrite(session, meta, probe);
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const row = (await repos.auth.apiTokens.list()).find((r) => r.id === id);
        if (!row) throw new AppError("NOT_FOUND");
        const revoked = await repos.auth.apiTokens.revoke(id, actor.userId, now());
        if (revoked) await gate.audit(repos, actor, meta, { ...probe, targetLabel: row.name });
        return { revoked };
      });
    },

    async revokeAll(session: VerifiedSession, reason: string, meta: PlatformMeta): Promise<{ revoked: number }> {
      browserOnly(session);
      const probe: AuditInput = { action: "api_token_revoked", entity: "platform", entityId: null, targetLabel: "Every key", reason };
      await gate.superWrite(session, meta, probe);
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const revoked = await repos.auth.apiTokens.revokeAll(actor.userId, now());
        await gate.audit(repos, actor, meta, { ...probe, targetLabel: `Every key (${revoked})` });
        return { revoked };
      });
    },

    async setFullAccess(session: VerifiedSession, input: z.infer<typeof apiFullAccessBody>, meta: PlatformMeta): Promise<ApiAccessView["fullAccess"]> {
      browserOnly(session);
      const probe: AuditInput = { action: "api_token_full_access", entity: "platform", entityId: null, targetLabel: input.enabled ? "Full access keys allowed" : "Full access keys switched off", reason: input.reason };
      await gate.superWrite(session, meta, probe);
      if (input.enabled && input.confirm !== true) throw field("confirm", "Confirm that full access keys may be made.");
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        await repos.auth.apiTokens.setFullAccess(input.enabled, actor.userId, input.reason, now());
        await gate.audit(repos, actor, meta, { ...probe, after: { enabled: input.enabled } });
        return fullAccessView(repos);
      });
    },

    /** The wrapper's events for a call made with a key (http/wrapper.ts onTokenEvent): one audit row, actor "API token: <name>". Never the key, never a body. */
    async recordEvent(session: VerifiedSession, request: Request, traceId: string, event: KeyEvent): Promise<void> {
      const key = session.token;
      if (!key) return;
      const url = new URL(request.url);
      const meta = platformMeta(request, traceId);
      const input: AuditInput =
        event.kind === "new_ip"
          ? { action: "api_token_new_ip", entity: "platform", entityId: key.id, targetLabel: key.name, reason: key.ip ? `First use from ${key.ip}` : null }
          : {
              action: event.kind === "write" ? "api_token_write" : "api_token_refused", entity: "platform", entityId: key.id, hotelId: session.hotelId === "" ? null : session.hotelId,
              targetLabel: short(`${request.method.toUpperCase()} ${url.pathname}`, 200), reason: event.kind === "write" ? `Answer ${event.status}${key.testMode ? " (test mode)" : ""}` : event.why,
            };
      const failed = event.kind === "refused" || (event.kind === "write" && event.status >= 400);
      await unit.run((repos) => repos.audit.write(auditRow({ userId: session.userId, name: `API token: ${key.name}`, role: session.accountRole }, meta, input, failed ? "failed" : "success", now())));
    },
  };
}

export type ApiTokenService = ReturnType<typeof createApiTokenService>;

import "server-only";
import { assertMailRoute, laneOf } from "../../mail/routes";
import { randomUUID } from "node:crypto";
import { foldRoleGrants } from "../../auth/access";
import type { Grant } from "../../auth/permissions";
import type { RecordScope } from "../../auth/session";
import type { AccessRecord, ApiTokenRow, AuditRecord, AuthCodeRecord, AuthEventRecord, AuthRepos, CampaignRunRecord, HotelRecord, HotelSiteRecord, HotelSetupRecord, MailHoldRecord, OutboxRecord, SenderIdentityRecord, PlatformUnit, RoleRecord, SessionRecord, SiteBuildRecord, SuppressionRecord, UserRecord } from "../auth";
import { RepoError } from "../types";
import { inTestMode } from "../../runtime/testMode";
import { MemoryStore } from "./store";

/** The platform data in memory: every table sign-in touches. Tests fill it through the helpers in tests/server/helpers/authWorld.ts. */
export interface AuthData {
  users: UserRecord[];
  roles: RoleRecord[];
  rolePermissions: { roleId: string; key: string; level: Grant["level"] }[];
  hotels: HotelRecord[];
  memberships: { userId: string; hotelId: string; roleId: string | null; status: "active" | "disabled"; isDefault: boolean; subject: RecordScope | null }[];
  /** The groups a Group Hotel Admin administers (platform.hotel_groups.admin_user_id); optional: most worlds have none. */
  adminGroups?: { id: string; name: string; adminUserId: string; status: string }[];
  userPermissions: { userId: string; hotelId: string; key: string; level: Grant["level"]; granted: boolean }[];
  codes: AuthCodeRecord[];
  sessions: SessionRecord[];
  outbox: OutboxRecord[];
  /** Mails sent per owner (a hotel id or "platform") per UTC day: the daily caps and the monthly usage; with the bounces and complaints the mail services reported (0130). */
  sendCounts: { scope: string; day: string; sent: number; bounced?: number; complained?: number }[];
  /** The suppression list (platform.mail_suppressions). */
  suppressions: SuppressionRecord[];
  /** Hotels whose campaign mail is or was on hold (platform.hotel_mail_holds). */
  mailHolds: MailHoldRecord[];
  /** The mail-events webhooks' receipts (platform.mail_event_receipts, 0136): what was already taken. */
  eventReceipts?: { provider: "ses" | "brevo"; key: string; at: Date }[];
  /** Campaigns being sent now (platform.mail_campaign_runs). */
  campaignRuns: CampaignRunRecord[];
  /** The Super Admin's daily mail cap per hotel. */
  mailCaps: { hotelId: string; cap: number }[];
  /** Sender identities (platform.sender_identities). */
  identities: SenderIdentityRecord[];
  events: AuthEventRecord[];
  audit: AuditRecord[];
  /** Enter-hotel visits (platform.hotel_visits): the session resolver reads them, the console writes them. */
  visits: MemVisit[];
  /** What the Super Admin allows each platform admin inside hotels (platform.platform_admin_hotel_access, 0135); no entry = view, all hotels. */
  adminAccess: { userId: string; level: "none" | "view" | "full"; allHotels: boolean; hotelIds: string[]; reason: string | null; updatedBy: string | null; updatedAt: Date }[];
  /** The "Set up your hotel" checklists (platform.hotel_setup). */
  hotelSetup: HotelSetupRecord[];
  /** Hotel websites (platform.hotel_sites joined with the hotel's slug): the "Website live" switch and the registered domains. */
  sites: { hotelId: string; slug: string; live: boolean; domains: string[] }[];
  /** Website template builds (platform.hotel_site_builds, 0160): each pick of a design and what the build job reported. */
  siteBuilds?: SiteBuildRecord[];
  /** API access keys (platform.api_tokens): the session resolver reads them, the console manages them. */
  apiTokens: ApiTokenRow[];
  /** The Super Admin's switch for FULL access keys (platform.api_access_settings): off until turned on. */
  apiAccess: { fullAccessEnabled: boolean; changedBy: string | null; changedAt: Date | null; reason: string | null };
  /** Platform settings > Security as stored (platform_settings security.*); optional: a world without it uses the defaults. */
  security?: { sessionMinutes?: unknown; tempPasswordMinutes?: unknown };
}

interface MemVisit {
  id: string;
  userId: string;
  hotelId: string;
  sessionId: string | null;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  endedReason: "exit" | "expired" | "signed_out" | "session_ended" | "hotel_unavailable" | "replaced" | "extended" | null;
  /** platform 0135: what the visit may do, fixed when it starts; and the visit it extends. */
  access?: "view" | "full";
  extendedFrom?: string | null;
  endedBy: string | null;
  ip: string | null;
  userAgent: string | null;
}

const emptyAuthData = (): AuthData => ({ users: [], roles: [], rolePermissions: [], hotels: [], memberships: [], userPermissions: [], codes: [], sessions: [], outbox: [], sendCounts: [], suppressions: [], mailHolds: [], campaignRuns: [], mailCaps: [], identities: [], events: [], audit: [], visits: [], adminAccess: [], hotelSetup: [], sites: [], apiTokens: [], apiAccess: { fullAccessEnabled: false, changedBy: null, changedAt: null, reason: null } });

const PLATFORM = "platform";
const clone = <T>(v: T): T => structuredClone(v);

const finishOrder = new WeakMap<AuthData, { touched: Map<string, number>; tick: number }>();

/** The outbox row by id without scanning the whole array each time (a 50,000-row campaign finishes row by row). The map is rebuilt when the array changed size or a row is not found in it. */
const outboxIndex = new WeakMap<AuthData, { size: number; byId: Map<string, OutboxRecord> }>();
function outboxRow(data: AuthData, id: string): OutboxRecord | undefined {
  let idx = outboxIndex.get(data);
  if (!idx || idx.size !== data.outbox.length || !idx.byId.has(id)) {
    idx = { size: data.outbox.length, byId: new Map(data.outbox.map((o) => [o.id, o])) };
    outboxIndex.set(data, idx);
  }
  return idx.byId.get(id);
}

export function memoryAuthRepos(data: AuthData): AuthRepos {
  // the order the outbox rows were last finished in (the double of updated_at): Settings > Email asks for the newest result. Kept per data set, not per unit.
  const order = finishOrder.get(data) ?? { touched: new Map<string, number>(), tick: 0 };
  finishOrder.set(data, order);
  const touched = order.touched;
  const user = (id: string): UserRecord | undefined => data.users.find((u) => u.id === id);

  const siteOf = (s: AuthData["sites"][number] | undefined): HotelSiteRecord | null => {
    const hotel = s ? data.hotels.find((h) => h.id === s.hotelId && h.status !== "deleted") : undefined;
    return s && hotel ? { hotelId: s.hotelId, slug: s.slug, name: hotel.name, status: hotel.status ?? "active", city: null, state: hotel.state ?? null, live: s.live, domains: [...s.domains] } : null;
  };

  // named, so a composed read (access.loadBySession, hotelSetup.find) can call the plain ones
  const repos: AuthRepos = {
    users: {
      async byUsername(lowerName) {
        const found = data.users.find((u) => u.username === lowerName && u.deletedAt === null);
        return found ? clone(found) : null;
      },
      async byEmail(lowerEmail) {
        const found = data.users.find((u) => u.email === lowerEmail && u.deletedAt === null);
        return found ? clone(found) : null;
      },
      async byId(id) {
        const found = user(id);
        return found ? clone(found) : null;
      },
      async update(id, patch) {
        const found = user(id);
        if (!found) throw new RepoError("check", "no such user");
        Object.assign(found, patch);
        // the table's CHECKs
        if ((found.blockedAt === null) !== (found.blockedKind === null)) throw new RepoError("check", "users_blocked_pair");
        if (found.lockLevel < 0 || found.lockLevel > 6) throw new RepoError("check", "lock_level");
        // decision 46: no database rule forces the emailed code any more (users_admin_code_required was dropped by platform migration 0114)
      },
    },
    codes: {
      async byId(id) {
        const found = data.codes.find((c) => c.id === id);
        return found ? clone(found) : null;
      },
      async byHash(purpose, hash) {
        const found = data.codes.find((c) => c.purpose === purpose && c.codeHash === hash);
        return found ? clone(found) : null;
      },
      async replace(row, now) {
        for (const c of data.codes) if (c.userId === row.userId && c.purpose === row.purpose && c.usedAt === null) c.usedAt = now;
        const record: AuthCodeRecord = { ...row, id: randomUUID(), createdAt: now, usedAt: null, attempts: 0, resendCount: 0 };
        if (record.expiresAt <= record.createdAt) throw new RepoError("check", "auth_codes_expiry_after_creation");
        data.codes.push(record);
        return clone(record);
      },
      async update(id, patch) {
        const found = data.codes.find((c) => c.id === id);
        if (!found) throw new RepoError("check", "no such code");
        Object.assign(found, patch);
        if (found.attempts < 0 || found.attempts > 10) throw new RepoError("check", "attempts");
      },
    },
    sessions: {
      async insert(row) {
        const record: SessionRecord = { ...row, id: randomUUID(), revokedAt: null, revokedReason: null };
        // the table's rules: the idle-window ceiling and one active session per user
        if (record.expiresAt.getTime() > (record.lastSeenAt ?? record.issuedAt).getTime() + 120 * 60_000) throw new RepoError("check", "sessions_web_idle_window");
        if (data.sessions.some((s) => s.userId === record.userId && s.revokedAt === null)) throw new RepoError("unique", "sessions_one_active_web_per_user_key");
        if (data.sessions.some((s) => s.tokenHash === record.tokenHash)) throw new RepoError("unique", "sessions_token_hash_key");
        // the backstop trigger sessions_sign_in_allowed (0105, SQLSTATE 42501): no session for an account waiting for approval, or into a hotel that is not active
        if (user(record.userId)?.status === "pending_approval") throw new Error("an account waiting for approval cannot sign in");
        const into = record.hotelId === null ? undefined : data.hotels.find((h) => h.id === record.hotelId);
        if (into && (into.status ?? "active") !== "active") throw new Error("nobody can sign in to a hotel that is not active");
        data.sessions.push(record);
        return clone(record);
      },
      async byTokenHash(hash) {
        const found = data.sessions.find((s) => s.tokenHash === hash);
        return found ? clone(found) : null;
      },
      async update(id, patch) {
        const found = data.sessions.find((s) => s.id === id);
        if (!found) return;
        Object.assign(found, patch);
        if (found.expiresAt.getTime() > (found.lastSeenAt ?? found.issuedAt).getTime() + 120 * 60_000) throw new RepoError("check", "sessions_web_idle_window");
      },
      async revokeActive(userId, reason, now) {
        let n = 0;
        for (const s of data.sessions) {
          if (s.userId !== userId || s.revokedAt !== null) continue;
          s.revokedAt = now;
          s.revokedReason = reason;
          n += 1;
        }
        return n;
      },
      async listActive(userId, now) {
        return data.sessions
          .filter((s) => s.userId === userId && s.revokedAt === null && s.expiresAt > now)
          .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
          .map(clone);
      },
      async revokeOthers(userId, exceptSessionId, reason, now) {
        let n = 0;
        for (const s of data.sessions) {
          if (s.userId !== userId || s.revokedAt !== null || s.id === exceptSessionId) continue;
          s.revokedAt = now;
          s.revokedReason = reason;
          n += 1;
        }
        return n;
      },
      async setLocked(id, at) {
        const found = data.sessions.find((x) => x.id === id);
        if (found && found.revokedAt === null) found.lockedAt = at;
      },
      async setRechecked(id, at) {
        const found = data.sessions.find((x) => x.id === id);
        if (found && found.revokedAt === null) found.recheckedAt = at;
      },
      async revokeById(id, reason, now) {
        const found = data.sessions.find((x) => x.id === id);
        if (found && found.revokedAt === null) {
          found.revokedAt = now;
          found.revokedReason = reason;
        }
      },
    },
    outbox: {
      async enqueue(row, now) {
        if (row.toEmail.length < 3 || row.toEmail.length > 320) throw new RepoError("check", "outbox_to_email_check");
        assertMailRoute(row.kind, row.hotelId);
        // a call made with an API key in test mode: checked as usual, never queued (as in the PostgreSQL repository)
        if (inTestMode()) return;
        data.outbox.push({ ...row, hotelId: row.hotelId ?? null, id: randomUUID(), status: "pending", attempts: 0, nextAttemptAt: now, sentAt: null, createdAt: now, lastError: null });
      },
      async claimDue(now, limit) {
        // the system lane first, then the bulk lane (the same order as the lane-aware worker)
        const pending = data.outbox.filter((o) => o.status === "pending" && o.nextAttemptAt <= now);
        const due = [...pending.filter((o) => laneOf(o.kind) === "system"), ...pending.filter((o) => laneOf(o.kind) === "bulk")].slice(0, limit);
        for (const o of due) o.status = "sending";
        return due.map(clone);
      },
      async claimLane(now, lane, limit, hotelId) {
        const due: OutboxRecord[] = [];
        for (const o of data.outbox) {
          if (due.length >= limit) break;
          if (o.status === "pending" && o.nextAttemptAt <= now && laneOf(o.kind) === lane && (hotelId === undefined || o.hotelId === hotelId)) due.push(o);
        }
        for (const o of due) o.status = "sending";
        return due.map(clone);
      },
      async bulkHotels(now) {
        // in hotel id order, as the PostgreSQL skip scan
        const hotels = new Set<string>();
        for (const o of data.outbox) if (o.status === "pending" && o.nextAttemptAt <= now && laneOf(o.kind) === "bulk" && o.hotelId) hotels.add(o.hotelId);
        return [...hotels].sort().slice(0, 200);
      },
      async sentToday(scopes, day) {
        const out = new Map<string, number>();
        for (const c of data.sendCounts) if (c.day === day && scopes.includes(c.scope)) out.set(c.scope, c.sent);
        return out;
      },
      async addSent(entries) {
        for (const e of entries) {
          const hit = data.sendCounts.find((c) => c.scope === e.scope && c.day === e.day);
          if (hit) hit.sent += e.sent;
          else data.sendCounts.push({ scope: e.scope, day: e.day, sent: e.sent });
        }
      },
      async setCap(hotelId, cap) {
        const i = data.mailCaps.findIndex((c) => c.hotelId === hotelId);
        if (i >= 0) data.mailCaps.splice(i, 1);
        if (cap !== null) data.mailCaps.push({ hotelId, cap });
        return true;
      },
      async usage(fromDay, toDay, scopes) {
        const out = new Map<string, number>();
        for (const c of data.sendCounts) if (c.day >= fromDay && c.day < toDay && scopes.includes(c.scope)) out.set(c.scope, (out.get(c.scope) ?? 0) + c.sent);
        return out;
      },
      async caps(hotelIds) {
        return new Map(data.mailCaps.filter((c) => hotelIds.includes(c.hotelId)).map((c) => [c.hotelId, c.cap]));
      },
      async lastFailure(hotelId) {
        const rows = data.outbox.filter((o) => o.hotelId === hotelId && (o.status === "sent" || o.lastError !== null) && touched.has(o.id)).sort((a, b) => (touched.get(b.id) ?? 0) - (touched.get(a.id) ?? 0));
        const o = rows[0];
        return o && o.status !== "sent" && o.lastError ? { code: o.lastError, at: o.sentAt ?? o.nextAttemptAt } : null;
      },
      async countByTemplate(hotelId, templates) {
        const out = new Map<string, { pending: number; sent: number; failed: number }>();
        for (const o of data.outbox) {
          // campaign mail only, as the PostgreSQL query (it uses the 0121 index outbox_campaign_template_idx, WHERE kind = 'campaign')
          if (o.hotelId !== hotelId || o.kind !== "campaign" || !templates.includes(o.template)) continue;
          const c = out.get(o.template) ?? { pending: 0, sent: 0, failed: 0 };
          if (o.status === "sent") c.sent += 1;
          else if (o.status === "failed") c.failed += 1;
          else c.pending += 1;
          out.set(o.template, c);
        }
        return out;
      },
      async finish(id, outcome) {
        const o = outboxRow(data, id);
        if (!o) return;
        o.status = outcome.status;
        o.attempts = outcome.attempts;
        if (outcome.nextAttemptAt) o.nextAttemptAt = outcome.nextAttemptAt;
        if (outcome.sentAt) o.sentAt = outcome.sentAt;
        o.lastError = outcome.status === "sent" ? null : (outcome.error ?? null);
        touched.set(o.id, ++order.tick);
        // the one-time code only ever lives in the payload: it goes as soon as the mail is sent or has failed for good
        if (outcome.status !== "pending") o.payload = null;
        if (o.status === "sent" !== (o.sentAt !== null)) throw new RepoError("check", "outbox_sent_pair");
        const status = String(o.status);
        if ((status === "pending" || status === "sending") && o.payload === null) throw new RepoError("check", "outbox_payload_while_waiting");
      },
      async bulkWaiting(hotelIds) {
        const out = new Map<string, number>();
        for (const o of data.outbox) if ((o.status === "pending" || o.status === "sending") && laneOf(o.kind) === "bulk" && o.hotelId && hotelIds.includes(o.hotelId)) out.set(o.hotelId, (out.get(o.hotelId) ?? 0) + 1);
        return out;
      },
      async cancelTemplate(hotelId, template) {
        let n = 0;
        for (const o of data.outbox) {
          if (o.hotelId !== hotelId || o.template !== template || o.kind !== "campaign" || o.status !== "pending") continue;
          o.status = "failed";
          o.payload = null;
          o.lastError = "CANCELLED";
          touched.set(o.id, ++order.tick);
          n += 1;
        }
        return n;
      },
      async hotelOf(id) {
        const o = outboxRow(data, id);
        return o ? o.hotelId : undefined;
      },
      async lastHotelMailedTo(email, since) {
        const e = email.trim().toLowerCase();
        let best: OutboxRecord | null = null;
        for (const o of data.outbox) if (o.status === "sent" && o.hotelId && o.sentAt && o.sentAt >= since && o.toEmail.toLowerCase() === e && (!best || (best.sentAt as Date) < o.sentAt)) best = o;
        return best?.hotelId ?? null;
      },
    },
    mailSafety: {
      ready: async () => true,
      async receive(provider, keys, now) {
        // platform.mail_event_receipts (0136): kept seven days, a key received before is not new
        const since = now.getTime() - 7 * 86_400_000;
        data.eventReceipts = (data.eventReceipts ?? []).filter((x) => x.at.getTime() >= since);
        const out = new Set<string>();
        for (const key of new Set(keys)) {
          if (!/^[0-9a-f]{64}$/.test(key)) throw new RepoError("check", "mail_event_receipts_event_key_check");
          if (data.eventReceipts.some((x) => x.provider === provider && x.key === key)) continue;
          data.eventReceipts.push({ provider, key, at: now });
          out.add(key);
        }
        return out;
      },
      async suppress(row, now) {
        const email = row.email.trim().toLowerCase();
        if (email.length < 3 || email.length > 254) throw new RepoError("check", "mail_suppressions_email_check");
        if (data.suppressions.some((s) => s.email === email && s.hotelId === row.hotelId)) return false;
        data.suppressions.push({ ...row, email, id: randomUUID(), createdAt: now });
        return true;
      },
      async unsuppress(id) {
        const i = data.suppressions.findIndex((s) => s.id === id);
        if (i < 0) return null;
        return clone(data.suppressions.splice(i, 1)[0]);
      },
      async suppressions(query) {
        const search = query.search?.trim().toLowerCase() ?? "";
        return data.suppressions
          .filter((s) => (search === "" || s.email.includes(search)) && (!query.before || s.createdAt < query.before.at || (s.createdAt.getTime() === query.before.at.getTime() && s.id < query.before.id)))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
          .slice(0, query.limit)
          .map(clone);
      },
      async suppressedAmong(hotelId, emails) {
        const want = new Set(emails.map((e) => e.trim().toLowerCase()));
        return new Set(data.suppressions.filter((s) => want.has(s.email) && (s.hotelId === null || s.hotelId === hotelId)).map((s) => s.email));
      },
      async addEvents(entries) {
        for (const e of entries) {
          let hit = data.sendCounts.find((c) => c.scope === e.scope && c.day === e.day);
          if (!hit) data.sendCounts.push((hit = { scope: e.scope, day: e.day, sent: 0 }));
          hit.bounced = (hit.bounced ?? 0) + e.bounced;
          hit.complained = (hit.complained ?? 0) + e.complained;
        }
      },
      async rates(hotelId, fromDay) {
        const out = { sent: 0, bounced: 0, complained: 0 };
        for (const c of data.sendCounts) {
          if (c.scope !== hotelId || c.day < fromDay) continue;
          out.sent += c.sent;
          out.bounced += c.bounced ?? 0;
          out.complained += c.complained ?? 0;
        }
        return out;
      },
      async hold(hotelId) {
        const h = data.mailHolds.find((x) => x.hotelId === hotelId);
        return h ? clone(h) : null;
      },
      async holds() {
        return [...data.mailHolds].sort((a, b) => Number(b.releasedAt === null) - Number(a.releasedAt === null) || b.heldAt.getTime() - a.heldAt.getTime()).map(clone);
      },
      async heldAmong(hotelIds) {
        return new Set(data.mailHolds.filter((h) => h.releasedAt === null && hotelIds.includes(h.hotelId)).map((h) => h.hotelId));
      },
      async putOnHold(row, now) {
        const h = data.mailHolds.find((x) => x.hotelId === row.hotelId);
        if (h && h.releasedAt === null) return false;
        if (h) Object.assign(h, { reason: row.reason, detail: row.detail, heldAt: now, heldBy: row.heldBy, releasedAt: null, releasedBy: null, releaseReason: null });
        else data.mailHolds.push({ ...row, heldAt: now, releasedAt: null, releasedBy: null, releaseReason: null, countedFrom: null });
        return true;
      },
      async release(hotelId, by, reason, now) {
        const h = data.mailHolds.find((x) => x.hotelId === hotelId && x.releasedAt === null);
        if (!h) return false;
        Object.assign(h, { releasedAt: now, releasedBy: by, releaseReason: reason, countedFrom: now });
        return true;
      },
    },
    campaignRuns: {
      async start(hotelId, campaignId, now) {
        const r = data.campaignRuns.find((x) => x.hotelId === hotelId && x.campaignId === campaignId);
        if (r) r.state = "sending";
        else data.campaignRuns.push({ hotelId, campaignId, state: "sending", startedAt: now });
      },
      async setState(hotelId, campaignId, state) {
        const r = data.campaignRuns.find((x) => x.hotelId === hotelId && x.campaignId === campaignId);
        if (r) r.state = state;
      },
      async end(hotelId, campaignId) {
        data.campaignRuns = data.campaignRuns.filter((x) => !(x.hotelId === hotelId && x.campaignId === campaignId));
      },
      async active() {
        return [...data.campaignRuns].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()).map(clone);
      },
    },
    identities: {
      async get(scope) {
        const r = data.identities.find((i) => i.scope === scope);
        return r ? clone(r) : null;
      },
      async list() {
        return data.identities.map(clone);
      },
      async save(scope, patch) {
        let r = data.identities.find((i) => i.scope === scope);
        if (!r) {
          if (patch.domain === undefined) throw new RepoError("check", "sender_identities_domain");
          r = { scope, domain: patch.domain, fromAddress: null, dkimTokens: [], sesConfirmed: false, status: "pending", checkedAt: null, result: null };
          data.identities.push(r);
        } else if (patch.domain !== undefined && patch.domain !== r.domain) {
          // a new domain starts again: the old DKIM names, confirmation and check do not describe it
          Object.assign(r, { domain: patch.domain, dkimTokens: [], sesConfirmed: false, status: "pending", checkedAt: null, result: null });
        }
        const { domain: _domain, ...rest } = patch;
        void _domain;
        Object.assign(r, clone(rest));
        return clone(r);
      },
      async remove(scope) {
        const i = data.identities.findIndex((x) => x.scope === scope);
        if (i >= 0) data.identities.splice(i, 1);
      },
    },
    events: {
      async event(row) {
        data.events.push(clone(row));
      },
      async audit(row) {
        data.audit.push(clone(row));
      },
    },
    access: {
      async load(userId, hotelId): Promise<AccessRecord | null> {
        const found = user(userId);
        if (!found || found.deletedAt !== null) return null;
        // as the PostgreSQL loader: a console account (Super, Platform, Group Hotel Admin) has no hotel membership; an active hotel comes before the default one
        const consoleRole = found.accountRole === "super_admin" || found.accountRole === "platform_admin" || found.accountRole === "group_hotel_admin";
        const mine = consoleRole ? [] : data.memberships.filter((m) => m.userId === userId && m.status === "active");
        const live = (m: (typeof mine)[number]): boolean => (data.hotels.find((h) => h.id === m.hotelId)?.status ?? "active") === "active";
        const membership = hotelId ? mine.find((m) => m.hotelId === hotelId) : (mine.find((m) => live(m) && m.isDefault) ?? mine.find(live) ?? mine.find((m) => m.isDefault) ?? mine[0]);
        if (hotelId && !membership) return null;
        // as the PostgreSQL loader (h.deleted_at IS NULL): a hotel deleted for good is no longer anybody's hotel
        const hotel = membership ? (data.hotels.find((h) => h.id === membership.hotelId && h.status !== "deleted") ?? null) : null;
        if (membership && !hotel) return null;
        const roleId = membership?.roleId ?? found.roleId;
        const role = data.roles.find((r) => r.id === roleId);
        if (!role) return null;
        const ladder = data.roles.filter((r) => r.hotelId === null || r.hotelId === hotel?.id);
        const own = (id: string): Grant[] => data.rolePermissions.filter((p) => p.roleId === id).map((p) => ({ key: p.key, level: p.level }));
        return {
          user: clone(found),
          hotel: hotel ? clone(hotel) : null,
          role: clone(role),
          grants: foldRoleGrants(role, ladder, own),
          overrides: data.userPermissions.filter((p) => p.userId === userId && p.hotelId === hotel?.id).map((p) => ({ key: p.key, level: p.level, granted: p.granted })),
          ...(membership?.subject ? { scope: clone(membership.subject) } : {}),
        };
      },
      async portalHotels(userId, kind) {
        return data.memberships
          .filter((m) => m.userId === userId && m.status === "active" && m.subject !== null && m.subject.kind === kind)
          .flatMap((m) => {
            const hotel = data.hotels.find((h) => h.id === m.hotelId);
            return hotel && m.subject ? [{ hotelId: m.hotelId, hotelName: hotel.name, subjectId: m.subject.id }] : [];
          })
          .sort((a, b) => a.hotelName.localeCompare(b.hotelName));
      },
      async entryHotelId(slug) {
        const site = data.sites.find((s) => s.slug === slug && s.live);
        const hotel = site ? data.hotels.find((h) => h.id === site.hotelId) : undefined;
        return hotel && (hotel.status ?? "active") === "active" ? hotel.id : null;
      },
      async adminGroup(userId) {
        const g = (data.adminGroups ?? []).find((x) => x.adminUserId === userId);
        return g ? { id: g.id, name: g.name, status: g.status } : null;
      },
      async loadVisit(userId, hotelId): Promise<AccessRecord | null> {
        const found = user(userId);
        if (!found || found.deletedAt !== null) return null;
        const hotel = data.hotels.find((h) => h.id === hotelId && h.status !== "deleted");
        const role = data.roles.find((r) => r.hotelId === null && r.key === "super_admin");
        if (!hotel || !role) return null;
        const ladder = data.roles.filter((r) => r.hotelId === null || r.hotelId === hotel.id);
        const own = (id: string): Grant[] => data.rolePermissions.filter((p) => p.roleId === id).map((p) => ({ key: p.key, level: p.level }));
        return { user: clone(found), hotel: clone(hotel), role: clone(role), grants: foldRoleGrants(role, ladder, own), overrides: [] };
      },
      async loadBySession(tokenHash, at) {
        // composed from the reads above (no state of its own): what the one PostgreSQL statement answers
        const session = await repos.sessions.byTokenHash(tokenHash);
        if (!session) return null;
        const access = await repos.access.load(session.userId, session.hotelId);
        const platform = access !== null && (access.user.accountRole === "platform_admin" || access.user.accountRole === "super_admin" || access.user.accountRole === "group_hotel_admin");
        const visit = platform ? await repos.visits.activeForSession(session.id, at) : null;
        const visitAccess = visit ? await repos.access.loadVisit(session.userId, visit.hotelId) : null;
        return { session, access, visit, visitAccess, sessionLimits: data.security?.sessionMinutes ?? null };
      },
      async security() {
        return { sessionMinutes: data.security?.sessionMinutes ?? null, tempPasswordMinutes: data.security?.tempPasswordMinutes ?? null };
      },
    },
    sites: {
      async bySlug(slug) {
        return siteOf(data.sites.find((s) => s.slug === slug));
      },
      async byHotel(hotelId) {
        return siteOf(data.sites.find((s) => s.hotelId === hotelId));
      },
      async byDomain(host) {
        return siteOf(data.sites.find((s) => s.domains.includes(host)));
      },
      async save(hotelId, next) {
        const taken = next.domains.filter((d) => data.sites.some((s) => s.hotelId !== hotelId && s.domains.includes(d)));
        if (taken.length > 0) return { taken };
        const row = data.sites.find((s) => s.hotelId === hotelId);
        if (row) {
          row.live = next.live;
          row.domains = [...next.domains];
        } else {
          const hotel = data.hotels.find((h) => h.id === hotelId);
          data.sites.push({ hotelId, slug: String((hotel as unknown as { slug?: string })?.slug ?? hotelId), live: next.live, domains: [...next.domains] });
        }
        return { taken: [] };
      },
    },
    siteBuilds: {
      async byId(id) {
        const x = (data.siteBuilds ?? []).find((b) => b.id === id);
        return x ? clone(x) : null;
      },
      async recent(hotelId, limit) {
        return clone((data.siteBuilds ?? []).filter((b) => b.hotelId === hotelId).sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()).slice(0, limit));
      },
      async queue(hotelId, templateKey, by, now) {
        const rows = (data.siteBuilds ??= []);
        // the partial unique index of migration 0160: one queued or building build per hotel
        if (rows.some((b) => b.hotelId === hotelId && (b.status === "queued" || b.status === "building"))) return null;
        const row: SiteBuildRecord = { id: randomUUID(), hotelId, templateKey, status: "queued", message: null, runUrl: null, siteUrl: null, requestedBy: by, requestedAt: now, startedAt: null, finishedAt: null };
        rows.push(row);
        return clone(row);
      },
      async advance(id, next, now) {
        const row = (data.siteBuilds ?? []).find((b) => b.id === id);
        if (!row) return null;
        const allowed = next.status === "building" ? row.status === "queued" : row.status === "queued" || row.status === "building";
        if (!allowed) return null;
        row.status = next.status;
        row.message = next.message;
        if (next.runUrl !== null) row.runUrl = next.runUrl;
        if (next.siteUrl !== null) row.siteUrl = next.siteUrl;
        row.startedAt ??= now;
        if (next.status !== "building") row.finishedAt = now;
        return clone(row);
      },
      async failStale(hotelId, before, message, now) {
        let n = 0;
        for (const b of data.siteBuilds ?? []) {
          if (b.hotelId !== hotelId || (b.status !== "queued" && b.status !== "building") || b.requestedAt >= before) continue;
          b.status = "failed";
          b.message = message;
          b.finishedAt = now;
          n++;
        }
        return n;
      },
    },
    apiTokens: {
      async byHash(hash) {
        const x = data.apiTokens.find((t) => t.tokenHash === hash);
        return x ? clone({ id: x.id, name: x.name, level: x.level, scope: x.scope, hotelId: x.hotelId, testMode: x.testMode, callsPerMinute: x.callsPerMinute, ipAllow: x.ipAllow, ipSeen: x.ipSeen, createdBy: x.createdBy, expiresAt: x.expiresAt, revokedAt: x.revokedAt }) : null;
      },
      async fullAccessEnabled() {
        return data.apiAccess.fullAccessEnabled;
      },
      async list() {
        return clone([...data.apiTokens].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 200));
      },
      async insert(row, now) {
        if (data.apiTokens.some((t) => t.tokenHash === row.tokenHash)) throw new RepoError("unique", "api_tokens_hash_unique");
        // the same rules the database CHECKs state (migration 0129), so a test that breaks one fails here as it would there
        if (row.level === "full" && (row.ipAllow.length < 1 || !row.reason)) throw new RepoError("check", "api_tokens_full_ip");
        if (row.level === "ai" && (row.scope !== "all" || !row.reason)) throw new RepoError("check", "api_tokens_ai_scope");
        const days = row.level === "full" ? 1 : row.level === "ai" ? 3660 : 30;
        if (!(row.expiresAt.getTime() > now.getTime() && row.expiresAt.getTime() <= now.getTime() + days * 86_400_000)) throw new RepoError("check", "api_tokens_expiry_max");
        if ((row.scope === "hotel") !== (row.hotelId !== null)) throw new RepoError("check", "api_tokens_hotel_scope");
        const made: ApiTokenRow = { ...clone(row), id: randomUUID(), ipSeen: [], createdAt: now, lastUsedAt: null, lastIp: null, callsDay: null, callsCount: 0, revokedAt: null, revokedBy: null };
        data.apiTokens.push(made);
        return clone(made);
      },
      async countActive(now) {
        return data.apiTokens.filter((t) => t.revokedAt === null && t.expiresAt > now).length;
      },
      async revoke(id, by, now) {
        const x = data.apiTokens.find((t) => t.id === id);
        if (!x || x.revokedAt !== null) return false;
        x.revokedAt = now;
        x.revokedBy = by;
        return true;
      },
      async revokeAll(by, now) {
        let n = 0;
        for (const x of data.apiTokens) if (x.revokedAt === null) { x.revokedAt = now; x.revokedBy = by; n++; }
        return n;
      },
      async accessSettings() {
        return clone(data.apiAccess);
      },
      async setFullAccess(enabled, by, reason, now) {
        data.apiAccess = { fullAccessEnabled: enabled, changedBy: by, changedAt: now, reason };
      },
      async recordUse(id, use) {
        const x = data.apiTokens.find((t) => t.id === id);
        if (!x) return;
        x.lastUsedAt = use.at;
        x.lastIp = use.ip;
        x.callsCount = x.callsDay === use.day ? x.callsCount + 1 : 1;
        x.callsDay = use.day;
        if (use.ip !== null && !x.ipSeen.includes(use.ip)) x.ipSeen = [...x.ipSeen, use.ip].slice(-20);
      },
    },
    visits: {
      async endForSession(sessionId, reason, by, now) {
        const open = data.visits.filter((x) => x.sessionId === sessionId && x.endedAt === null);
        for (const v of open) Object.assign(v, { endedAt: now, endedReason: reason, endedBy: by });
        return open.map((v) => ({ id: v.id, hotelId: v.hotelId, live: v.expiresAt > now }));
      },
      async activeForSession(sessionId, now) {
        const v = data.visits.find((x) => x.sessionId === sessionId && x.endedAt === null && x.expiresAt > now);
        const hotel = v ? data.hotels.find((h) => h.id === v.hotelId) : undefined;
        return v && hotel ? { id: v.id, hotelId: v.hotelId, hotelName: hotel.name, expiresAt: v.expiresAt, access: v.access ?? "view" } : null;
      },
    },
    hotelSetup: {
      async get(hotelId) {
        const row = data.hotelSetup.find((x) => x.hotelId === hotelId);
        return row ? clone(row) : null;
      },
      async find(hotelId) {
        return repos.hotelSetup.get(hotelId);
      },
      async create(hotelId) {
        if (!data.hotelSetup.some((x) => x.hotelId === hotelId)) data.hotelSetup.push({ hotelId, status: "pending", steps: {}, hidden: false, doneAt: null });
      },
      async save(hotelId, next) {
        const row = data.hotelSetup.find((x) => x.hotelId === hotelId);
        if (!row) throw new Error("hotel_setup: no row for this hotel");
        if ((next.status === "done" || next.status === "skipped") !== (next.doneAt !== null)) throw new RepoError("check", "hotel_setup_done_fields");
        Object.assign(row, { status: next.status, steps: clone(next.steps), hidden: next.hidden, doneAt: next.doneAt });
        return clone(row);
      },
    },
  };
  return repos;
}

/** A store and a platform unit for sign-in, for tests and for running the app before the PostgreSQL repositories exist. */
export function createMemoryAuth(): { store: MemoryStore<AuthData>; unit: PlatformUnit; data: () => AuthData } {
  const store = new MemoryStore<AuthData>(emptyAuthData);
  return {
    store,
    data: () => store.dataFor(PLATFORM),
    // `read` is the same exclusive call: the memory double has no cheaper way to read, and a test may count either
    unit: { run: (work) => store.exclusive(PLATFORM, (data) => work(memoryAuthRepos(data))), read: (work) => store.exclusive(PLATFORM, (data) => work(memoryAuthRepos(data))) },
  };
}

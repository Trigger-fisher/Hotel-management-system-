import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { getDatabase } from "../../db";
import type { SqlClient } from "../../db/types";
import { boxOfTarget, liveWaInbox } from "../live/liveStores";
import { createPgWhatsAppHoldStore, createPgWhatsAppRoutingStore } from "../repos/postgres/whatsappRouting";
import { createPgWhatsAppInbox } from "../repos/postgres/whatsappInbox";
import { createPgMoveStore } from "../repos/postgres/whatsappMove";
import { createPlatformUnit } from "../repos/postgres/platformUnit";
import { whatsappConfig } from "../whatsapp/config";
import { createGraphClient, type SendOutcome } from "../whatsapp/graph";
import { createInboundHandler, type WaInboundNotifier } from "../whatsapp/inbound";
import { isLanguage, type Language } from "../whatsapp/language";
import type { WaLine } from "../whatsapp/ports";
import { createEventProcessor, LockTimeout, nextStatus, type WaEventHandlers, type WaGuestLock, type WhatsAppEventProcessor } from "../whatsapp/processor";
import { openToken } from "../whatsapp/seal";
import { publishConvChanges } from "./convLive";
import { getWhatsAppStores } from "./whatsapp";
import { inBackupWindow, runWhatsAppBackup } from "./whatsappBackup";
import { createMediaCapturer, purgeWhatsAppMedia } from "./whatsappMedia";

// The composition of the WhatsApp processor (phase 1 tasks 5, 7 and 9): the handlers on PostgreSQL, the notifier that talks to the guest on the line's own token, the per-guest lock and the sweep.
// Everything runs only when WhatsApp is set up AND the kill switch (platform setting whatsapp.enabled) is on; otherwise saved events simply wait.
const pool = () => getDatabase().pool;
const platformUnit = () => createPlatformUnit(pool(), (db) => db);

interface Settings {
  enabled: boolean;
  mode: "strict" | "balanced";
  timeframeMinutes: number;
  holdMinutes: number;
  defaultLanguage: Language;
}

async function readSettings(): Promise<Settings> {
  const rows = await platformUnit().read((db) => db.query("SELECT key, value FROM platform.platform_settings WHERE key IN ('whatsapp.enabled', 'whatsapp.routing_mode', 'whatsapp.routing_timeframe_minutes', 'whatsapp.hold_minutes', 'whatsapp.default_language')"));
  const v = new Map(rows.rows.map((r) => [String(r.key), r.value]));
  const n = (key: string, fallback: number): number => (typeof v.get(key) === "number" ? (v.get(key) as number) : fallback);
  const language = v.get("whatsapp.default_language");
  return { enabled: v.get("whatsapp.enabled") === true, mode: v.get("whatsapp.routing_mode") === "balanced" ? "balanced" : "strict", timeframeMinutes: n("whatsapp.routing_timeframe_minutes", 120), holdMinutes: n("whatsapp.hold_minutes", 10), defaultLanguage: isLanguage(language) ? language : "en" };
}

/** One guest at a time per line, across every server instance: a PostgreSQL advisory lock held in a transaction while the work runs. A lock not free in time is a LockTimeout (a retry, not a failure). */
function createPgGuestLock(): WaGuestLock {
  return async (lineId, guestKey, waitMs, work) => {
    const client = await pool().connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL lock_timeout = ${Math.max(1, Math.floor(waitMs))}`);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`whatsapp:${lineId}:${guestKey}`]);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => (broken = true));
        if ((error as { code?: string }).code === "55P03") throw new LockTimeout();
        throw error;
      }
      try {
        const result = await work();
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => (broken = true));
        throw error;
      }
    } finally {
      client.release(broken);
    }
  };
}

const FAILURE_CODES: Record<string, string> = { "131047": "REENGAGEMENT_WINDOW_CLOSED", "131026": "UNDELIVERABLE", "131049": "NOT_DELIVERED_QUALITY", "131050": "GUEST_OPTED_OUT", "131021": "SAME_NUMBER", "131051": "UNSUPPORTED_TYPE", "132000": "TEMPLATE_PARAMETERS" };
const failureOf = (errors: { code: string }[]): string => FAILURE_CODES[errors[0]?.code ?? ""] ?? "DELIVERY_FAILED";

/** Talks to a guest on a line with the line's own token. Policy and unclear outcomes are NOT retried (a notice twice is worse than none); network and token problems are thrown so the event is retried. */
function createNotifier(): WaInboundNotifier {
  const graph = createGraphClient({ graphVersion: whatsappConfig()?.graphVersion });
  const withToken = async (line: WaLine, send: (token: string) => Promise<SendOutcome>): Promise<{ wamid: string | null }> => {
    const cfg = whatsappConfig();
    if (!cfg) throw new Error("WhatsApp is not configured");
    const r = await platformUnit().read((db) => db.query("SELECT token_secret FROM platform.whatsapp_lines WHERE id = $1", [line.id]));
    if (!r.rows[0]) throw new Error("line not found");
    const outcome = await send(openToken(cfg.sealKey, String(r.rows[0].token_secret), line.phoneNumberId));
    if (outcome.kind === "ok") return { wamid: outcome.wamid };
    if (outcome.kind === "transient" || outcome.kind === "auth") throw new Error(outcome.code);
    return { wamid: null };
  };
  return {
    askHotel: (line, to, q) => withToken(line, (token) => (q.kind === "text" ? graph.sendText(token, line.phoneNumberId, to, q.body) : graph.sendInteractive(token, line.phoneNumberId, to, q.interactive))),
    tell: async (line, to, body) => void (await withToken(line, (token) => graph.sendText(token, line.phoneNumberId, to, body))),
    hotelNames: async (ids) => {
      if (ids.length === 0) return [];
      const r = await platformUnit().read((db) => db.query("SELECT id, name FROM platform.hotels WHERE id = ANY($1::uuid[])", [ids as string[]]));
      const byId = new Map(r.rows.map((x) => [String(x.id), String(x.name)]));
      return ids.map((id) => byId.get(id) ?? "Hotel");
    },
  };
}

const TEMPLATE_STATUS: Record<string, string> = { APPROVED: "approved", REJECTED: "rejected", PAUSED: "paused", DISABLED: "paused", PENDING: "pending", IN_APPEAL: "pending" };

function createHandlers(): WaEventHandlers {
  const database = getDatabase();
  const routing = createPgWhatsAppRoutingStore(database.pool);
  const holds = createPgWhatsAppHoldStore(database.pool);
  const inbox = liveWaInbox(createPgWhatsAppInbox({ pool: database.pool, withHotel: database.withHotel }), publishConvChanges);
  const notifier = createNotifier();
  const key = (): Buffer => {
    const cfg = whatsappConfig();
    if (!cfg) throw new Error("WhatsApp is not configured");
    return cfg.hashKey;
  };
  const inbound = createInboundHandler({
    routing,
    holds,
    inbox,
    notifier,
    media: createMediaCapturer(),
    hashKey: key,
    sealKey: () => (whatsappConfig() as NonNullable<ReturnType<typeof whatsappConfig>>).sealKey,
    settings: async () => {
      const s = await readSettings();
      return { mode: s.mode, timeframeMinutes: s.timeframeMinutes, holdMinutes: s.holdMinutes, defaultLanguage: s.defaultLanguage };
    },
  });

  return {
    message: inbound.message,

    // a delivery state of a message HMS sent: found through the message index (line + wamid -> hotel or platform); a status that beats its message is parked by the processor
    async status({ event, line }) {
      // (the line is the one the status arrived on)
      const owner = await routing.messageOwner(line.id, event.wamid);
      if (!owner) return { kind: "park" };
      // the tick moves on the open pages too (the conversation's id only)
      const apply = async (db: SqlClient, prefix: string): Promise<{ moved: string | null } | null> => {
        const row = (await db.query(`SELECT status, conversation_id FROM ${prefix}conv_messages WHERE channel = 'whatsapp' AND external_id = $1`, [event.wamid])).rows[0];
        if (!row) return null;
        const next = nextStatus(String(row.status), event.status);
        if (next === String(row.status)) return { moved: null };
        await db.query(`UPDATE ${prefix}conv_messages SET status = $2, failure_code = $3 WHERE channel = 'whatsapp' AND external_id = $1`, [event.wamid, next, next === "failed" ? failureOf(event.errors) : null]);
        return { moved: String(row.conversation_id) };
      };
      const found = owner.hotelId ? await database.withHotel({ hotelId: owner.hotelId }, (tx) => apply(tx, "")) : await platformUnit().run((db) => apply(db, "platform."));
      if (found?.moved) publishConvChanges([{ box: boxOfTarget(owner.hotelId ? { kind: "hotel", hotelId: owner.hotelId } : { kind: "platform" }), ids: [found.moved], what: "status" }]);
      return found ? { kind: "done" } : { kind: "park" };
    },

    // template approvals reach every hotel that uses the line; number changes update the line's own health
    async other({ event, line }) {
      const value = event.value as Record<string, unknown>;
      if (event.kind === "template") {
        const status = TEMPLATE_STATUS[String(value.event ?? "").toUpperCase()];
        const name = typeof value.message_template_name === "string" ? value.message_template_name : null;
        const language = typeof value.message_template_language === "string" ? value.message_template_language : null;
        if (!status || !name || !language) return { kind: "done" };
        const reason = typeof value.reason === "string" && value.reason !== "NONE" ? value.reason.slice(0, 300) : null;
        const hotels = await platformUnit().read((db) => db.query("SELECT DISTINCT hotel_id FROM platform.whatsapp_line_hotels WHERE line_id = $1 AND valid_to IS NULL", [line.id]));
        for (const h of hotels.rows) {
          await database.withHotel({ hotelId: String(h.hotel_id) }, (tx) => tx.query("UPDATE wa_templates SET status = $3, status_reason = $4 WHERE name = $1 AND (language = $2 OR (language = 'hinglish' AND $2 = 'en')) AND (line_id IS NULL OR line_id = $5)", [name, language, status, reason, line.id]));
        }
        return { kind: "done" };
      }
      const tier = typeof value.current_limit === "string" ? value.current_limit.slice(0, 40) : null;
      if (tier) await platformUnit().run((db) => db.query("UPDATE platform.whatsapp_lines SET messaging_tier = $2 WHERE id = $1", [line.id, tier]));
      return { kind: "done" };
    },
  };
}

let processor: WhatsAppEventProcessor | undefined;
export function getWhatsAppProcessor(): WhatsAppEventProcessor {
  const stores = getWhatsAppStores();
  processor ??= createEventProcessor({
    events: stores.events,
    lines: stores.lines,
    handlers: createHandlers(),
    sealKey: () => whatsappConfig()?.sealKey ?? null,
    enabled: async () => (await readSettings()).enabled,
    lock: createPgGuestLock(),
  });
  return processor;
}

/** After Meta has been answered, process what was just saved (plain `after()` on Vercel; outside a request at once). Its failure never reaches Meta: the sweep finds the events anyway. */
export function wakeWhatsAppProcessor(): void {
  const work = async (): Promise<void> => {
    await getWhatsAppProcessor().runBatch(20);
  };
  try {
    after(() => work().catch(() => undefined));
  } catch {
    void work().catch(() => undefined);
  }
}

export interface WhatsAppSweepResult {
  events: Awaited<ReturnType<WhatsAppEventProcessor["runBatch"]>>;
  holdsExpired: number;
  purged: { done: number; failed: number; index: number; selections: number };
  /** Hotels whose transition days ended and whose move became final in this sweep. */
  movesFinished: number;
  /** Running campaigns that took a turn in this sweep, and the messages they sent. */
  campaigns: { campaigns: number; sent: number };
  /** Kept files removed because they were older than the keep time. */
  mediaPurged: number;
  /** Encrypted backups written in this sweep (only in the nightly window). */
  backupWritten: number;
}

/**
 * May this call run the sweep? Vercel Cron sends CRON_SECRET (the route also takes it through getCron().authorize); the database scheduler (pg_cron) sends WHATSAPP_SWEEP_KEY, a key of its own
 * that opens THIS route only (CRON_SECRET is stored unreadable on the host, and a scheduler inside the database should not hold the key to every job). At least 32 characters, constant time.
 */
export function sweepKeyMatches(authorization: string | null, env: Record<string, string | undefined> = process.env): boolean {
  const key = (env.WHATSAPP_SWEEP_KEY ?? "").trim();
  if (key.length < 32 || authorization === null) return false;
  const a = createHash("sha256").update(authorization).digest();
  const b = createHash("sha256").update(`Bearer ${key}`).digest();
  return timingSafeEqual(a, b);
}

const NOTHING: WhatsAppSweepResult = { events: { active: false, taken: 0, done: 0, parked: 0, retried: 0, dead: 0 }, holdsExpired: 0, purged: { done: 0, failed: 0, index: 0, selections: 0 }, movesFinished: 0, campaigns: { campaigns: 0, sent: 0 }, mediaPurged: 0, backupWritten: 0 };

/** The background lane (plan part 17): events due, held questions expired, old rows purged. Run by the minute from the database scheduler (pg_cron), on traffic, by hand, and once a day by Vercel as the backstop. */
export async function runWhatsAppSweep(): Promise<WhatsAppSweepResult> {
  // not set up: nothing was ever saved, so there is nothing to do (and no database work for a call every minute)
  if (!whatsappConfig()) return NOTHING;
  const stores = getWhatsAppStores();
  const events = await getWhatsAppProcessor().runBatch(50);
  const now = new Date();
  const holds = createPgWhatsAppHoldStore(pool());
  const holdsExpired = await holds.removeExpired(now);
  const purged = await stores.events.purge(now);
  const cleanup = await platformUnit().run(async (db) => {
    const index = await db.query("DELETE FROM platform.whatsapp_message_index WHERE created_at < now() - interval '30 days'");
    const selections = await db.query("DELETE FROM platform.whatsapp_selections WHERE expires_at < now()");
    return { index: index.affectedRows, selections: selections.affectedRows };
  });
  // a cut-over whose days are over becomes final (a failure here never costs the rest of the sweep)
  const moved = await createPgMoveStore(pool()).finishDue(now).catch(() => 0);
  // the next few guests of every running campaign (a campaign is spread over many sweeps; one that fails never stops the sweep)
  const { runWhatsAppCampaigns } = await import("./whatsappCampaigns");
  const campaigns = await runWhatsAppCampaigns();
  // kept files older than the keep time leave the bucket (checked about once an hour, not every minute: listing a bucket costs a call)
  const mediaPurged = now.getMinutes() === 7 ? await purgeWhatsAppMedia(now) : 0;
  // the nightly encrypted copy of the WhatsApp chats: from 3 am to 5 am India time, a few scopes a minute until each has today's file
  const backup = inBackupWindow(now) ? await runWhatsAppBackup(now, 3) : null;
  return { events, holdsExpired, purged: { ...purged, ...cleanup }, movesFinished: moved, campaigns, mediaPurged, backupWritten: backup?.written ?? 0 };
}

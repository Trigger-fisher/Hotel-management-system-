import "server-only";
import { createHash } from "node:crypto";
import type { ClientPool, WithHotel } from "../../../db/withHotel";
import { hashNumber } from "../../whatsapp/config";
import type { WaLineKind, WaLineStatus } from "../../whatsapp/ports";
import type { MessagePatch, MessageStatus, PendingMessage, RuleLayers, SendLine, SendScope, StoredMessage, TemplateCategory, TemplateStatus, UsageCategory, UsageDelta, WaRuleName, WaRules, WaSendStore, WindowInfo } from "../../whatsapp/sendPorts";

// The PostgreSQL side of the send pipeline's store (plan parts 8, 12, 13; the port is whatsapp/sendPorts.ts, the in-memory reference sendMemory.ts). A hotel's rows (conv_messages, wa_usage,
// wa_optouts, wa_templates, customers, stays) are reached ONLY inside withHotel; the platform line's conversation is the platform.conv_* tables; lines, rules, suppressions, the message index and
// guest_hotels are platform tables on the raw pool. Nothing here logs, and no number or text leaves a row it belongs in (the index and the suppressions hold ids and keyed hashes only).
//   - The message id: the caller's request id when it is a UUID, else a UUID derived from it (SHA-256), so one request is one conv_messages.id and a repeat finds the same row (INSERT .. ON CONFLICT (id)).
//   - A pending row has external_id "pending:<id>" (conv_messages.external_id is NOT NULL and unique with the channel); the wamid replaces it when Meta accepts the message.
//   - failure_code is stored in the column's own shape (A-Z and _ only) and handed back lower case.
//   - The platform conversation tables have no wa_usage (migration 0182 gave them line_id): platform sends are not counted (the hotel bill-back is the only consumer).
const DEFAULT_ZONE = "Asia/Kolkata";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RULE_TYPES: Readonly<Record<WaRuleName, "boolean" | "number">> = {
  hotel_may_start_chats: "boolean",
  recipients_stay_guests_only: "boolean",
  templates_only_for_new_messages: "boolean",
  marketing_allowed: "boolean",
  daily_cap: "number",
  consent_required_for_automatic: "boolean",
  hotel_label_on_messages: "boolean",
  platform_blocklist_enabled: "boolean",
  wrong_hotel_button: "boolean",
};

type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export interface PgSendStoreDeps {
  pool: ClientPool;
  withHotel: WithHotel;
  /** The server hash key (whatsappConfig().hashKey): the suppression list holds keyed hashes, never numbers. */
  hashKey: Buffer;
}

/** The conv_messages id for a request id. */
export function messageIdOf(requestId: string): string {
  if (UUID.test(requestId)) return requestId.toLowerCase();
  const h = createHash("sha256").update(`whatsapp-send:${requestId}`, "utf8").digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The calendar day (YYYY-MM-DD) of `now` in an IANA zone; a zone the runtime does not know falls back to Asia/Kolkata. */
export function localDay(now: Date, zone: string): string {
  const fmt = (z: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  try {
    return fmt(zone);
  } catch {
    return fmt(DEFAULT_ZONE);
  }
}

const codeToColumn = (code: string): string => code.toUpperCase().replace(/[^A-Z_]/g, "_").slice(0, 40) || "UNKNOWN";
const codeFromColumn = (code: unknown): string | null => (typeof code === "string" ? code.toLowerCase() : null);
const last10 = (digits: string): string => digits.slice(-10);
const truncate = (s: string | null, n: number): string | null => (s === null ? null : s.slice(0, n));

function lineOf(r: Record<string, unknown>): SendLine {
  return { id: String(r.id), kind: String(r.kind) as WaLineKind, phoneNumberId: String(r.phone_number_id), wabaId: String(r.waba_id), status: String(r.status) as WaLineStatus, sealedToken: String(r.token_secret) };
}

/** Only the known switches with the right type survive (a settings row is data, not trusted shape). */
function rulesOf(value: unknown): Partial<WaRules> {
  const out: Record<string, boolean | number> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  for (const name of Object.keys(RULE_TYPES) as WaRuleName[]) {
    const v = (value as Record<string, unknown>)[name];
    if (typeof v === RULE_TYPES[name]) out[name] = v as boolean | number;
  }
  return out as Partial<WaRules>;
}

export function createPgWhatsAppSendStore(deps: PgSendStoreDeps): WaSendStore {
  const { pool, withHotel } = deps;
  /** One transaction on the raw pool (platform tables as hms_app). */
  async function onPool<T>(work: (q: Query) => Promise<T>, tx = false): Promise<T> {
    const client = await pool.connect();
    let broken = false;
    const onError = (): void => {
      broken = true;
    };
    client.on("error", onError);
    try {
      const q: Query = async (text, params) => (await client.query(text, params)).rows;
      if (!tx) return await work(q);
      await client.query("BEGIN");
      try {
        const result = await work(q);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {
          broken = true;
        });
        throw error;
      }
    } finally {
      client.removeListener("error", onError);
      client.release(broken);
    }
  }
  const inHotel = <T>(hotelId: string, work: (q: Query) => Promise<T>): Promise<T> => withHotel({ hotelId }, (tx) => work(async (text, params) => (await tx.query(text, params)).rows));
  /** The scope's own conversation tables: a hotel's in its schema (search path), the platform's qualified. */
  const inScope = <T>(scope: SendScope, work: (q: Query, t: string) => Promise<T>): Promise<T> =>
    scope.kind === "hotel" ? inHotel(scope.hotelId, (q) => work(q, "")) : onPool((q) => work(q, "platform."), true);

  const hotelZone = async (hotelId: string): Promise<string> => {
    const rows = await onPool((q) => q("SELECT timezone FROM platform.hotels WHERE id = $1", [hotelId]));
    return typeof rows[0]?.timezone === "string" ? rows[0].timezone : DEFAULT_ZONE;
  };
  const conversationOf = async (q: Query, t: string, digits: string): Promise<{ id: string; closes: Date | null } | null> => {
    const rows = await q(
      `SELECT c.id, c.wa_window_closes_at FROM ${t}conv_contact_handles h JOIN ${t}conv_contacts ct ON ct.id = h.contact_id JOIN ${t}conv_conversations c ON c.contact_id = ct.id
        WHERE h.kind = 'phone' AND right(h.value, 10) = $1 ORDER BY (h.value = $2) DESC, c.last_message_at DESC LIMIT 1`,
      [last10(digits), digits],
    );
    return rows[0] ? { id: String(rows[0].id), closes: (rows[0].wa_window_closes_at as Date | null) ?? null } : null;
  };

  const store: WaSendStore = {
    async setting(key) {
      const rows = await onPool((q) => q("SELECT value #>> '{}' AS v FROM platform.platform_settings WHERE key = $1", [key]));
      return rows[0] && typeof rows[0].v === "string" ? rows[0].v : null;
    },

    async lineById(id) {
      if (!UUID.test(id)) return null;
      const rows = await onPool((q) => q("SELECT id, kind, phone_number_id, waba_id, status, token_secret FROM platform.whatsapp_lines WHERE id = $1", [id]));
      return rows[0] ? lineOf(rows[0]) : null;
    },

    async currentLine(scope) {
      const rows = await onPool((q) =>
        scope.kind === "platform"
          ? q("SELECT id, kind, phone_number_id, waba_id, status, token_secret FROM platform.whatsapp_lines WHERE kind = 'platform' AND status <> 'banned' LIMIT 1")
          : q(
              `SELECT l.id, l.kind, l.phone_number_id, l.waba_id, l.status, l.token_secret FROM platform.whatsapp_line_hotels lh JOIN platform.whatsapp_lines l ON l.id = lh.line_id
                WHERE lh.hotel_id = $1 AND lh.valid_to IS NULL AND l.status <> 'banned' AND (NOT lh.own OR lh.state <> 'pending') ORDER BY lh.own DESC, lh.valid_from DESC LIMIT 1`,
              [scope.hotelId],
            ),
      );
      return rows[0] ? lineOf(rows[0]) : null;
    },

    async ruleLayers(scope, line): Promise<RuleLayers> {
      const profileKey = line.kind === "shared" ? "whatsapp.rules.shared" : line.kind === "platform" || line.kind === "person" ? "whatsapp.rules.platform" : "whatsapp.rules.own_default";
      return onPool(async (q) => {
        const settings = await q("SELECT key, value FROM platform.platform_settings WHERE key IN ($1, 'whatsapp.default_daily_cap')", [profileKey]);
        const byKey = new Map(settings.map((r) => [String(r.key), r.value]));
        const cap = byKey.get("whatsapp.default_daily_cap");
        const globalDefault: Partial<WaRules> = typeof cap === "number" && cap >= 0 ? { daily_cap: cap } : {};
        let hotelOverride: Partial<WaRules> = {};
        let hotelPaused = false;
        if (scope.kind === "hotel") {
          const rows = await q("SELECT rules_override, daily_cap, marketing_allowed, may_message_anyone FROM platform.whatsapp_line_hotels WHERE hotel_id = $1 AND line_id = $2 AND valid_to IS NULL", [scope.hotelId, line.id]);
          const r = rows[0];
          if (r) {
            hotelPaused = (r.rules_override as Record<string, unknown> | null)?.hotel_paused === true;
            hotelOverride = rulesOf(r.rules_override);
            if (typeof r.daily_cap === "number" && hotelOverride.daily_cap === undefined) hotelOverride.daily_cap = r.daily_cap;
            if (r.marketing_allowed === true && hotelOverride.marketing_allowed === undefined) hotelOverride.marketing_allowed = true;
            if (r.may_message_anyone === true && hotelOverride.recipients_stay_guests_only === undefined) hotelOverride.recipients_stay_guests_only = false;
          }
        }
        return { hotelOverride, lineProfile: rulesOf(byKey.get(profileKey)), globalDefault, hotelPaused };
      });
    },

    async hotelLabel(hotelId) {
      const rows = await onPool((q) => q("SELECT name FROM platform.hotels WHERE id = $1", [hotelId]));
      return rows[0] ? String(rows[0].name) : null;
    },

    // a stay in the house, or a booking that is confirmed or checked in and not yet over
    async hasStay(hotelId, digits) {
      const rows = await inHotel(hotelId, (q) =>
        q(
          `SELECT 1 FROM pms_stays WHERE status = 'in_house' AND right(regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g'), 10) = $1
           UNION ALL SELECT 1 FROM pms_reservations WHERE status IN ('confirmed', 'checked_in') AND check_out >= current_date AND right(regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g'), 10) = $1 LIMIT 1`,
          [last10(digits)],
        ),
      );
      return rows.length > 0;
    },

    async isOptedOut(scope, digits) {
      if (scope.kind === "hotel") return (await inHotel(scope.hotelId, (q) => q("SELECT 1 FROM wa_optouts WHERE phone_digits = $1", [digits]))).length > 0;
      const rows = await onPool((q) => q("SELECT 1 FROM platform.whatsapp_suppressions WHERE number_hash = $1 AND hotel_id IS NULL AND reason IN ('stop', 'stop_all')", [hashNumber(deps.hashKey, digits)]));
      return rows.length > 0;
    },

    async isSuppressed(digits) {
      const rows = await onPool((q) => q("SELECT 1 FROM platform.whatsapp_suppressions WHERE number_hash = $1 AND hotel_id IS NULL", [hashNumber(deps.hashKey, digits)]));
      return rows.length > 0;
    },

    async hasConsent(scope, digits) {
      if (scope.kind !== "hotel") return false;
      const rows = await inHotel(scope.hotelId, (q) => q("SELECT 1 FROM customers WHERE wa_consent_at IS NOT NULL AND right(regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g'), 10) = $1 LIMIT 1", [last10(digits)]));
      return rows.length > 0;
    },

    async windowFor(scope, digits): Promise<WindowInfo> {
      return inScope(scope, async (q, t) => {
        const conv = await conversationOf(q, t, digits);
        if (conv === null) return { closesAt: null, lastInboundLineId: null };
        const rows = await q(`SELECT line_id FROM ${t}conv_messages WHERE conversation_id = $1 AND channel = 'whatsapp' AND direction = 'in' ORDER BY sent_at DESC LIMIT 1`, [conv.id]);
        const lastInboundLineId = rows[0]?.line_id ? String(rows[0].line_id) : null;
        return { closesAt: conv.closes, lastInboundLineId };
      });
    },

    async findTemplate(scope, name, language, lineId) {
      if (scope.kind !== "hotel") return null;
      const rows = await inHotel(scope.hotelId, (q) =>
        q("SELECT status, category FROM wa_templates WHERE name = $1 AND language = $2 AND (line_id = $3 OR line_id IS NULL) ORDER BY (line_id IS NOT NULL) DESC LIMIT 1", [name, language, lineId]),
      );
      return rows[0] ? { status: String(rows[0].status) as TemplateStatus, category: String(rows[0].category) as TemplateCategory } : null;
    },

    async startedToday(scope, now) {
      if (scope.kind !== "hotel") return 0;
      const day = localDay(now, await hotelZone(scope.hotelId));
      const rows = await inHotel(scope.hotelId, (q) => q("SELECT coalesce(sum(started), 0)::int AS n FROM wa_usage WHERE day = $1::date", [day]));
      return Number(rows[0]?.n ?? 0);
    },

    // one statement: two sends at the same moment add to the counter, neither overwrites
    async bumpUsage(scope, lineId, category: UsageCategory, now, delta: UsageDelta) {
      if (scope.kind !== "hotel") return;
      const day = localDay(now, await hotelZone(scope.hotelId));
      await inHotel(scope.hotelId, (q) =>
        q(
          `INSERT INTO wa_usage (day, line_id, category, sent, started, failed) VALUES ($1::date, $2, $3, $4, $5, $6)
           ON CONFLICT (day, line_id, category) DO UPDATE SET sent = wa_usage.sent + EXCLUDED.sent, started = wa_usage.started + EXCLUDED.started, failed = wa_usage.failed + EXCLUDED.failed`,
          [day, lineId, category, delta.sent ?? 0, delta.started ?? 0, delta.failed ?? 0],
        ),
      );
    },

    async insertPending(message: PendingMessage): Promise<{ created: true } | { created: false; existing: StoredMessage }> {
      const id = messageIdOf(message.id);
      const scope = message.scope;
      const result = await inScope(scope, async (q, t) => {
        const have = async (): Promise<StoredMessage | null> => {
          const rows = await q(`SELECT status, external_id, failure_code FROM ${t}conv_messages WHERE id = $1`, [id]);
          const r = rows[0];
          return r ? { id: message.id, status: String(r.status) as MessageStatus, wamid: String(r.external_id).startsWith("pending:") ? null : String(r.external_id), failureCode: codeFromColumn(r.failure_code) } : null;
        };
        const before = await have();
        if (before) return before;
        // the person: the conversation of this number, made (contact, handle, conversation) when the guest has none yet
        let conv = await conversationOf(q, t, message.to);
        if (conv === null) {
          const contact = await q(`INSERT INTO ${t}conv_contacts DEFAULT VALUES RETURNING id`);
          const handle = await q(`INSERT INTO ${t}conv_contact_handles (contact_id, kind, value) VALUES ($1, 'phone', $2) ON CONFLICT (kind, value) DO NOTHING RETURNING contact_id`, [contact[0].id, message.to]);
          const contactId = handle[0] ? contact[0].id : (await q(`SELECT contact_id FROM ${t}conv_contact_handles WHERE kind = 'phone' AND value = $1`, [message.to]))[0].contact_id;
          if (!handle[0]) await q(`DELETE FROM ${t}conv_contacts WHERE id = $1`, [contact[0].id]);
          await q(
            `INSERT INTO ${t}conv_conversations (contact_id, last_message_at, last_channel, last_direction, channels) VALUES ($1, $2, 'whatsapp', 'out', ARRAY['whatsapp']) ON CONFLICT (contact_id) DO NOTHING`,
            [contactId, message.createdAt],
          );
          const made = await q(`SELECT id FROM ${t}conv_conversations WHERE contact_id = $1`, [contactId]);
          conv = { id: String(made[0].id), closes: null };
        }
        const sentBy = UUID.test(message.sentBy) ? message.sentBy : null;
        const waType = message.kind === "template" ? "template" : "text";
        const text = truncate(message.kind === "template" ? `Template ${message.templateName ?? ""}`.trim() : message.body, 4096);
        const inserted = await q(
          `INSERT INTO ${t}conv_messages (id, conversation_id, channel, direction, status, external_id, sent_at, sent_by, sent_from, wa_type, wa_text, preview, line_id)
           VALUES ($1, $2, 'whatsapp', 'out', 'pending', $3, $4, $5, 'hms', $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING RETURNING id`,
          [id, conv.id, `pending:${id}`, message.createdAt, sentBy, waType, text, truncate(text, 240), message.lineId],
        );
        if (inserted.length === 0) return (await have()) as StoredMessage;
        await q(
          `UPDATE ${t}conv_conversations SET last_message_at = greatest(last_message_at, $2), last_channel = 'whatsapp', last_direction = 'out',
             channels = (SELECT array_agg(DISTINCT c) FROM unnest(channels || ARRAY['whatsapp']) AS c) WHERE id = $1`,
          [conv.id, message.createdAt],
        );
        return null;
      });
      if (result === null) return { created: true };
      return { created: false, existing: result };
    },

    async updateMessage(scope, requestId, patch: MessagePatch) {
      const id = messageIdOf(requestId);
      const sets = ["status = $2"];
      const params: unknown[] = [id, patch.status];
      if (patch.wamid !== undefined && patch.wamid !== null) {
        params.push(patch.wamid);
        sets.push(`external_id = $${params.length}`);
      }
      if (patch.failureCode !== undefined) {
        params.push(patch.failureCode === null ? null : codeToColumn(patch.failureCode));
        sets.push(`failure_code = $${params.length}`);
      }
      const rows = await inScope(scope, (q, t) => q(`UPDATE ${t}conv_messages SET ${sets.join(", ")} WHERE id = $1 RETURNING line_id`, params));
      // the index: this outgoing message id finds its hotel with one query (no content)
      if (typeof patch.wamid === "string" && rows[0]) {
        const lineId = rows[0].line_id ? String(rows[0].line_id) : null;
        if (lineId !== null) {
          await onPool((q) =>
            q("INSERT INTO platform.whatsapp_message_index (line_id, wamid, hotel_id, direction) VALUES ($1, $2, $3, 'out') ON CONFLICT (line_id, wamid) DO NOTHING", [lineId, patch.wamid, scope.kind === "hotel" ? scope.hotelId : null]),
          );
        }
      }
    },

    async touchLastOut(scope, digits, now) {
      if (scope.kind !== "hotel") return;
      const ids = (await inHotel(scope.hotelId, (q) => q("SELECT id FROM customers WHERE right(regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g'), 10) = $1", [last10(digits)]))).map((r) => String(r.id));
      if (ids.length === 0) return;
      await onPool((q) => q("UPDATE platform.guest_hotels SET wa_last_out_at = $3 WHERE hotel_id = $1 AND customer_id = ANY($2::uuid[])", [scope.hotelId, ids, now]));
    },

    async recordTokenFailure(lineId) {
      const rows = await onPool((q) => q("UPDATE platform.whatsapp_lines SET token_failures = token_failures + 1, last_error_code = 'token_invalid', last_error_at = now() WHERE id = $1 RETURNING token_failures", [lineId]));
      return Number(rows[0]?.token_failures ?? 0);
    },

    async resetTokenFailures(lineId) {
      await onPool((q) => q("UPDATE platform.whatsapp_lines SET token_failures = 0 WHERE id = $1 AND token_failures <> 0", [lineId]));
    },

    async markNeedsReconnect(lineId) {
      await onPool((q) => q("UPDATE platform.whatsapp_lines SET status = 'needs_reconnect' WHERE id = $1 AND status IN ('test', 'active')", [lineId]));
    },
  };
  return store;
}

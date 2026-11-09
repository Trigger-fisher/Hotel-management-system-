import "server-only";
import { randomUUID } from "node:crypto";
import { WHATSAPP_NOT_CONNECTED, type WhatsAppHotelRow, type WhatsAppSettings } from "@shared/dashboards/whatsapp";
import { getDatabase } from "../../db";
import { createPlatformUnit } from "../repos/postgres/platformUnit";
import { hotelMonthCounts, hotelTemplates, monthStartIn } from "../repos/postgres/whatsappHotelState";
import { whatsappConfig } from "../whatsapp/config";
import { getWhatsAppSender } from "./whatsappSend";
import { hotelAcceptedTerms } from "./whatsappTerms";

// The platform line's chat, live (phase 1 task 12): what the Console's WhatsApp screens are told, and the send behind the reply box. Super Admin and Platform Admin share the one platform line with the
// same access (the conversations service checks who may call). While WhatsApp is not set up, or its kill switch is off, or no platform number is connected, everything answers "not connected yet"
// exactly as before, so the live site never changes until the owner switches WhatsApp on.
const platformUnit = () => createPlatformUnit(getDatabase().pool, (db) => db);

/** The platform number as the screens show it, or the not-connected state. */
export async function platformWhatsAppState(): Promise<WhatsAppSettings> {
  if (!whatsappConfig()) return WHATSAPP_NOT_CONNECTED;
  const r = await platformUnit().read((db) =>
    db.query(
      `SELECT l.display_phone, l.display_name, l.name_status, l.quality, l.connected_at, l.last_event_at,
              coalesce((SELECT value = 'true'::jsonb FROM platform.platform_settings WHERE key = 'whatsapp.enabled'), false) AS enabled
       FROM platform.whatsapp_lines l WHERE l.kind = 'platform' AND l.status IN ('test', 'active') LIMIT 1`,
    ),
  );
  const row = r.rows[0];
  if (!row || row.enabled !== true) return WHATSAPP_NOT_CONNECTED;
  const quality = String(row.quality);
  return {
    connected: true,
    available: true,
    ...(row.display_phone ? { number: String(row.display_phone) } : {}),
    ...(row.display_name ? { displayName: String(row.display_name) } : {}),
    displayNameStatus: row.name_status === "named" ? "approved" : "pending",
    quality: quality === "green" || quality === "yellow" || quality === "red" ? quality : "unknown",
    ...(row.connected_at ? { connectedAt: (row.connected_at as Date).toISOString() } : {}),
    lastSentAt: null,
    lastReceivedAt: row.last_event_at ? (row.last_event_at as Date).toISOString() : null,
    // the platform has no template table yet (phase 2) and no automatic messages
    templates: [],
    automatic: [],
  };
}

/**
 * What a hotel's WhatsApp screen is told: the number the hotel uses now (its own number first, else the shared one) and its quality, or the not-connected state. Not connected while WhatsApp is not
 * set up, the master switch is off, the hotel has no number, or the hotel is paused by the platform. The shared number's own phone is shown as the number guests write to.
 */
export async function hotelWhatsAppState(hotelId: string): Promise<WhatsAppSettings> {
  if (!whatsappConfig()) return WHATSAPP_NOT_CONNECTED;
  const r = await platformUnit().read((db) =>
    db.query(
      `SELECT l.display_phone, l.display_name, l.name_status, l.quality, lh.valid_from, l.last_event_at, lh.state, lh.own,
              coalesce(lh.rules_override ->> 'hotel_paused', '') = 'true' AS paused,
              coalesce((SELECT value = 'true'::jsonb FROM platform.platform_settings WHERE key = 'whatsapp.enabled'), false) AS enabled
       FROM platform.whatsapp_line_hotels lh JOIN platform.whatsapp_lines l ON l.id = lh.line_id
       WHERE lh.hotel_id = $1 AND lh.valid_to IS NULL AND l.status IN ('test', 'active')
       ORDER BY lh.own DESC, lh.created_at DESC LIMIT 1`,
      [hotelId],
    ),
  );
  const row = r.rows[0];
  if (!row || row.enabled !== true || row.paused === true) return WHATSAPP_NOT_CONNECTED;
  const quality = String(row.quality);
  // the hotel's own templates and this month's counts, read from its schema (a read that fails leaves the card with the number and nothing else, never an error)
  const zone = (await platformUnit().read((db) => db.query("SELECT timezone FROM platform.hotels WHERE id = $1", [hotelId]))).rows[0]?.timezone;
  const own = await getDatabase()
    .withHotel({ hotelId, readOnly: true }, async (tx) => ({ templates: await hotelTemplates(tx), month: await hotelMonthCounts(tx, monthStartIn(new Date(), typeof zone === "string" ? zone : "Asia/Kolkata")) }))
    .catch(() => null);
  return {
    connected: true,
    available: true,
    ...(row.display_phone ? { number: String(row.display_phone) } : {}),
    ...(row.display_name ? { displayName: String(row.display_name) } : {}),
    displayNameStatus: row.name_status === "named" ? "approved" : "pending",
    quality: quality === "green" || quality === "yellow" || quality === "red" ? quality : "unknown",
    ...(row.valid_from ? { connectedAt: (row.valid_from as Date).toISOString() } : {}),
    lastSentAt: null,
    lastReceivedAt: row.last_event_at ? (row.last_event_at as Date).toISOString() : null,
    templates: own?.templates ?? [],
    // the automatic messages are the automation engine's (later, only when MJ says)
    automatic: [],
    ...(own ? { month: own.month } : {}),
  };
}

/** One free-text message as a hotel through the sender (the checks of plan part 12, the hotel's Rules, its pause). Never throws: a refusal is a plain sentence. */
export async function hotelWhatsAppSend(req: { hotelId: string; by: string; to: string; text: string }): Promise<{ ok: boolean; message: string; messageId?: string }> {
  const sender = getWhatsAppSender();
  if (!sender) return { ok: false, message: "WhatsApp is not connected yet." };
  // the legal gate: the hotel's admin has accepted the WhatsApp terms (Settings > WhatsApp)
  if (!(await hotelAcceptedTerms(req.hotelId))) return { ok: false, message: "The hotel admin must accept the WhatsApp terms in Settings > WhatsApp before the hotel can message guests." };
  const result = await sender.send({ id: randomUUID(), scope: { kind: "hotel", hotelId: req.hotelId }, to: req.to, content: { kind: "text", body: req.text }, by: { id: req.by }, origin: "staff" });
  const ok = result.status === "sent" || result.status === "duplicate";
  return { ok, message: result.message, ...(result.messageId ? { messageId: result.messageId } : {}) };
}

/** The hotels that use a WhatsApp number (its current line, an own line first), for the Console's list and the Rules screen's hotel picker. No chat content. */
export async function platformWhatsAppHotels(): Promise<WhatsAppHotelRow[]> {
  const r = await platformUnit().read((db) =>
    db.query(
      `SELECT DISTINCT ON (h.id) h.id, h.name, l.status, l.display_phone, l.quality
       FROM platform.whatsapp_line_hotels lh
       JOIN platform.hotels h ON h.id = lh.hotel_id
       JOIN platform.whatsapp_lines l ON l.id = lh.line_id
       WHERE lh.valid_to IS NULL AND h.deleted_at IS NULL
       ORDER BY h.id, lh.own DESC, lh.created_at DESC`,
    ),
  );
  const month = (z: unknown): string => monthStartIn(new Date(), typeof z === "string" ? z : "Asia/Kolkata");
  const zones = new Map((await platformUnit().read((db) => db.query("SELECT id, timezone FROM platform.hotels WHERE id = ANY($1::uuid[])", [r.rows.map((x) => String(x.id))]))).rows.map((z) => [String(z.id), z.timezone] as const));
  // each hotel's own counts (a number only, never content); ten hotels at a time, and a hotel that cannot be read counts as zero rather than failing the list
  const counts = new Map<string, { templates: number; free: number }>();
  const ids = r.rows.map((x) => String(x.id));
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(
      ids.slice(i, i + 10).map(async (id) => {
        const c = await getDatabase()
          .withHotel({ hotelId: id, readOnly: true }, (tx) => hotelMonthCounts(tx, month(zones.get(id))))
          .catch(() => null);
        if (c) counts.set(id, { templates: c.templates, free: c.free });
      }),
    );
  }
  return r.rows
    .map((x) => ({
      hotelId: String(x.id),
      hotelName: String(x.name),
      connected: x.status === "active" || x.status === "test",
      number: x.display_phone ? String(x.display_phone) : null,
      quality: (["green", "yellow", "red"].includes(String(x.quality)) ? String(x.quality) : "unknown") as WhatsAppHotelRow["quality"],
      monthTemplates: counts.get(String(x.id))?.templates ?? 0,
      monthMessages: (counts.get(String(x.id))?.templates ?? 0) + (counts.get(String(x.id))?.free ?? 0),
    }))
    .sort((a, b) => a.hotelName.localeCompare(b.hotelName));
}

/** One free-text message on the platform line through the sender (the checks of plan part 12). Never throws: a refusal is a plain sentence. */
export async function platformWhatsAppSend(req: { by: string; to: string; text: string }): Promise<{ ok: boolean; message: string; messageId?: string }> {
  const sender = getWhatsAppSender();
  if (!sender) return { ok: false, message: "WhatsApp is not connected yet." };
  const result = await sender.send({ id: randomUUID(), scope: { kind: "platform" }, to: req.to, content: { kind: "text", body: req.text }, by: { id: req.by }, origin: "staff" });
  const ok = result.status === "sent" || result.status === "duplicate";
  return { ok, message: result.message, ...(result.messageId ? { messageId: result.messageId } : {}) };
}

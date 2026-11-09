import "server-only";
// Meta's webhook body, split into the single events HMS saves (plan part 9; the shapes are marked "verify" in the plan's appendix and are read tolerantly here: an unknown field is ignored,
// a malformed item is skipped and counted, nothing throws). One call can carry many changes and each change many messages and statuses; every message, every status and every other
// change becomes ONE event, so one bad item never costs the rest.
//   message   an inbound message of a guest or a person (any type: text, image, interactive reply, reaction, unsupported ...), kept whole
//   status    the delivery state of a message HMS sent: sent, delivered, read, failed (with Meta's error codes, which are not guest data)
//   template  a template's approval changed (message_template_status_update, message_template_quality_update, ...)
//   other     account or number changes (quality rating, name approval, a ban ...)

export type WaStatusKind = "sent" | "delivered" | "read" | "failed";
const STATUSES: ReadonlySet<string> = new Set<WaStatusKind>(["sent", "delivered", "read", "failed"]);
/** Meta's message ids ("wamid.HBgM..." base64-like text). */
const WAMID = /^[A-Za-z0-9_=.:+/-]{4,200}$/;
const PHONE_NUMBER_ID = /^[0-9]{5,40}$/;
/** More changes than this in one call is not Meta: the rest are dropped. */
export const MAX_EVENTS_PER_CALL = 500;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

interface Where {
  phoneNumberId: string | null;
  wabaId: string | null;
}

export type WaWebhookEvent =
  | (Where & { kind: "message"; wamid: string; from: string; timestamp: number | null; contactName: string | null; message: Obj })
  | (Where & { kind: "status"; wamid: string; status: WaStatusKind; timestamp: number | null; recipient: string | null; errors: { code: string; title: string | null }[] })
  | (Where & { kind: "template" | "other"; field: string; value: Obj });

export interface ParsedWebhook {
  events: WaWebhookEvent[];
  /** Items that could not be read or were not of a kind HMS handles (counted, never stored). */
  skipped: number;
  /** More than MAX_EVENTS_PER_CALL: how many were dropped. */
  dropped: number;
}

const seconds = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);

/** Parse the JSON of a call that already passed the signature check. A body that is not a WhatsApp Business Account call gives no events. */
export function parseWebhook(body: unknown): ParsedWebhook {
  const out: ParsedWebhook = { events: [], skipped: 0, dropped: 0 };
  if (!isObj(body) || body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return out;
  const push = (event: WaWebhookEvent): void => {
    if (out.events.length >= MAX_EVENTS_PER_CALL) out.dropped += 1;
    else out.events.push(event);
  };
  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.changes)) {
      out.skipped += 1;
      continue;
    }
    const wabaId = typeof entry.id === "string" && PHONE_NUMBER_ID.test(entry.id) ? entry.id : null;
    for (const change of entry.changes) {
      if (!isObj(change) || !isObj(change.value) || typeof change.field !== "string") {
        out.skipped += 1;
        continue;
      }
      const field = change.field.slice(0, 80);
      const value = change.value;
      const meta = isObj(value.metadata) ? value.metadata : {};
      const phoneNumberId = typeof meta.phone_number_id === "string" && PHONE_NUMBER_ID.test(meta.phone_number_id) ? meta.phone_number_id : null;
      const where: Where = { phoneNumberId, wabaId };
      if (field === "messages") {
        const contacts = Array.isArray(value.contacts) ? value.contacts.filter(isObj) : [];
        for (const m of Array.isArray(value.messages) ? value.messages : []) {
          const from = isObj(m) ? text(m.from, 40) : null;
          if (!isObj(m) || typeof m.id !== "string" || !WAMID.test(m.id) || from === null) {
            out.skipped += 1;
            continue;
          }
          const contact = contacts.find((c) => c.wa_id === m.from);
          const profile = contact && isObj(contact.profile) ? contact.profile : null;
          push({ ...where, kind: "message", wamid: m.id, from, timestamp: seconds(m.timestamp), contactName: profile ? text(profile.name, 120) : null, message: m });
        }
        for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
          if (!isObj(s) || typeof s.id !== "string" || !WAMID.test(s.id) || typeof s.status !== "string" || !STATUSES.has(s.status)) {
            out.skipped += 1;
            continue;
          }
          const errors = (Array.isArray(s.errors) ? s.errors : []).filter(isObj).slice(0, 3).map((e) => ({ code: String(e.code ?? "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || "unknown", title: text(e.title, 200) }));
          push({ ...where, kind: "status", wamid: s.id, status: s.status as WaStatusKind, timestamp: seconds(s.timestamp), recipient: text(s.recipient_id, 40), errors });
        }
        continue;
      }
      const kind = field.startsWith("message_template") ? "template" : "other";
      push({ ...where, kind, field, value });
    }
  }
  return out;
}

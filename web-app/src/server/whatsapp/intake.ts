import "server-only";
import { createHash } from "node:crypto";
import { AppError } from "../errors";
import type { WhatsAppConfig } from "./config";
import { parseWebhook, type WaWebhookEvent } from "./payload";
import type { NewWaEvent, WaEventStore, WaLine, WaLineStore } from "./ports";
import { sealEvent } from "./seal";
import { signatureMatches } from "./signature";

// The door Meta calls (plan part 9, phase 1 task 4): check, SAVE, answer. Nothing is routed or delivered here; every change is written to whatsapp_events first and processed from there
// (a function of the event id), so Meta gets its 200 at once and a crash after the answer loses nothing.
//   GET   the subscription check: hub.mode=subscribe and hub.verify_token equal to WHATSAPP_VERIFY_TOKEN -> the challenge text, else 403
//   POST  the signature of the RAW body is checked first, in constant time; a wrong or missing one is a 403 and nothing is read; a number HMS does not know is dropped (its id is not even logged);
//         every message, status and change is saved once (the repeat of a delivery changes nothing)
// Not set up (no app secret, verify token or hash key) = 404, as if the route did not exist.
export interface IntakeDeps {
  config: () => WhatsAppConfig | null;
  lines: WaLineStore;
  events: WaEventStore;
  now?: () => Date;
  /** Called with the ids of the events just saved (the app wakes the processor after the answer); its failure never reaches Meta. */
  wake?: (eventIds: string[]) => void;
}

export interface IntakeResult {
  saved: number;
  duplicates: number;
  /** Items for a number HMS does not know, items that could not be read and items beyond the per-call limit. */
  ignored: number;
}

/** A body is at most this big (Meta's calls are a few KB; a media-heavy burst is still far below it). */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

const shortHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);

/** The key that makes a repeat delivery the same event. */
export function dedupeKeyOf(lineId: string, event: WaWebhookEvent): string {
  if (event.kind === "message") return `m:${lineId}:${event.wamid}`;
  if (event.kind === "status") return `s:${lineId}:${event.wamid}:${event.status}`;
  return `o:${lineId}:${shortHash([event.field, event.value])}`;
}

export function createWhatsAppIntake(deps: IntakeDeps) {
  const now = deps.now ?? (() => new Date());
  return {
    /** The answer to Meta's subscription check: the challenge text to send back. */
    verifySubscription(query: { mode: string | null; token: string | null; challenge: string | null }): string {
      const cfg = deps.config();
      if (!cfg) throw new AppError("NOT_FOUND");
      const same = query.token !== null && Buffer.byteLength(query.token) === Buffer.byteLength(cfg.verifyToken) && createHash("sha256").update(query.token).digest("hex") === createHash("sha256").update(cfg.verifyToken).digest("hex");
      if (query.mode !== "subscribe" || !same || query.challenge === null || query.challenge === "" || query.challenge.length > 200) throw new AppError("FORBIDDEN", "The verify token did not match.");
      return query.challenge;
    },

    async receive(input: { rawBody: string; signature: string | null }): Promise<IntakeResult> {
      const cfg = deps.config();
      if (!cfg) throw new AppError("NOT_FOUND");
      if (Buffer.byteLength(input.rawBody, "utf8") > MAX_WEBHOOK_BYTES) throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Request is too large" } });
      if (!signatureMatches(cfg.appSecret, input.rawBody, input.signature)) throw new AppError("FORBIDDEN", "The signature did not match.");
      let body: unknown;
      try {
        body = JSON.parse(input.rawBody);
      } catch {
        throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Not valid JSON" } });
      }
      const parsed = parseWebhook(body);
      const at = now();
      let ignored = parsed.skipped + parsed.dropped;
      const byNumber = new Map<string, WaLine | null>();
      const lineOf = async (event: WaWebhookEvent): Promise<WaLine | null> => {
        const id = event.phoneNumberId ?? (event.wabaId ? `waba:${event.wabaId}` : null);
        if (id === null) return null;
        if (!byNumber.has(id)) byNumber.set(id, event.phoneNumberId ? await deps.lines.findByPhoneNumberId(event.phoneNumberId) : await deps.lines.findByWabaId(event.wabaId as string));
        return byNumber.get(id) ?? null;
      };
      const toSave: NewWaEvent[] = [];
      const touched = new Set<string>();
      for (const event of parsed.events) {
        const line = await lineOf(event);
        // an unknown or banned number is dropped: nothing is kept and nothing is logged about it
        if (!line || line.status === "banned") {
          ignored += 1;
          continue;
        }
        touched.add(line.id);
        toSave.push({ lineId: line.id, kind: event.kind, dedupeKey: dedupeKeyOf(line.id, event), payloadSecret: sealEvent(cfg.sealKey, event, line.id), receivedAt: at });
      }
      const result = toSave.length > 0 ? await deps.events.save(toSave) : { saved: [], duplicates: 0 };
      for (const id of touched) await deps.lines.touchEvent(id, at);
      if (result.saved.length > 0 && deps.wake) {
        try {
          deps.wake(result.saved);
        } catch {
          // the sweep finds them anyway
        }
      }
      return { saved: result.saved.length, duplicates: result.duplicates, ignored };
    },
  };
}

export type WhatsAppIntake = ReturnType<typeof createWhatsAppIntake>;

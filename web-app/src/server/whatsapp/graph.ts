import "server-only";
// A small client for Meta's WhatsApp Cloud API (Graph API), plan parts 12, 26.4 and 28.6. One function per call HMS needs. Rules every call follows:
//   - the base is https://graph.facebook.com/{version}/..., the version coming from config.ts (one place)
//   - the line's OWN opened token is passed per call as a Bearer header; it is never stored here, never logged and never part of a result
//   - 10 seconds, then the call is cut off (AbortController); the fetch is injectable so tests use fakeMeta.ts and never touch the network
//   - nothing here logs, and no result carries Meta's error text or the guest's message: only a short machine code and Meta's numeric code
// Every call returns a typed outcome instead of throwing:
//   ok         Meta accepted it
//   policy     Meta refused it for a reason a retry cannot fix (24-hour window, bad number, template problem): NEVER retried
//   transient  nothing was accepted and trying again later may work: a connection that never opened (DNS, refused, TLS), a 5xx, a 429
//   auth       the token is invalid or expired (HTTP 401 or Meta code 190)
//   unknown    a SEND that timed out or whose connection dropped after the request may have reached Meta. It MUST NOT be resent automatically (plan 26.4: as far as the author knows the send
//              call has no idempotency key, verify); a status webhook or a person decides. Calls that are safe to repeat (reads, mark read, register) report these as transient instead.
import { DEFAULT_GRAPH_VERSION } from "./config";

export type FetchLike = typeof fetch;

export interface GraphOptions {
  fetch?: FetchLike;
  /** Defaults to DEFAULT_GRAPH_VERSION; pass whatsappConfig().graphVersion. */
  graphVersion?: string;
  timeoutMs?: number;
}

export const GRAPH_TIMEOUT_MS = 10_000;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export type GraphFailure =
  | { kind: "policy"; code: string; metaCode: number | null; httpStatus: number }
  | { kind: "transient"; code: string; metaCode: number | null; retryAfterSeconds: number }
  | { kind: "auth"; code: string; metaCode: number | null }
  | { kind: "unknown"; code: "unknown_outcome" };

export type GraphOutcome<T> = ({ kind: "ok" } & T) | GraphFailure;
export type SendOutcome = GraphOutcome<{ wamid: string }>;

/**
 * Meta's numeric error codes to short machine codes. Every row is from the author's memory of Meta's error-code list: VERIFY each against the current documentation and a real test-number
 * run (plan 27.9) before the pilot. A code not listed is a policy error "meta_<code>" (or transient when it comes with a 5xx).
 */
const META_CODES: Readonly<Record<number, string>> = {
  190: "token_invalid", // verify: access token expired or invalid
  131047: "reengagement_window_closed", // verify: more than 24 hours since the guest's last message
  131026: "undeliverable", // verify: not a WhatsApp number, or the guest has not accepted the terms
  131030: "recipient_not_allowed", // verify: the test number may only message numbers on its allowed list
  131031: "account_locked", // verify
  131048: "spam_rate_limit", // verify: the number's messages are being flagged; policy, not a retry
  131049: "not_delivered_by_meta", // verify: Meta chose not to deliver (marketing frequency)
  131051: "unsupported_message_type", // verify
  131053: "media_upload_error", // verify
  132000: "template_param_mismatch", // verify: the number of variables does not match the template
  132001: "template_missing", // verify: no such template in that language
  132005: "template_text_too_long", // verify
  132007: "template_format_policy", // verify
  132012: "template_param_format", // verify
  132015: "template_paused", // verify
  132016: "template_disabled", // verify
  100: "invalid_parameter", // verify
  368: "account_restricted", // verify
  // rate limits and temporary faults (retry later)
  4: "rate_limited", // verify
  80007: "rate_limited", // verify
  130429: "rate_limited", // verify: Cloud API throughput reached
  131056: "pair_rate_limited", // verify: too many messages to one number at once
  1: "server_error", // verify
  2: "server_error", // verify
};
const TRANSIENT_META_CODES: ReadonlySet<number> = new Set([4, 80007, 130429, 131056, 1, 2]);

/** The connection never opened, so nothing can have reached Meta: safe to try again. */
const NOT_SENT_CODES: ReadonlySet<string> = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** What the screens may know about a number (Connect screen). */
export interface PhoneNumberInfo {
  displayNumber: string | null;
  verifiedName: string | null;
  quality: string | null;
  messagingTier: string | null;
}

export interface MediaDownload {
  mimeType: string | null;
  sha256: string | null;
  size: number;
  bytes: Buffer;
}

export interface TemplateSend {
  name: string;
  /** Meta's language code, "en" or "en_US". */
  language: string;
  /** The body variables in order ({{1}}, {{2}} ...). */
  bodyVariables: readonly string[];
}

export interface GraphClient {
  sendText(token: string, phoneNumberId: string, to: string, body: string): Promise<SendOutcome>;
  sendTemplate(token: string, phoneNumberId: string, to: string, template: TemplateSend): Promise<SendOutcome>;
  /** `interactive` is the finished "interactive" object built by the routing module's builders. */
  sendInteractive(token: string, phoneNumberId: string, to: string, interactive: Record<string, unknown>): Promise<SendOutcome>;
  markRead(token: string, phoneNumberId: string, wamid: string): Promise<GraphOutcome<object>>;
  getPhoneNumber(token: string, phoneNumberId: string): Promise<GraphOutcome<PhoneNumberInfo>>;
  /** Subscribe the HMS app to a business account's webhooks. */
  subscribeApp(token: string, wabaId: string): Promise<GraphOutcome<object>>;
  /** Register a number with its two-step verification PIN (6 digits). */
  registerNumber(token: string, phoneNumberId: string, pin: string): Promise<GraphOutcome<object>>;
  /** Media id to metadata, then the bytes (both calls carry the token). */
  downloadMedia(token: string, mediaId: string, maxBytes?: number): Promise<GraphOutcome<MediaDownload>>;
  /** Submit a message template for approval (POST /{waba}/message_templates). Repeatable: Meta refuses a second one of the same name and language. */
  createTemplate(token: string, wabaId: string, template: TemplateSubmit): Promise<GraphOutcome<{ metaId: string; status: string }>>;
  /** The approval state of a template by name (GET /{waba}/message_templates?name=). `found: false` when Meta has no such template. */
  templateStatus(token: string, wabaId: string, name: string): Promise<GraphOutcome<TemplateState>>;
  /** Remove a template by name from the business account (DELETE /{waba}/message_templates?name=). */
  deleteTemplate(token: string, wabaId: string, name: string): Promise<GraphOutcome<object>>;
}

export interface TemplateSubmit {
  name: string;
  language: string;
  category: "utility" | "authentication" | "marketing";
  /** The body with {{1}}, {{2}} ... */
  body: string;
  /** One example value per variable, in order (Meta needs them for review). */
  examples: readonly string[];
  /** Buttons under the message: a fixed link, or a quick answer. */
  buttons?: readonly ({ kind: "url"; text: string; url: string } | { kind: "quick_reply"; text: string })[];
}

export interface TemplateState {
  found: boolean;
  metaId: string | null;
  /** Meta's own word, lower case: approved, pending, rejected, paused, disabled ... */
  status: string | null;
  reason: string | null;
}

export function createGraphClient(options: GraphOptions = {}): GraphClient {
  const doFetch: FetchLike = options.fetch ?? fetch;
  const base = `https://graph.facebook.com/${options.graphVersion ?? DEFAULT_GRAPH_VERSION}`;
  const timeoutMs = options.timeoutMs ?? GRAPH_TIMEOUT_MS;

  /** One HTTP exchange. `sending` marks a call that must not be repeated when its outcome is unclear. */
  async function exchange(token: string, method: "GET" | "POST" | "DELETE", url: string, body: unknown, sending: boolean, binary = false): Promise<{ status: number; headers: Headers; json: unknown; bytes: Buffer | null } | GraphFailure> {
    const controller = new AbortController();
    // a file download gets longer than a message call (a big file over a slow link), but never longer than a serverless function lives
    const timer = setTimeout(() => controller.abort(), binary ? Math.max(timeoutMs, 25_000) : timeoutMs);
    // An unclear result: the request may have reached Meta (sends) or does not matter (repeatable calls).
    const unclear = (): GraphFailure => (sending ? { kind: "unknown", code: "unknown_outcome" } : { kind: "transient", code: "network_error", metaCode: null, retryAfterSeconds: 15 });
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      let res: Response;
      try {
        res = await doFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: "no-store" });
      } catch (e) {
        const aborted = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
        const cause = (e as { cause?: { code?: string } } | null)?.cause?.code;
        if (!aborted && typeof cause === "string" && NOT_SENT_CODES.has(cause)) return { kind: "transient", code: "network_error", metaCode: null, retryAfterSeconds: 15 };
        return unclear();
      }
      try {
        if (binary && res.ok) {
          const bytes = Buffer.from(await res.arrayBuffer());
          return { status: res.status, headers: res.headers, json: null, bytes };
        }
        const raw = await res.text();
        let json: unknown = null;
        try {
          json = raw === "" ? null : JSON.parse(raw);
        } catch {
          json = null;
        }
        return { status: res.status, headers: res.headers, json, bytes: null };
      } catch {
        // The answer began and then broke: Meta may have acted on it.
        return res.ok || res.status >= 500 ? unclear() : { kind: "transient", code: "network_error", metaCode: null, retryAfterSeconds: 15 };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Turn a non-2xx answer into a failure. Never copies Meta's message text. */
  function failure(status: number, headers: Headers, json: unknown): GraphFailure {
    const err = isObj(json) && isObj(json.error) ? json.error : {};
    const metaCode = typeof err.code === "number" ? err.code : null;
    if (status === 401 || metaCode === 190) return { kind: "auth", code: "token_invalid", metaCode };
    const mapped = metaCode !== null ? META_CODES[metaCode] : undefined;
    if (status === 429 || status >= 500 || (metaCode !== null && TRANSIENT_META_CODES.has(metaCode))) {
      const retryAfter = Number(headers.get("retry-after"));
      const fallback = status === 429 ? 60 : 30;
      return { kind: "transient", code: status === 429 ? "rate_limited" : (mapped ?? "server_error"), metaCode, retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(Math.floor(retryAfter), 3600) : fallback };
    }
    return { kind: "policy", code: mapped ?? (metaCode !== null ? `meta_${metaCode}` : `http_${status}`), metaCode, httpStatus: status };
  }

  /** The common send: POST /{phone_number_id}/messages. A 2xx without a message id is an unclear outcome, not a success. */
  async function postMessage(token: string, phoneNumberId: string, payload: Obj): Promise<SendOutcome> {
    const r = await exchange(token, "POST", `${base}/${encodeURIComponent(phoneNumberId)}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", ...payload }, true);
    if ("kind" in r) return r;
    if (r.status < 200 || r.status >= 300) return failure(r.status, r.headers, r.json);
    const messages = isObj(r.json) && Array.isArray(r.json.messages) ? r.json.messages : [];
    const first = messages[0];
    const wamid = isObj(first) && typeof first.id === "string" && first.id !== "" ? first.id : null;
    return wamid === null ? { kind: "unknown", code: "unknown_outcome" } : { kind: "ok", wamid };
  }

  /** A repeatable call that answers with JSON. */
  async function simple<T>(token: string, method: "GET" | "POST" | "DELETE", url: string, body: unknown, read: (json: Obj) => T | null): Promise<GraphOutcome<T extends object ? T : object>> {
    const r = await exchange(token, method, url, body, false);
    if ("kind" in r) return r;
    if (r.status < 200 || r.status >= 300) return failure(r.status, r.headers, r.json);
    const value = read(isObj(r.json) ? r.json : {});
    if (value === null) return { kind: "transient", code: "bad_answer", metaCode: null, retryAfterSeconds: 30 };
    return { kind: "ok", ...(value as object) } as GraphOutcome<T extends object ? T : object>;
  }

  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

  return {
    sendText: (token, phoneNumberId, to, body) => postMessage(token, phoneNumberId, { to, type: "text", text: { preview_url: false, body } }),

    sendTemplate: (token, phoneNumberId, to, t) =>
      postMessage(token, phoneNumberId, {
        to,
        type: "template",
        template: {
          name: t.name,
          language: { code: t.language },
          ...(t.bodyVariables.length > 0 ? { components: [{ type: "body", parameters: t.bodyVariables.map((text) => ({ type: "text", text })) }] } : {}),
        },
      }),

    sendInteractive: (token, phoneNumberId, to, interactive) => postMessage(token, phoneNumberId, { to, type: "interactive", interactive }),

    markRead: (token, phoneNumberId, wamid) =>
      simple(token, "POST", `${base}/${encodeURIComponent(phoneNumberId)}/messages`, { messaging_product: "whatsapp", status: "read", message_id: wamid }, () => ({})),

    getPhoneNumber: (token, phoneNumberId) =>
      simple<PhoneNumberInfo>(token, "GET", `${base}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`, undefined, (j) => ({
        displayNumber: str(j.display_phone_number),
        verifiedName: str(j.verified_name),
        quality: str(j.quality_rating),
        messagingTier: str(j.messaging_limit_tier),
      })),

    subscribeApp: (token, wabaId) => simple(token, "POST", `${base}/${encodeURIComponent(wabaId)}/subscribed_apps`, {}, (j) => (j.success === false ? null : {})),

    registerNumber: (token, phoneNumberId, pin) => simple(token, "POST", `${base}/${encodeURIComponent(phoneNumberId)}/register`, { messaging_product: "whatsapp", pin }, (j) => (j.success === false ? null : {})),

    createTemplate: (token, wabaId, t) =>
      simple<{ metaId: string; status: string }>(
        token,
        "POST",
        `${base}/${encodeURIComponent(wabaId)}/message_templates`,
        {
          name: t.name,
          language: t.language,
          category: t.category.toUpperCase(),
          components: [
            { type: "BODY", text: t.body, ...(t.examples.length > 0 ? { example: { body_text: [t.examples] } } : {}) },
            ...(t.buttons && t.buttons.length > 0 ? [{ type: "BUTTONS", buttons: t.buttons.map((b) => (b.kind === "url" ? { type: "URL", text: b.text, url: b.url } : { type: "QUICK_REPLY", text: b.text })) }] : []),
          ],
        },
        (j) => {
          const id = str(j.id);
          return id === null ? null : { metaId: id, status: (str(j.status) ?? "PENDING").toLowerCase() };
        },
      ),

    templateStatus: (token, wabaId, name) =>
      simple<TemplateState>(token, "GET", `${base}/${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,status,rejected_reason`, undefined, (j) => {
        const first = Array.isArray(j.data) ? j.data[0] : undefined;
        if (!isObj(first)) return { found: false, metaId: null, status: null, reason: null };
        const reason = str(first.rejected_reason);
        return { found: true, metaId: str(first.id), status: (str(first.status) ?? "").toLowerCase() || null, reason: reason === null || reason === "NONE" ? null : reason };
      }),

    deleteTemplate: (token, wabaId, name) => simple(token, "DELETE", `${base}/${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(name)}`, undefined, (j) => (j.success === false ? null : {})),

    async downloadMedia(token, mediaId, maxBytes = MAX_MEDIA_BYTES) {
      const meta = await simple<{ url: string; mimeType: string | null; sha256: string | null; size: number | null }>(token, "GET", `${base}/${encodeURIComponent(mediaId)}`, undefined, (j) => {
        const url = str(j.url);
        if (url === null || !/^https:\/\//i.test(url)) return null;
        return { url, mimeType: str(j.mime_type), sha256: str(j.sha256), size: typeof j.file_size === "number" ? j.file_size : null };
      });
      if (meta.kind !== "ok") return meta;
      if (meta.size !== null && meta.size > maxBytes) return { kind: "policy", code: "media_too_large", metaCode: null, httpStatus: 200 };
      const r = await exchange(token, "GET", meta.url, undefined, false, true);
      if ("kind" in r) return r;
      if (r.status < 200 || r.status >= 300 || r.bytes === null) return failure(r.status, r.headers, r.json);
      if (r.bytes.length > maxBytes) return { kind: "policy", code: "media_too_large", metaCode: null, httpStatus: 200 };
      return { kind: "ok", mimeType: meta.mimeType, sha256: meta.sha256, size: r.bytes.length, bytes: r.bytes };
    },
  };
}

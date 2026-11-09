import "server-only";
// The WhatsApp send pipeline (plan part 12), in the plan's order. Permission is checked BEFORE this by the caller (the route or service takes the session and hands over an already
// authorized actor in `by`); nothing here knows about sessions. Every refusal is a short machine code plus one plain sentence for the screen: never a number, never message text.
//   0 kill switch (whatsapp.enabled) and line status    1b which line    2 who may be messaged    3 opt-out and suppression    4 consent    5 window    6 category    7 daily cap
//   8 payload (hotel name in bold on the shared line)    9 insert as 'pending' FIRST (idempotent id)    10 call Meta    11 outcome
// Outcomes: ok is sent; a policy error is failed and never retried; a transient error is failed with a retry hint (this module never resends: the outbox lane does, by calling send
// again with the same id); an UNKNOWN outcome keeps the row 'pending' with failure code "unknown_outcome" and is NEVER resent (plan 26.4, a status webhook or a person decides);
// a token failure counts on the line and the second one marks it needs_reconnect (plan 28.6).
import { digitsOf } from "./config";
import type { GraphClient } from "./graph";
import { BODY_MAX, wrongButtonId } from "./interactive";
import { metaLanguageCode, textsFor } from "./language";
import type { RuleLayers, SendLine, SendScope, UsageCategory, WaRuleName, WaRules, WaSendStore } from "./sendPorts";

/** The shared-line profile: what applies when no layer sets a switch (the safest column of plan part 6). */
export const BUILTIN_RULES: Readonly<WaRules> = {
  hotel_may_start_chats: false,
  recipients_stay_guests_only: true,
  templates_only_for_new_messages: true,
  marketing_allowed: false,
  daily_cap: 50,
  consent_required_for_automatic: true,
  hotel_label_on_messages: true,
  platform_blocklist_enabled: true,
  wrong_hotel_button: true,
};

/** Meta's own rules: shown greyed on the Rules screen and never read from a switch (free text only in the window, approved templates otherwise, opted-out numbers never messaged). */
export const LOCKED_RULES: ReadonlySet<WaRuleName> = new Set<WaRuleName>(["templates_only_for_new_messages"]);
export const isLockedRule = (name: WaRuleName): boolean => LOCKED_RULES.has(name);

/** Hotel override, then the line's profile, then the global default, then the built-in. A key that is undefined (or null) in a layer is "not set here". */
export function resolveRules(layers: RuleLayers): WaRules {
  const out = { ...BUILTIN_RULES } as Record<WaRuleName, boolean | number>;
  for (const name of Object.keys(BUILTIN_RULES) as WaRuleName[]) {
    for (const layer of [layers.hotelOverride, layers.lineProfile, layers.globalDefault]) {
      const v = layer[name];
      if (v !== undefined && v !== null) {
        out[name] = v;
        break;
      }
    }
  }
  out.templates_only_for_new_messages = true; // locked
  return out as unknown as WaRules;
}

export type SendContent =
  | { kind: "text"; body: string }
  | { kind: "template"; name: string; language: string; variables: readonly string[] }
  /** A button or list message already built by the routing module's builders. `bodyText`, when present, is what the guest reads (used for the hotel label). */
  | { kind: "interactive"; interactive: Record<string, unknown>; summary: string };

export interface SendRequest {
  /** Chosen by the caller (a UUID). The same id never inserts or sends twice. */
  id: string;
  scope: SendScope;
  /** The guest's number, any format with the country code. */
  to: string;
  content: SendContent;
  /** The already-authorized actor (staff login id, or a system id for automatic messages). */
  by: { id: string };
  /** "automatic" for notices HMS sends by itself; "staff" (default) for a person's message. */
  origin?: "staff" | "automatic";
  /** Staff are opening a chat with someone they have no thread with (the hotel_may_start_chats switch). */
  startsNewChat?: boolean;
  /** A utility message about something the guest did (a booking confirmation): needs no marketing-style consent tick. */
  transactional?: boolean;
}

export type SendStatus = "sent" | "refused" | "failed" | "retry" | "unknown" | "duplicate";
export interface SendResult {
  ok: boolean;
  status: SendStatus;
  /** Short machine code ("window_closed", "token_invalid" ...). Empty on success. */
  code: string;
  /** One plain English sentence for the screen. Never a number or message text. */
  message: string;
  messageId?: string;
  wamid?: string;
  lineId?: string;
  /** status "retry": when the outbox may call send again with the same id. */
  retryAfterSeconds?: number;
  /** status "failed" after a token failure: the line was marked needs_reconnect. */
  lineNeedsReconnect?: boolean;
  /** status "duplicate": the stored status of the row that already has this id. */
  existingStatus?: string;
}

const REFUSALS: Readonly<Record<string, string>> = {
  invalid_number: "That is not a valid phone number.",
  kill_switch_off: "WhatsApp is switched off.",
  hotel_paused: "WhatsApp is paused for this hotel by EasyHotelSolutions.",
  no_line: "No WhatsApp number is set up for this.",
  line_not_active: "This WhatsApp number is not active right now.",
  line_token_unreadable: "This WhatsApp number needs to be reconnected.",
  recipient_not_allowed: "This number can only be messaged when the guest has a current or upcoming stay at the hotel.",
  hotels_reply_only: "Hotels can only reply on this number, not start a new chat.",
  opted_out: "This guest opted out of WhatsApp messages.",
  suppressed: "This number is blocked from WhatsApp messages.",
  consent_missing: "This guest has not agreed to receive WhatsApp messages.",
  window_closed: "Free text can only be sent within 24 hours of the guest's last message. Use an approved template instead.",
  template_not_approved: "That template is not approved yet, so it cannot be sent.",
  marketing_not_allowed: "Marketing messages are not allowed on this number.",
  daily_cap_reached: "The daily limit for new messages has been reached. Try again tomorrow.",
};

/** What a stored failure says in plain words (failed-message screens). */
export const FAILURE_TEXT: Readonly<Record<string, string>> = {
  reengagement_window_closed: "The 24-hour reply window had closed, so WhatsApp did not accept the message.",
  undeliverable: "This number cannot receive WhatsApp messages.",
  recipient_not_allowed: "This number is not on the test number's allowed list.",
  template_param_mismatch: "The template's fields did not match what it expects.",
  template_missing: "WhatsApp does not have that template.",
  template_paused: "WhatsApp has paused that template.",
  template_disabled: "WhatsApp has disabled that template.",
  spam_rate_limit: "WhatsApp is limiting this number's messages.",
  token_invalid: "The WhatsApp connection is no longer valid.",
  rate_limited: "WhatsApp is busy. The message will be tried again.",
  server_error: "WhatsApp had a problem. The message will be tried again.",
  network_error: "The connection to WhatsApp failed. The message will be tried again.",
  unknown_outcome: "It is not known whether this message was sent.",
};
const failureText = (code: string): string => FAILURE_TEXT[code] ?? "WhatsApp did not accept this message.";

/** Failure codes a person or the outbox may retry (plan 26.4: only clear failures where Meta accepted nothing). */
export const RETRYABLE_CODES: ReadonlySet<string> = new Set(["network_error", "server_error", "rate_limited", "pair_rate_limited", "bad_answer"]);
export const isRetryableCode = (code: string | null): boolean => code !== null && RETRYABLE_CODES.has(code);

const truthy = (v: string | null): boolean => v !== null && ["true", "1", "on", "yes"].includes(v.trim().toLowerCase());
/** The hotel name made safe to wrap in WhatsApp's bold marks. */
const label = (name: string): string => `*${name.replace(/[*_~`\n\r]/g, " ").trim()}*`;

export interface SenderDeps {
  store: WaSendStore;
  graph: GraphClient;
  /** Open a line's sealed token (seal.ts openToken with the server key). May throw when the key changed. */
  openToken(sealed: string, phoneNumberId: string): string;
  now?: () => Date;
}

export function createSender(deps: SenderDeps): { send(request: SendRequest): Promise<SendResult> } {
  const { store, graph } = deps;
  const clock = deps.now ?? (() => new Date());
  const refuse = (code: string): SendResult => ({ ok: false, status: "refused", code, message: REFUSALS[code] ?? "This message cannot be sent." });

  async function send(req: SendRequest): Promise<SendResult> {
    const now = clock();
    const scope = req.scope;
    const origin = req.origin ?? "staff";
    const content = req.content;
    const to = digitsOf(req.to);
    if (to === null) return refuse("invalid_number");

    // 0 kill switch
    if (!truthy(await store.setting("whatsapp.enabled"))) return refuse("kill_switch_off");

    // 1b which line: the line of the guest's last inbound if that window is open, else the current line
    const win = await store.windowFor(scope, to);
    const windowOpen = win.closesAt !== null && win.closesAt.getTime() > now.getTime();
    let line: SendLine | null = windowOpen && win.lastInboundLineId !== null ? await store.lineById(win.lastInboundLineId) : null;
    if (line === null) line = await store.currentLine(scope);
    if (line === null) return refuse("no_line");
    if (line.status !== "active" && line.status !== "test") return refuse("line_not_active");
    const layers = await store.ruleLayers(scope, line);
    // the Super Admin's per-hotel kill switch (Rules screen): that hotel sends nothing until it is resumed
    if (layers.hotelPaused === true) return refuse("hotel_paused");
    const rules = resolveRules(layers);

    // 2 who may be messaged. A guest who wrote to us inside the window may always be answered.
    if (!windowOpen && rules.recipients_stay_guests_only) {
      if (scope.kind !== "hotel" || !(await store.hasStay(scope.hotelId, to))) return refuse("recipient_not_allowed");
    }
    if (scope.kind === "hotel" && origin === "staff" && req.startsNewChat === true && !windowOpen && !rules.hotel_may_start_chats) return refuse("hotels_reply_only");

    // 3 opt-out (locked) and the platform suppression list
    if (await store.isOptedOut(scope, to)) return refuse("opted_out");
    if (rules.platform_blocklist_enabled && (await store.isSuppressed(to))) return refuse("suppressed");

    const isTemplate = content.kind === "template";
    const template = content.kind === "template" ? await store.findTemplate(scope, content.name, content.language, line.id) : null;

    // 4 consent: automatic notices and templates a person starts outside the window (a reply in the window needs none)
    const needsConsent = scope.kind === "hotel" && rules.consent_required_for_automatic && isTemplate && (origin === "automatic" || !windowOpen) && !(req.transactional === true && template?.category === "utility");
    if (needsConsent && scope.kind === "hotel" && !(await store.hasConsent(scope, to))) return refuse("consent_missing");

    // 5 window (locked, Meta's rule): free text and buttons only inside the window, otherwise an approved template
    if (!isTemplate && !windowOpen) return refuse("window_closed");
    if (isTemplate && (template === null || template.status !== "approved")) return refuse("template_not_approved");

    // 6 category
    const category: UsageCategory = template ? template.category : "service";
    if (category === "marketing" && !rules.marketing_allowed) return refuse("marketing_not_allowed");

    // 7 daily cap on messages the hotel STARTS (a template outside the window); 0 means no cap
    const starts = isTemplate && !windowOpen;
    if (starts && rules.daily_cap > 0 && (await store.startedToday(scope, now)) >= rules.daily_cap) return refuse("daily_cap_reached");

    // the token, opened only now, only for this call
    let token: string;
    try {
      token = deps.openToken(line.sealedToken, line.phoneNumberId);
    } catch {
      await store.markNeedsReconnect(line.id);
      return refuse("line_token_unreadable");
    }

    // 8 payload: on the shared line the hotel's name is the first line, in bold
    let hotelLabel: string | null = null;
    if (scope.kind === "hotel" && line.kind === "shared" && rules.hotel_label_on_messages) {
      const name = await store.hotelLabel(scope.hotelId);
      if (name !== null && name.trim() !== "") hotelLabel = label(name);
    }

    // 9 insert 'pending' FIRST. A repeat of the same id never sends again, except a row that failed in a clearly retryable way.
    const inserted = await store.insertPending({
      id: req.id,
      scope,
      lineId: line.id,
      to,
      kind: content.kind,
      body: content.kind === "text" ? content.body : content.kind === "interactive" ? content.summary : null,
      templateName: content.kind === "template" ? content.name : null,
      sentBy: req.by.id,
      createdAt: now,
    });
    if (!inserted.created) {
      const ex = inserted.existing;
      if (!(ex.status === "failed" && isRetryableCode(ex.failureCode))) {
        return { ok: ex.status !== "failed", status: "duplicate", code: ex.failureCode ?? "", message: "This message was already handled.", messageId: req.id, wamid: ex.wamid ?? undefined, lineId: line.id, existingStatus: ex.status };
      }
      await store.updateMessage(scope, req.id, { status: "pending", failureCode: null });
    } else if (starts) {
      await store.bumpUsage(scope, line.id, category, now, { started: 1 });
    }

    // 10 call Meta
    let outcome: Awaited<ReturnType<GraphClient["sendText"]>>;
    try {
      if (content.kind === "text") {
        const text = hotelLabel ? `${hotelLabel}\n${content.body}` : content.body;
        // on the shared number a person's reply carries a "Wrong hotel?" button (a reply button is free text's twin: only inside the window, which a text reply is)
        const withButton = scope.kind === "hotel" && line.kind === "shared" && origin === "staff" && windowOpen && rules.wrong_hotel_button && text.length <= BODY_MAX;
        outcome = withButton
          ? await graph.sendInteractive(token, line.phoneNumberId, to, { type: "button", body: { text }, action: { buttons: [{ type: "reply", reply: { id: wrongButtonId((scope as { hotelId: string }).hotelId), title: textsFor(content.body).t.wrongButton } }] } })
          : await graph.sendText(token, line.phoneNumberId, to, text);
      }
      else if (content.kind === "template") outcome = await graph.sendTemplate(token, line.phoneNumberId, to, { name: content.name, language: metaLanguageCode(content.language), bodyVariables: content.variables });
      else outcome = await graph.sendInteractive(token, line.phoneNumberId, to, withLabel(content.interactive, hotelLabel));
    } catch {
      outcome = { kind: "unknown", code: "unknown_outcome" };
    }

    // 11 outcome
    const base = { messageId: req.id, lineId: line.id };
    switch (outcome.kind) {
      case "ok":
        await store.updateMessage(scope, req.id, { status: "sent", wamid: outcome.wamid, failureCode: null });
        await store.bumpUsage(scope, line.id, category, now, { sent: 1 });
        await store.touchLastOut(scope, to, now);
        await store.resetTokenFailures(line.id);
        return { ok: true, status: "sent", code: "", message: "Sent.", wamid: outcome.wamid, ...base };
      case "policy":
        await store.updateMessage(scope, req.id, { status: "failed", failureCode: outcome.code });
        await store.bumpUsage(scope, line.id, category, now, { failed: 1 });
        return { ok: false, status: "failed", code: outcome.code, message: failureText(outcome.code), ...base };
      case "transient":
        await store.updateMessage(scope, req.id, { status: "failed", failureCode: outcome.code });
        await store.bumpUsage(scope, line.id, category, now, { failed: 1 });
        return { ok: false, status: "retry", code: outcome.code, message: failureText(outcome.code), retryAfterSeconds: outcome.retryAfterSeconds, ...base };
      case "auth": {
        await store.updateMessage(scope, req.id, { status: "failed", failureCode: "token_invalid" });
        await store.bumpUsage(scope, line.id, category, now, { failed: 1 });
        const failures = await store.recordTokenFailure(line.id);
        const stop = failures >= 2;
        if (stop) await store.markNeedsReconnect(line.id);
        return { ok: false, status: "failed", code: "token_invalid", message: failureText("token_invalid"), lineNeedsReconnect: stop, ...base };
      }
      default:
        // unknown: stay 'pending' with the marker. Never resent here; a status webhook or a person decides.
        await store.updateMessage(scope, req.id, { status: "pending", failureCode: "unknown_outcome" });
        return { ok: false, status: "unknown", code: "unknown_outcome", message: failureText("unknown_outcome"), ...base };
    }
  }

  return { send };
}

/** Put the bold hotel name at the top of an interactive message's body text (when it has one). */
function withLabel(interactive: Record<string, unknown>, hotelLabel: string | null): Record<string, unknown> {
  if (hotelLabel === null) return interactive;
  const body = interactive.body;
  if (typeof body !== "object" || body === null || typeof (body as { text?: unknown }).text !== "string") return interactive;
  return { ...interactive, body: { ...body, text: `${hotelLabel}\n${(body as { text: string }).text}` } };
}

import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { isPortalAccount } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";
import type { GraphClient, GraphFailure, GraphOutcome } from "../../whatsapp/graph";
import { digitsOf } from "../../whatsapp/config";
import { openPin, openToken, sealPin, sealToken } from "../../whatsapp/seal";
import type { WaLineKind, WaLineStatus } from "../../whatsapp/ports";
import { auditRow, createGate, type AuditInput, type Gate, type PlatformMeta } from "../platform/access";
import type { LineAdminStore, LinePatch, LineRecord, WaQuality } from "./connectionPorts";

// The WhatsApp connection manager, backend (plan part 28.2, 28.5, 28.6): Super Admin and Platform Admin connect and watch the lines. What every step follows:
//   - the token is typed once, sealed at once (bound to the line's phone number id) and never returned, logged, audited or put in an error; only "token saved on ... by ..." is shown
//   - a step that calls Meta answers with a result (ok, a plain sentence when it failed, the line's fresh health) instead of an error, so the screen can show it beside the step
//   - every write is audited (who, what, line, old and new NON-secret values, result code); a refused or failed one is kept as a failed row
//   - a token that fails twice in a row (HTTP 401 from Meta) marks the line "needs_reconnect"
// The audit rows go through the platform audit (action "settings_updated", entity "platform"); the step is in the reason ("whatsapp:line_verified: ok").

/** The webhook fields the HMS app listens to; Meta keeps them per app, the checklist on the screen lists them. */
export const WHATSAPP_FIELDS: readonly string[] = ["messages"];
export const WEBHOOK_PATH = "/api/v1/whatsapp/webhook";
/** The test message: Meta's own "hello_world" template exists on every new business account, so a number that never wrote to us can be tested. Verify against a real number (plan 27.9). */
const TEST_TEMPLATE = { name: "hello_world", language: "en_US", bodyVariables: [] as string[] };

export type ConnectStep = "line_connected" | "line_verified" | "line_subscribed" | "line_registered" | "line_test_sent" | "token_replaced" | "line_paused" | "line_resumed" | "line_disconnected";

/** One line as the screen may see it: health, never a token or a PIN. */
export interface LineView {
  id: string;
  kind: WaLineKind;
  /** What the operator types to confirm (display name, else display number, else the number id). */
  label: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string | null;
  displayName: string | null;
  status: WaLineStatus;
  /** Plain state of the token: valid, unchecked, failing (one 401), needs_reconnect or disconnected. */
  tokenState: "valid" | "unchecked" | "failing" | "needs_reconnect" | "disconnected";
  tokenSavedAt: string | null;
  tokenSavedBy: string | null;
  tokenCheckedAt: string | null;
  quality: WaQuality;
  nameStatus: string | null;
  messagingTier: string | null;
  registered: boolean;
  webhookSubscribed: boolean;
  subscribedFields: string[];
  lastEventAt: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  lastErrorText: string | null;
  lastErrorAt: string | null;
  hotelsAttached: number;
  ownerLoginId: string | null;
  managed: boolean;
  createdAt: string;
}

/** What a step that calls Meta answers. `ok` false carries a plain sentence for the operator and the short code; the line is always the fresh state. */
export interface StepResult {
  ok: boolean;
  code: string | null;
  message: string | null;
  line: LineView;
  /** Test send only: Meta accepted it (delivery arrives later by the status webhook). */
  accepted?: boolean;
}

export interface AppStatus {
  appSecret: boolean;
  verifyToken: boolean;
  sealKey: boolean;
  graphVersion: string;
  /** The one address to give Meta; null when HMS_PUBLIC_URL is not set. */
  callbackUrl: string | null;
  /** The webhook fields the app must be subscribed to. */
  fields: string[];
  /** The latest time any line was verified with Meta. */
  lastVerifiedAt: string | null;
  lines: number;
}

export interface CreateLineInput {
  kind: WaLineKind;
  phoneNumberId: string;
  wabaId: string;
  token: string;
  hotelId?: string;
  personId?: string;
}

export interface ConnectionDeps {
  unit: PlatformConsoleUnit;
  lines: LineAdminStore;
  /** The Graph client (tests pass one over fakeMeta). */
  graph: () => GraphClient;
  /** The key that seals tokens; null while WhatsApp is not set up on the server. */
  sealKey: () => Buffer | null;
  /** The app-secret status, from whatsappConfigStatus(). */
  configStatus: () => { appSecret: boolean; verifyToken: boolean; sealKey: boolean; graphVersion: string };
  /** HMS_PUBLIC_URL, for the callback address. */
  publicUrl: () => string | null;
  /** The file storage test (compose/whatsappMedia.ts checkWhatsAppStorage): writes, reads and deletes one tiny test file. Absent in tests. */
  storage?: { check(): Promise<{ ok: boolean; message: string }> };
  /** The encrypted backup of WhatsApp chats (compose/whatsappBackup.ts): a pass now, and opening the newest copies to check them. Absent in tests. */
  backup?: { run(): Promise<{ ok: boolean; message: string }>; verify(): Promise<{ ok: boolean; message: string }> };
  now: () => Date;
  gate?: Gate;
  /** Six digits; tests fix it. */
  newPin?: () => string;
}

const labelOf = (l: LineRecord): string => l.displayName ?? l.displayPhone ?? `Line ${l.phoneNumberId}`;
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const isDisconnected = (l: LineRecord): boolean => l.status === "paused" && l.lastErrorCode === "disconnected";

/** Meta's short codes (graph.ts) as sentences an operator can act on. */
export function plainFailure(code: string): string {
  switch (code) {
    case "token_invalid":
      return "Meta rejected the access token. It may be wrong, expired or revoked. Replace the token.";
    case "token_unreadable":
      return "The saved token cannot be opened on this server. Replace the token.";
    case "rate_limited":
    case "pair_rate_limited":
      return "Meta is limiting requests right now. Wait a minute and try again.";
    case "network_error":
    case "server_error":
    case "bad_answer":
      return "Could not get a clear answer from Meta. Nothing was changed. Try again shortly.";
    case "unknown_outcome":
      return "Meta did not answer in time. The message may or may not have been sent.";
    case "invalid_parameter":
    case "meta_100":
    case "meta_33":
    case "http_400":
    case "http_404":
      return "This token cannot see that phone number, or the number id or business account id is wrong. Check both ids and that the token belongs to that business account.";
    case "meta_10":
    case "meta_200":
    case "meta_299":
      return "The token is valid but does not have permission for WhatsApp on this business account. Give the system user the WhatsApp management and messaging permissions in Meta.";
    case "recipient_not_allowed":
      return "That phone is not on this test number's allowed list in Meta. Add it there, or use a number that is.";
    case "undeliverable":
      return "That is not a WhatsApp number, or the person has not accepted WhatsApp's terms.";
    case "account_locked":
    case "account_restricted":
      return "Meta has restricted this number's business account. Check the account in Meta Business Suite.";
    case "template_missing":
      return "The test template is missing on this business account. Create or approve it in Meta, then test again.";
    default:
      return `Meta refused this step (code ${code}). Check the number and token in Meta Business Suite.`;
  }
}

const QUALITY: Readonly<Record<string, WaQuality>> = { GREEN: "green", YELLOW: "yellow", RED: "red" };

export function createConnectionService(deps: ConnectionDeps) {
  const { unit, lines, now } = deps;
  const gate = deps.gate ?? createGate(unit, now);
  const newPin = deps.newPin ?? ((): string => String(randomInt(0, 1_000_000)).padStart(6, "0"));
  const probe = (step: ConnectStep, id: string | null): AuditInput => ({ action: "settings_updated", entity: "platform", entityId: id, reason: `whatsapp:${step}` });

  function view(l: LineRecord): LineView {
    const tokenState: LineView["tokenState"] = isDisconnected(l) ? "disconnected" : l.status === "needs_reconnect" ? "needs_reconnect" : l.tokenFailures > 0 ? "failing" : l.tokenCheckedAt === null ? "unchecked" : "valid";
    return {
      id: l.id, kind: l.kind, label: labelOf(l), phoneNumberId: l.phoneNumberId, wabaId: l.wabaId, displayPhone: l.displayPhone, displayName: l.displayName, status: l.status, tokenState,
      tokenSavedAt: iso(l.connectedAt), tokenSavedBy: l.connectedByName, tokenCheckedAt: iso(l.tokenCheckedAt), quality: l.quality, nameStatus: l.nameStatus, messagingTier: l.messagingTier,
      registered: l.registered, webhookSubscribed: l.webhookSubscribed, subscribedFields: l.subscribedFields, lastEventAt: iso(l.lastEventAt), lastVerifiedAt: iso(l.lastVerifiedAt),
      lastErrorCode: l.lastErrorCode, lastErrorText: l.lastErrorCode === null || l.lastErrorCode === "disconnected" ? null : plainFailure(l.lastErrorCode), lastErrorAt: iso(l.lastErrorAt),
      hotelsAttached: l.hotelsAttached, ownerLoginId: l.ownerLoginId, managed: l.managed, createdAt: l.createdAt.toISOString(),
    };
  }

  /** Super Admin only (MJ, 5 Nov 2026), from the session (an API key, an Enter-hotel visit and a portal account are refused), before anything is read. */
  function readGate(session: VerifiedSession): void {
    if (session.token !== undefined || session.visit !== undefined || isPortalAccount(session)) throw new AppError("FORBIDDEN");
    gate.superRead(session);
  }

  /** The same for a write; a refusal is audited as a failed row. Returns the actor. */
  async function writeGate(session: VerifiedSession, meta: PlatformMeta, step: ConnectStep, id: string | null) {
    if (session.token !== undefined || session.visit !== undefined || isPortalAccount(session)) throw await gate.refuse(session, meta, probe(step, id), new AppError("FORBIDDEN"));
    await gate.superWrite(session, meta, probe(step, id));
    return unit.run((repos) => gate.actor(repos, session));
  }

  /** One audit row for a finished step, in its own unit (the line change and the audit are separate transactions: the line change stands even if the audit write fails, and the failure is thrown). */
  async function audit(session: VerifiedSession, meta: PlatformMeta, step: ConnectStep, line: LineRecord, ok: boolean, code: string | null, before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
    await unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const input: AuditInput = { ...probe(step, line.id), targetLabel: labelOf(line), reason: `whatsapp:${step}: ${ok ? "ok" : (code ?? "failed")}`, before, after: { lineId: line.id, ...after } };
      await repos.audit.write(auditRow({ userId: actor.userId, name: actor.name, role: actor.role }, meta, input, ok ? "success" : "failed", now()));
    });
  }

  async function mustGet(id: string): Promise<LineRecord> {
    const line = await lines.get(id);
    if (!line) throw new AppError("NOT_FOUND");
    return line;
  }

  const requireKey = (): Buffer => {
    const key = deps.sealKey();
    if (!key) throw new AppError("CONFLICT", "WhatsApp is not set up on the server yet (the app secret, the verify token and the hash key must be set).");
    return key;
  };

  /** A line a step may work on: not banned, not disconnected (replace the token first). */
  function workable(line: LineRecord): void {
    if (line.status === "banned") throw new AppError("CONFLICT", "Meta has banned this number. It cannot be used.");
    if (isDisconnected(line)) throw new AppError("CONFLICT", "This line is disconnected. Replace its token to connect it again.");
  }

  /**
   * One call to Meta with the line's own token. Keeps the failure bookkeeping (a 401 counts; two in a row mark the line needs_reconnect; any success clears the count) and returns
   * either Meta's answer or the failure code. Never throws for a Meta failure and never puts the token anywhere.
   */
  async function callMeta<T>(line: LineRecord, work: (token: string, g: GraphClient) => Promise<GraphOutcome<T>>): Promise<{ ok: true; value: Extract<GraphOutcome<T>, { kind: "ok" }>; line: LineRecord } | { ok: false; code: string; failure: GraphFailure | null; line: LineRecord }> {
    const key = requireKey();
    const at = now();
    let token: string;
    try {
      token = openToken(key, line.tokenSecret, line.phoneNumberId);
    } catch {
      const updated = (await lines.update(line.id, { lastErrorCode: "token_unreadable", lastErrorAt: at, status: line.status === "active" || line.status === "test" ? "needs_reconnect" : line.status }, at)) ?? line;
      return { ok: false, code: "token_unreadable", failure: null, line: updated };
    }
    const outcome = await work(token, deps.graph());
    if (outcome.kind === "ok") return { ok: true, value: outcome as Extract<GraphOutcome<T>, { kind: "ok" }>, line };
    const patch: LinePatch = { lastErrorCode: outcome.code, lastErrorAt: at };
    if (outcome.kind === "auth") {
      patch.tokenFailures = line.tokenFailures + 1;
      if (patch.tokenFailures >= 2 && (line.status === "active" || line.status === "test")) patch.status = "needs_reconnect";
    }
    const updated = (await lines.update(line.id, patch, at)) ?? line;
    return { ok: false, code: outcome.code, failure: outcome, line: updated };
  }

  const succeed = (l: LineRecord, extra: Partial<StepResult> = {}): StepResult => ({ ok: true, code: null, message: null, line: view(l), ...extra });
  const fail = (l: LineRecord, code: string): StepResult => ({ ok: false, code, message: plainFailure(code), line: view(l) });

  /** After a good Meta call: the token is proven, so the count of failures is cleared. */
  const proven = (at: Date): LinePatch => ({ tokenFailures: 0, tokenCheckedAt: at });

  return {
    /** Every line with its health (plan 28.2). */
    async list(session: VerifiedSession): Promise<{ lines: LineView[] }> {
      readGate(session);
      await unit.run((repos) => gate.actor(repos, session));
      return { lines: (await lines.list()).map(view) };
    },

    /** Steps 1 and 2: kind, owner, ids and the token (sealed at once). The new line is in status "test". */
    async create(session: VerifiedSession, input: CreateLineInput, meta: PlatformMeta): Promise<{ line: LineView }> {
      const actor = await writeGate(session, meta, "line_connected", null);
      const refuse = async (message: string, field?: string): Promise<never> => {
        throw await gate.refuse(session, meta, probe("line_connected", null), new AppError(field ? "VALIDATION_FAILED" : "CONFLICT", message, field ? { fields: { [field]: message } } : undefined));
      };
      // seal before anything else touches the token: from here on only the sealed text exists
      const key = requireKey();
      const tokenSecret = sealToken(key, input.token, input.phoneNumberId);
      if (input.kind === "group") return refuse("Group lines are not connected here yet.", "kind");
      if (input.kind === "hotel") {
        if (!input.hotelId) return refuse("Choose the hotel this number belongs to.", "hotelId");
        if (!(await lines.hotelExists(input.hotelId))) return refuse("That hotel was not found.", "hotelId");
      } else if (input.hotelId) return refuse("Only a hotel's own line takes a hotel.", "hotelId");
      if (input.kind === "person") {
        if (!input.personId) return refuse("Choose the person this number belongs to.", "personId");
        if (!(await lines.loginExists(input.personId))) return refuse("That person was not found.", "personId");
      } else if (input.personId) return refuse("Only a person's line takes a person.", "personId");
      const made = await lines.create({ kind: input.kind, phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, tokenSecret, ownerLoginId: input.kind === "person" ? (input.personId ?? null) : null, hotelId: input.kind === "hotel" ? (input.hotelId ?? null) : null, connectedBy: actor.userId, at: now() });
      if (!made.ok) {
        const text = made.reason === "number_taken" ? "That number is already attached to a line." : made.reason === "platform_exists" ? "There is already a platform line. Extra numbers are connected as person lines." : "That hotel already has its own line.";
        return refuse(text);
      }
      await audit(session, meta, "line_connected", made.line, true, null, null, { kind: made.line.kind, phoneNumberId: made.line.phoneNumberId, wabaId: made.line.wabaId, hotelId: input.hotelId ?? null, personId: input.personId ?? null, status: made.line.status });
      return { line: view(made.line) };
    },

    /** Step 3: read the number from Meta; shows the display number, verified name, quality and messaging limit, and proves the token. */
    async verify(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<StepResult> {
      await writeGate(session, meta, "line_verified", id);
      const line = await mustGet(id);
      workable(line);
      const before = { quality: line.quality, messagingTier: line.messagingTier, displayPhone: line.displayPhone, status: line.status };
      const r = await callMeta(line, (token, g) => g.getPhoneNumber(token, line.phoneNumberId));
      if (!r.ok) {
        await audit(session, meta, "line_verified", r.line, false, r.code, before, null);
        return fail(r.line, r.code);
      }
      const at = now();
      const info = r.value;
      const patch: LinePatch = {
        ...proven(at), lastVerifiedAt: at, lastErrorCode: null, lastErrorAt: null, displayPhone: info.displayNumber, displayName: info.verifiedName,
        quality: QUALITY[(info.quality ?? "").toUpperCase()] ?? "unknown", messagingTier: info.messagingTier,
        // the call returns no approval state of its own: a number with a verified name has been through Meta's name check
        nameStatus: info.verifiedName !== null ? "named" : "not_named",
        status: line.status === "needs_reconnect" ? "test" : line.status,
      };
      const updated = (await lines.update(line.id, patch, at)) ?? line;
      await audit(session, meta, "line_verified", updated, true, null, before, { quality: updated.quality, messagingTier: updated.messagingTier, displayPhone: updated.displayPhone, status: updated.status });
      return succeed(updated);
    },

    /** Step 4: subscribe the business account to the HMS app. Doing it again is harmless (Meta answers success). */
    async subscribe(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<StepResult> {
      await writeGate(session, meta, "line_subscribed", id);
      const line = await mustGet(id);
      workable(line);
      const before = { webhookSubscribed: line.webhookSubscribed, subscribedFields: line.subscribedFields };
      const r = await callMeta(line, (token, g) => g.subscribeApp(token, line.wabaId));
      if (!r.ok) {
        await audit(session, meta, "line_subscribed", r.line, false, r.code, before, null);
        return fail(r.line, r.code);
      }
      const at = now();
      const updated = (await lines.update(line.id, { ...proven(at), webhookSubscribed: true, subscribedFields: [...WHATSAPP_FIELDS], lastErrorCode: null }, at)) ?? line;
      await audit(session, meta, "line_subscribed", updated, true, null, before, { webhookSubscribed: true, subscribedFields: updated.subscribedFields });
      return succeed(updated);
    },

    /** Step 5: register the number with its two-step PIN. The PIN is made here, sealed, never returned; a repeat reuses the saved PIN. */
    async register(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<StepResult> {
      await writeGate(session, meta, "line_registered", id);
      const line = await mustGet(id);
      workable(line);
      const key = requireKey();
      let pin: string | null = null;
      if (line.pinSecret !== null) {
        try {
          pin = openPin(key, line.pinSecret, line.phoneNumberId);
        } catch {
          pin = null;
        }
      }
      const fresh = pin === null;
      pin ??= newPin();
      const before = { registered: line.registered };
      const sealedPin = fresh ? sealPin(key, pin, line.phoneNumberId) : line.pinSecret;
      const r = await callMeta(line, (token, g) => g.registerNumber(token, line.phoneNumberId, pin as string));
      if (!r.ok) {
        await audit(session, meta, "line_registered", r.line, false, r.code, before, null);
        return fail(r.line, r.code);
      }
      const at = now();
      const updated = (await lines.update(line.id, { ...proven(at), registered: true, pinSecret: sealedPin, lastErrorCode: null }, at)) ?? line;
      await audit(session, meta, "line_registered", updated, true, null, before, { registered: true });
      return succeed(updated);
    },

    /** Step 6: send the test message to a number the operator types. Only the last four digits are kept in the audit. */
    async test(session: VerifiedSession, id: string, to: string, meta: PlatformMeta): Promise<StepResult> {
      await writeGate(session, meta, "line_test_sent", id);
      const line = await mustGet(id);
      workable(line);
      const digits = digitsOf(to);
      if (digits === null) throw await gate.refuse(session, meta, probe("line_test_sent", id), new AppError("VALIDATION_FAILED", "Type the phone number with its country code, for example +91 98250 41236.", { fields: { to: "Type the phone number with its country code." } }));
      const tail = digits.slice(-4);
      const r = await callMeta(line, (token, g) => g.sendTemplate(token, line.phoneNumberId, digits, TEST_TEMPLATE));
      if (!r.ok) {
        await audit(session, meta, "line_test_sent", r.line, false, r.code, null, { toEnding: tail });
        return { ...fail(r.line, r.code), accepted: false };
      }
      const at = now();
      const updated = (await lines.update(line.id, { ...proven(at), lastErrorCode: null }, at)) ?? line;
      await audit(session, meta, "line_test_sent", updated, true, null, null, { toEnding: tail, accepted: true });
      return succeed(updated, { accepted: true });
    },

    /** Replaces the token (sealed at once, never echoed). Failures are cleared; history stays. An active line needs the line's name typed as confirmation. */
    async replaceToken(session: VerifiedSession, id: string, input: { token: string; confirm?: string }, meta: PlatformMeta): Promise<{ line: LineView }> {
      await writeGate(session, meta, "token_replaced", id);
      const key = requireKey();
      const line = await mustGet(id);
      if (line.status === "banned") throw await gate.refuse(session, meta, probe("token_replaced", id), new AppError("CONFLICT", "Meta has banned this number. It cannot be used."));
      if (line.status === "active") await confirmed(session, meta, "token_replaced", line, input.confirm);
      const sealed = sealToken(key, input.token, line.phoneNumberId);
      const at = now();
      const before = { status: line.status, tokenFailures: line.tokenFailures };
      const wasDown = line.status === "needs_reconnect";
      const updated = (await lines.update(line.id, { tokenSecret: sealed, tokenFailures: 0, tokenCheckedAt: null, lastErrorCode: null, lastErrorAt: null, status: wasDown ? "test" : line.status }, at)) ?? line;
      await audit(session, meta, "token_replaced", updated, true, null, before, { status: updated.status, tokenFailures: 0 });
      return { line: view(updated) };
    },

    /** Stops sending on a line (the screen then shows "paused"). Nothing is deleted. */
    async pause(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<{ line: LineView }> {
      await writeGate(session, meta, "line_paused", id);
      const line = await mustGet(id);
      workable(line);
      if (line.status === "paused") return { line: view(line) };
      const before = { status: line.status };
      const updated = (await lines.update(line.id, { status: "paused" }, now())) ?? line;
      await audit(session, meta, "line_paused", updated, true, null, before, { status: "paused" });
      return { line: view(updated) };
    },

    /** Go live: a test or paused line becomes active. A line that needs its token replaced cannot. */
    async resume(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<{ line: LineView }> {
      await writeGate(session, meta, "line_resumed", id);
      const line = await mustGet(id);
      workable(line);
      if (line.status === "needs_reconnect") throw await gate.refuse(session, meta, probe("line_resumed", id), new AppError("CONFLICT", "This line needs its token replaced before it can go live."));
      if (line.status === "active") return { line: view(line) };
      const before = { status: line.status };
      const updated = (await lines.update(line.id, { status: "active" }, now())) ?? line;
      await audit(session, meta, "line_resumed", updated, true, null, before, { status: "active" });
      return { line: view(updated) };
    },

    /**
     * Disconnects a line (the name typed as confirmation). Refused while any hotel is attached. Rows are never deleted: the line is paused, its token is overwritten with a sealed throw-away
     * value (HMS can no longer call Meta with it), its PIN is dropped and "disconnected" is shown. A new token reconnects it.
     */
    async disconnect(session: VerifiedSession, id: string, input: { confirm?: string }, meta: PlatformMeta): Promise<{ line: LineView }> {
      await writeGate(session, meta, "line_disconnected", id);
      const key = requireKey();
      const line = await mustGet(id);
      if (line.hotelsAttached > 0) throw await gate.refuse(session, meta, probe("line_disconnected", id), new AppError("CONFLICT", `${labelOf(line)} is still used by ${line.hotelsAttached} hotel${line.hotelsAttached === 1 ? "" : "s"}. Move them off this line first.`));
      await confirmed(session, meta, "line_disconnected", line, input.confirm);
      if (isDisconnected(line)) return { line: view(line) };
      const at = now();
      const before = { status: line.status, webhookSubscribed: line.webhookSubscribed, registered: line.registered };
      const updated = (await lines.update(line.id, { status: "paused", tokenSecret: sealToken(key, randomBytes(24).toString("base64url"), line.phoneNumberId), pinSecret: null, registered: false, webhookSubscribed: false, subscribedFields: [], tokenFailures: 0, lastErrorCode: "disconnected", lastErrorAt: at }, at)) ?? line;
      await audit(session, meta, "line_disconnected", updated, true, null, before, { status: "paused", webhookSubscribed: false, registered: false });
      return { line: view(updated) };
    },

    /** Whether the app's settings are present (never their values), the address to give Meta and the fields to subscribe. */
    async appStatus(session: VerifiedSession): Promise<AppStatus> {
      readGate(session);
      await unit.run((repos) => gate.actor(repos, session));
      const all = await lines.list();
      const base = deps.publicUrl();
      const latest = all.reduce<Date | null>((m, l) => (l.lastVerifiedAt !== null && (m === null || l.lastVerifiedAt > m) ? l.lastVerifiedAt : m), null);
      return { ...deps.configStatus(), callbackUrl: base ? `${base.replace(/\/+$/, "")}${WEBHOOK_PATH}` : null, fields: [...WHATSAPP_FIELDS], lastVerifiedAt: iso(latest), lines: all.length };
    },

    /** Can this server keep the guests' files? One tiny test file is written, read and deleted in the WhatsApp folder of the bucket. Nothing of a guest is touched. */
    async storageCheck(session: VerifiedSession): Promise<{ ok: boolean; message: string }> {
      readGate(session);
      await unit.run((repos) => gate.actor(repos, session));
      if (!deps.storage) return { ok: false, message: "File storage is not set up on this server (the S3 settings are missing), so guests' files are not kept." };
      return deps.storage.check();
    },

    /** "Back up now" (a pass for every scope without today's copy) or "Verify backups" (open the newest copy of every scope). Super Admin and Platform Admin only. */
    async backupStep(session: VerifiedSession, step: "run" | "verify"): Promise<{ ok: boolean; message: string }> {
      readGate(session);
      await unit.run((repos) => gate.actor(repos, session));
      if (!deps.backup) return { ok: false, message: "Backups are not set up on this server." };
      return step === "run" ? deps.backup.run() : deps.backup.verify();
    },
  };

  /** The operator typed the line's name (or its number id) to confirm a risky step; anything else is refused and audited. */
  async function confirmed(session: VerifiedSession, meta: PlatformMeta, step: ConnectStep, line: LineRecord, typed: string | undefined): Promise<void> {
    const t = (typed ?? "").trim().toLowerCase();
    if (t === "" || (t !== labelOf(line).toLowerCase() && t !== line.phoneNumberId)) {
      throw await gate.refuse(session, meta, probe(step, line.id), new AppError("VALIDATION_FAILED", `Type the line's name (${labelOf(line)}) to confirm.`, { fields: { confirm: `Type the line's name (${labelOf(line)}) to confirm.` } }));
    }
  }
}

export type ConnectionService = ReturnType<typeof createConnectionService>;

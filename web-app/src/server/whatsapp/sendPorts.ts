import "server-only";
// The store the send pipeline (send.ts, plan part 12) stands on. A port here, an in-memory double in sendMemory.ts for tests, the PostgreSQL repository later (the hotel's conv_messages,
// wa_usage, wa_optouts, wa_templates and customers.wa_consent_at, or the platform's conversation tables). A "scope" says whose database the message belongs to.
import type { WaLineKind, WaLineStatus } from "./ports";

export type SendScope = { kind: "hotel"; hotelId: string } | { kind: "platform" };

/** A line as the sender needs it: the sealed token is opened by the sender's own `openToken`, never by the store. */
export interface SendLine {
  id: string;
  kind: WaLineKind;
  phoneNumberId: string;
  wabaId: string;
  status: WaLineStatus;
  sealedToken: string;
}

/** Every restriction switch of plan part 6 that the sender reads (the others belong to routing and to the move). */
export interface WaRules {
  hotel_may_start_chats: boolean;
  recipients_stay_guests_only: boolean;
  /** Locked: Meta's own rule. Present so the Rules screen can show it, ignored by the sender. */
  templates_only_for_new_messages: boolean;
  marketing_allowed: boolean;
  /** Messages a hotel may start per day. 0 means no cap. */
  daily_cap: number;
  consent_required_for_automatic: boolean;
  hotel_label_on_messages: boolean;
  platform_blocklist_enabled: boolean;
  /** A hotel's reply on the shared number carries a "Wrong hotel?" button, so a guest who reached the wrong hotel can be asked again which one they meant. */
  wrong_hotel_button: boolean;
}
export type WaRuleName = keyof WaRules;

/** The three places a switch can be set, each a partial set (a missing key means "not set here"). Resolved hotel override, then line profile, then global default (plan part 6). */
export interface RuleLayers {
  hotelOverride: Partial<WaRules>;
  lineProfile: Partial<WaRules>;
  globalDefault: Partial<WaRules>;
  /** The per-hotel kill switch (rules_override.hotel_paused): a paused hotel sends nothing. Not a rule of the three layers. */
  hotelPaused?: boolean;
}

export interface WindowInfo {
  /** wa_window_closes_at of the conversation, null when the guest never wrote. */
  closesAt: Date | null;
  /** The line of the guest's last inbound message. */
  lastInboundLineId: string | null;
}

export type TemplateStatus = "draft" | "pending" | "approved" | "rejected" | "paused";
export type TemplateCategory = "utility" | "authentication" | "marketing";
export interface TemplateInfo {
  status: TemplateStatus;
  category: TemplateCategory;
}

export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export type UsageCategory = "service" | TemplateCategory;

export interface PendingMessage {
  /** Chosen by the caller so a repeated request inserts once. */
  id: string;
  scope: SendScope;
  lineId: string;
  /** The guest's number as digits. */
  to: string;
  kind: "text" | "template" | "interactive";
  /** The text staff wrote (no hotel label), or a short description for a template or button message. Held in the conversation table only, never logged. */
  body: string | null;
  templateName: string | null;
  sentBy: string;
  createdAt: Date;
}

export interface StoredMessage {
  id: string;
  status: MessageStatus;
  wamid: string | null;
  failureCode: string | null;
}

export interface MessagePatch {
  status: MessageStatus;
  wamid?: string | null;
  /** A short machine code; null clears it. "unknown_outcome" on a pending row is the marker reconciliation looks for (plan 26.4). */
  failureCode?: string | null;
}

export interface UsageDelta {
  started?: number;
  sent?: number;
  failed?: number;
}

export interface WaSendStore {
  /** A platform setting's value as text (whatsapp.enabled is "true" when on), null when never set. */
  setting(key: string): Promise<string | null>;
  lineById(id: string): Promise<SendLine | null>;
  /** The line the scope uses now (the hotel's current row of whatsapp_line_hotels; the platform line). */
  currentLine(scope: SendScope): Promise<SendLine | null>;
  ruleLayers(scope: SendScope, line: SendLine): Promise<RuleLayers>;
  /** The hotel's name for the bold first line. */
  hotelLabel(hotelId: string): Promise<string | null>;
  /** A current or upcoming stay or reservation at the hotel for this number. */
  hasStay(hotelId: string, digits: string): Promise<boolean>;
  /** The hotel's own wa_optouts (hotel scope) or the platform's list (platform scope). */
  isOptedOut(scope: SendScope, digits: string): Promise<boolean>;
  /** The platform-wide suppression ("STOP ALL" and the numbers a platform admin blocked). */
  isSuppressed(digits: string): Promise<boolean>;
  hasConsent(scope: SendScope, digits: string): Promise<boolean>;
  windowFor(scope: SendScope, digits: string): Promise<WindowInfo>;
  findTemplate(scope: SendScope, name: string, language: string, lineId: string): Promise<TemplateInfo | null>;
  /** Messages started today for the cap (the hotel's wa_usage.started summed over the day; the store decides the day from `now`). */
  startedToday(scope: SendScope, now: Date): Promise<number>;
  bumpUsage(scope: SendScope, lineId: string, category: UsageCategory, now: Date, delta: UsageDelta): Promise<void>;
  /** Insert with status pending, or report the row that already has this id (no second insert). */
  insertPending(message: PendingMessage): Promise<{ created: true } | { created: false; existing: StoredMessage }>;
  updateMessage(scope: SendScope, id: string, patch: MessagePatch): Promise<void>;
  /** guest_hotels.wa_last_out_at = now (hotel scope only; the platform store may ignore it). */
  touchLastOut(scope: SendScope, digits: string, now: Date): Promise<void>;
  /** Count one more failed token on the line and return the new count. */
  recordTokenFailure(lineId: string): Promise<number>;
  resetTokenFailures(lineId: string): Promise<void>;
  /** Status needs_reconnect: the sender stops using the line (and the Lines screen says why). */
  markNeedsReconnect(lineId: string): Promise<void>;
}

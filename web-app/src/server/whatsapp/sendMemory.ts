import "server-only";
// In-memory double of the send store, for unit tests. Every field is public so a test can set the scene (a stay, an opt-out, a closed window) and look at what the sender wrote.
import type { MessagePatch, PendingMessage, RuleLayers, SendLine, SendScope, StoredMessage, TemplateInfo, UsageCategory, UsageDelta, WaSendStore, WindowInfo, WaRules } from "./sendPorts";

const scopeKey = (s: SendScope): string => (s.kind === "hotel" ? `hotel:${s.hotelId}` : "platform");

export interface MemorySendStore extends WaSendStore {
  settings: Map<string, string>;
  lines: Map<string, SendLine>;
  /** scope key to the line id it uses now. */
  current: Map<string, string>;
  hotelOverrides: Map<string, Partial<WaRules>>;
  lineProfiles: Map<string, Partial<WaRules>>;
  globalDefault: Partial<WaRules>;
  hotelNames: Map<string, string>;
  /** "hotelId:digits" */
  stays: Set<string>;
  /** "scopeKey:digits" */
  optouts: Set<string>;
  suppressed: Set<string>;
  consent: Set<string>;
  windows: Map<string, WindowInfo>;
  /** "scopeKey:name:language" */
  templates: Map<string, TemplateInfo>;
  usage: { scope: string; lineId: string; category: UsageCategory; started: number; sent: number; failed: number }[];
  messages: Map<string, PendingMessage & StoredMessage>;
  lastOut: Map<string, Date>;
  tokenFailures: Map<string, number>;
}

export function createMemorySendStore(): MemorySendStore {
  const s: MemorySendStore = {
    settings: new Map(),
    lines: new Map(),
    current: new Map(),
    hotelOverrides: new Map(),
    lineProfiles: new Map(),
    globalDefault: {},
    hotelNames: new Map(),
    stays: new Set(),
    optouts: new Set(),
    suppressed: new Set(),
    consent: new Set(),
    windows: new Map(),
    templates: new Map(),
    usage: [],
    messages: new Map(),
    lastOut: new Map(),
    tokenFailures: new Map(),

    async setting(key) {
      return s.settings.get(key) ?? null;
    },
    async lineById(id) {
      const l = s.lines.get(id);
      return l ? { ...l } : null;
    },
    async currentLine(scope) {
      const id = s.current.get(scopeKey(scope));
      return id ? s.lineById(id) : null;
    },
    async ruleLayers(scope, line): Promise<RuleLayers> {
      return { hotelOverride: scope.kind === "hotel" ? (s.hotelOverrides.get(scope.hotelId) ?? {}) : {}, lineProfile: s.lineProfiles.get(line.id) ?? {}, globalDefault: s.globalDefault };
    },
    async hotelLabel(hotelId) {
      return s.hotelNames.get(hotelId) ?? null;
    },
    async hasStay(hotelId, digits) {
      return s.stays.has(`${hotelId}:${digits}`);
    },
    async isOptedOut(scope, digits) {
      return s.optouts.has(`${scopeKey(scope)}:${digits}`);
    },
    async isSuppressed(digits) {
      return s.suppressed.has(digits);
    },
    async hasConsent(scope, digits) {
      return s.consent.has(`${scopeKey(scope)}:${digits}`);
    },
    async windowFor(scope, digits) {
      return s.windows.get(`${scopeKey(scope)}:${digits}`) ?? { closesAt: null, lastInboundLineId: null };
    },
    async findTemplate(scope, name, language) {
      return s.templates.get(`${scopeKey(scope)}:${name}:${language}`) ?? null;
    },
    async startedToday(scope) {
      return s.usage.filter((u) => u.scope === scopeKey(scope)).reduce((n, u) => n + u.started, 0);
    },
    async bumpUsage(scope, lineId, category, _now, delta: UsageDelta) {
      let row = s.usage.find((u) => u.scope === scopeKey(scope) && u.lineId === lineId && u.category === category);
      if (!row) {
        row = { scope: scopeKey(scope), lineId, category, started: 0, sent: 0, failed: 0 };
        s.usage.push(row);
      }
      row.started += delta.started ?? 0;
      row.sent += delta.sent ?? 0;
      row.failed += delta.failed ?? 0;
    },
    async insertPending(message) {
      const have = s.messages.get(message.id);
      if (have) return { created: false, existing: { id: have.id, status: have.status, wamid: have.wamid, failureCode: have.failureCode } };
      s.messages.set(message.id, { ...message, status: "pending", wamid: null, failureCode: null });
      return { created: true };
    },
    async updateMessage(_scope, id, patch: MessagePatch) {
      const row = s.messages.get(id);
      if (!row) return;
      row.status = patch.status;
      if (patch.wamid !== undefined) row.wamid = patch.wamid;
      if (patch.failureCode !== undefined) row.failureCode = patch.failureCode;
    },
    async touchLastOut(scope, digits, now) {
      s.lastOut.set(`${scopeKey(scope)}:${digits}`, now);
    },
    async recordTokenFailure(lineId) {
      const n = (s.tokenFailures.get(lineId) ?? 0) + 1;
      s.tokenFailures.set(lineId, n);
      return n;
    },
    async resetTokenFailures(lineId) {
      s.tokenFailures.set(lineId, 0);
    },
    async markNeedsReconnect(lineId) {
      const l = s.lines.get(lineId);
      if (l) l.status = "needs_reconnect";
    },
  };
  return s;
}

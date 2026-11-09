import "server-only";
// The Rules screen's backend (WhatsApp plan part 6, task 11): the restriction switches of the three profiles (shared line, platform line, a hotel's own number), the numbers, a hotel's
// own overrides, and the kill switches. Super Admin only (MJ, 5 Nov 2026; never an API key or an Enter-hotel visit). Every change is audited per key with the OLD and NEW value, and nothing
// is cached: the sender reads the settings and the rows on its next message. The profiles and numbers are rows of platform.platform_settings (through the console unit, so the audit
// row commits with them); the lines and a hotel's overrides are the store port below (repos/postgres/whatsappRules.ts, in-memory double here).
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors/AppError";
import type { PlatformConsoleRepos, PlatformConsoleUnit } from "../../repos/platformConsole";
import { BUILTIN_RULES, isLockedRule, resolveRules } from "../../whatsapp/send";
import type { WaRuleName } from "../../whatsapp/sendPorts";
import type { WaLineKind, WaLineStatus } from "../../whatsapp/ports";
import { createGate, type PlatformMeta } from "../platform/access";

/* ---------------------------------------------------------------- the catalogue */

export type ProfileId = "shared" | "platform" | "own_default";
export const PROFILE_IDS: readonly ProfileId[] = ["shared", "platform", "own_default"];
const PROFILE_LABEL: Record<ProfileId, string> = { shared: "The shared line", platform: "The platform line", own_default: "A hotel's own number (the default)" };

/** The switch the routing module reads that WaRules (the sender's set) does not carry. */
export type ExtraRuleName = "automatic_messages_one_way";
export type RuleKey = WaRuleName | ExtraRuleName;
export type RuleValue = boolean | number;

const LOCKED_REASON: Partial<Record<RuleKey, string>> = {
  templates_only_for_new_messages: "Meta's own rule: free text only inside the 24 hour window, an approved template for anything else. It cannot be switched off.",
};
/** Locked rules that are not switches at all, shown greyed on the screen (plan part 6). */
export const LOCKED_NOTES: readonly string[] = [
  "STOP is always honoured: a number that opted out is never messaged.",
  "Message content and phone numbers never go to logs.",
  "A hotel never reads another hotel's chats, and the platform never reads a hotel's guest chats.",
];

interface RuleDef { key: RuleKey; type: "boolean" | "number"; label: string }
export const RULE_DEFS: readonly RuleDef[] = [
  { key: "hotel_may_start_chats", type: "boolean", label: "Hotels may start a chat" },
  { key: "recipients_stay_guests_only", type: "boolean", label: "Only guests with a stay or reservation may be messaged" },
  { key: "templates_only_for_new_messages", type: "boolean", label: "Approved templates only outside the 24 hour window" },
  { key: "marketing_allowed", type: "boolean", label: "Marketing messages allowed" },
  { key: "daily_cap", type: "number", label: "Messages a hotel may start per day (0 = no cap)" },
  { key: "consent_required_for_automatic", type: "boolean", label: "Guest consent needed for automatic messages" },
  { key: "hotel_label_on_messages", type: "boolean", label: "Hotel name in bold on the first line" },
  { key: "platform_blocklist_enabled", type: "boolean", label: "Platform block list applies" },
  { key: "wrong_hotel_button", type: "boolean", label: "A 'wrong hotel' button on replies" },
  { key: "automatic_messages_one_way", type: "boolean", label: "Automatic messages are one way" },
];
const DEF_OF = new Map<RuleKey, RuleDef>(RULE_DEFS.map((d) => [d.key, d]));
export const RULE_KEYS: readonly RuleKey[] = RULE_DEFS.map((d) => d.key);
const EXTRA_BUILTIN: Record<ExtraRuleName, boolean> = { automatic_messages_one_way: true };
const builtinOf = (k: RuleKey): RuleValue => (k in EXTRA_BUILTIN ? EXTRA_BUILTIN[k as ExtraRuleName] : BUILTIN_RULES[k as WaRuleName]);
function isLocked(k: RuleKey): boolean {
  return k in LOCKED_REASON || (!(k in EXTRA_BUILTIN) && isLockedRule(k as WaRuleName));
}
/** Every key a hotel override may carry: the unlocked switches, plus the hotel's own kill switch. */
export const HOTEL_PAUSED_KEY = "hotel_paused";
export const HOTEL_OVERRIDE_KEYS: readonly string[] = [...RULE_KEYS.filter((k) => !isLocked(k)), HOTEL_PAUSED_KEY];

export const NUMBER_KEYS = ["routing_timeframe_minutes", "default_daily_cap", "hold_minutes", "routing_mode", "transition_days", "media_max_mb", "media_keep_days", "media_keep_days_platform", "backup_keep_days", "default_language"] as const;
export type NumberKey = (typeof NUMBER_KEYS)[number];
export type RoutingMode = "strict" | "balanced";
/** The four languages WhatsApp texts can be written in: English, Hinglish (Hindi in English letters), Hindi and Gujarati. */
export const WA_LANGUAGES = ["en", "hinglish", "hi", "gu"] as const;
export type WaLanguage = (typeof WA_LANGUAGES)[number];
/** The settings that are a choice, not a number, with what may be chosen. */
export const OPTION_KEYS = { routing_mode: ["strict", "balanced"], default_language: WA_LANGUAGES } as const satisfies Partial<Record<NumberKey, readonly string[]>>;
export interface RuleNumbers {
  routing_timeframe_minutes: number;
  default_daily_cap: number;
  hold_minutes: number;
  routing_mode: RoutingMode;
  transition_days: number;
  /** The largest guest file kept, in megabytes (hotel files and platform files alike). */
  media_max_mb: number;
  /** Days a hotel's guest files are kept in the bucket. */
  media_keep_days: number;
  /** Days the files of the Super Admin's and Platform Admin's own numbers are kept. */
  media_keep_days_platform: number;
  /** Days the nightly encrypted backups of WhatsApp chats are kept. */
  backup_keep_days: number;
  /** The language of what HMS says to a guest by itself until it can tell the guest's own. */
  default_language: WaLanguage;
}
export const NUMBER_LIMITS = { routing_timeframe_minutes: { min: 5, max: 1440 }, default_daily_cap: { min: 0, max: 100000 }, hold_minutes: { min: 1, max: 60 }, transition_days: { min: 1, max: 365 }, media_max_mb: { min: 1, max: 50 }, media_keep_days: { min: 1, max: 365 }, media_keep_days_platform: { min: 1, max: 365 }, backup_keep_days: { min: 1, max: 365 } } as const;
const NUMBER_DEFAULTS: RuleNumbers = { routing_timeframe_minutes: 120, default_daily_cap: 50, hold_minutes: 10, routing_mode: "strict", transition_days: 30, media_max_mb: 16, media_keep_days: 30, media_keep_days_platform: 30, backup_keep_days: 14, default_language: "en" };
const NUMBER_LABEL: Record<NumberKey, string> = {
  routing_timeframe_minutes: "Routing timeframe (minutes)",
  default_daily_cap: "Default daily cap",
  hold_minutes: "Hold a message waiting for 'which hotel?' (minutes)",
  routing_mode: "Routing mode",
  transition_days: "Days of the move to an own number",
  media_max_mb: "Largest guest file kept (MB)",
  media_keep_days: "Days a hotel's guest files are kept",
  media_keep_days_platform: "Days the Super Admin's and Platform Admin's files are kept",
  backup_keep_days: "Days the nightly encrypted backups of WhatsApp chats are kept",
  default_language: "Language HMS uses with a guest until it knows theirs",
};
const LANGUAGE_NAME: Record<WaLanguage, string> = { en: "English", hinglish: "Hinglish", hi: "Hindi", gu: "Gujarati" };
const SETTING_KEY = (k: NumberKey): string => `whatsapp.${k}`;
const PROFILE_SETTING = (p: ProfileId): string => `whatsapp.rules.${p}`;
const ENABLED_KEY = "whatsapp.enabled";

/* ---------------------------------------------------------------- the store port */

export interface RulesLine { id: string; kind: WaLineKind; displayName: string | null; status: WaLineStatus; quality: string }
export interface RulesHotelRow { lineId: string; lineKind: WaLineKind; own: boolean; override: Record<string, unknown> }
export interface WaRulesStore {
  /** Every line, newest first. Never the token or the PIN. */
  lines(): Promise<RulesLine[]>;
  line(id: string): Promise<RulesLine | null>;
  /** Moves a line to active or paused only. Returns false when no such line. */
  setLineStatus(id: string, status: "active" | "paused"): Promise<boolean>;
  /** The hotel's current whatsapp_line_hotels rows (valid_to null). */
  hotelRows(hotelId: string): Promise<RulesHotelRow[]>;
  /** Replaces rules_override on every current row of the hotel; returns how many rows. */
  setOverride(hotelId: string, override: Record<string, unknown>): Promise<number>;
}

export interface MemoryRulesData { lines: RulesLine[]; rows: { hotelId: string; lineId: string; own: boolean; override: Record<string, unknown> | null }[] }
export function createMemoryWaRulesStore(data: MemoryRulesData = { lines: [], rows: [] }): WaRulesStore & { data: MemoryRulesData } {
  const kindOf = (id: string): WaLineKind => data.lines.find((l) => l.id === id)?.kind ?? "shared";
  return {
    data,
    lines: async () => data.lines.map((l) => ({ ...l })),
    line: async (id) => ((l) => (l ? { ...l } : null))(data.lines.find((x) => x.id === id)),
    setLineStatus: async (id, status) => {
      const l = data.lines.find((x) => x.id === id);
      if (!l) return false;
      l.status = status;
      return true;
    },
    hotelRows: async (hotelId) => data.rows.filter((r) => r.hotelId === hotelId).map((r) => ({ lineId: r.lineId, lineKind: kindOf(r.lineId), own: r.own, override: { ...(r.override ?? {}) } })),
    setOverride: async (hotelId, override) => {
      const rows = data.rows.filter((r) => r.hotelId === hotelId);
      for (const r of rows) r.override = { ...override };
      return rows.length;
    },
  };
}

/* ---------------------------------------------------------------- the answers */

export interface RuleView { key: RuleKey; label: string; type: "boolean" | "number"; value: RuleValue; builtIn: RuleValue; locked: boolean; lockedReason: string | null }
export interface ProfileView { id: ProfileId; label: string; rules: RuleView[] }
export interface LineView { id: string; kind: WaLineKind; displayName: string | null; status: WaLineStatus; paused: boolean; quality: string }
export interface NumberView { key: NumberKey; label: string; value: number | RoutingMode | WaLanguage; min?: number; max?: number; options?: readonly string[]; /** Plain names for the options (the language names). */ optionLabels?: Readonly<Record<string, string>> }
export interface RulesView {
  numbers: RuleNumbers;
  numberFields: NumberView[];
  killSwitch: { global: { killed: boolean } };
  profiles: ProfileView[];
  lines: LineView[];
  lockedNotes: readonly string[];
}
export type RuleSource = "hotel_override" | "line_profile" | "global_default" | "built_in";
export interface HotelRuleView { key: RuleKey; label: string; type: "boolean" | "number"; locked: boolean; lockedReason: string | null; effective: RuleValue; inherited: RuleValue; inheritedFrom: Exclude<RuleSource, "hotel_override">; override: RuleValue | null; source: RuleSource }
export interface HotelRulesView { hotelId: string; line: LineView | null; profile: ProfileId; hotelPaused: boolean; rules: HotelRuleView[] }

export type RulePatch = Partial<Record<RuleKey, RuleValue | null>>;
export interface RulesUpdate { numbers?: Partial<RuleNumbers>; profiles?: Partial<Record<ProfileId, RulePatch>>; confirm?: boolean }
export type KillTarget = { scope: "global" } | { scope: "line"; id: string } | { scope: "hotel"; id: string };
export interface KillResult { scope: "global" | "line" | "hotel"; id: string | null; killed: boolean }

/* ---------------------------------------------------------------- helpers */

const asBool = (v: unknown): boolean | undefined => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined);
const asNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A stored profile as a clean partial: only known keys of the right type survive. */
function cleanProfile(raw: unknown): Record<string, RuleValue> {
  const out: Record<string, RuleValue> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const d of RULE_DEFS) {
    const v = (raw as Record<string, unknown>)[d.key];
    const x = d.type === "boolean" ? asBool(v) : asNum(v);
    if (x !== undefined) out[d.key] = x;
  }
  return out;
}
const profileOfKind = (kind: WaLineKind): ProfileId => (kind === "shared" ? "shared" : kind === "platform" ? "platform" : "own_default");

/** A value the key may take, or the plain sentence that says why not. */
function problemOf(key: string, v: unknown): string | null {
  const d = DEF_OF.get(key as RuleKey);
  if (!d) return "Unknown rule";
  if (isLocked(d.key)) return LOCKED_REASON[d.key] ?? "This rule is locked";
  if (d.type === "boolean") return typeof v === "boolean" ? null : "Must be on or off";
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100000 ? null : "Must be a whole number from 0 to 100000";
}

/** The risk of moving a value from `before` to `after`, as a plain sentence; null when it is not one of the risky changes (plan part 27). */
export function riskOf(key: string, before: unknown, after: unknown): string | null {
  if (before === after) return null;
  if (key === "marketing_allowed" && after === true) return "Marketing messages will be allowed (guests can report them as spam and the number can be restricted).";
  if (key === "consent_required_for_automatic" && after === false) return "Automatic messages will go out without a consent tick.";
  if ((key === "daily_cap" || key === "default_daily_cap") && after === 0) return "The daily cap will be removed: nothing limits how many messages a hotel starts.";
  if (key === "routing_mode" && after === "balanced") return "Balanced routing may deliver an ambiguous message to a guess instead of asking the guest.";
  return null;
}

function needConfirm(risks: readonly string[], confirm: boolean | undefined): void {
  if (risks.length === 0 || confirm === true) return;
  throw new AppError("CONFLICT", `Please confirm: ${risks.join(" ")}`, { reason: "needs_confirmation", fields: { confirm: risks.join(" ") } });
}
const invalid = (fields: Record<string, string>): AppError => new AppError("VALIDATION_FAILED", undefined, { fields });

/* ---------------------------------------------------------------- the service */

export interface RulesServiceDeps { unit: PlatformConsoleUnit; store: WaRulesStore; now: () => Date }

export function createWaRulesService(deps: RulesServiceDeps) {
  const { unit, store, now } = deps;
  const gate = createGate(unit, now);
  const probe = { action: "settings_updated", entity: "platform", entityId: null } as const;
  const forbidden = (): AppError => new AppError("FORBIDDEN");
  /** Super Admin accounts only: not an API key, not an Enter-hotel visit. */
  const refusedSession = (s: VerifiedSession): boolean => s.token !== undefined || s.client === "token" || s.visit !== undefined;
  const read = (s: VerifiedSession): void => {
    gate.superRead(s);
    if (refusedSession(s)) throw forbidden();
  };
  const write = async (s: VerifiedSession, meta: PlatformMeta, input: Parameters<typeof gate.write>[2] = probe): Promise<void> => {
    await gate.superWrite(s, meta, input);
    if (refusedSession(s)) throw await gate.refuse(s, meta, input, forbidden());
  };

  async function settings(repos: PlatformConsoleRepos): Promise<Map<string, unknown>> {
    return new Map((await repos.settings.all()).map((r) => [r.key, r.value]));
  }
  function numbersOf(by: Map<string, unknown>): RuleNumbers {
    const n = (k: keyof typeof NUMBER_LIMITS, lo: number, hi: number): number => {
      const v = asNum(by.get(SETTING_KEY(k)));
      return v !== undefined && Number.isInteger(v) && v >= lo && v <= hi ? v : NUMBER_DEFAULTS[k];
    };
    const L = NUMBER_LIMITS;
    const language = by.get(SETTING_KEY("default_language"));
    return {
      routing_timeframe_minutes: n("routing_timeframe_minutes", L.routing_timeframe_minutes.min, L.routing_timeframe_minutes.max),
      default_daily_cap: n("default_daily_cap", L.default_daily_cap.min, L.default_daily_cap.max),
      hold_minutes: n("hold_minutes", L.hold_minutes.min, L.hold_minutes.max),
      routing_mode: by.get(SETTING_KEY("routing_mode")) === "balanced" ? "balanced" : "strict",
      transition_days: n("transition_days", L.transition_days.min, L.transition_days.max),
      media_max_mb: n("media_max_mb", L.media_max_mb.min, L.media_max_mb.max),
      media_keep_days: n("media_keep_days", L.media_keep_days.min, L.media_keep_days.max),
      media_keep_days_platform: n("media_keep_days_platform", L.media_keep_days_platform.min, L.media_keep_days_platform.max),
      backup_keep_days: n("backup_keep_days", L.backup_keep_days.min, L.backup_keep_days.max),
      default_language: (WA_LANGUAGES as readonly unknown[]).includes(language) ? (language as WaLanguage) : "en",
    };
  }
  const enabledOf = (by: Map<string, unknown>): boolean => asBool(by.get(ENABLED_KEY)) === true;
  const lineView = (l: RulesLine): LineView => ({ id: l.id, kind: l.kind, displayName: l.displayName, status: l.status, paused: l.status === "paused", quality: l.quality });
  const ruleView = (key: RuleKey, value: RuleValue): RuleView => ((d) => ({ key, label: d.label, type: d.type, value, builtIn: builtinOf(key), locked: isLocked(key), lockedReason: LOCKED_REASON[key] ?? null }))(DEF_OF.get(key) as RuleDef);

  async function get(session: VerifiedSession): Promise<RulesView> {
    read(session);
    const lines = await store.lines();
    return unit.run(async (repos) => {
      await gate.actor(repos, session);
      const by = await settings(repos);
      const n = numbersOf(by);
      const L = NUMBER_LIMITS;
      return {
        numbers: n,
        numberFields: [
          { key: "routing_timeframe_minutes", label: NUMBER_LABEL.routing_timeframe_minutes, value: n.routing_timeframe_minutes, ...L.routing_timeframe_minutes },
          { key: "default_daily_cap", label: NUMBER_LABEL.default_daily_cap, value: n.default_daily_cap, ...L.default_daily_cap },
          { key: "hold_minutes", label: NUMBER_LABEL.hold_minutes, value: n.hold_minutes, ...L.hold_minutes },
          { key: "routing_mode", label: NUMBER_LABEL.routing_mode, value: n.routing_mode, options: ["strict", "balanced"] },
          { key: "transition_days", label: NUMBER_LABEL.transition_days, value: n.transition_days, ...L.transition_days },
          { key: "media_max_mb", label: NUMBER_LABEL.media_max_mb, value: n.media_max_mb, ...L.media_max_mb },
          { key: "media_keep_days", label: NUMBER_LABEL.media_keep_days, value: n.media_keep_days, ...L.media_keep_days },
          { key: "media_keep_days_platform", label: NUMBER_LABEL.media_keep_days_platform, value: n.media_keep_days_platform, ...L.media_keep_days_platform },
          { key: "backup_keep_days", label: NUMBER_LABEL.backup_keep_days, value: n.backup_keep_days, ...L.backup_keep_days },
          { key: "default_language", label: NUMBER_LABEL.default_language, value: n.default_language, options: [...WA_LANGUAGES], optionLabels: LANGUAGE_NAME },
        ],
        killSwitch: { global: { killed: !enabledOf(by) } },
        profiles: PROFILE_IDS.map((id) => {
          const p = cleanProfile(by.get(PROFILE_SETTING(id)));
          return { id, label: PROFILE_LABEL[id], rules: RULE_KEYS.map((k) => ruleView(k, isLocked(k) ? true : (p[k] ?? builtinOf(k)))) };
        }),
        lines: lines.map(lineView),
        lockedNotes: LOCKED_NOTES,
      };
    });
  }

  /** The value and its source for each key of a hotel, from the three layers (hotel override, line profile, global default, then the built-in). */
  function hotelRules(override: Record<string, unknown>, profile: Record<string, RuleValue>, n: RuleNumbers): HotelRuleView[] {
    const own: Record<string, RuleValue> = {};
    for (const d of RULE_DEFS) {
      const v = d.type === "boolean" ? asBool(override[d.key]) : asNum(override[d.key]);
      if (v !== undefined) own[d.key] = v;
    }
    const globalDefault = { daily_cap: n.default_daily_cap };
    const layers = (o: Record<string, RuleValue>) => ({ hotelOverride: o as never, lineProfile: profile as never, globalDefault });
    const effective = resolveRules(layers(own)) as unknown as Record<string, RuleValue>;
    const inheritedAll = resolveRules(layers({})) as unknown as Record<string, RuleValue>;
    return RULE_KEYS.map((key) => {
      const inh = key in EXTRA_BUILTIN ? (profile[key] ?? builtinOf(key)) : inheritedAll[key];
      const inheritedFrom: HotelRuleView["inheritedFrom"] = profile[key] !== undefined ? "line_profile" : key === "daily_cap" ? "global_default" : "built_in";
      const o = own[key];
      const eff = o !== undefined && !isLocked(key) ? o : key in EXTRA_BUILTIN ? inh : effective[key];
      const d = DEF_OF.get(key) as RuleDef;
      return { key, label: d.label, type: d.type, locked: isLocked(key), lockedReason: LOCKED_REASON[key] ?? null, effective: eff as RuleValue, inherited: inh as RuleValue, inheritedFrom, override: o !== undefined && !isLocked(key) ? o : null, source: o !== undefined && !isLocked(key) ? "hotel_override" : inheritedFrom };
    });
  }

  /** The hotel's current row (its own number first), the profile that line kind uses, and the stored override. */
  async function hotelContext(hotelId: string): Promise<{ rows: RulesHotelRow[]; row: RulesHotelRow | null; profile: ProfileId; override: Record<string, unknown> }> {
    const rows = await store.hotelRows(hotelId);
    const row = rows.find((r) => r.own) ?? rows[0] ?? null;
    return { rows, row, profile: row ? profileOfKind(row.lineKind) : "shared", override: row?.override ?? {} };
  }

  async function hotelView(repos: PlatformConsoleRepos, hotelId: string): Promise<HotelRulesView> {
    const ctx = await hotelContext(hotelId);
    const by = await settings(repos);
    const line = ctx.row ? await store.line(ctx.row.lineId) : null;
    return { hotelId, line: line ? lineView(line) : null, profile: ctx.profile, hotelPaused: ctx.override[HOTEL_PAUSED_KEY] === true, rules: hotelRules(ctx.override, cleanProfile(by.get(PROFILE_SETTING(ctx.profile))), numbersOf(by)) };
  }

  async function getHotel(session: VerifiedSession, hotelId: string): Promise<HotelRulesView> {
    read(session);
    return unit.run(async (repos) => {
      await gate.actor(repos, session);
      return hotelView(repos, hotelId);
    });
  }

  async function update(session: VerifiedSession, patch: RulesUpdate, meta: PlatformMeta): Promise<RulesView> {
    await write(session, meta);
    // validation first, nothing is read or written while a field is wrong
    const f: Record<string, string> = {};
    const N = NUMBER_LIMITS;
    const num = patch.numbers ?? {};
    for (const k of NUMBER_KEYS) {
      const v = num[k];
      if (v === undefined) continue;
      if (k === "routing_mode" || k === "default_language") {
        if (!(OPTION_KEYS[k] as readonly unknown[]).includes(v)) f[`numbers.${k}`] = k === "routing_mode" ? "Choose strict or balanced" : "Choose English, Hinglish, Hindi or Gujarati";
      } else if (!(typeof v === "number" && Number.isInteger(v) && v >= N[k].min && v <= N[k].max)) f[`numbers.${k}`] = `Must be a whole number from ${N[k].min} to ${N[k].max}`;
    }
    for (const [pid, p] of Object.entries(patch.profiles ?? {})) {
      if (!PROFILE_IDS.includes(pid as ProfileId)) {
        f[`profiles.${pid}`] = "Unknown profile";
        continue;
      }
      for (const [k, v] of Object.entries(p ?? {})) {
        const why = v === null ? (DEF_OF.has(k as RuleKey) ? (isLocked(k as RuleKey) ? (LOCKED_REASON[k as RuleKey] ?? "This rule is locked") : null) : "Unknown rule") : problemOf(k, v);
        if (why) f[`profiles.${pid}.${k}`] = why;
      }
    }
    if (Object.keys(f).length > 0) throw invalid(f);
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const by = await settings(repos);
      const before = numbersOf(by);
      const writes: { setting: string; value: unknown; reason: string; key: string; old: unknown; next: unknown; label: string }[] = [];
      const risks: string[] = [];
      for (const k of NUMBER_KEYS) {
        const v = num[k];
        if (v === undefined || v === before[k]) continue;
        const r = riskOf(k, before[k], v);
        if (r) risks.push(r);
        writes.push({ setting: SETTING_KEY(k), value: v, reason: `WhatsApp rules: ${NUMBER_LABEL[k]}`, key: k, old: before[k], next: v, label: "WhatsApp rules: numbers" });
      }
      for (const pid of PROFILE_IDS) {
        const p = patch.profiles?.[pid];
        if (!p || Object.keys(p).length === 0) continue;
        const stored = cleanProfile(by.get(PROFILE_SETTING(pid)));
        const next: Record<string, RuleValue> = { ...stored };
        for (const [k, v] of Object.entries(p)) {
          const old = stored[k] ?? builtinOf(k as RuleKey);
          if (v === null || v === undefined) delete next[k];
          else next[k] = v;
          const now2 = next[k] ?? builtinOf(k as RuleKey);
          if (now2 === old) continue;
          const r = riskOf(k, old, now2);
          if (r) risks.push(r);
          writes.push({ setting: PROFILE_SETTING(pid), value: null, reason: `WhatsApp rules: ${PROFILE_LABEL[pid]}, ${k}`, key: `${pid}.${k}`, old, next: now2, label: `WhatsApp rules: ${PROFILE_LABEL[pid]}` });
        }
        // the whole profile object is written once, with the unknown keys the screen does not know kept as they were
        const raw = by.get(PROFILE_SETTING(pid));
        const kept = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k]) => !DEF_OF.has(k as RuleKey))) : {};
        for (const w of writes) if (w.setting === PROFILE_SETTING(pid)) w.value = { ...kept, ...next };
      }
      needConfirm(risks, patch.confirm);
      const done = new Set<string>();
      for (const w of writes) {
        if (!done.has(w.setting)) {
          await repos.settings.set(w.setting, w.value, actor.userId, at);
          done.add(w.setting);
        }
        await gate.audit(repos, actor, meta, { ...probe, targetLabel: w.label, reason: w.reason, before: { [w.key]: w.old }, after: { [w.key]: w.next } });
      }
      return null;
    }).then(() => get(session));
  }

  /** Validates an override patch against the hotel's switches (a null value clears that key). */
  function overrideProblems(patch: Record<string, unknown>): Record<string, string> {
    const f: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === HOTEL_PAUSED_KEY) {
        if (v !== null && typeof v !== "boolean") f[k] = "Must be on or off";
      } else if (v !== null) {
        const why = problemOf(k, v);
        if (why) f[k] = why;
      } else if (!DEF_OF.has(k as RuleKey)) f[k] = "Unknown rule";
      else if (isLocked(k as RuleKey)) f[k] = LOCKED_REASON[k as RuleKey] ?? "This rule is locked";
    }
    return f;
  }

  /** Applies the changes to a hotel's override object, checks the risks, stores and audits. `patch` null = remove the key. */
  async function changeHotel(session: VerifiedSession, hotelId: string, patch: Record<string, RuleValue | null>, confirm: boolean | undefined, meta: PlatformMeta, why: string): Promise<HotelRulesView> {
    const audit = { ...probe, entity: "hotel", entityId: hotelId, hotelId } as const;
    await write(session, meta, audit);
    const f = overrideProblems(patch);
    if (Object.keys(f).length > 0) throw invalid(f);
    const actor = await unit.run((repos) => gate.actor(repos, session));
    const ctx = await hotelContext(hotelId);
    if (ctx.rows.length === 0) throw new AppError("NOT_FOUND", "This hotel has no WhatsApp line yet");
    const by = await unit.run((repos) => settings(repos));
    const before = hotelRules(ctx.override, cleanProfile(by.get(PROFILE_SETTING(ctx.profile))), numbersOf(by));
    const next: Record<string, unknown> = { ...ctx.override };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    const after = hotelRules(next, cleanProfile(by.get(PROFILE_SETTING(ctx.profile))), numbersOf(by));
    const changes: { key: string; old: unknown; next: unknown }[] = [];
    const risks: string[] = [];
    for (const k of Object.keys(patch)) {
      if (k === HOTEL_PAUSED_KEY) {
        const o = ctx.override[HOTEL_PAUSED_KEY] === true;
        const nw = next[HOTEL_PAUSED_KEY] === true;
        if (o !== nw) changes.push({ key: k, old: o, next: nw });
        continue;
      }
      const b = before.find((r) => r.key === k)?.effective;
      const a = after.find((r) => r.key === k)?.effective;
      if (b === a) continue;
      changes.push({ key: k, old: b, next: a });
      const r = riskOf(k, b, a);
      if (r) risks.push(r);
    }
    const stopping = changes.find((c) => c.key === HOTEL_PAUSED_KEY && c.next === true);
    if (stopping) risks.push("WhatsApp will stop for this hotel: no message is sent or received through HMS until it is resumed.");
    needConfirm(risks, confirm);
    // the stored override changes even when the effective value does not (a new explicit override that equals the inherited value is still kept)
    await store.setOverride(hotelId, next);
    await unit.run(async (repos) => {
      for (const c of changes) await gate.audit(repos, actor, meta, { ...audit, targetLabel: "WhatsApp rules: one hotel", reason: `${why}: ${c.key}`, before: { [c.key]: c.old }, after: { [c.key]: c.next } });
    });
    return unit.run((repos) => hotelView(repos, hotelId));
  }

  const setHotelOverride = (session: VerifiedSession, hotelId: string, patch: Record<string, RuleValue | null>, confirm: boolean | undefined, meta: PlatformMeta) =>
    changeHotel(session, hotelId, patch, confirm, meta, "WhatsApp hotel override");
  /** Reset one switch of a hotel to what it inherits. */
  const clearHotelOverride = (session: VerifiedSession, hotelId: string, key: string, confirm: boolean | undefined, meta: PlatformMeta) =>
    changeHotel(session, hotelId, { [key]: null }, confirm, meta, "WhatsApp hotel override reset");

  /** The kill switches. `on: true` stops WhatsApp (needs confirm); `on: false` lets it run again. Tokens are never touched. */
  async function setKillSwitch(session: VerifiedSession, target: KillTarget, on: boolean, confirm: boolean | undefined, meta: PlatformMeta): Promise<KillResult> {
    if (target.scope === "hotel") {
      const v = await changeHotel(session, target.id, { [HOTEL_PAUSED_KEY]: on ? true : null }, confirm, meta, on ? "WhatsApp kill switch on" : "WhatsApp kill switch off");
      return { scope: "hotel", id: target.id, killed: v.hotelPaused };
    }
    const audit = target.scope === "global" ? probe : ({ ...probe, entityId: target.id } as const);
    await write(session, meta, audit);
    if (target.scope === "global") {
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const was = !enabledOf(await settings(repos));
        if (on && !was) needConfirm(["WhatsApp will stop for every hotel and the platform: nothing is sent, and incoming messages wait."], confirm);
        if (was !== on) {
          await repos.settings.set(ENABLED_KEY, !on, actor.userId, now());
          await gate.audit(repos, actor, meta, { ...probe, targetLabel: "WhatsApp kill switch", reason: "WhatsApp kill switch: everything", before: { killed: was }, after: { killed: on } });
        }
        return { scope: "global" as const, id: null, killed: on };
      });
    }
    const actor = await unit.run((repos) => gate.actor(repos, session));
    const line = await store.line(target.id);
    if (!line) throw new AppError("NOT_FOUND", "This line does not exist");
    const was = line.status === "paused";
    if (!was && on && (line.status === "needs_reconnect" || line.status === "banned")) throw invalid({ id: "This line is not in use; it needs reconnecting, not pausing" });
    if (was !== on) {
      if (on) needConfirm(["This line will stop sending and receiving until it is resumed."], confirm);
      await store.setLineStatus(target.id, on ? "paused" : "active");
      await unit.run((repos) => gate.audit(repos, actor, meta, { ...audit, targetLabel: line.displayName ?? "WhatsApp line", reason: "WhatsApp kill switch: one line", before: { killed: was, status: line.status }, after: { killed: on, status: on ? "paused" : "active" } }));
    }
    return { scope: "line", id: target.id, killed: on };
  }

  return { get, getHotel, update, setHotelOverride, clearHotelOverride, setKillSwitch };
}

export type WaRulesService = ReturnType<typeof createWaRulesService>;

import "server-only";
import type { VerifiedSession as AuthSession } from "../../auth/session";
import type { HealthUsageReader, ActivityRaw, UsageRaw } from "../../repos/postgres/healthUsage";
import { istWindow, requireSuperAdmin } from "./context";

// System Health usage (GET /system/health/usage): the per-feature usage map of the System Health page, built from what HMS really records.
// HMS keeps no request log, so a "hit" here is a RECORDED ACTION (one system log line: a save, an edit, a delete, a sign-in) and not a page visit; speed
// (avgMs, maxMs) is not measured and is sent as null / 0, and so are the request p50 and p95. The page says so instead of drawing invented numbers.
// SuperAdmin only. No guest data: module keys, counts and distinct-people counts.

const DAY_MS = 86_400_000;

export type FeatureStatus = "healthy" | "degraded" | "down" | "idle";

/** ui-shared adminSystem HealthFeature. */
export interface HealthFeatureDto {
  key: string;
  label: string;
  icon: string;
  group: string;
  status: FeatureStatus;
  hits7: number;
  hits30: number;
  trend: number;
  users7: number;
  avgMs: number | null;
  maxMs: number;
  errors7: number;
  openFaults: number;
  depends: string[];
  reasons: string[];
  routes: string[];
  daily: { day: string; hits: number; errors: number; avgMs: number }[];
  openMenu?: string;
}

export interface HealthUsage {
  /** Where the numbers come from. */
  source: "system_log";
  /** One fixed sentence the page shows next to the numbers. */
  note: string;
  features: HealthFeatureDto[];
  /** Feature key -> the tables it uses. */
  tables: Record<string, string[]>;
  /** [from feature, to feature, people who moved between them within 30 minutes]. */
  flows: [string, string, number][];
  activity: ActivityRaw[];
  server: {
    poolTotal: number | null;
    poolIdle: number | null;
    poolWaiting: number | null;
    hotelDataBytes: number | null;
    dbConnections: number | null;
    requestP50Ms: null;
    requestP95Ms: null;
    timing: string;
  };
}

interface FeatureDef {
  /** The system log module this feature's actions are filed under. */
  key: string;
  label: string;
  icon: string;
  group: string;
  depends: string[];
  tables: string[];
  routes: string[];
  openMenu?: string;
  /** Names the faults (feature_errors.feature) of this feature may carry. */
  faultKeys: string[];
}

// The features HMS records actions for (ui-shared adminSystem logModules). Tables are the hotel tables each one writes; routes the API families.
const FEATURES: readonly FeatureDef[] = [
  { key: "revenue", label: "Revenue", icon: "cash-coin", group: "Money", depends: ["database"], tables: ["hotel_cash_deposits", "food_cash_deposits"], routes: ["/revenue"], openMenu: "hotel.cash.revenue", faultKeys: ["revenue"] },
  { key: "expense", label: "Expenses", icon: "cash-stack", group: "Money", depends: ["database"], tables: ["hotel_cash_withdrawals", "food_cash_withdrawals", "hotel_misc_expenses", "food_misc_expenses", "expense_lines"], routes: ["/expense"], openMenu: "hotel.cash.expenses", faultKeys: ["expense"] },
  { key: "handover", label: "Shift Handover", icon: "arrow-left-right", group: "Money", depends: ["database"], tables: ["shift_handovers"], routes: ["/handover"], openMenu: "hotel.cash.handover", faultKeys: ["handover", "shift-handover"] },
  { key: "bills", label: "Billing", icon: "receipt", group: "Money", depends: ["database", "storage"], tables: ["bill_master_bills", "bill_master_advances"], routes: ["/billing"], openMenu: "hotel.billing.bills", faultKeys: ["bills", "bill-master"] },
  { key: "companies", label: "Company Profiles", icon: "buildings", group: "People", depends: ["database"], tables: ["company_profiles", "customers", "mail_campaigns", "mail_campaign_recipients", "mail_optouts"], routes: ["/companies"], openMenu: "hotel.companies.profiles", faultKeys: ["companies", "company"] },
  { key: "frontdesk", label: "Front Office", icon: "door-closed", group: "Front Office", depends: ["database"], tables: ["pms_rooms", "pms_reservations", "pms_stays", "pms_charges"], routes: ["/front-office"], faultKeys: ["frontdesk", "front-office"] },
  { key: "website", label: "Website admin", icon: "globe2", group: "Website", depends: ["database", "storage"], tables: ["site_settings", "site_rooms", "site_gallery_photos", "site_enquiries"], routes: ["/website"], openMenu: "hotel.web", faultKeys: ["website"] },
  { key: "masters", label: "Master Data", icon: "sliders", group: "Administration", depends: ["database"], tables: ["option_sets", "option_items", "payroll_master_items"], routes: ["/admin/masters", "/payroll/master"], faultKeys: ["masters"] },
  { key: "users", label: "User Accounts", icon: "people", group: "Administration", depends: ["database"], tables: ["users", "user_audit_logs"], routes: ["/admin/users"], openMenu: "hotel.admin.users", faultKeys: ["users"] },
  { key: "access", label: "Roles", icon: "diagram-3", group: "Administration", depends: ["database"], tables: ["roles", "role_permissions"], routes: ["/admin/roles"], faultKeys: ["access"] },
  { key: "account", label: "Sign-in and profile", icon: "person-circle", group: "Core", depends: ["database", "mail"], tables: ["sessions", "auth_events"], routes: ["/auth", "/profile"], openMenu: "hotel.admin.profile", faultKeys: ["account", "login", "profile"] },
  { key: "system", label: "System", icon: "gear", group: "Administration", depends: ["database"], tables: ["system_logs", "force_logs", "health_checks", "feature_errors"], routes: ["/system"], openMenu: "hotel.admin.log", faultKeys: ["system", "system-log", "force-log"] },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-11" -> "11 Oct" (the label the page's chart uses). */
const dayLabel = (date: string): string => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""}`.trim();
const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const NOTE = "EasyHotelSolutions keeps no page-visit or speed log. Uses are recorded actions (saves, edits, deletes and sign-ins from the system log); speed is not measured.";
const TIMING = "Not measured: EasyHotelSolutions keeps no request timings.";

/** The pure part: raw rows in, the page's feature map out. `today` is the IST date of now. */
export function buildHealthUsage(raw: UsageRaw, today: string): Pick<HealthUsage, "features" | "tables" | "flows"> {
  const days = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const last7 = new Set(days.slice(23));
  const known = new Set(FEATURES.map((f) => f.key));

  const features = FEATURES.map((def): HealthFeatureDto => {
    const mine = raw.daily.filter((d) => d.module === def.key);
    const byDay = new Map(mine.map((d) => [d.day, d]));
    const daily = days.map((day) => ({ day: dayLabel(day), hits: byDay.get(day)?.hits ?? 0, errors: byDay.get(day)?.failed ?? 0, avgMs: 0 }));
    const hits30 = mine.reduce((s, d) => s + d.hits, 0);
    const hits7 = mine.filter((d) => last7.has(d.day)).reduce((s, d) => s + d.hits, 0);
    const errors7 = mine.filter((d) => last7.has(d.day)).reduce((s, d) => s + d.failed, 0);
    const prev = raw.prev7.find((p) => p.module === def.key)?.hits ?? 0;
    const trend = prev === 0 ? (hits7 > 0 ? 100 : 0) : Math.round(((hits7 - prev) / prev) * 100);
    const openFaults = raw.faults.filter((f) => def.faultKeys.includes(f.feature)).reduce((s, f) => s + f.open, 0);
    const users7 = raw.users7.find((u) => u.module === def.key)?.users ?? 0;

    const reasons: string[] = [];
    if (errors7 > 0) reasons.push(`${errors7} failed ${errors7 === 1 ? "action" : "actions"} in 7 days`);
    if (openFaults > 0) reasons.push(`${openFaults} open ${openFaults === 1 ? "fault" : "faults"}`);
    let status: FeatureStatus = "healthy";
    if (hits30 === 0 && openFaults === 0) status = "idle";
    else if (hits7 > 0 && errors7 * 2 >= hits7 && errors7 > 0) status = "down";
    else if (reasons.length > 0) status = "degraded";

    return { key: def.key, label: def.label, icon: def.icon, group: def.group, status, hits7, hits30, trend, users7, avgMs: null, maxMs: 0, errors7, openFaults, depends: def.depends, reasons, routes: def.routes, daily, ...(def.openMenu ? { openMenu: def.openMenu } : {}) };
  });

  const tables = Object.fromEntries(FEATURES.map((f) => [f.key, f.tables]));
  const flows = raw.flows.filter((f) => known.has(f.from) && known.has(f.to)).map((f): [string, string, number] => [f.from, f.to, f.people]);
  return { features, tables, flows };
}

export interface HealthUsageDeps {
  reader: HealthUsageReader;
  /** The connection pool's counters, or null when there is no pool (no database). */
  pool(): { total: number; idle: number; waiting: number } | null;
  now: () => Date;
}

export function createHealthUsageService(deps: HealthUsageDeps) {
  return {
    async usage(session: AuthSession): Promise<HealthUsage> {
      requireSuperAdmin(session, "System Health");
      const now = deps.now();
      const { today, todayStart } = istWindow(now);
      const windows = { from30: new Date(todayStart.getTime() - 29 * DAY_MS), from7: new Date(todayStart.getTime() - 6 * DAY_MS), from14: new Date(todayStart.getTime() - 13 * DAY_MS) };
      const who = { hotelId: session.hotelId ?? "" };
      const [raw, activity, server] = await Promise.all([deps.reader.usage(who, windows), deps.reader.activity(who, now), deps.reader.server(who)]);
      const pool = deps.pool();
      return {
        source: "system_log",
        note: NOTE,
        ...buildHealthUsage(raw, today),
        activity,
        server: { poolTotal: pool?.total ?? null, poolIdle: pool?.idle ?? null, poolWaiting: pool?.waiting ?? null, hotelDataBytes: server.hotelDataBytes, dbConnections: server.dbConnections, requestP50Ms: null, requestP95Ms: null, timing: TIMING },
      };
    },
  };
}

export type HealthUsageService = ReturnType<typeof createHealthUsageService>;
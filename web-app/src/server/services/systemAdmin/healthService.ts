import "server-only";
import type { Page } from "@shared/dashboards/common";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { FeatureErrorRecord, HealthCheckRecord } from "../../repos/systemAdmin";
import { requireSuperAdmin, type SystemAdminDeps } from "./context";
import { searchWords } from "../../validation/listQuery";

// System Health (Pallav SystemHealthController + Support/Health/HealthChecks.php; SuperAdmin only) and GET /health/deep: the systems the features stand on,
// each answering ok, warn or down in a sentence, filed in health_checks; uptime over 7 days; the faults (feature_errors) with mark-fixed and reopen.
// A check's sentence never carries a secret or a value of a setting: only whether it is set. HMS checks: database, disk, email, backups, online payments,
// recent faults (Pallav's cache, encryption key and queue checks have no HMS counterpart). The per-feature usage map needs Pallav's feature_stats /
// feature_flows tables, which HMS does not have: not offered.

export type CheckStatus = "ok" | "warn" | "down";

const CHECKS: readonly [string, string, string][] = [
  ["database", "Database", "database"],
  ["storage", "Disk space", "hdd"],
  ["mail", "Email", "envelope"],
  ["backup", "Backups", "cloud-arrow-up"],
  ["razorpay", "Online payments", "credit-card-2-front"],
  ["faults", "Recent faults", "bug"],
];

/** ui-shared adminSystem HealthCheckRow, plus when it was checked. */
interface HealthCheckDto {
  name: string;
  label: string;
  icon: string;
  status: CheckStatus;
  message: string;
  latencyMs: number | null;
  /** Share of results over 7 days that were not down; null when none filed. */
  uptime: number | null;
  checkedAt: string;
}

/** ui-shared adminSystem HealthFault (contract request: `id` is a UUID string; `lastSeen` an ISO instant). */
interface HealthFaultDto {
  id: string;
  exception: string;
  feature: string;
  message: string;
  occurrences: number;
  lastSeen: string;
  method: string | null;
  path: string | null;
  userName: string | null;
  file: string;
  line: number;
  trace: string | null;
  resolvedBy: string | null;
  resolved: boolean;
}

interface HealthOverview {
  overall: "healthy" | "degraded" | "down";
  checks: HealthCheckDto[];
  openErrors: number;
  recentErrors: HealthFaultDto[];
  /** Deployment warnings, plain English sentences (no value of a setting); empty when all is well. */
  notices: string[];
}

interface DeepHealth {
  status: CheckStatus;
  checkedAt: string;
  checks: { name: string; status: CheckStatus; message: string; latencyMs: number | null }[];
}

const MAX_AGE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const on = (v: string | null | undefined): boolean => ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());
const set = (v: string | null | undefined): boolean => String(v ?? "").trim() !== "";

function faultDto(e: FeatureErrorRecord): HealthFaultDto {
  return {
    id: e.id,
    exception: e.exception,
    feature: e.feature,
    message: e.message ?? "",
    occurrences: e.occurrences,
    lastSeen: (e.lastSeenAt ?? e.firstSeenAt ?? new Date(0)).toISOString(),
    method: e.method,
    path: e.path,
    userName: e.userName,
    file: e.file ?? "",
    line: e.line ?? 0,
    trace: e.trace,
    resolvedBy: e.resolvedBy,
    resolved: e.resolvedAt !== null,
  };
}

export function createHealthService(deps: SystemAdminDeps) {
  const { unit, probes, now, people } = deps;

  type Result = Omit<HealthCheckRecord, "checkedAt">;
  type Who = Pick<VerifiedSession, "hotelId" | "userId">;

  async function checkDatabase(who: Who): Promise<[CheckStatus, string]> {
    const t = Date.now();
    await unit.run(who, (repos) => repos.health.ping());
    const ms = Date.now() - t;
    return ms > 500 ? ["warn", `Answering slowly (${ms} ms)`] : ["ok", `Answering in ${ms} ms`];
  }

  async function checkStorage(): Promise<[CheckStatus, string]> {
    const disk = await probes.disk();
    if (!disk || disk.totalBytes <= 0) return ["warn", "Could not read the disk"];
    const pct = Math.round((1000 * disk.freeBytes) / disk.totalBytes) / 10;
    const gb = Math.round((10 * disk.freeBytes) / 1073741824) / 10;
    if (pct < 5) return ["down", `Almost full: ${gb} GB free (${pct}%)`];
    if (pct < 15) return ["warn", `Getting full: ${gb} GB free (${pct}%)`];
    return ["ok", `${gb} GB free (${pct}%)`];
  }

  async function checkMail(settings: Map<string, string | null>): Promise<[CheckStatus, string]> {
    // the hotel's own mail server (Settings > Email) is used when it is set up; the platform sender (the log driver in development) carries the rest
    const driver = probes.mailDriver();
    const mailer = driver === "log" ? "log" : "smtp";
    if (mailer === "log") return ["warn", `Email goes to the log, not to people (${mailer})`];
    if (!set(settings.get("email.host"))) return ["warn", "Email is switched to SMTP but no mail server is set"];
    return ["ok", `Sending through ${mailer}`];
  }

  function checkBackup(settings: Map<string, string | null>, at: Date): [CheckStatus, string] {
    if (!on(settings.get("backup.enabled"))) return ["warn", "Automatic backups are switched off"];
    const last = settings.get("backup.last_at");
    const lastAt = last ? new Date(last) : null;
    if (!lastAt || Number.isNaN(lastAt.getTime())) return ["warn", "Switched on, but no backup has run yet"];
    const hours = Math.floor(Math.abs(at.getTime() - lastAt.getTime()) / 3_600_000);
    // the stored result text is never shown (it could name a host, a path or a key): only a fixed word
    const stored = String(settings.get("backup.last_result") ?? "").trim();
    const failed = /fail|error/i.test(stored);
    if (hours > 72) return ["down", `Last backup was ${hours} hours ago`];
    if (hours > 36) return ["warn", `Last backup was ${hours} hours ago`];
    if (failed) return ["warn", `Last backup ${hours} hours ago: failed`];
    return ["ok", `Last backup ${hours} hours ago${stored ? ": ok" : ""}`];
  }

  function checkRazorpay(settings: Map<string, string | null>): [CheckStatus, string] {
    const inUse: string[] = [];
    for (const book of ["hotel", "food"]) {
      if (!on(settings.get(`razorpay_${book}.enabled`))) continue;
      if (!set(settings.get(`razorpay_${book}.key_id`)) || !set(settings.get(`razorpay_${book}.key_secret`))) return ["down", `Online payments are on for ${book} but its keys are missing`];
      inUse.push(book);
    }
    return ["ok", inUse.length > 0 ? `Configured for ${inUse.join(" and ")}` : "Not in use"];
  }

  async function checkFaults(who: Who, at: Date): Promise<[CheckStatus, string]> {
    const recent = await unit.run(who, (repos) => repos.health.openSince(new Date(at.getTime() - 3_600_000)));
    if (recent >= 10) return ["down", `${recent} different faults in the last hour`];
    if (recent > 0) return ["warn", `${recent} unresolved fault(s) in the last hour`];
    return ["ok", "No new faults in the last hour"];
  }

  const SETTING_KEYS = ["email.host", "backup.enabled", "backup.last_at", "backup.last_result", "razorpay_hotel.enabled", "razorpay_hotel.key_id", "razorpay_hotel.key_secret", "razorpay_food.enabled", "razorpay_food.key_id", "razorpay_food.key_secret"];

  /**
   * HealthChecks::run: every check now, each in its own try (one failing never stops the rest); the results are filed when the database lets them be.
   * `file` false = read-only (GET /health/deep): the checks run but nothing is written, so a view-only caller cannot grow health_checks.
   */
  async function run(who: Who, file = true): Promise<Result[]> {
    const at = now();
    const settings = await unit.run(who, (repos) => repos.health.settings(SETTING_KEYS)).catch(() => new Map<string, string | null>());
    const probesByName: Record<string, () => Promise<[CheckStatus, string]>> = {
      database: () => checkDatabase(who),
      storage: () => checkStorage(),
      mail: () => checkMail(settings),
      backup: async () => checkBackup(settings, at),
      razorpay: async () => checkRazorpay(settings),
      faults: () => checkFaults(who, at),
    };
    const results: Result[] = [];
    for (const [name] of CHECKS) {
      const started = Date.now();
      let outcome: [CheckStatus, string];
      try {
        outcome = await probesByName[name]();
      } catch {
        // Pallav shows the exception's text; HMS never does (it could name a host or a setting): the cause goes to the server log through the caller
        outcome = ["down", name === "database" ? "The database did not answer" : "The check could not run"];
      }
      results.push({ name, status: outcome[0], message: outcome[1], latencyMs: Date.now() - started });
    }
    // the database being down is exactly when this cannot be filed; the result is still returned
    if (file) await unit.run(who, (repos) => repos.health.record(results, at)).catch(() => undefined);
    return results;
  }

  async function withUptime(who: Who, results: (Result & { checkedAt?: Date })[]): Promise<HealthCheckDto[]> {
    const at = now();
    const uptime = await unit.run(who, (repos) => repos.health.uptime(new Date(at.getTime() - 7 * DAY_MS))).catch(() => []);
    return CHECKS.flatMap(([name, label, icon]) => {
      const r = results.find((x) => x.name === name);
      if (!r) return [];
      const u = uptime.find((x) => x.name === name);
      return [{ name, label, icon, status: r.status, message: r.message, latencyMs: r.latencyMs, uptime: u && u.total > 0 ? Math.round(10000 * (1 - u.down / u.total)) / 100 : null, checkedAt: (r.checkedAt ?? at).toISOString() }];
    });
  }

  const overallOf = (checks: readonly { status: CheckStatus }[]): HealthOverview["overall"] => (checks.some((c) => c.status === "down") ? "down" : checks.some((c) => c.status === "warn") ? "degraded" : "healthy");

  return {
    /** index: the newest result of each check, run again when none is under 5 minutes old (HealthChecks::latest), the open faults. */
    async overview(session: VerifiedSession): Promise<HealthOverview> {
      requireSuperAdmin(session, "System Health");
      const fresh = await unit.run(session, (repos) => repos.health.latest(new Date(now().getTime() - MAX_AGE_MS))).catch(() => []);
      const results = fresh.length >= CHECKS.length ? fresh : await run(session);
      const checks = await withUptime(session, results);
      const errors = await unit.run(session, async (repos) => ({ counts: await repos.health.errorCounts(), recent: await repos.health.errors({ state: "open" }, { offset: 0, limit: 6 }) }));
      const notices = probes.notices ? await probes.notices().catch(() => []) : [];
      return { overall: overallOf(checks), checks, openErrors: errors.counts.open, recentErrors: errors.recent.rows.map(faultDto), notices };
    },

    /** check: runs every check now. "All checks ran just now." */
    async runChecks(session: VerifiedSession): Promise<{ checks: HealthCheckDto[]; message: string }> {
      requireSuperAdmin(session, "System Health");
      return { checks: await withUptime(session, await run(session)), message: "All checks ran just now." };
    },

    /** GET /health/deep (an Admin): the checks run now, status and sentence only. Read-only: only System Health's own runs are filed. */
    async deep(session: VerifiedSession): Promise<DeepHealth> {
      const results = await run(session, false);
      return { status: results.some((r) => r.status === "down") ? "down" : results.some((r) => r.status === "warn") ? "warn" : "ok", checkedAt: now().toISOString(), checks: results.map((r) => ({ name: r.name, status: r.status, message: r.message, latencyMs: r.latencyMs })) };
    },

    /** errors: open (default), resolved or all, optionally one feature; newest last-seen first. */
    async errors(session: VerifiedSession, q: { show: "open" | "resolved" | "all"; feature?: string; search?: string; page: number; pageSize: number }): Promise<{ page: Page<HealthFaultDto>; counts: { open: number; resolved: number }; features: string[] }> {
      requireSuperAdmin(session, "System Health");
      return unit.run(session, async (repos) => {
        const page = await repos.health.errors({ state: q.show, feature: q.feature, words: searchWords(q.search) }, { offset: (q.page - 1) * q.pageSize, limit: q.pageSize });
        return { page: { items: page.rows.map(faultDto), total: page.total, page: q.page, pageSize: q.pageSize }, counts: await repos.health.errorCounts(), features: await repos.health.errorFeatures() };
      });
    },

    /** resolve / reopen: a SET (doing it twice changes nothing). Pallav writes no log line; HMS writes one (module system) in the same unit. */
    async setResolved(session: VerifiedSession, id: string, resolved: boolean, meta: RequestMeta): Promise<{ fault: HealthFaultDto; message: string }> {
      requireSuperAdmin(session, "System Health");
      const actor = (await people.get([session.userId])).get(session.userId);
      const name = actor?.name ?? "System";
      return unit.run(session, async (repos) => {
        const fault = await repos.health.setResolved(id, resolved ? now() : null, resolved ? name.slice(0, 150) : null);
        if (!fault) throw new AppError("NOT_FOUND");
        await repos.systemLogs.write({
          module: "system",
          action: "updated",
          entity: "Fault",
          subjectId: fault.id,
          subjectLabel: fault.exception.slice(0, 255),
          summary: `${resolved ? "Marked as fixed" : "Reopened"}: ${fault.exception}`.slice(0, 500),
          details: { Feature: fault.feature },
          userId: session.userId,
          userName: name,
          ipAddress: meta.ip,
          traceId: meta.traceId,
        });
        return { fault: faultDto(fault), message: resolved ? "Marked as fixed. It will reopen by itself if it happens again." : "Reopened." };
      });
    },
  };
}

export type HealthService = ReturnType<typeof createHealthService>;

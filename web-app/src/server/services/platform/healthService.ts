import "server-only";
import type { PlatformDbState, PlatformHealth, PlatformHealthRow } from "@shared/dashboards/platform";
import { platformCopy } from "@shared/dashboards/platform";
import type { VerifiedSession } from "../../auth/session";
import { ProvisionError, type HotelInspection } from "../../provisioner/port";
import { createGate, type PlatformMeta } from "./access";
import type { InviteDeps } from "./context";
import { hotelStatusOf } from "./views";

// Platform health, Super Admin only (docs/BACKEND.md 14.6): for each LIVE hotel (active or suspended) the database changes applied and waiting, the
// database's answer time, whether its people's mail is failing, the last nightly backup copy (T6, platform.hotel_backups) and what its tables take
// on disk (P1). Platform metadata only. Where the owner-side look at the hotel schemas is not configured (a production server without its owner
// worker) the migration numbers are 0 and the database answer time is the platform schema's.

const P = platformCopy.platformHealth.problems;
/** A hotel with no activity for this many days is flagged. */
const QUIET_DAYS = 14;
const SLOW_MS = 500;
/** A newest backup copy older than this is flagged (the nightly run should have replaced it). */
const BACKUP_STALE_DAYS = 2;
const DAY_MS = 86_400_000;

export function createHealthService(deps: InviteDeps) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);

  async function build(session: VerifiedSession, audit: PlatformMeta | null): Promise<PlatformHealth> {
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const live = (await repos.hotels.list({ words: [] }, at)).filter((h) => (h.status === "active" || h.status === "suspended") && h.provisionedAt !== null);
      let inspection: HotelInspection | null = null;
      try {
        inspection = await deps.provisioner.inspect({ hotelIds: live.map((h) => h.id) });
      } catch (error) {
        if (!(error instanceof ProvisionError && error.failure === "NOT_CONFIGURED")) deps.report?.("platform health: inspecting the hotel schemas failed", error, audit?.traceId ?? "-");
      }
      const pingMs = await repos.health.ping();
      const failedMail = await repos.health.hotelsWithFailedMail(new Date(at.getTime() - DAY_MS));
      // T6: the newest nightly copy of each hotel (platform.hotel_backups); P1: what each hotel's tables take on disk (a failure hides only that figure)
      const backups = await repos.backups.latestOf(live.map((h) => h.id));
      let storage = new Map<string, number>();
      try {
        storage = await repos.health.storageBytes(live.map((h) => h.id));
      } catch (error) {
        deps.report?.("platform health: reading the hotels' storage failed", error, audit?.traceId ?? "-");
      }
      // P1: the guest bills of the month per hotel (one short read per hotel); a failure hides only that column
      let bills = new Map<string, { count: number; billedPaise: number }>();
      try {
        bills = (await deps.billsThisMonth?.(live.map((h) => h.id), at)) ?? bills;
      } catch (error) {
        deps.report?.("platform health: reading the hotels' bills failed", error, audit?.traceId ?? "-");
      }
      const latest = inspection?.latestMigration ?? 0;
      const rows = live
        .map((h): PlatformHealthRow => {
          const seen = inspection?.hotels[h.id];
          const applied = seen?.migrationsApplied ?? 0;
          // the provisioner compares the SET of files with the applied rows (a gap in the numbering is not pending); an older one only gives the count
          const pending = !inspection ? 0 : seen?.migrationsPending !== undefined ? seen.migrationsPending : Math.max(0, latest - applied);
          const ms = inspection ? (seen?.databaseMs ?? null) : pingMs;
          const database: PlatformDbState = ms === null ? "down" : ms > SLOW_MS ? "slow" : "ok";
          const mail = failedMail.has(h.id) ? "failing" : "ok";
          const problems: string[] = [];
          if (database === "down") problems.push(P.down);
          if (database === "slow") problems.push(P.slow);
          if (pending > 0) problems.push(P.pending(pending));
          if ((seen?.unknownMigrations ?? 0) > 0) problems.push(P.unknownMigrations(seen?.unknownMigrations ?? 0));
          if (mail === "failing") problems.push(P.mail);
          const backup = backups.get(h.id) ?? null;
          if (!backup) problems.push(P.noBackup);
          else if (at.getTime() - backup.finishedAt.getTime() > BACKUP_STALE_DAYS * DAY_MS) problems.push(P.oldBackup);
          // P1: a hotel nobody has touched for two weeks (or ever) is something to look at
          const quietDays = h.lastActivityAt ? Math.floor((at.getTime() - h.lastActivityAt.getTime()) / DAY_MS) : null;
          if (quietDays === null) problems.push(P.neverUsed);
          else if (quietDays >= QUIET_DAYS) problems.push(P.quiet(quietDays));
          return {
            hotelId: h.id, hotelName: h.name, slug: h.slug, city: h.city ?? "", hotelStatus: hotelStatusOf(h), migrationsApplied: applied, migrationsPending: pending, database, databaseMs: ms,
            mail, lastBackupAt: backup ? backup.finishedAt.toISOString() : null, lastActivityAt: h.lastActivityAt ? h.lastActivityAt.toISOString() : null, bills: bills.get(h.id) ?? null,
            storageBytes: storage.get(h.id) ?? null, status: database === "down" ? "down" : problems.length > 0 ? "attention" : "healthy", problems,
          };
        })
        .sort((a, b) => a.hotelName.localeCompare(b.hotelName, "en"));
      const view: PlatformHealth = {
        checkedAt: at.toISOString(), latestMigration: latest, rows,
        tiles: {
          healthy: rows.filter((r) => r.status === "healthy").length, attention: rows.filter((r) => r.status !== "healthy").length,
          noBackup: rows.filter((r) => r.lastBackupAt === null).length, pendingMigrations: rows.filter((r) => r.migrationsPending > 0).length,
        },
      };
      if (audit) await gate.audit(repos, actor, audit, { action: "health_checked", entity: "platform", entityId: null, reason: platformCopy.platformHealth.summary(view.tiles.healthy, view.tiles.attention) });
      return view;
    });
  }

  async function get(session: VerifiedSession): Promise<PlatformHealth> {
    gate.superRead(session);
    return build(session, null);
  }

  async function check(session: VerifiedSession, meta: PlatformMeta): Promise<PlatformHealth> {
    await gate.superWrite(session, meta, { action: "health_checked", entity: "platform", entityId: null });
    return build(session, meta);
  }

  return { get, check };
}

export type HealthService = ReturnType<typeof createHealthService>;

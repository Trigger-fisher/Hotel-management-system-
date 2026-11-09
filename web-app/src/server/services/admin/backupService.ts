import "server-only";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import type { SettingRow } from "../../repos/admin";
import { isPlatformSetupSession, PLATFORM_SETS_UP } from "../../auth/secretSettings";
import { AppError } from "../../errors";
import { actorOf, conflict, logLine, requireSuperAdmin, type AdminDeps, type Who } from "./context";

// Backup & Restore of the Settings (Pallav BackupController, settings/_backup), SuperAdmin only: the status line, and the buttons. What is real here: the
// status (is Google Drive connected, when and how the last backup ended, both read from app_settings: backup.refresh_token, backup.last_at,
// backup.last_result) and Disconnect (forgets the Drive token). The Google side (the sign-in redirect, testing the connection, the nightly zip and
// upload to Drive) is NOT built yet: those buttons answer 409 with a plain sentence, and nothing writes backup.last_at / backup.last_result until it is.

interface BackupStatusDto {
  connected: boolean;
  redirectUri: string;
  lastAt: string | null;
  lastResult: string | null;
}

const KEYS = ["backup.client_id", "backup.client_secret", "backup.refresh_token", "backup.folder_id", "backup.last_at", "backup.last_result"] as const;
/** Connecting, testing and running the backup are the Super Admin's, from the Set-up centre (MJ, 5 Nov 2026); the hotel keeps the status line. */
const setupOnly = (session: VerifiedSession): void => {
  if (!isPlatformSetupSession(session)) throw new AppError("FORBIDDEN", PLATFORM_SETS_UP);
};
const NOT_YET = "The Google Drive link is not available on this server yet.";

export function createBackupService(deps: AdminDeps & { publicUrl: string }) {
  const { unit } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });
  const filled = (row: SettingRow | undefined): boolean => row !== undefined && row.value !== null && row.value !== "";

  async function statusIn(repos: Parameters<Parameters<typeof unit.run>[1]>[0]): Promise<{ status: BackupStatusDto; rows: Map<string, SettingRow> }> {
    const rows = new Map((await repos.adminSettings.get(KEYS)).map((r) => [r.key, r]));
    const lastAt = rows.get("backup.last_at")?.value ?? null;
    const lastResult = rows.get("backup.last_result")?.value ?? null;
    return {
      rows,
      status: {
        connected: filled(rows.get("backup.refresh_token")),
        redirectUri: `${deps.publicUrl.replace(/\/+$/, "")}/settings/backup/google/callback`,
        lastAt: lastAt === "" ? null : lastAt,
        lastResult: lastResult === "" ? null : lastResult,
      },
    };
  }

  return {
    /** The Backup tab's status. */
    async status(session: VerifiedSession): Promise<BackupStatusDto> {
      requireSuperAdmin(session, "Backup");
      return unit.run(session, async (repos) => (await statusIn(repos)).status);
    },

    /** Connect with Google: Pallav needs the client id and secret saved first; the Google sign-in itself is not built yet. */
    async connect(session: VerifiedSession): Promise<BackupStatusDto> {
      setupOnly(session);
      return unit.run(session, async (repos) => {
        const { rows } = await statusIn(repos);
        if (!filled(rows.get("backup.client_id")) || !filled(rows.get("backup.client_secret"))) throw conflict("Save the Google client ID and secret first, then click Connect with Google.");
        throw conflict(NOT_YET);
      });
    },

    /** Disconnect: forgets the Drive token and folder (Pallav DriveBackup::disconnect); the client id and secret stay. */
    async disconnect(session: VerifiedSession, meta: RequestMeta): Promise<BackupStatusDto> {
      setupOnly(session);
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        await repos.adminSettings.set(
          [
            { key: "backup.refresh_token", value: null, secret: true },
            { key: "backup.folder_id", value: null, secret: false },
          ],
          session.userId,
        );
        await repos.systemLogs.write(logLine(w, "settings", { action: "updated", entity: "Backup", summary: "Disconnected Google Drive from backups", subject: null }));
        return (await statusIn(repos)).status;
      });
    },

    /** Test connection: needs a connected Drive; the check itself is not built yet. */
    async test(session: VerifiedSession): Promise<{ message: string }> {
      setupOnly(session);
      return unit.run(session, async (repos) => {
        if (!(await statusIn(repos)).status.connected) throw conflict("Google Drive is not connected yet.");
        throw conflict(NOT_YET);
      });
    },

    /** Back up now: needs a connected Drive; the backup itself is not built yet. */
    async run(session: VerifiedSession): Promise<BackupStatusDto & { message: string }> {
      setupOnly(session);
      return unit.run(session, async (repos) => {
        if (!(await statusIn(repos)).status.connected) throw conflict("Google Drive is not connected yet.");
        throw conflict(NOT_YET);
      });
    },
  };
}

export type BackupService = ReturnType<typeof createBackupService>;

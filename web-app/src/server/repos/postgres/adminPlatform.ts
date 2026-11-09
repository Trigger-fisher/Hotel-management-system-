import "server-only";
// The PostgreSQL implementation of the Admin platform repositories (repos/adminPlatform.ts): what belongs to a PERSON, not to one hotel.
// Today: the person's own display preferences (platform.users.ui_theme, migration 0100).
import type { SqlClient } from "../../../db/types";
import type { ClientPool } from "../../../db/withHotel";
import { AppError } from "../../errors";
import type { AdminPlatformRepos, AdminPlatformUnit, UiTheme } from "../adminPlatform";
import { guard } from "./shared";
import { createPlatformUnit } from "./platformUnit";

/** The 503 sentence while platform migration 0131 (users.photo_file) has not been run on this database. */
export const PROFILE_PHOTO_UPDATE_MISSING = "Profile photos need the latest database update (platform 0131). Please try again later.";
const missingColumn = (error: unknown): boolean => (error as { code?: unknown }).code === "42703";

function pgAdminPlatformRepos(db: SqlClient): AdminPlatformRepos {
  const theme = (v: unknown): UiTheme | null => (v === "light" || v === "dark" ? v : null);
  return {
    photo: {
      async get(userId) {
        // a database before 0131: no photo (the savepoint keeps the unit usable after the error)
        await db.query("SAVEPOINT photo_get");
        try {
          const r = await db.query("SELECT photo_file FROM platform.people WHERE id = $1", [userId]);
          await db.query("RELEASE SAVEPOINT photo_get");
          return typeof r.rows[0]?.photo_file === "string" ? (r.rows[0].photo_file as string) : null;
        } catch (error) {
          if (!missingColumn(error)) throw error;
          await db.query("ROLLBACK TO SAVEPOINT photo_get");
          return null;
        }
      },
      async set(userId, file) {
        try {
          const before = await db.query("SELECT photo_file FROM platform.logins WHERE id = $1 FOR UPDATE", [userId]);
          await db.query("UPDATE platform.logins SET photo_file = $2 WHERE id = $1", [userId, file]);
          return typeof before.rows[0]?.photo_file === "string" ? (before.rows[0].photo_file as string) : null;
        } catch (error) {
          if (missingColumn(error)) throw new AppError("CONFLICT", PROFILE_PHOTO_UPDATE_MISSING);
          throw error;
        }
      },
    },
    preferences: {
      async get(userId) {
        const r = await db.query("SELECT ui_theme FROM platform.people WHERE id = $1", [userId]);
        return { uiTheme: theme(r.rows[0]?.ui_theme) };
      },
      async set(userId, patch) {
        if (patch.uiTheme !== undefined) await guard(db.query("UPDATE platform.logins SET ui_theme = $2 WHERE id = $1", [userId, patch.uiTheme]));
        const r = await db.query("SELECT ui_theme FROM platform.people WHERE id = $1", [userId]);
        return { uiTheme: theme(r.rows[0]?.ui_theme) };
      },
    },
  };
}

export function createPgAdminPlatformUnit(pool: ClientPool): AdminPlatformUnit {
  return createPlatformUnit(pool, pgAdminPlatformRepos);
}

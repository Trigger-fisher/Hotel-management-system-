import "server-only";
// The two things the cash services read from OUTSIDE the hotel's schema, on the real database (platform schema, as hms_app): the people directory
// (names and roles of the people who recorded entries) and the platform audit trail.
import type { ClientPool } from "../../../db/withHotel";
import type { PeopleDirectory, Person, PlatformAudit } from "../../services/cash/ports";

async function withClient<T>(pool: ClientPool, work: (query: (text: string, params?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await work((text, params) => client.query(text, params));
  } finally {
    client.release();
  }
}

export function createPgPeopleDirectory(pool: ClientPool): PeopleDirectory {
  return {
    async get(ids) {
      const people = new Map<string, Person>();
      if (ids.length === 0) return people;
      const rows = await withClient(pool, async (query) =>
        (
          await query(
            `SELECT u.id, u.display_name, u.deleted_at, r.key AS role_key, r.level AS role_level
               FROM platform.people u
               JOIN platform.roles r ON r.id = COALESCE((SELECT uh.role_id FROM platform.user_hotels uh WHERE uh.user_id = u.id AND uh.is_default LIMIT 1), u.role_id)
              WHERE u.id = ANY($1::uuid[])`,
            [ids],
          )
        ).rows,
      );
      for (const r of rows) {
        people.set(String(r.id), { id: String(r.id), name: String(r.display_name), roleKey: String(r.role_key), roleLevel: Number(r.role_level), deleted: r.deleted_at !== null });
      }
      return people;
    },
  };
}

export function createPgPlatformAudit(pool: ClientPool): PlatformAudit {
  return {
    async record(event) {
      await withClient(pool, (query) =>
        query("INSERT INTO platform.audit_log (actor_user_id, hotel_id, action, entity, entity_id, after) VALUES ($1, $2, $3, 'user', $1, $4::jsonb)", [event.userId, event.hotelId, event.action, JSON.stringify(event.details)]),
      );
    },
  };
}

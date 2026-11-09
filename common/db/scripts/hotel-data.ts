// Owner-side work on ONE hotel's data that the running app cannot do with its own login (hms_app has no right on a hotel schema outside its role and cannot
// drop one): a full data export for the Platform console's "Export data", and the permanent removal of a hotel's schema and role. Runs as hms_owner, from the
// provisioner (web-app/src/server/provisioner). Nothing here decides WHETHER a hotel may be exported or deleted: the console checks the rules (and the database
// trigger on platform.hotel_deletions backs them up) before it calls either.
import type { MigrationClient } from "./migrate";
import { isHotelSchemaName, LEGACY_SCHEMA } from "./schema-names";

/**
 * Tables whose rows are never exported: Conversations (decision 66): guests' messages, addresses and numbers never leave in plain
 * form, and the mail positions are left out too, so a restored hotel starts its mail check again from the first window.
 */
export const EXPORT_SKIPS: ReadonlySet<string> = new Set(["conv_contacts", "conv_contact_handles", "conv_conversations", "conv_messages", "conv_notes", "conv_mail_positions"]);

export class HotelDataError extends Error {
  readonly code: "BAD_INPUT" | "NOT_FOUND";
  constructor(code: "BAD_INPUT" | "NOT_FOUND", message: string) {
    super(message);
    this.name = "HotelDataError";
    this.code = code;
  }
}

export interface HotelExportText {
  /** One JSON object per line: {"kind":"hotel"|"user"|"membership"|"status_history"|"table"...}. */
  ndjson: string;
  tables: number;
  rows: number;
}

/**
 * Where a hotel's data is read from. The owner connection (the CLI, the development provisioner) reads both sides itself; the running app reads the
 * platform rows with its own login and the hotel's tables through withHotel (the hotel's role, its schema first on search_path), so the nightly
 * backup copy (T6) works on a host without the owner login.
 */
export interface HotelExportSource {
  /** Reads platform.hotels, platform.users, platform.user_hotels and platform.hotel_status_history. */
  platform: MigrationClient;
  /** Runs `work` with a client that can read the hotel's schema; `table(name)` is how a table of that schema is named in SQL on that client. */
  hotel<T>(schema: string, work: (client: MigrationClient, table: (name: string) => string) => Promise<T>): Promise<T>;
}

/**
 * Everything the platform and the hotel hold about one hotel, as newline-delimited JSON: the platform row, its people (never a password hash), their
 * memberships, the status history, and every table of the hotel's own schema when it has one (a hotel that was rejected or never approved has none).
 */
export async function exportHotelData(owner: MigrationClient, hotelId: string): Promise<HotelExportText> {
  return exportHotelLines({ platform: owner, hotel: (schema, work) => work(owner, (name) => `"${schema}"."${name}"`) }, hotelId);
}

/** The same export from any source (see HotelExportSource). */
export async function exportHotelLines(source: HotelExportSource, hotelId: string): Promise<HotelExportText> {
  const hotel = await source.platform.query("SELECT to_jsonb(h) AS row, h.schema_name, h.provisioned_at FROM platform.hotels h WHERE h.id = $1", [hotelId]);
  const found = hotel.rows[0];
  if (!found) throw new HotelDataError("NOT_FOUND", "No such hotel");
  const lines: string[] = [];
  let rows = 0;
  let tables = 0;
  const add = (kind: string, value: unknown, extra: Record<string, unknown> = {}): void => {
    lines.push(JSON.stringify({ kind, ...extra, row: value }));
    rows += 1;
  };
  add("hotel", found.row);
  for (const r of (
    await source.platform.query(
      `SELECT u.id, u.username, u.email, u.mobile, u.display_name, u.account_role, u.status, u.created_at, u.last_login_at, u.deleted_at
         FROM platform.people u WHERE u.id IN (SELECT user_id FROM platform.user_hotels WHERE hotel_id = $1) ORDER BY u.created_at, u.id`,
      [hotelId],
    )
  ).rows) add("user", r);
  for (const r of (await source.platform.query("SELECT user_id, hotel_id, role_id, status, is_default FROM platform.user_hotels WHERE hotel_id = $1 ORDER BY user_id", [hotelId])).rows) add("membership", r);
  for (const r of (await source.platform.query("SELECT * FROM platform.hotel_status_history WHERE hotel_id = $1 ORDER BY at, id", [hotelId])).rows) add("status_history", r);
  const schema = String(found.schema_name);
  if (found.provisioned_at !== null && isHotelSchemaName(schema)) {
    await source.hotel(schema, async (client, table) => {
      const names = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name", [schema]);
      for (const t of names.rows) {
        const name = String(t.table_name);
        tables += 1;
        // tables in EXPORT_SKIPS are never part of a hotel export
        if (EXPORT_SKIPS.has(name)) continue;
        for (const r of (await client.query(`SELECT to_jsonb(t) AS row FROM ${table(name)} t`)).rows) add("table", r.row, { table: name });
      }
    });
  }
  return { ndjson: lines.join("\n") + "\n", tables, rows };
}

/** Drops the hotel's schema (every table in it) and its login-less role, in one transaction. Safe to run again: a schema or role that is gone is not an error. */
export async function dropHotelSchema(owner: MigrationClient, schema: string): Promise<void> {
  if (!isHotelSchemaName(schema)) throw new HotelDataError("BAD_INPUT", "Not a hotel schema name");
  // the role is named from the hotel's id, not from its schema (readable schemas, migration 0172): platform.hotels holds it; a hotel not renamed yet has the old hotel_<hex>_rw
  const named = await owner.query("SELECT role_name FROM platform.hotels WHERE schema_name = $1", [schema]);
  const role = String(named.rows[0]?.role_name ?? (LEGACY_SCHEMA.test(schema) ? `${schema}_rw` : ""));
  await owner.query("BEGIN");
  try {
    await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    if (role !== "" && (await owner.query("SELECT 1 AS present FROM pg_roles WHERE rolname = $1", [role])).rows.length > 0) {
      await owner.query(`DROP ROLE "${role}"`);
    }
    await owner.query("COMMIT");
  } catch (error) {
    try {
      await owner.query("ROLLBACK");
    } catch {
      // the connection is gone; the original error matters
    }
    throw error;
  }
}

import "server-only";
import type { ClientPool } from "../../db/withHotel";
import { AppError } from "../errors";
import { assertSafe, contentTypeOf, type MediaStore } from "./store";

// The database-backed media store (MEDIA_DRIVER=db, platform migration 0137, table platform.media_files): the same port as the local folder, the memory double and S3, with the
// files kept as bytea rows in the platform schema, so a hosted server needs no bucket and no disk. One row per (owner, bucket, name): `owner` is the folder the other adapters
// use (a hotel id; for the profile photos a user id), `bucket` is the store ("id-photos", "menu-photos", "media", "profile-photos"). Every query takes the owner from the
// caller (the services pass the session's own hotel), never from a request, and the name has already been through assertSafe. No route reads this table: only the services'
// authenticated routes do. Pictures are made small before they are put (media/compress.ts), so a row stays a few hundred KB. Moving the files to a bucket later is a copy.

export const MEDIA_TABLE_MISSING = "Photo storage needs the latest database update (platform 0137)";

export type MediaBucket = "id-photos" | "menu-photos" | "media" | "profile-photos";

export function createDbMediaStore(pool: ClientPool, bucket: MediaBucket): MediaStore {
  let ready = false;
  /** One statement on a pooled connection (a single statement: no transaction, no savepoint). */
  async function run(text: string, params: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
    const client = await pool.connect();
    let broken = false;
    const onError = (): void => {
      broken = true;
    };
    client.on("error", onError);
    try {
      return await client.query(text, params);
    } catch (error) {
      broken = true;
      throw error;
    } finally {
      client.removeListener("error", onError);
      client.release(broken);
    }
  }
  /** Has migration 0137 been applied? to_regclass answers NULL for a missing table, so the probe never fails; a positive answer is remembered. */
  async function tableThere(): Promise<boolean> {
    if (ready) return true;
    ready = (await run("SELECT to_regclass('platform.media_files') IS NOT NULL AS there", [])).rows[0]?.there === true;
    return ready;
  }
  return {
    async put(owner, name, bytes) {
      assertSafe(owner, name);
      if (!(await tableThere())) throw new AppError("CONFLICT", MEDIA_TABLE_MISSING);
      await run(
        `INSERT INTO platform.media_files (owner_id, bucket, name, content_type, bytes, size)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (owner_id, bucket, name) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, size = EXCLUDED.size, updated_at = now()`,
        [owner, bucket, name, contentTypeOf(name), Buffer.from(bytes), bytes.length],
      );
      return name;
    },
    async get(owner, name) {
      assertSafe(owner, name);
      if (!(await tableThere())) return null;
      const r = await run("SELECT bytes, content_type FROM platform.media_files WHERE owner_id = $1 AND bucket = $2 AND name = $3", [owner, bucket, name]);
      const row = r.rows[0];
      return row ? { bytes: new Uint8Array(row.bytes as Buffer), contentType: String(row.content_type) } : null;
    },
    async has(owner, name) {
      assertSafe(owner, name);
      if (!(await tableThere())) return false;
      return (await run("SELECT 1 FROM platform.media_files WHERE owner_id = $1 AND bucket = $2 AND name = $3", [owner, bucket, name])).rows.length > 0;
    },
    async remove(owner, name) {
      assertSafe(owner, name);
      if (!(await tableThere())) return;
      await run("DELETE FROM platform.media_files WHERE owner_id = $1 AND bucket = $2 AND name = $3", [owner, bucket, name]);
    },
  };
}

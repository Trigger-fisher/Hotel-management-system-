import "server-only";
// One transaction on the PLATFORM schema, as hms_app (no hotel role: the platform schema is the app's own). Used by every platform repository set
// (sign-in, the Admin profile): `bind` makes the repositories over the unit's connection; a failure rolls the whole unit back.
import type { SqlClient } from "../../../db/types";
import type { ClientPool } from "../../../db/withHotel";

export function createPlatformUnit<Repos>(pool: ClientPool, bind: (db: SqlClient) => Repos): { run<T>(work: (repos: Repos) => Promise<T>): Promise<T>; read<T>(work: (repos: Repos) => Promise<T>): Promise<T> } {
  return {
    /**
     * ONE read outside a transaction (no BEGIN / COMMIT: two fewer waits for the database). Only for work that is a single SELECT, or reads that need not agree with each
     * other; anything that writes, locks (FOR UPDATE) or must see one moment uses run().
     */
    async read(work) {
      const client = await pool.connect();
      let broken = false;
      const onError = (): void => {
        broken = true;
      };
      client.on("error", onError);
      try {
        return await work(bind({ query: async (text, params) => ((r) => ({ rows: r.rows, affectedRows: r.rowCount ?? 0 }))(await client.query(text, params as unknown[] | undefined)) }));
      } finally {
        client.removeListener("error", onError);
        client.release(broken);
      }
    },
    async run(work) {
      const client = await pool.connect();
      let broken = false;
      const onError = (): void => {
        broken = true;
      };
      client.on("error", onError);
      const db: SqlClient = { query: async (text, params) => ((r) => ({ rows: r.rows, affectedRows: r.rowCount ?? 0 }))(await client.query(text, params as unknown[] | undefined)) };
      try {
        await client.query("BEGIN");
        try {
          const result = await work(bind(db));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          if (!broken) {
            try {
              await client.query("ROLLBACK");
            } catch {
              broken = true;
            }
          }
          throw error;
        }
      } finally {
        client.removeListener("error", onError);
        client.release(broken);
      }
    },
  };
}

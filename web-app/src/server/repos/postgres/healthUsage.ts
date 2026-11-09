import "server-only";
import type { VerifiedSession, WithHotel } from "../../../db/withHotel";

// System Health usage: what the hotel's own tables can say about how the features are used. HMS has no request log (no page visits, no timings), so the
// source is the system log (system_logs: one line per recorded action, with module, user, status and time) plus plain record counts of the busy tables.
// Nothing here reads a guest's data: counts, module keys and user ids (only to count distinct people) leave the database, nothing else.

export interface UsageRaw {
  /** Recorded actions per module and IST day (last 30 days). */
  daily: { module: string; day: string; hits: number; failed: number }[];
  /** Distinct people per module over the last 7 days. */
  users7: { module: string; users: number }[];
  /** Recorded actions per module in the 7 days before the last 7. */
  prev7: { module: string; hits: number }[];
  /** Pairs of consecutive actions of one person within 30 minutes, in different modules (people counted once per pair). */
  flows: { from: string; to: string; people: number }[];
  /** Open faults per feature key. */
  faults: { feature: string; open: number }[];
}

export interface ActivityRaw {
  key: string;
  label: string;
  last24h: number;
  last7d: number;
  last30d: number;
}

export interface ServerRaw {
  /** What this hotel's own tables take on disk (the app's database role may not read the whole database's size). */
  hotelDataBytes: number | null;
  /** Connections of the app's role to this database. */
  dbConnections: number | null;
}

export type UsageWho = VerifiedSession;

export interface HealthUsageReader {
  usage(who: UsageWho, windows: { from30: Date; from7: Date; from14: Date }): Promise<UsageRaw>;
  /** Record counts per busy table group; a group whose table does not exist in this hotel is left out. */
  activity(who: UsageWho, now: Date): Promise<ActivityRaw[]>;
  server(who: UsageWho): Promise<ServerRaw>;
}

/** [key, label, tables whose rows are summed]. The names are code constants, never user input. */
const ACTIVITY: readonly [string, string, readonly string[]][] = [
  ["stays", "Stays", ["pms_stays"]],
  ["bills", "Bills", ["bill_master_bills"]],
  ["advances", "Guest advances", ["bill_master_advances"]],
  ["revenue", "Revenue deposits", ["hotel_cash_deposits", "food_cash_deposits"]],
  ["expenses", "Expense entries", ["hotel_cash_withdrawals", "food_cash_withdrawals", "hotel_misc_expenses", "food_misc_expenses"]],
  ["salary", "Salary runs", ["salary_processings"]],
];

const n = (v: unknown): number => Number(v ?? 0) || 0;
/** PostgreSQL"s undefined_table / undefined_column: a hotel on an older migration level. Any other failure (a refused connection, a timeout) is a real error and goes up. */
const missing = (e: unknown): boolean => ["42P01", "42703"].includes(String((e as { code?: unknown } | null)?.code ?? ""));

export function createPgHealthUsageReader(withHotel: WithHotel): HealthUsageReader {
  return {
    usage: (who, w) =>
      withHotel(who, async (tx) => {
        const daily = await tx.query(
          `SELECT module, (created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day, count(*) AS hits, count(*) FILTER (WHERE status = 'failed') AS failed
             FROM system_logs WHERE created_at >= $1 GROUP BY 1, 2 ORDER BY 2, 1`,
          [w.from30],
        );
        const users7 = await tx.query(`SELECT module, count(DISTINCT user_id) AS users FROM system_logs WHERE created_at >= $1 AND user_id IS NOT NULL GROUP BY module`, [w.from7]);
        const prev7 = await tx.query(`SELECT module, count(*) AS hits FROM system_logs WHERE created_at >= $1 AND created_at < $2 GROUP BY module`, [w.from14, w.from7]);
        const flows = await tx.query(
          `WITH s AS (
             SELECT user_id, module, created_at, lag(module) OVER w AS prev_module, lag(created_at) OVER w AS prev_at
               FROM system_logs WHERE created_at >= $1 AND user_id IS NOT NULL
             WINDOW w AS (PARTITION BY user_id ORDER BY created_at, id)
           )
           SELECT prev_module AS from_module, module AS to_module, count(DISTINCT user_id) AS people
             FROM s WHERE prev_module IS NOT NULL AND prev_module <> module AND created_at - prev_at <= interval '30 minutes'
            GROUP BY 1, 2 ORDER BY people DESC, 1, 2 LIMIT 60`,
          [w.from30],
        );
        const faults = await tx.query(`SELECT feature, count(*) AS open FROM feature_errors WHERE resolved_at IS NULL GROUP BY feature`);
        return {
          daily: daily.rows.map((r) => ({ module: String(r.module), day: String(r.day), hits: n(r.hits), failed: n(r.failed) })),
          users7: users7.rows.map((r) => ({ module: String(r.module), users: n(r.users) })),
          prev7: prev7.rows.map((r) => ({ module: String(r.module), hits: n(r.hits) })),
          flows: flows.rows.map((r) => ({ from: String(r.from_module), to: String(r.to_module), people: n(r.people) })),
          faults: faults.rows.map((r) => ({ feature: String(r.feature), open: n(r.open) })),
        };
      }),

    async activity(who, now) {
      const t = (ms: number) => new Date(now.getTime() - ms);
      const out: ActivityRaw[] = [];
      for (const [key, label, tables] of ACTIVITY) {
        try {
          const sums = await withHotel(who, async (tx) => {
            let d1 = 0;
            let d7 = 0;
            let d30 = 0;
            for (const table of tables) {
              const r = await tx.query(
                `SELECT count(*) FILTER (WHERE created_at >= $1) AS d1, count(*) FILTER (WHERE created_at >= $2) AS d7, count(*) AS d30 FROM ${table} WHERE created_at >= $3`,
                [t(86_400_000), t(7 * 86_400_000), t(30 * 86_400_000)],
              );
              d1 += n(r.rows[0]?.d1);
              d7 += n(r.rows[0]?.d7);
              d30 += n(r.rows[0]?.d30);
            }
            return { d1, d7, d30 };
          });
          out.push({ key, label, last24h: sums.d1, last7d: sums.d7, last30d: sums.d30 });
        } catch (e) {
          // a hotel without this table (an older migration level): the group is left out, never an error for the page
          if (!missing(e)) throw e;
        }
      }
      return out;
    },

    async server(who) {
      // each number on its own: one the app's role may not read must not hide the other
      const one = async (sql: string): Promise<number | null> => {
        try {
          return await withHotel(who, async (tx) => n((await tx.query(sql)).rows[0]?.v));
        } catch {
          return null;
        }
      };
      return {
        hotelDataBytes: await one(`SELECT COALESCE(sum(pg_total_relation_size(c.oid)), 0) AS v FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = current_schema() AND c.relkind = 'r'`),
        dbConnections: await one(`SELECT count(*) AS v FROM pg_stat_activity WHERE datname = current_database()`),
      };
    },
  };
}
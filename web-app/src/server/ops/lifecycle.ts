import "server-only";

// Process lifecycle: is the database answering (readiness), and a clean stop (SIGTERM / SIGINT: a deploy, a restart, a scale-down). On a stop the mail worker
// stops taking new rows and the connection pool is closed so PostgreSQL sees clean disconnects; the host's grace period (default 10 to 30 seconds) is enough.

export interface PingPool {
  connect(): Promise<{ query(sql: string): Promise<unknown>; release(): void }>;
}

/** True when the database answers `SELECT 1` within the time; never throws. */
export async function pingDatabase(pool: PingPool, timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const ask = (async (): Promise<boolean> => {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  })().catch(() => false);
  try {
    return await Promise.race([ask, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface ShutdownDeps {
  stopWork(): void;
  closeDatabase(): Promise<void>;
  log(message: string): void;
  exit(code: number): void;
  /** Longest wait for the pool to close before the process leaves anyway. */
  graceMs?: number;
}

/** The stop sequence, separate from the signals so a test can drive it. Runs once however many signals arrive. */
export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let started = false;
  return async (signal) => {
    if (started) return;
    started = true;
    deps.log(`${signal} received: stopping`);
    deps.stopWork();
    // the timer is kept referenced on purpose: a stop in progress must outlive an empty event loop until the pool is closed or the grace is over
    const grace = new Promise<void>((resolve) => setTimeout(resolve, deps.graceMs ?? 8000));
    await Promise.race([deps.closeDatabase().catch(() => undefined), grace]);
    deps.exit(0);
  };
}
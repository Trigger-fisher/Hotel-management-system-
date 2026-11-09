import "server-only";
import { z } from "zod";

// The ID reader bridge's two deployment settings (read here, server only; never sent to a browser, never printed). Set by whoever deploys the server:
//   INTAKE_QUEUE_DATABASE_URL  the database that holds the intake_jobs queue (the same one the reader worker pulls from), as a login that may SELECT and INSERT it
//   INTAKE_MASTER_KEY          the worker's own INTAKE_MASTER_KEY (32 random bytes, base64): HMS seals each job's key with it
// Either one missing, or not valid, means the reader is not connected: the check-in asks for the details to be typed.
const url = z.string().refine((v) => /^postgres(ql)?:\/\//.test(v));
const key = z.string().refine((v) => /^[A-Za-z0-9+/]{43}=$/.test(v) && Buffer.from(v, "base64").length === 32);

export interface IntakeSettings {
  queueUrl: string;
  masterKey: Buffer;
}

export function readIntakeSettings(env: Record<string, string | undefined> = process.env): IntakeSettings | null {
  const queue = url.safeParse(env.INTAKE_QUEUE_DATABASE_URL?.trim());
  const master = key.safeParse(env.INTAKE_MASTER_KEY?.trim());
  if (!queue.success || !master.success) return null;
  return { queueUrl: queue.data, masterKey: Buffer.from(master.data, "base64") };
}

import "server-only";
import { getConfig } from "../config/env";
import { createMemoryAuth } from "../repos/memory/auth";
import { createMailQueue, type MailQueue } from "../services/auth/mail";
import { getPlatformUnit } from "./auth";

// The mail queue the business services (bills, advances, the guest portal) put their mails on: platform.outbox when the real database is configured, the in-memory
// outbox otherwise. The worker (compose/mail.ts) sends them: a hotel's mail from the hotel's own email, system mail from the platform email (mail/routes.ts).
let queue: MailQueue | null = null;
export function getMailQueue(): MailQueue {
  if (queue) return queue;
  const config = getConfig();
  queue = config.DATABASE_URL && config.HMS_HASH_KEY ? createMailQueue(getPlatformUnit(), () => new Date()) : createMailQueue(createMemoryAuth().unit, () => new Date());
  return queue;
}

/** Replaces the queue (start-up code and tests). */
export function configureMailQueue(next: MailQueue | null): void {
  queue = next;
}
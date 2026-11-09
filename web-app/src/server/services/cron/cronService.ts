import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { AppError } from "../../errors";

// Scheduled jobs called over HTTP (/api/v1/cron/*), for a host where no timer outlives a request (Vercel Cron, or any scheduler such as a system
// cron with curl). No session: `Authorization: Bearer <CRON_SECRET>`, compared in constant time over SHA-256 digests (the lengths never leak).
// No secret configured = the routes do not exist (404); a missing or wrong one = 401.

export interface CronMailSummary {
  sent: number;
  failed: number;
  remaining: number;
}

export interface CronSummaryRun {
  hotels: number;
  queued: number;
  skipped: number;
  failed: number;
  /** Present (true) when hotels are left: the call stopped at its batch size or time budget and the next call continues (the route chains it). */
  more?: true;
}

export interface CronBackupRun {
  configured: boolean;
  hotels: number;
  done: number;
  failed: number;
  skipped: number;
  pruned: number;
}

/** The daily safety net of Conversations (decision 66): the 12-month purge of every hotel, then the mail check of mailboxes not checked for 6 hours. */
export interface CronConversationsRun {
  hotels: number;
  checked: number;
  added: number;
  purged: number;
  failed: number;
  /** Present (true) when hotels are left: the route hands the rest to a new call. */
  more?: true;
}

interface CronDeps {
  /** CRON_SECRET, read when a request comes (undefined = cron routes are off). */
  secret: () => string | undefined;
  /** One pass of the mail queue. */
  drainMail: () => Promise<CronMailSummary>;
  /** The owners' daily summary mails, once a day. */
  dailySummary: () => Promise<CronSummaryRun>;
  /** The nightly backup copy of every live hotel (T6). */
  backup: () => Promise<CronBackupRun>;
  /** Conversations' daily pass (purge, then the mail checks). Absent = nothing to do. */
  conversations?: () => Promise<CronConversationsRun>;
}

const sha = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();

export function createCronService(deps: CronDeps) {
  function authorize(request: Request): void {
    const secret = deps.secret();
    if (!secret) throw new AppError("NOT_FOUND");
    const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
    if (given === "" || !timingSafeEqual(sha(secret), sha(given))) throw new AppError("SESSION_EXPIRED");
  }
  return {
    authorize,
    /** Sends what the mail queue holds, once: `{sent, failed, remaining}`. */
    mail: (): Promise<CronMailSummary> => deps.drainMail(),
    /** Queues every hotel's daily summary (at most once a day per hotel): `{hotels, queued, skipped, failed}`. */
    dailySummary: (): Promise<CronSummaryRun> => deps.dailySummary(),
    /** Copies every live hotel's records to the object store, once: `{configured, hotels, done, failed, skipped, pruned}`. */
    backup: (): Promise<CronBackupRun> => deps.backup(),
    /** Conversations: the 12-month purge, then the mail checks due: `{hotels, checked, added, purged, failed, more?}`. */
    conversations: (): Promise<CronConversationsRun> => (deps.conversations ? deps.conversations() : Promise.resolve({ hotels: 0, checked: 0, added: 0, purged: 0, failed: 0 })),
  };
}

export type CronService = ReturnType<typeof createCronService>;

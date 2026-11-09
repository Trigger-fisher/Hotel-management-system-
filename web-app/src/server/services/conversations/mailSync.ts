import "server-only";
import type { FetchResult, Position } from "../../conversations/channel";
import type { createEmailChannel } from "../../conversations/emailChannel";
import type { MailboxRead } from "../../mail/mailbox";
import type { ConversationsRepo, IngestResult, LinkMatcher } from "../../repos/conversations";

// One mail check of a mailbox (Conversations, decision 66), the hotel's or the platform's: new mail by IMAP UID since the last position, taken into the hub. No transaction is
// held while the mail server is talked to:
//   1. a short unit: the mailbox's settings and positions, the throttle, a changed address (the positions start again), the lease (one check at a time per mailbox);
//   2. the IMAP work, outside any unit, within a time budget;
//   3. a short unit: the new entries taken in, the positions saved (only to the last UID read), the lease released.
// Throttle: a check opened on screen runs at most every 50 seconds, a background one (the menu badge's poll, every 90 seconds while HMS is open) about every 1.5 minutes;
// the daily safety net forces it (the lease still holds). A mail server that says "too many connections" (RATE_LIMITED) holds the background checks back 15 minutes (a
// check on screen or "Check now" is not held back). What is logged: counts and a code, never an address.

export const FOREGROUND_GAP_MS = 50_000;
/** A little under the badge's 90-second poll, so a poll that comes a moment early still checks. */
export const BACKGROUND_GAP_MS = 85_000;
export const RATE_LIMITED_WAIT_MS = 15 * 60_000;
export const LEASE_MS = 60_000;
export const FIRST_WINDOW_DAYS = 14;
export const MAX_PER_FOLDER = 100;
export const DEFAULT_SYNC_BUDGET_MS = 20_000;

/** The repositories one short unit hands the check (the hub and its matcher). */
export interface SyncRepos {
  conversations: ConversationsRepo;
  matcher: LinkMatcher;
}

export interface SyncTarget<R extends SyncRepos = SyncRepos> {
  /** One short unit of work on this mailbox's hub. */
  run<T>(work: (repos: R) => Promise<T>): Promise<T>;
  /** The mailbox as set up now (read inside `run` by the caller when it needs the settings rows). */
  mailbox(repos: R): Promise<MailboxRead>;
  /** Runs in the same unit right after the new entries are taken in (the platform labels its desks' mail: Sales, Support). */
  afterIngest?(repos: R, entries: FetchResult["entries"], at: Date): Promise<void>;
}

export interface SyncOutcome {
  /** A check ran now (false: throttled, another check holds the lease, or there is no mailbox to read). */
  checked: boolean;
  added: number;
  error: string | null;
  newInbound: IngestResult["newInbound"];
  mailbox: MailboxRead;
  positions: Position[];
}

export interface SyncOptions<R extends SyncRepos = SyncRepos> {
  target: SyncTarget<R>;
  channel: Pick<ReturnType<typeof createEmailChannel>, "fetchNew">;
  now: () => Date;
  force?: boolean;
  background?: boolean;
  budgetMs?: number;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

export async function syncMailbox<R extends SyncRepos>(o: SyncOptions<R>): Promise<SyncOutcome> {
  const started = o.now();
  // 1. settings, positions, throttle, lease
  const prep = await o.target.run(async (repos) => {
    const mailbox = await o.target.mailbox(repos);
    if (!mailbox.config) return { mailbox, positions: [] as Position[], go: false };
    let positions = await repos.conversations.positions();
    const address = mailbox.config.address;
    if (positions.some((p) => p.mailbox !== address)) {
      // a different mailbox now: its UIDs mean nothing here; the first window again
      await repos.conversations.resetPositions(address);
      positions = await repos.conversations.positions();
    }
    const inbox = positions.find((p) => p.folder === "inbox");
    const last = inbox?.checkedAt ?? null;
    const gap = o.background ? (inbox?.lastError === "RATE_LIMITED" ? RATE_LIMITED_WAIT_MS : BACKGROUND_GAP_MS) : FOREGROUND_GAP_MS;
    if (!o.force && last && started.getTime() - last.getTime() < gap) return { mailbox, positions, go: false };
    const leased = await repos.conversations.acquireLease(address, started, LEASE_MS);
    return { mailbox, positions: leased ? await repos.conversations.positions() : positions, go: leased };
  });
  const idle = (): SyncOutcome => ({ checked: false, added: 0, error: null, newInbound: [], mailbox: prep.mailbox, positions: prep.positions });
  if (!prep.go || !prep.mailbox.config) return idle();
  const config = prep.mailbox.config;

  // 2. the mail server, outside any unit
  let fetched: FetchResult;
  try {
    fetched = await o.channel.fetchNew(config, prep.positions, {
      max: MAX_PER_FOLDER,
      firstWindowDays: FIRST_WINDOW_DAYS,
      budgetMs: o.budgetMs ?? DEFAULT_SYNC_BUDGET_MS,
      knownMessageIds: (ids) => o.target.run((repos) => repos.conversations.knownMessageIds(ids)),
    });
  } catch {
    fetched = { entries: [], positions: [], error: "UNKNOWN", sentFolder: false };
  }

  // 3. taken in, positions saved, lease released
  const at = o.now();
  try {
    const result = await o.target.run(async (repos) => {
      const ingested = await repos.conversations.ingest(fetched.entries, { mailbox: config.address }, repos.matcher, at);
      if (o.target.afterIngest && fetched.entries.length > 0) await o.target.afterIngest(repos, fetched.entries, at);
      // RATE_LIMITED is kept as the error: the throttle above holds the background checks back 15 minutes from this check
      const error = fetched.error ?? (fetched.sentFolder ? null : "NO_SENT_FOLDER");
      await repos.conversations.savePositions(config.address, fetched.positions, { checkedAt: at, ok: fetched.error === null, error });
      return { ingested, positions: await repos.conversations.positions() };
    });
    o.log?.("mail check", { added: result.ingested.added, entries: fetched.entries.length, code: fetched.error });
    return { checked: true, added: result.ingested.added, error: fetched.error, newInbound: result.ingested.newInbound, mailbox: prep.mailbox, positions: result.positions };
  } catch (error) {
    await o.target.run((repos) => repos.conversations.releaseLease()).catch(() => undefined);
    throw error;
  }
}

import "server-only";
import type { MailCheck, MailConnectionTest } from "@shared/dashboards/conversations";
import { imapHintFor } from "./hints";
import type { ImapClientFactory, ImapConfig } from "./imap";
import { IMAP_FAILURE_TEXT, imapFailureOf } from "./imapFailure";
import type { HostLookup } from "./safeHost";
import { verifySmtp, type SmtpConfig, type TransportFactory } from "./smtp";

// "Test connection" (hotel Settings > Email; Console > Conversations > Settings): signs in to the mailbox for reading (IMAP: the folder list and the Inbox) and for sending
// (SMTP: a sign-in, nothing sent) at the same time, each with its own time limit, and says what failed in FIXED sentences with a plain hint (decision 66, A13). The server's own
// words, the login and the password are never part of the answer, and the stored result (a hotel's email.connection_test) holds only codes, sentences and the time.

export const TEST_TIMEOUT_MS = 20_000;
export const SEND_ONLY_CHECK: MailCheck = { ok: false, code: "SEND_ONLY", message: "Reading mail needs Gmail or your own mail server." };
export const NOT_SET_CHECK: MailCheck = { ok: false, code: "NOT_SET", message: "Reading mail is not set up yet: switch it on in the mail settings, enter the IMAP server if asked, and save." };

const timeout = <T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> =>
  new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(onTimeout());
      },
    );
  });

async function checkImap(config: ImapConfig, factory: ImapClientFactory, ms: number): Promise<MailCheck> {
  let session: Awaited<ReturnType<ImapClientFactory>> | null = null;
  try {
    session = await factory(config, { budgetMs: ms });
    const folders = await session.listSpecial();
    await session.open(folders.inbox);
    return folders.sent ? { ok: true, code: null, message: "Signed in. Sent folder found." } : { ok: true, code: "NO_SENT_FOLDER", message: "Signed in, but no Sent folder was found: replies are still sent." };
  } catch (error) {
    const code = imapFailureOf(error);
    const hint = imapHintFor(config.host, code);
    return { ok: false, code, message: IMAP_FAILURE_TEXT[code], ...(hint ? { hint } : {}) };
  } finally {
    await session?.close().catch(() => undefined);
  }
}

/**
 * Both sides of the test. `imap` null: reading is not set up (or the service only sends: `sendOnly`). `smtp` null: no mail server to sign in to.
 */
export async function testMailConnection(
  cfg: { smtp: SmtpConfig | null; imap: ImapConfig | null; sendOnly?: boolean },
  deps: { imap: ImapClientFactory; createTransport?: TransportFactory; lookup?: HostLookup; timeoutMs?: number; now?: () => Date },
): Promise<MailConnectionTest> {
  const ms = deps.timeoutMs ?? TEST_TIMEOUT_MS;
  const timedOut = (host: string): MailCheck => ({ ok: false, code: "TIMEOUT", message: IMAP_FAILURE_TEXT.TIMEOUT, ...(imapHintFor(host, "TIMEOUT") ? { hint: imapHintFor(host, "TIMEOUT") } : {}) });
  const imap: Promise<MailCheck> = cfg.sendOnly ? Promise.resolve(SEND_ONLY_CHECK) : cfg.imap ? timeout(checkImap(cfg.imap, deps.imap, ms), ms + 1_000, () => timedOut(cfg.imap?.host ?? "")) : Promise.resolve(NOT_SET_CHECK);
  const smtp: Promise<MailCheck> = cfg.smtp
    ? timeout(verifySmtp(cfg.smtp, deps.createTransport, deps.lookup), ms, () => ({ ok: false, code: "TIMEOUT", message: "The mail server took too long to answer." }))
    : Promise.resolve({ ok: false, code: "NOT_SET", message: "No mail server is set up for sending." });
  const [i, s] = await Promise.all([imap, smtp]);
  return { imap: i, smtp: s, at: (deps.now?.() ?? new Date()).toISOString() };
}

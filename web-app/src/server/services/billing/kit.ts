import "server-only";
import type { MailQueue } from "../auth/mail";
import type { Catalog } from "../../auth/catalog";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { BillingRepos } from "../../repos/billing";
import type { Unit } from "../../repos/types";
import { guardBooks, guardWouldRefuse, type GuardInput } from "../cash/books";
import type { PeopleDirectory, Person, PlatformAudit } from "../cash/ports";
import { forceOn } from "../cash/rules";
import type { LogContext } from "../cash/syslog";
import { fail } from "./advanceValidate";

// What every billing service shares ONCE: the people lookup, the log context, Pallav's ForceMode::locked (a lock that steps aside for
// the SuperAdmin with force armed and is written to the force log and the platform audit) and the accounting-year guard with the error on
// the apps' date field.
export interface BillingDeps {
  unit: Unit<BillingRepos>;
  people: PeopleDirectory;
  audit: PlatformAudit;
  catalog: Catalog;
  now: () => Date;
  /** Queues a mail (an invoice or a receipt) for the worker; the hotel's own email sends it. Absent = emailing is not available. */
  mail?: MailQueue;
}

export const BILLS_MODULE = "bills";

/** The pieces of one write that the lock and the guard need. */
export interface WriteCtx {
  repos: BillingRepos;
  session: VerifiedSession;
  meta: RequestMeta;
  actor: Person | undefined;
}

export function billingKit(deps: BillingDeps) {
  const { people, audit, catalog } = deps;

  async function forceAudit(f: WriteCtx, what: string): Promise<void> {
    await f.repos.forceLogs.write({ userId: f.session.userId, userName: f.actor?.name ?? "System", action: "lock", module: BILLS_MODULE, summary: `Forced past a lock: ${what}`, details: { Lock: what }, route: null, method: null, ipAddress: f.meta.ip });
    await audit.record({ action: "force.override", userId: f.session.userId, hotelId: f.session.hotelId, details: { lock: what, traceId: f.meta.traceId } });
  }

  return {
    actorOf: async (session: VerifiedSession, more: (string | null)[] = []): Promise<Map<string, Person>> => people.get([...new Set([session.userId, ...more.filter((x): x is string => x !== null)])]),
    logCtx: (f: Pick<WriteCtx, "session" | "meta" | "actor">): LogContext => ({ userId: f.session.userId, userName: f.actor?.name ?? "System", ip: f.meta.ip, traceId: f.meta.traceId }),
    force: (session: VerifiedSession): boolean => forceOn(session, catalog),

    /** ForceMode::locked: true = refuse; with force armed the lock steps aside and is written to the force log. */
    async locked(condition: boolean, what: string, f: WriteCtx): Promise<boolean> {
      if (!condition) return false;
      if (!forceOn(f.session, catalog)) return true;
      await forceAudit(f, what);
      return false;
    },

    /** Books::guard, with the refusal on the apps' field for the date ("date" keeps the guard's own key). */
    async guard(input: GuardInput, field: string, f: WriteCtx): Promise<void> {
      if (forceOn(f.session, catalog)) {
        if (guardWouldRefuse(input)) await forceAudit(f, "Accounting year lock");
        return;
      }
      try {
        guardBooks(input);
      } catch (error) {
        if (error instanceof AppError && field !== "date") throw fail(field, error.message);
        throw error;
      }
    },
  };
}


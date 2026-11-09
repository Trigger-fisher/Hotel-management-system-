import "server-only";
import type { MailMessage } from "../services/auth/mail";
import { failureCodeOf, type MailFailureCode } from "./failure";

// Platform mail has a main service (Amazon SES) and a backup (a Google address). When the main service fails for a reason on ITS side, the mail goes out through the backup instead,
// and the platform stays on the backup for `returnMinutes` before it tries the main service again. Pure rules and one small router; the senders themselves are the shared module
// (mail/smtp.ts) and the settings are read in mail/platformSmtp.ts.

export type FailoverRoute = "primary" | "backup";

export interface FailoverRule {
  enabled: boolean;
  returnMinutes: number;
}

export interface FailoverEvent {
  at: string;
  from: FailoverRoute;
  to: FailoverRoute;
  /** A fixed sentence, never the mail server's own words. */
  reason: string;
}

export interface FailoverState {
  active: FailoverRoute;
  since: string | null;
  /** Newest first, at most EVENT_LIMIT. */
  events: FailoverEvent[];
}

export const EVENT_LIMIT = 10;
export const DEFAULT_RETURN_MINUTES = 15;
export const MAX_RETURN_MINUTES = 1440;

/** The rules as saved; anything missing or out of range is the default (on, 15 minutes). */
export function failoverRuleOf(enabled: unknown, returnMinutes: unknown): FailoverRule {
  const minutes = typeof returnMinutes === "number" && Number.isInteger(returnMinutes) && returnMinutes >= 1 && returnMinutes <= MAX_RETURN_MINUTES ? returnMinutes : DEFAULT_RETURN_MINUTES;
  return { enabled: enabled !== false, returnMinutes: minutes };
}

/** The saved state as a state; nothing usable is "on the main service, never switched". */
export function failoverStateOf(value: unknown): FailoverState | null {
  const v = value as { active?: unknown; since?: unknown; events?: unknown } | null | undefined;
  if (!v || (v.active !== "primary" && v.active !== "backup")) return null;
  const events = Array.isArray(v.events)
    ? v.events
        .filter((e): e is FailoverEvent => !!e && typeof e === "object" && typeof (e as FailoverEvent).at === "string" && typeof (e as FailoverEvent).reason === "string" && ((e as FailoverEvent).from === "primary" || (e as FailoverEvent).from === "backup") && ((e as FailoverEvent).to === "primary" || (e as FailoverEvent).to === "backup"))
        .slice(0, EVENT_LIMIT)
        .map((e) => ({ at: e.at, from: e.from, to: e.to, reason: e.reason }))
    : [];
  return { active: v.active, since: typeof v.since === "string" ? v.since : null, events };
}

/**
 * A failure the BACKUP can mend: the main service refused the login, could not be reached, failed its secure connection, refused the message (a quota, a sandbox) or failed in a way
 * nobody can name. A wrong recipient, a message that could not be made and a mail that must not go (suppressed, cancelled) are the same through any service, so they never switch.
 */
export function isServiceSideFailure(code: MailFailureCode): boolean {
  return code === "AUTH" || code === "CONNECT" || code === "TLS" || code === "REFUSED" || code === "UNKNOWN";
}

const WHY: Partial<Record<MailFailureCode, string>> = {
  AUTH: "The main service did not accept the login.",
  CONNECT: "The main service could not be reached.",
  TLS: "The secure connection to the main service failed.",
  REFUSED: "The main service refused the message.",
  UNKNOWN: "The main service failed.",
};
const WHY_BACKUP = "The backup also failed, so the main service was tried again.";

export interface FailoverContext {
  main: { send(message: MailMessage): Promise<void> };
  backup: { send(message: MailMessage): Promise<void> };
  rule: FailoverRule;
  /** The state another server wrote down; used when it is newer than this process's own. */
  saved: FailoverState | null;
}

/** The router: remembers where mail goes out from, switches on a service-side failure and tries the main service again after `returnMinutes`. `save` writes each switch down (best effort). */
export function createFailoverRouter(options: { now: () => number; save: (state: FailoverState) => Promise<void> }) {
  let state: FailoverState = { active: "primary", since: null, events: [] };

  const adopt = (saved: FailoverState | null): void => {
    if (saved && (saved.since ?? "") > (state.since ?? "")) state = saved;
  };
  const switchTo = (to: FailoverRoute, reason: string): void => {
    const at = new Date(options.now()).toISOString();
    state = { active: to, since: at, events: [{ at, from: state.active, to, reason }, ...state.events].slice(0, EVENT_LIMIT) };
    void options.save(state).catch(() => undefined);
  };

  return {
    state: (): FailoverState => state,
    async send(message: MailMessage, ctx: FailoverContext): Promise<void> {
      adopt(ctx.saved);
      if (!ctx.rule.enabled) {
        // switched off: the main service alone, a failure waits for the retry; a switch made earlier is undone
        if (state.active === "backup") switchTo("primary", "Failover was switched off.");
        return ctx.main.send(message);
      }
      // long enough on the backup: the main service gets another chance
      if (state.active === "backup" && state.since && options.now() - Date.parse(state.since) >= ctx.rule.returnMinutes * 60_000) switchTo("primary", `The main service is tried again after ${ctx.rule.returnMinutes} minutes.`);

      if (state.active === "primary") {
        try {
          return await ctx.main.send(message);
        } catch (error) {
          const code = failureCodeOf(error);
          if (!isServiceSideFailure(code)) throw error;
          switchTo("backup", WHY[code] ?? WHY.UNKNOWN ?? "The main service failed.");
          return ctx.backup.send(message);
        }
      }
      try {
        return await ctx.backup.send(message);
      } catch (error) {
        const code = failureCodeOf(error);
        if (!isServiceSideFailure(code)) throw error;
        // both are down: the main service has the last word (its error is the one the retry sees)
        switchTo("primary", WHY_BACKUP);
        return ctx.main.send(message);
      }
    },
  };
}

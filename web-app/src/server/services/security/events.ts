import "server-only";
import type { DetailValue, SecurityEventRow, SecurityRepo, SecuritySeverity } from "../../repos/security";
import type { AlertDispatcher } from "./alerts";

// Recording a security event and alerting on it (plan section 7). Only Warning and Critical events come here; Info stays in the platform audit log. What a kind means decides its severity,
// never the caller, so a Critical event cannot be quietly recorded as a Warning.

export const EVENT_KINDS = {
  // a bare scan of a decoy address happens to every site every day (bots): a Warning on Slack, no SMS. The Critical ones are a canary opened or a real isolation failure.
  honeypot_hit: "warning",
  canary_triggered: "critical",
  honeytoken_used: "critical",
  cross_hotel_attempt: "critical",
  origin_bypass: "critical",
  failed_login_burst: "warning",
  fail2ban_ban: "warning",
  full_visit_write_flagged: "warning",
  reset_requested: "warning",
  reset_finished: "warning",
} as const satisfies Record<string, SecuritySeverity>;

export type SecurityEventKind = keyof typeof EVENT_KINDS;

export interface SecurityEventInput {
  kind: SecurityEventKind;
  summary: string;
  detail?: Record<string, DetailValue>;
  ip?: string | null;
  traceId?: string | null;
}

/** Printable ASCII only, one line, cut to `max`: an attacker chooses paths and headers, and none of it may reach a log, Slack or an SMS as it came. */
export function cleanText(value: unknown, max: number): string {
  return String(value ?? "").replace(/[^\x20-\x7e]/g, "?").replace(/\s+/g, " ").trim().slice(0, max);
}

const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

export function createSecurityEvents(deps: { repo: SecurityRepo; alerts: AlertDispatcher; now?: () => Date; log?: (message: string, fields: Record<string, unknown>) => void }) {
  const now = deps.now ?? (() => new Date());
  return {
    /** Stores the event, then sends its alert. Never throws (a failing store or channel is logged and the request goes on). */
    async record(input: SecurityEventInput): Promise<SecurityEventRow | null> {
      const severity = EVENT_KINDS[input.kind];
      const detail: Record<string, DetailValue> = {};
      for (const [k, v] of Object.entries(input.detail ?? {}).slice(0, 12)) detail[cleanText(k, 40)] = typeof v === "string" ? cleanText(v, 200) : v;
      const event = {
        severity, kind: input.kind, summary: cleanText(input.summary, 300), detail, ip: input.ip && IP_SHAPE.test(input.ip) ? input.ip : null,
        traceId: input.traceId ? cleanText(input.traceId, 64) : null, at: now(),
      };
      let id: string | null = null;
      try {
        id = await deps.repo.addEvent(event);
      } catch (error) {
        deps.log?.("security event could not be stored", { kind: input.kind, error: error instanceof Error ? error.name : "unknown" });
      }
      const country = typeof detail.country === "string" && detail.country !== "" ? ` [${detail.country}]` : "";
      const where = event.ip ? ` from ${event.ip}${country}` : "";
      const delivery = await deps.alerts.dispatch({ severity, key: `${input.kind}:${event.ip ?? "-"}`, text: `${event.summary}${where}` });
      if (id !== null) await deps.repo.markAlerted(id, delivery.slack, delivery.sms).catch(() => undefined);
      return id === null ? null : { ...event, id, slack: delivery.slack, sms: delivery.sms };
    },
  };
}

export type SecurityEvents = ReturnType<typeof createSecurityEvents>;

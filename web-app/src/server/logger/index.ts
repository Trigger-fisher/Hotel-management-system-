import "server-only";
import { getConfig } from "../config/env";
import { createLogger, type Logger, type LogLevel, type LogLevelSetting } from "./logger";

export { createLogger, type LogFields, type Logger, type LogLevel, type LogLevelSetting } from "./logger";
export { redact, redactString, REDACTED, BODY_OMITTED } from "./redact";

let shared: Logger | undefined;

/** Error lines also go to HMS_ALERT_WEBHOOK (at most this many a minute; the rest are only logged). */
export const ALERTS_PER_MINUTE = 20;

/**
 * A `write` that also POSTs every error line to the alert webhook: fire and forget, five seconds at most, never throws, never more than ALERTS_PER_MINUTE a
 * minute. The line is already redacted by the logger. The body is `{text, level, time, msg, traceId}` so a Slack/Discord/Teams webhook shows `text` as is.
 */
export function alertingWrite(webhook: string, post: (url: string, body: string) => Promise<unknown> = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(5000) })): (line: string, level: LogLevel) => void {
  let windowStart = 0;
  let sent = 0;
  return (line, level) => {
    (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
    if (level !== "error") return;
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      sent = 0;
    }
    if (sent >= ALERTS_PER_MINUTE) return;
    sent += 1;
    let record: Record<string, unknown> = {};
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      record = { msg: line };
    }
    const text = `[HMS] ${String(record.msg ?? "error")}${record.traceId ? ` (trace ${String(record.traceId)})` : ""}`;
    void post(webhook, JSON.stringify({ text, level, time: record.time, msg: record.msg, traceId: record.traceId })).catch(() => undefined);
  };
}

/** The process-wide logger, at the level the config asks for. A broken config must still be loggable, so it falls back to "info". */
export function getLogger(): Logger {
  if (shared) return shared;
  let level: LogLevelSetting = "info";
  let webhook: string | undefined;
  try {
    const config = getConfig();
    level = config.LOG_LEVEL;
    webhook = config.HMS_ALERT_WEBHOOK;
  } catch {
    // keep the default; the caller is usually reporting this very problem
  }
  shared = createLogger({ level, ...(webhook ? { write: alertingWrite(webhook) } : {}) });
  return shared;
}

import "server-only";
import { redact, redactString } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogLevelSetting = LogLevel | "silent";
export type LogFields = Record<string, unknown>;

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Same logger with extra fields on every line (for example { traceId }). */
  child(fields: LogFields): Logger;
}

interface LoggerOptions {
  level?: LogLevelSetting;
  /** Receives one finished JSON line. The default writes to stdout (stderr for errors). */
  write?: (line: string, level: LogLevel) => void;
  fields?: LogFields;
  now?: () => Date;
}

const defaultWrite = (line: string, level: LogLevel): void => {
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
};

/** Structured JSON logger. Every message and field passes through redact() before it is written. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = options.level ?? "info";
  const write = options.write ?? defaultWrite;
  const now = options.now ?? (() => new Date());
  const base = options.fields ?? {};

  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (threshold === "silent" || RANK[level] < RANK[threshold]) return;
    const safe = redact({ ...base, ...fields });
    // The fixed keys come last so a caller's own field called "level" or "msg" cannot overwrite them.
    const record = {
      ...(typeof safe === "object" && safe !== null ? safe : {}),
      time: now().toISOString(),
      level,
      msg: redactString(message),
    };
    write(JSON.stringify(record), level);
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (fields) => createLogger({ level: threshold, write, now, fields: { ...base, ...fields } }),
  };
}

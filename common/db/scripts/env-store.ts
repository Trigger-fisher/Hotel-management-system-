// An .env.local file as a tiny store: read a value, append missing ones. Existing lines are never rewritten, so a value MJ set by hand (or a
// key that data depends on) can never be overwritten, and a value is never printed by anything here. The one exception is `remove`, used
// ONLY to drop names that no longer exist (the MySQL and encryption-key names), never a live value.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

export interface EnvStore {
  get(name: string): string | undefined;
  /** Adds the names that are missing; a name that is already there is left exactly as it is. */
  append(entries: readonly (readonly [string, string])[]): void;
  /** Deletes whole lines for names that are retired. Returns the names that were present. */
  remove(names: readonly string[]): string[];
}

const LINE = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/;
const NAME = /^[A-Z][A-Z0-9_]*$/;

/** The values in an env file's text. Blank lines and # comments are skipped; surrounding quotes are removed. */
export function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const match = LINE.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (value !== "") values.set(match[1], value);
  }
  return values;
}

export function createEnvStore(file: string): EnvStore {
  const text = (): string => (existsSync(file) ? readFileSync(file, "utf8") : "");
  const read = (): Map<string, string> => parseEnv(text());
  return {
    get: (name) => read().get(name),
    append(entries) {
      const present = read();
      const current = text();
      const lines: string[] = [];
      for (const [name, value] of entries) {
        if (!NAME.test(name) || /[\r\n]/.test(value)) throw new Error("Not a valid environment entry");
        if (present.has(name)) continue;
        lines.push(`${name}=${value}`);
      }
      if (lines.length === 0) return;
      appendFileSync(file, `${current === "" || current.endsWith("\n") ? "" : "\n"}${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    },
    remove(names) {
      const drop = new Set(names);
      const removed: string[] = [];
      const kept = text()
        .split(/\r?\n/)
        .filter((line) => {
          const match = LINE.exec(line);
          if (match && drop.has(match[1])) {
            removed.push(match[1]);
            return false;
          }
          return true;
        });
      if (removed.length > 0) writeFileSync(file, kept.join("\n").replace(/\n+$/, "\n"), { encoding: "utf8", mode: 0o600 });
      return removed;
    },
  };
}

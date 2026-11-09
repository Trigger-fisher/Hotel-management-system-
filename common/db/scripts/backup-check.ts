// backup-check: reads ONE nightly backup copy (the file the website writes to the object store, backups/<hotel id>/backup-<day>-<sha8>.ndjson.gz, or a
// Super Admin export) without a database: gunzips it, proves the SHA-256 when one is given, parses every line and counts what it holds (the hotel row,
// people, memberships, status history, and the rows per table). A file that does not read back whole is not a backup; this is the drill to run after a
// copy is downloaded from the bucket. Prints counts and names only, never a row's content.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export interface BackupCheck {
  bytes: number;
  sha256: string;
  lines: number;
  kinds: Record<string, number>;
  /** Rows per table of the hotel's schema, table name first. */
  tables: Record<string, number>;
  hotelId: string | null;
}

export function checkBackupText(ndjson: string): Omit<BackupCheck, "bytes" | "sha256"> {
  const kinds: Record<string, number> = {};
  const tables: Record<string, number> = {};
  let hotelId: string | null = null;
  let lines = 0;
  for (const raw of ndjson.split("\n")) {
    if (raw.trim() === "") continue;
    lines += 1;
    let line: { kind?: unknown; table?: unknown; row?: unknown };
    try {
      line = JSON.parse(raw) as typeof line;
    } catch {
      throw new Error(`line ${lines} is not JSON`);
    }
    if (typeof line.kind !== "string" || !("row" in line)) throw new Error(`line ${lines} has no kind or row`);
    kinds[line.kind] = (kinds[line.kind] ?? 0) + 1;
    if (line.kind === "hotel" && hotelId === null) hotelId = String((line.row as { id?: unknown } | null)?.id ?? "");
    if (line.kind === "table") {
      if (typeof line.table !== "string") throw new Error(`line ${lines} names no table`);
      tables[line.table] = (tables[line.table] ?? 0) + 1;
    }
  }
  if (!kinds.hotel) throw new Error("the file holds no hotel row");
  return { lines, kinds, tables, hotelId };
}

export function checkBackupFile(file: string, expectedSha256?: string): BackupCheck {
  const bytes = readFileSync(file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (expectedSha256 && expectedSha256.toLowerCase() !== sha256) throw new Error(`the checksum does not match: the file is not the one that was recorded (expected ${expectedSha256.slice(0, 12)}..., got ${sha256.slice(0, 12)}...)`);
  const text = file.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  return { bytes: bytes.length, sha256, ...checkBackupText(text) };
}

import "server-only";
// In-memory doubles of the WhatsApp stores, for unit tests and the local demo. They follow the same rules as the PostgreSQL repository (the real-database test runs the same scenarios).
import { randomUUID } from "node:crypto";
import type { NewWaEvent, WaEventRow, WaEventState, WaEventStore, WaLine, WaLineStore } from "./ports";

export function createMemoryLineStore(lines: readonly WaLine[] = []): WaLineStore & { lines: WaLine[]; lastEvent: Map<string, Date> } {
  const all = [...lines];
  const lastEvent = new Map<string, Date>();
  return {
    lines: all,
    lastEvent,
    async findById(id) {
      return all.find((l) => l.id === id) ?? null;
    },
    async findByPhoneNumberId(id) {
      return all.find((l) => l.phoneNumberId === id) ?? null;
    },
    async findByWabaId(id) {
      return all.find((l) => l.wabaId === id && l.status !== "banned") ?? null;
    },
    async touchEvent(lineId, at) {
      lastEvent.set(lineId, at);
    },
  };
}

interface Stored extends WaEventRow {
  nextAttemptAt: Date;
  lockedUntil: Date | null;
  lastErrorCode: string | null;
  processedAt: Date | null;
}

const DAY_MS = 86_400_000;

export function createMemoryEventStore(): WaEventStore & { rows: Stored[] } {
  const rows: Stored[] = [];
  const due = (r: Stored, now: Date): boolean =>
    (["received", "failed", "parked"].includes(r.state) && r.nextAttemptAt <= now) || (r.state === "processing" && (r.lockedUntil === null || r.lockedUntil <= now));
  const take = (r: Stored, now: Date, leaseSeconds: number): WaEventRow => {
    r.state = "processing";
    r.attempts += 1;
    r.lockedUntil = new Date(now.getTime() + leaseSeconds * 1000);
    return { ...r };
  };
  return {
    rows,
    async save(events: readonly NewWaEvent[]) {
      const saved: string[] = [];
      let duplicates = 0;
      for (const e of events) {
        if (rows.some((r) => r.dedupeKey === e.dedupeKey)) {
          duplicates += 1;
          continue;
        }
        const id = randomUUID();
        rows.push({ id, lineId: e.lineId, kind: e.kind, dedupeKey: e.dedupeKey, payloadSecret: e.payloadSecret, state: "received", attempts: 0, receivedAt: e.receivedAt, nextAttemptAt: e.receivedAt, lockedUntil: null, lastErrorCode: null, processedAt: null });
        saved.push(id);
      }
      return { saved, duplicates };
    },
    async claim(now, limit, leaseSeconds) {
      return rows
        .filter((r) => due(r, now))
        .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
        .slice(0, limit)
        .map((r) => take(r, now, leaseSeconds));
    },
    async claimOne(id, now, leaseSeconds) {
      const r = rows.find((x) => x.id === id);
      return r && due(r, now) ? take(r, now, leaseSeconds) : null;
    },
    async complete(id, now) {
      const r = rows.find((x) => x.id === id);
      if (!r) return;
      r.state = "done";
      r.payloadSecret = null;
      r.lockedUntil = null;
      r.processedAt = now;
    },
    async fail(id, code, retryAt, now) {
      const r = rows.find((x) => x.id === id);
      if (!r) return;
      r.state = (retryAt === null ? "dead" : "failed") as WaEventState;
      r.lastErrorCode = code;
      r.lockedUntil = null;
      r.processedAt = retryAt === null ? now : null;
      if (retryAt) r.nextAttemptAt = retryAt;
    },
    async park(id, retryAt) {
      const r = rows.find((x) => x.id === id);
      if (!r) return;
      r.state = "parked";
      r.lockedUntil = null;
      r.nextAttemptAt = retryAt;
      // parking is not a failed attempt
      r.attempts = Math.max(0, r.attempts - 1);
    },
    async purge(now) {
      let done = 0;
      let failed = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const r = rows[i];
        if (r.state === "done" && r.processedAt && now.getTime() - r.processedAt.getTime() > DAY_MS) {
          rows.splice(i, 1);
          done += 1;
        } else if ((r.state === "failed" || r.state === "dead") && now.getTime() - r.receivedAt.getTime() > 7 * DAY_MS) {
          rows.splice(i, 1);
          failed += 1;
        }
      }
      return { done, failed };
    },
  };
}

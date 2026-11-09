import "server-only";
import { randomUUID } from "node:crypto";
import type { AccountingYear, ForceLogEntry, SystemLogEntry } from "../cashSupport";
import type { HandoverPatch, HandoverRecord, HandoverRepo, HandoverRepos, HandoverStaffMember, NewHandover } from "../handovers";
import { RepoError, type VersionedResult } from "../types";
import { createMemoryUnit, MemoryStore } from "./store";

// The in-memory double of the Shift Handover repositories: per-hotel data, one unit at a time, rollback on throw (MemoryStore), and the table rules:
// one entry number for the hotel (max + 1, soft-deleted rows count), soft delete, the version step, the CHECKs (counts and totals >= 0).

interface HandoverData {
  handovers: HandoverRecord[];
  staff: HandoverStaffMember[];
  lists: Record<string, string[]>;
  years: AccountingYear[];
  systemLogs: SystemLogEntry[];
  forceLogs: ForceLogEntry[];
  hotelName: string;
}

const emptyHandoverData = (): HandoverData => ({ handovers: [], staff: [], lists: {}, years: [], systemLogs: [], forceLogs: [], hotelName: "Hotel" });

const sortKey = (r: HandoverRecord): string => `${r.date} ${r.time} ${r.id}`;

function check(v: Partial<NewHandover>): void {
  if (v.totalPaise !== undefined && v.totalPaise < BigInt(0)) throw new RepoError("check", "total_paise >= 0");
  for (const n of Object.values(v.counts ?? {})) if (!Number.isInteger(n) || n < 0) throw new RepoError("check", "count >= 0");
  if (v.shift !== undefined && v.shift.length > 20) throw new RepoError("check", "shift varchar(20)");
}

function memoryHandoverRepo(data: HandoverData): HandoverRepo {
  const copy = (r: HandoverRecord): HandoverRecord => structuredClone(r);
  const live = (): HandoverRecord[] => data.handovers.filter((r) => r.deletedAt === null);

  function versioned(id: string, expected: number, deleted: boolean, change: (row: HandoverRecord) => void): VersionedResult<HandoverRecord> {
    const row = data.handovers.find((r) => r.id === id);
    if (!row || (row.deletedAt !== null) !== deleted) return { ok: false, reason: "not_found" };
    if (row.version !== expected) return { ok: false, reason: "conflict", currentVersion: row.version };
    change(row);
    row.version += 1;
    row.updatedAt = new Date();
    return { ok: true, record: copy(row) };
  }

  return {
    async rows(filter) {
      return data.handovers
        .filter((r) => (filter.deleted === "only") === (r.deletedAt !== null) && (!filter.from || r.date >= filter.from) && (!filter.to || r.date <= filter.to))
        .map(copy);
    },
    async newestId() {
      const rows = live();
      if (rows.length === 0) return null;
      return rows.reduce((best, r) => (sortKey(r) > sortKey(best) ? r : best)).id;
    },
    async get(id, options = {}) {
      const row = data.handovers.find((r) => r.id === id && (r.deletedAt !== null) === (options.deleted === true));
      return row ? copy(row) : null;
    },
    async create(input) {
      check(input);
      const now = new Date();
      const row: HandoverRecord = {
        id: randomUUID(),
        entryNo: data.handovers.reduce((max, r) => Math.max(max, r.entryNo), 0) + 1,
        ...structuredClone(input),
        updatedBy: null,
        deletedAt: null,
        deletedBy: null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      data.handovers.push(row);
      return copy(row);
    },
    async update(id, expected, patch: HandoverPatch, actorId) {
      check(patch);
      return versioned(id, expected, false, (row) => {
        for (const [k, v] of Object.entries(structuredClone(patch))) if (v !== undefined) (row as unknown as Record<string, unknown>)[k] = v;
        row.updatedBy = actorId;
      });
    },
    async softDelete(id, expected, actorId) {
      return versioned(id, expected, false, (row) => {
        row.deletedAt = new Date();
        row.deletedBy = actorId;
      });
    },
    async restore(id, expected, actorId) {
      return versioned(id, expected, true, (row) => {
        row.deletedAt = null;
        row.deletedBy = null;
        row.updatedBy = actorId;
      });
    },
    async purge(id) {
      const index = data.handovers.findIndex((r) => r.id === id && r.deletedAt !== null);
      if (index < 0) return false;
      data.handovers.splice(index, 1);
      return true;
    },
    async totals(from, to) {
      const rows = live().filter((r) => r.date >= from && r.date <= to);
      return { count: rows.length, totalPaise: rows.reduce((s, r) => s + r.totalPaise, BigInt(0)) };
    },
  };
}

export function createMemoryHandovers(): { store: MemoryStore<HandoverData>; unit: ReturnType<typeof createMemoryUnit<HandoverData, HandoverRepos>> } {
  const store = new MemoryStore<HandoverData>(emptyHandoverData);
  return {
    store,
    unit: createMemoryUnit(store, (data) => ({
      handovers: memoryHandoverRepo(data),
      handoverStaff: { active: async () => data.staff.map((s) => ({ ...s })).sort((a, b) => a.name.localeCompare(b.name)) },
      masterLists: { activeValues: async (key) => [...(data.lists[key] ?? [])] },
      accountingYears: { list: async () => data.years.map((y) => ({ ...y })).sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1)) },
      systemLogs: { write: async (entry) => void data.systemLogs.push(entry) },
      forceLogs: { write: async (entry) => void data.forceLogs.push(entry) },
      hotelName: async () => data.hotelName,
    })),
  };
}

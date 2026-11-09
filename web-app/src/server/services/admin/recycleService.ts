import "server-only";
import type { Page } from "@shared/dashboards/common";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import type { Logger } from "../../logger/logger";
import type { PeopleDirectory } from "../cash/ports";
import { notFound, requireSuperAdmin, type AdminDeps } from "./context";

// The recycle bin (Pallav RecycleBinController + Support/RecycleBin.php): everything deleted in the last N days (Settings "recycle.days", 30 by default), newest
// deletion first, with who deleted it and the days left; restore it or remove it for good. The hotel's SuperAdmin only. Each kind of record is a SOURCE: the
// module that owns it lists its deleted rows and restores or purges them with ITS OWN rules (accounting-year lock, unique numbers, permissions), so the bin never
// bypasses a module. Spec: docs/specs/admin.md §9.

const DEFAULT_DAYS = 30;
const SETTING = "recycle.days";

export interface TrashedRow {
  id: string;
  /** What a person calls it: a name, a bill or receipt number, an entry number ("Rajesh Patel", "2026 / 1188"). */
  title: string;
  /** One more line to tell two apart ("Rs 5,000.00 received on 02 Oct 2026"); may be empty. */
  detail: string;
  deletedAt: Date;
  /** The person who deleted it (a user id), if known. */
  deletedBy: string | null;
}

export interface RecycleSource {
  /** The key the restore link carries ("bill", "hotel-deposit"). */
  key: string;
  /** "Bill", "Hotel cash deposit": Pallav's labels. */
  label: string;
  /** The deleted records of this hotel. */
  list(who: Pick<VerifiedSession, "hotelId" | "userId">): Promise<TrashedRow[]>;
  /** The module's own restore for this record, as the signed-in person (it may refuse: a closed year, a number taken). */
  restore(session: VerifiedSession, id: string, meta: RequestMeta): Promise<void>;
  /** The module's own removal for good. */
  purge(session: VerifiedSession, id: string, meta: RequestMeta): Promise<void>;
  /** The nightly clean-up: removes for good what this hotel deleted before `cutoff`, as the system; returns how many. */
  purgeBefore(hotelId: string, cutoff: Date): Promise<number>;
}

export interface RecycleItem {
  key: string;
  id: string;
  /** The type: "Bill". */
  kind: string;
  /** The record: "2026 / 1188". */
  label: string;
  detail: string;
  deletedBy: string;
  deletedAt: string;
  daysLeft: number;
}

interface RecycleDeps extends Pick<AdminDeps, "unit" | "people" | "now"> {
  sources: readonly RecycleSource[];
  /** Where the nightly clean-up reports a kind it could not clean (the kind and the hotel only; never record contents). */
  logger?: Pick<Logger, "warn">;
}

const DAY = 86_400_000;

export function createRecycleService(deps: RecycleDeps) {
  const { unit, now, sources } = deps;
  const byKey = (key: string): RecycleSource => {
    const source = sources.find((s) => s.key === key);
    if (!source) throw notFound();
    return source;
  };

  async function keepDays(who: Pick<VerifiedSession, "hotelId" | "userId">): Promise<number> {
    const rows = await unit.run(who, (repos) => repos.adminSettings.get([SETTING]));
    const n = Math.floor(Number(rows[0]?.value ?? DEFAULT_DAYS));
    return Number.isFinite(n) && n >= 1 ? n : DEFAULT_DAYS;
  }

  const names = async (people: PeopleDirectory, ids: readonly string[]): Promise<Map<string, string>> => new Map([...(await people.get(ids))].map(([id, p]) => [id, p.name]));

  return {
    /** index: every kind, newest deletion first; `search` matches the type, the record or the line under it. */
    async list(session: VerifiedSession, q: { search?: string; page: number; pageSize: number }): Promise<Page<RecycleItem>> {
      requireSuperAdmin(session, "the recycle bin");
      const days = await keepDays(session);
      const at = now();
      const found = (await Promise.all(sources.map(async (s) => (await s.list(session)).map((row) => ({ s, row }))))).flat();
      const who = await names(deps.people, [...new Set(found.flatMap((f) => (f.row.deletedBy ? [f.row.deletedBy] : [])))]);
      const words = (q.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const items = found
        .map(({ s, row }): RecycleItem => ({
          key: s.key,
          id: row.id,
          kind: s.label,
          label: row.title,
          detail: row.detail,
          deletedBy: row.deletedBy ? (who.get(row.deletedBy) ?? "") : "",
          deletedAt: row.deletedAt.toISOString(),
          daysLeft: Math.max(0, days - Math.max(0, Math.floor((at.getTime() - row.deletedAt.getTime()) / DAY))),
        }))
        .filter((i) => words.every((w) => `${i.kind} ${i.label} ${i.detail} ${i.deletedBy}`.toLowerCase().includes(w)))
        .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : a.label.localeCompare(b.label)));
      return { items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: items.length, page: q.page, pageSize: q.pageSize };
    },

    /** restore: the module brings it back by its own rules and writes its own "recycle-bin" system-log line (Restored by ...). */
    async restore(session: VerifiedSession, key: string, id: string, meta: RequestMeta): Promise<{ key: string; id: string; message: string }> {
      requireSuperAdmin(session, "the recycle bin");
      const source = byKey(key);
      const row = (await source.list(session)).find((r) => r.id === id);
      if (!row) throw notFound("That record is not in the recycle bin.");
      await source.restore(session, id, meta);
      return { key, id, message: `${source.label} ${row.title} restored.` };
    },

    /** destroy: removed for good, by the module's own removal. */
    async purge(session: VerifiedSession, key: string, id: string, meta: RequestMeta): Promise<{ key: string; id: string; message: string }> {
      requireSuperAdmin(session, "the recycle bin");
      const source = byKey(key);
      const row = (await source.list(session)).find((r) => r.id === id);
      if (!row) throw notFound("That record is not in the recycle bin.");
      await source.purge(session, id, meta);
      return { key, id, message: `${source.label} ${row.title} removed for good.` };
    },

    /** The nightly clean-up (RecycleBin::purge) of ONE hotel: what has sat in the bin longer than its keep time goes for good. Returns how many. */
    async purgeExpired(hotelId: string): Promise<number> {
      const cutoff = new Date(now().getTime() - (await keepDays({ hotelId, userId: "system" })) * DAY);
      let count = 0;
      for (const s of sources) {
        // one kind failing (a database refusal, a lost connection) never stops the kinds after it; it is tried again the next night
        try {
          count += await s.purgeBefore(hotelId, cutoff);
        } catch (error) {
          deps.logger?.warn("recycle: nightly clean-up of one kind failed", { hotelId, kind: s.key, error: error instanceof Error ? error.name : "unknown" });
        }
      }
      return count;
    },
  };
}

export type RecycleService = ReturnType<typeof createRecycleService>;

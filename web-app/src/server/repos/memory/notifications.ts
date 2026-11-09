import "server-only";
import { randomUUID } from "node:crypto";
import type { Addressee } from "../companies";
import type { NotificationEmailStatus, NotificationRecord, NotificationRepo, NotificationsRepos, NotificationStatus, NotificationSummary } from "../notifications";
import type { ListResult, Unit } from "../types";
import type { CompaniesData } from "./companies";
import { bindHotelRepos, emptyHotelData, type HotelData } from "./frontOffice";
import { createMemoryUnit, MemoryStore } from "./store";

// The in-memory double of the notifications repositories (repos/notifications.ts), in the SAME per-hotel data as the companies. It keeps the table rules of
// migration 0039: one target per (notification, company), the targets a snapshot, withdrawn and expired ones hidden from the company, the first read time kept.

export interface NotificationsData {
  notifications: NotificationRecord[];
  notificationTargets: { notificationId: string; companyId: string; readAt: Date | null; emailStatus: NotificationEmailStatus; createdAt: Date }[];
}
export const emptyNotificationsData = (): NotificationsData => ({ notifications: [], notificationTargets: [] });

const copy = <T>(r: T): T => structuredClone(r);
const newestFirst = (a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }): number => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);
const paged = <T>(rows: T[], p: { page: number; pageSize: number }): ListResult<T> => ({ rows: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize).map(copy), total: rows.length });

export const statusOf = (n: Pick<NotificationRecord, "withdrawnAt" | "expiresAt">, today: string): NotificationStatus =>
  n.withdrawnAt !== null ? "withdrawn" : n.expiresAt !== null && n.expiresAt < today ? "expired" : "active";

export function bindNotifications(data: CompaniesData & NotificationsData): NotificationRepo {
  const live = () => data.companyProfiles.filter((c) => c.deletedAt === null);
  const readCount = (id: string): number => data.notificationTargets.filter((t) => t.notificationId === id && t.readAt !== null).length;
  const summary = (n: NotificationRecord): NotificationSummary => ({ ...copy(n), readCount: readCount(n.id) });
  const liveFor = (companyId: string, today: string) =>
    data.notificationTargets
      .filter((t) => t.companyId === companyId)
      .map((t) => ({ t, n: data.notifications.find((x) => x.id === t.notificationId) }))
      .filter((x): x is { t: (typeof data.notificationTargets)[number]; n: NotificationRecord } => x.n !== undefined && statusOf(x.n, today) === "active");

  return {
    async create(input, targets, now) {
      const row: NotificationRecord = { ...copy(input), id: randomUUID(), targetCount: new Set(targets.map((t) => t.companyId)).size, withdrawnAt: null, withdrawnBy: null, createdAt: now };
      data.notifications.push(row);
      const seen = new Set<string>();
      for (const t of targets) {
        if (seen.has(t.companyId)) continue;
        seen.add(t.companyId);
        data.notificationTargets.push({ notificationId: row.id, companyId: t.companyId, readAt: null, emailStatus: t.emailStatus, createdAt: now });
      }
      return copy(row);
    },
    async get(id) {
      const n = data.notifications.find((x) => x.id === id);
      return n ? summary(n) : null;
    },
    async targets(id) {
      return data.notificationTargets
        .filter((t) => t.notificationId === id)
        .map((t) => ({ companyId: t.companyId, companyName: data.companyProfiles.find((c) => c.id === t.companyId)?.name ?? "", readAt: t.readAt, emailStatus: t.emailStatus }))
        .sort((a, b) => (a.companyName.toLowerCase() < b.companyName.toLowerCase() ? -1 : a.companyName.toLowerCase() > b.companyName.toLowerCase() ? 1 : a.companyId < b.companyId ? -1 : 1))
        .map(copy);
    },
    async list(query) {
      const rows = data.notifications
        .filter((n) => {
          if (query.status && statusOf(n, query.today) !== query.status) return false;
          const hay = `${n.title} ${n.body}`.toLowerCase();
          return !query.words || query.words.every((w) => hay.includes(w.toLowerCase()));
        })
        .sort(newestFirst)
        .map(summary);
      return paged(rows, query);
    },
    async withdraw(id, actorId, at) {
      const n = data.notifications.find((x) => x.id === id);
      if (!n) return null;
      if (n.withdrawnAt === null) {
        n.withdrawnAt = at;
        n.withdrawnBy = actorId;
      }
      return copy(n);
    },
    async liveCompanyIds(ids) {
      return live()
        .map((c) => c.id)
        .filter((id) => !ids || ids.includes(id))
        .sort();
    },
    async emailsOf(companyIds) {
      const out = new Map<string, Addressee[]>();
      for (const c of live().filter((x) => companyIds.includes(x.id))) {
        const list: Addressee[] = [];
        const add = (email: string | null, name: string) => {
          const e = (email ?? "").trim().toLowerCase();
          if (!e || e.indexOf("@") < 1 || data.optOuts.has(e) || list.some((a) => a.email === e)) return;
          list.push({ email: e, name: name.trim() });
        };
        add(c.email, c.name);
        for (const p of c.contacts) add(p.email, p.name || c.name);
        if (list.length > 0) out.set(c.id, list);
      }
      return out;
    },

    async forCompany(companyId, query) {
      const words = (query.search ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
      const all = liveFor(companyId, query.today).filter(({ t, n }) => (!query.unread || t.readAt === null) && (!query.read || t.readAt !== null) && words.every((w) => `${n.title} ${n.body}`.toLowerCase().includes(w)));
      const rows = all
        .filter(({ n }) => !query.through || n.createdAt.getTime() <= query.through.getTime())
        .map(({ t, n }) => ({ id: n.id, title: n.title, body: n.body, priority: n.priority, linkView: n.linkView, linkId: n.linkId, createdAt: n.createdAt, readAt: t.readAt }))
        .sort(newestFirst);
      return { ...paged(rows, query), total: all.length };
    },
    async unreadCount(companyId, today) {
      return liveFor(companyId, today).filter(({ t }) => t.readAt === null).length;
    },
    async markRead(companyId, notificationId, at, today) {
      const hit = liveFor(companyId, today).find(({ n }) => n.id === notificationId);
      if (!hit) return false;
      if (hit.t.readAt === null) hit.t.readAt = at;
      return true;
    },
    async markAllRead(companyId, at, today) {
      let changed = 0;
      for (const { t } of liveFor(companyId, today)) {
        if (t.readAt === null) {
          t.readAt = at;
          changed += 1;
        }
      }
      return changed;
    },
  };
}

export type NotificationsHotelData = HotelData & NotificationsData;
export const emptyNotificationsHotelData = (): NotificationsHotelData => ({ ...emptyHotelData(), ...emptyNotificationsData() });

export const bindNotificationsHotel = (data: NotificationsHotelData): NotificationsRepos => ({ ...bindHotelRepos(data), notifications: bindNotifications(data) });

/** ONE in-memory hotel store with the notifications on top of the companies (tests look inside through `store.dataFor`). */
export function createMemoryNotificationsHotel(): { store: MemoryStore<NotificationsHotelData>; unit: Unit<NotificationsRepos> } {
  const store = new MemoryStore<NotificationsHotelData>(emptyNotificationsHotelData);
  return { store, unit: createMemoryUnit(store, bindNotificationsHotel) };
}

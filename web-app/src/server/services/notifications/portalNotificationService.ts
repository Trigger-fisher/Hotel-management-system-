import "server-only";
import type { NotificationLinkView, PortalNotification, PortalNotificationPage } from "@shared/dashboards/notifications";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { portalNotLinked } from "../../errors/portal";
import type { PortalRepos } from "../../repos/portal";
import type { Unit } from "../../repos/types";
import { requireScope, todayIst } from "../guest/portalKit";
import { cursorModeOf, cursorSecretOr, makeCursor, pageByKeyset, readCursor } from "../portal/cursor";
import { gather, type Memberships } from "../portal/multiHotel";
import type { PortalNotificationQuery } from "./schemas";

// Notifications, the COMPANY PORTAL side (docs/BACKEND.md "Notifications"). A company login reads only its own company's notices, in each hotel it is linked to: every read runs in that
// hotel's own scoped transaction (record scope = the company, so the database's row-level security of migration 0039 is the second fence) and the answers are merged with the hotel's id
// and name. A hotel that cannot be reached is named in `unavailable` and left out (portal/multiHotel.ts gather). Withdrawn and expired notices never show. "Read" keeps the first read
// time. A deleted company profile has no portal (as for the bills). Lists read by page, or by cursor when a `limit` or `cursor` is sent (portal/cursor.ts).

interface Deps {
  unit: Unit<PortalRepos>;
  now: () => Date;
  memberships?: Memberships;
  /** The server key that signs list cursors (HMS_HASH_KEY); absent = a key that lives as long as the process. */
  cursorSecret?: () => Buffer;
}

/** Rows read past the cursor's moment per hotel, so notices that share the cursor's exact timestamp are still seen (a send is one request, so only a handful can share one). */
const SAME_MOMENT_ALLOWANCE = 50;

export function createPortalNotifications(deps: Deps) {
  const { unit, now } = deps;

  /** Runs `work` inside the hotel's unit for the company the session points at; a deleted company is "not linked". */
  const forCompany = <T>(s: VerifiedSession, work: (repos: PortalRepos, companyId: string, today: string) => Promise<T>): Promise<T> => {
    const companyId = requireScope(s, "company").id;
    return unit.run(s, async (repos) => {
      if (!(await repos.companyProfiles.get(companyId))) throw portalNotLinked("company");
      return work(repos, companyId, todayIst(now()));
    });
  };

  return {
    /**
     * Newest first over the hotels asked for (`hotel` = an id or all), `unread` = only the ones not read yet. `unread` in the answer is the badge over the same hotels; `unavailable`
     * names the linked hotels that are missing. By page (`page`, `pageSize`) or, with `limit` / `cursor`, by cursor: the order is newest first, then hotel, then id.
     */
    async notifications(session: VerifiedSession, q: PortalNotificationQuery): Promise<PortalNotificationPage> {
      const mode = cursorModeOf(q);
      const secret = cursorSecretOr(deps.cursorSecret);
      const scope = ["notifications", q.hotel || "all", q.unread ? "unread" : q.read ? "read" : "", q.search ?? ""].join("|");
      const after = mode && q.cursor !== undefined ? readCursor(secret, session.userId, scope, q.cursor) : null;
      const want = mode ? mode.limit + SAME_MOMENT_ALLOWANCE : q.page * q.pageSize;
      const { parts, unavailable } = await gather(deps.memberships, session, "company", q.hotel, (s) =>
        forCompany(s, async (repos, companyId, today) => ({
          list: await repos.notifications.forCompany(companyId, { unread: q.unread, read: q.read, search: q.search, today, through: after ? new Date(after.d) : undefined, page: 1, pageSize: want }),
          unread: await repos.notifications.unreadCount(companyId, today),
        })),
      );
      const rows: PortalNotification[] = parts.flatMap((p) =>
        p.value.list.rows.map((r) => ({
          id: r.id,
          hotelId: p.hotel.hotelId,
          hotelName: p.hotel.hotelName,
          title: r.title,
          body: r.body,
          priority: r.priority,
          createdAt: r.createdAt.toISOString(),
          readAt: r.readAt ? r.readAt.toISOString() : null,
          linkView: r.linkView as NotificationLinkView | null,
          linkId: r.linkId,
        })),
      );
      const total = parts.reduce((t, p) => t + p.value.list.total, 0);
      const unread = parts.reduce((t, p) => t + p.value.unread, 0);
      if (mode) {
        const { items, next } = pageByKeyset(rows, (r) => ({ d: r.createdAt, h: r.hotelId, i: r.id }), after, mode.limit, "desc");
        return { items, total, page: 1, pageSize: mode.limit, unread, nextCursor: next ? makeCursor(secret, session.userId, scope, next) : null, unavailable };
      }
      const newest = rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
      return { items: newest.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total, page: q.page, pageSize: q.pageSize, unread, nextCursor: null, unavailable };
    },

    /** The badge: unread notices over the hotels asked for. */
    async unreadNotifications(session: VerifiedSession, q: { hotel?: string }): Promise<{ count: number; unavailable: { hotelId: string; hotelName: string }[] }> {
      const { parts, unavailable } = await gather(deps.memberships, session, "company", q.hotel, (s) => forCompany(s, (repos, companyId, today) => repos.notifications.unreadCount(companyId, today)));
      return { count: parts.reduce((t, p) => t + p.value, 0), unavailable };
    },

    /**
     * Marks one notice read. The id belongs to one hotel: with `hotel` that hotel is asked, without it each linked hotel is tried in turn (each in its own scope, so another
     * company's id or another hotel's id is simply not found). Reading it twice is fine and keeps the first time. 404 when it is not this company's live notice.
     */
    async readNotification(session: VerifiedSession, q: { hotel?: string }, id: string): Promise<{ id: string; read: true }> {
      const at = now();
      const { parts } = await gather(deps.memberships, session, "company", q.hotel, (s) => forCompany(s, (repos, companyId, today) => repos.notifications.markRead(companyId, id, at, today)));
      if (!parts.some((p) => p.value)) throw new AppError("NOT_FOUND");
      return { id, read: true };
    },

    /** Marks every unread notice of this company read, over the hotels asked for. */
    async readAllNotifications(session: VerifiedSession, q: { hotel?: string }): Promise<{ marked: number; unavailable: { hotelId: string; hotelName: string }[] }> {
      const at = now();
      const { parts, unavailable } = await gather(deps.memberships, session, "company", q.hotel, (s) => forCompany(s, (repos, companyId, today) => repos.notifications.markAllRead(companyId, at, today)));
      return { marked: parts.reduce((t, p) => t + p.value, 0), unavailable };
    },
  };
}

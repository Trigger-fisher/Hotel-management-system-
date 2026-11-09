import "server-only";
import type { Catalog } from "../../auth/catalog";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { PortalRepos } from "../../repos/portal";
import type { SupportRequestRecord, SupportStatus } from "../../repos/supportRequests";
import type { Unit } from "../../repos/types";
import type { PeopleDirectory, Person } from "../cash/ports";
import { updatedEntry, type LogContext } from "../cash/syslog";

// The hotel's side of customer support (Front Office > Guest messages; guest portal round 3, decision 61, rebuilt on main). The queue of open messages (oldest first) and the
// answered and closed ones (newest first); one reply per message (it may be changed while the message is open or answered), then answered or closed. Plain text only. The In
// House part (pms.stays): view to read, edit to answer. One system-log line per answer (status and the reply's length, never the text).

const PART = "pms.stays";
const LOG_MODULE = "front-office";
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;

export interface SupportDeskDeps {
  unit: Unit<PortalRepos>;
  people: PeopleDirectory;
  catalog: Catalog;
  now: () => Date;
}

const words = (s: string | undefined): string[] => (s ?? "").toLowerCase().split(/\s+/).filter(Boolean);
const view = (r: SupportRequestRecord) => ({
  id: r.id,
  number: r.number,
  guestName: r.guestName,
  subject: r.subject,
  message: r.message,
  billRef: r.billRef,
  orderRef: r.orderRef,
  status: r.status,
  reply: r.reply,
  repliedAt: r.repliedAt ? r.repliedAt.toISOString() : null,
  repliedByName: r.repliedByName,
  createdAt: r.createdAt.toISOString(),
});

export function createSupportDesk(deps: SupportDeskDeps) {
  const { unit, people, catalog, now } = deps;
  const logCtx = (session: VerifiedSession, meta: RequestMeta, actor: Person | undefined): LogContext => ({ userId: session.userId, userName: actor?.name ?? "System", ip: meta.ip, traceId: meta.traceId });

  return {
    /** `open` (the default, oldest first), `answered`, `closed` or `all` (newest first); words in the number, guest, subject, message or the bill/order it is about. */
    async list(session: VerifiedSession, q: { status: SupportStatus | "all"; search?: string; page: number; pageSize: number }) {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const found = await repos.supportRequests.list({ status: q.status === "all" ? undefined : q.status, words: words(q.search), page: q.page, pageSize: q.pageSize });
        const open = q.status === "open" ? found.total : (await repos.supportRequests.list({ status: "open", page: 1, pageSize: 1 })).total;
        return { items: found.rows.map(view), total: found.total, page: q.page, pageSize: q.pageSize, openCount: open };
      });
    },

    /** Answers (status answered, the reply needed) or closes (a reply optional) a message. A closed message is not changed again (409). */
    async respond(session: VerifiedSession, id: string, input: { status: "answered" | "closed"; reply?: string | null }, meta: RequestMeta) {
      requirePermission(session, catalog, PART, "edit");
      const reply = (input.reply ?? "").replace(/\r\n?/g, "\n").trim();
      if (input.status === "answered" && reply.length < 2) throw new AppError("VALIDATION_FAILED", "Write the answer the guest will read.", { fields: { reply: "Write the answer the guest will read." } });
      if (reply.length > 2000) throw new AppError("VALIDATION_FAILED", "Keep the answer under 2,000 characters.", { fields: { reply: "Keep the answer under 2,000 characters." } });
      if (HTML_TAG.test(reply)) throw new AppError("VALIDATION_FAILED", "Plain text only: please remove the HTML tags.", { fields: { reply: "Plain text only: please remove the HTML tags." } });
      return unit.run(session, async (repos) => {
        const before = await repos.supportRequests.get(id, { forUpdate: true });
        if (!before) throw new AppError("NOT_FOUND");
        if (before.status === "closed") throw new AppError("CONFLICT", "This message is closed.");
        const actor = (await people.get([session.userId])).get(session.userId);
        const done = (await repos.supportRequests.respond(id, { status: input.status, reply: reply === "" ? before.reply : reply, at: now(), by: { id: session.userId, name: actor?.name ?? "Staff" } })) ?? before;
        await repos.systemLogs.write({
          ...updatedEntry(logCtx(session, meta, actor), "Support request", { id: before.id, label: before.number }, { Status: before.status }, { Status: done.status }, LOG_MODULE),
          details: { Status: `was ${before.status}, became ${done.status}`, "Reply length": String(reply.length) },
        });
        return view(done);
      });
    },
  };
}

export type SupportDesk = ReturnType<typeof createSupportDesk>;

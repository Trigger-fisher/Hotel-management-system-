import "server-only";
import {
  NOTIFICATION_BODY_MAX, NOTIFICATION_EMAIL_CAP, NOTIFICATION_TITLE_MAX,
  type Notification, type NotificationAudienceKind, type NotificationDetail, type NotificationLinkView, type NotificationPage, type NotificationTarget,
} from "@shared/dashboards/notifications";
import { requirePermission } from "../../auth/permissions";
import type { Catalog } from "../../auth/catalog";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { NotificationEmailStatus, NotificationRecord, NotificationsRepos, NotificationSummary } from "../../repos/notifications";
import type { Unit } from "../../repos/types";
import type { MailPayload, MailQueue } from "../auth/mail";
import type { PeopleDirectory, Person } from "../cash/ports";
import { createdEntry, updatedEntry, type LogContext } from "../cash/syslog";
import { Check } from "../frontOffice/validate";
import { isRealDate, todayIst } from "../guest/portalKit";
import type { NotificationBody, NotificationListQuery } from "./schemas";

// Notifications, the HOTEL side (HMS; docs/plans/NOTIFICATIONS-PLAN-2026-10-18.md, docs/BACKEND.md "Notifications"). Staff with the Companies module send a short plain-text notice
// to one, a few or all companies, read the history (who read it, when) and withdraw one (hidden from the companies, kept here). Sending writes the notification and one target per
// company in ONE transaction (a snapshot: a company added later does not get an old notice); with "also email" it then queues one mail per usable address through the hotel's own mail
// server (kind `notification`, hotel mail in the system lane), after the commit, best effort per address (the in-app notice is the promise, the mail is the extra). Refused: mail not set up,
// more than 500 addresses, an HTML tag in the text, a past expiry date, a link to a bill that is not that one company's. Spec: BACKEND.md.

const MODULE = "companies";
export const NOTIFICATIONS_LOG = "companies";
/** A hotel can set up its mail server with these two; without them nothing can go out (mail/hotelSmtp.ts hotelSmtpFromSettings). */
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;
/** Mails queued at a time. */
const SEND_BATCH = 25;
const MAIL_SETUP = "Set up your mail server under Settings > Email before sending a notification by email.";

export interface NotificationDeps {
  unit: Unit<NotificationsRepos>;
  people: PeopleDirectory;
  catalog: Catalog;
  now: () => Date;
  /** The hotel's own mail (kind `notification`); absent = "also email" is refused as if mail were not set up. */
  mail?: MailQueue;
}

const words = (s: string | undefined): string[] => (s ?? "").toLowerCase().split(/\s+/).filter(Boolean);

export function createNotificationService(deps: NotificationDeps) {
  const { unit, people, catalog, now } = deps;
  const logCtx = (session: VerifiedSession, meta: RequestMeta, actor: Person | undefined): LogContext => ({ userId: session.userId, userName: actor?.name ?? "System", ip: meta.ip, traceId: meta.traceId });

  const audienceLabel = (kind: NotificationAudienceKind, count: number, soleName: string | null): string =>
    kind === "all" ? `All companies (${count})` : kind === "one" ? (soleName ?? "1 company") : `${count} ${count === 1 ? "company" : "companies"}`;

  function dto(r: NotificationRecord & { readCount: number }, names: ReadonlyMap<string, Person>, today: string, soleName: string | null): Notification {
    const status = r.withdrawnAt !== null ? "withdrawn" : r.expiresAt !== null && r.expiresAt < today ? "expired" : "active";
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      priority: r.priority,
      audienceKind: r.audienceKind,
      audienceLabel: audienceLabel(r.audienceKind, r.targetCount, soleName),
      targetCount: r.targetCount,
      deliveredCount: r.targetCount,
      readCount: r.readCount,
      expiresAt: r.expiresAt,
      withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null,
      alsoEmail: r.alsoEmail,
      linkView: r.linkView as NotificationLinkView | null,
      linkId: r.linkId,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy ? (names.get(r.createdBy)?.name ?? "") : "",
      status,
    };
  }

  async function detailOf(repos: NotificationsRepos, r: NotificationSummary, today: string): Promise<NotificationDetail> {
    const targets = await repos.notifications.targets(r.id);
    const names = await people.get(r.createdBy ? [r.createdBy] : []);
    const rows: NotificationTarget[] = targets.map((t) => ({ companyId: t.companyId, companyName: t.companyName, readAt: t.readAt ? t.readAt.toISOString() : null, emailStatus: r.alsoEmail ? t.emailStatus : null }));
    return {
      ...dto(r, names, today, targets[0]?.companyName ?? null),
      readCount: targets.filter((t) => t.readAt !== null).length,
      targets: rows,
      emailQueued: targets.filter((t) => t.emailStatus === "queued").length,
      emailSkipped: targets.filter((t) => t.emailStatus === "skipped").length,
    };
  }

  // mail can go out whenever the server has a mail queue: a hotel sends through the platform's Amazon SES unless the Super Admin gave it accounts of its own
  async function mailReady(_repos: NotificationsRepos): Promise<boolean> {
    return deps.mail !== undefined;
  }

  return {
    /** The history, newest first (the Companies > Notifications page). */
    async list(session: VerifiedSession, q: NotificationListQuery): Promise<NotificationPage> {
      requirePermission(session, catalog, MODULE, "view");
      const today = todayIst(now());
      const found = await unit.run(session, async (repos) => {
        const result = await repos.notifications.list({ words: words(q.search), status: q.status, today, page: q.page, pageSize: q.pageSize });
        // a notice to ONE company is labelled with that company's name
        const sole = new Map<string, string>();
        for (const r of result.rows.filter((x) => x.audienceKind === "one")) {
          const t = await repos.notifications.targets(r.id);
          if (t[0]) sole.set(r.id, t[0].companyName);
        }
        return { result, sole };
      });
      const names = await people.get([...new Set(found.result.rows.map((r) => r.createdBy).filter((x): x is string => x !== null))]);
      return { items: found.result.rows.map((r) => dto(r, names, today, found.sole.get(r.id) ?? null)), total: found.result.total, page: q.page, pageSize: q.pageSize };
    },

    /** One notification with the companies it went to and when each read it. */
    async get(session: VerifiedSession, id: string): Promise<NotificationDetail> {
      requirePermission(session, catalog, MODULE, "view");
      const today = todayIst(now());
      return unit.run(session, async (repos) => {
        const r = await repos.notifications.get(id);
        if (!r) throw new AppError("NOT_FOUND");
        return detailOf(repos, r, today);
      });
    },

    async send(session: VerifiedSession, input: NotificationBody, meta: RequestMeta): Promise<NotificationDetail> {
      requirePermission(session, catalog, MODULE, "create");
      const at = now();
      const today = todayIst(at);

      // the text: plain, bounded, no HTML
      const c = new Check(false);
      const title = c.required("title", "title", input.title);
      c.max("title", "title", title, NOTIFICATION_TITLE_MAX);
      const text = input.body.replace(/\r\n?/g, "\n").trim();
      const body = text === "" ? null : text;
      if (body === null) c.fail("body", "The message field is required.");
      else if (Array.from(body).length > NOTIFICATION_BODY_MAX) c.fail("body", `The message field must not be greater than ${NOTIFICATION_BODY_MAX} characters.`);
      if ((title !== null && HTML_TAG.test(title)) || (body !== null && HTML_TAG.test(body))) c.fail(body !== null && HTML_TAG.test(body) ? "body" : "title", "Plain text only: please remove the HTML tags.");
      const expiresAt = input.expiresAt ?? null;
      if (expiresAt !== null) {
        if (!isRealDate(expiresAt)) c.fail("expiresAt", "The expiry date must be a valid date.");
        else if (expiresAt < today) c.fail("expiresAt", "The expiry date cannot be in the past.");
      }
      const linkView = input.linkView ?? null;
      const linkId = input.linkId ?? null;
      if (linkView === null && linkId !== null) c.fail("linkView", "Choose the page the link opens.");
      if (linkView === "corporate.bill" && linkId === null) c.fail("linkId", "Choose the bill the link opens.");
      if (linkView !== null && linkView !== "corporate.bill" && linkId !== null) c.fail("linkId", "This page takes no record.");
      c.done();

      const sent = await unit.run(session, async (repos) => {
        // the audience: every live company, or the ones picked (each must still exist)
        const picked = input.companyIds === "all" ? null : [...new Set(input.companyIds)];
        const companyIds = await repos.notifications.liveCompanyIds(picked ?? undefined);
        if (picked !== null && companyIds.length !== picked.length) throw new AppError("VALIDATION_FAILED", "One of the companies you chose is no longer available.", { fields: { companyIds: "One of the companies you chose is no longer available." } });
        if (companyIds.length === 0) throw new AppError("VALIDATION_FAILED", "There are no companies to send this to yet.", { fields: { companyIds: "There are no companies to send this to yet." } });
        const audienceKind: NotificationAudienceKind = picked === null ? "all" : companyIds.length === 1 ? "one" : "selected";

        // a link to a bill must be a bill of the ONE company it goes to (a company can only open its own bills)
        if (linkView === "corporate.bill" && linkId !== null) {
          const bill = companyIds.length === 1 ? await repos.bills.get(linkId) : null;
          if (!bill || bill.companyId !== companyIds[0]) throw new AppError("VALIDATION_FAILED", "The link must be a bill of the one company you are sending to.", { fields: { linkId: "The link must be a bill of the one company you are sending to." } });
        }

        // "also email": mail must be set up, at most 500 addresses, one status per company
        let emails = new Map<string, { email: string; name: string }[]>();
        if (input.alsoEmail) {
          if (!(await mailReady(repos))) throw new AppError("VALIDATION_FAILED", MAIL_SETUP, { fields: { alsoEmail: MAIL_SETUP } });
          emails = await repos.notifications.emailsOf(companyIds);
          const addresses = [...emails.values()].reduce((t, list) => t + list.length, 0);
          if (addresses > NOTIFICATION_EMAIL_CAP) {
            const message = `This would send ${addresses} emails; the limit is ${NOTIFICATION_EMAIL_CAP} at a time. Untick "Also send by email" or choose fewer companies.`;
            throw new AppError("VALIDATION_FAILED", message, { fields: { alsoEmail: message } });
          }
        }
        const statusOf = (companyId: string): NotificationEmailStatus => (!input.alsoEmail ? "none" : (emails.get(companyId)?.length ?? 0) > 0 ? "queued" : "skipped");

        const record = await repos.notifications.create(
          { audienceKind, title: title ?? "", body: body ?? "", priority: input.priority, linkView, linkId, expiresAt, alsoEmail: input.alsoEmail, createdBy: session.userId },
          companyIds.map((companyId) => ({ companyId, emailStatus: statusOf(companyId) })),
          at,
        );
        const names = await people.get([session.userId]);
        await repos.systemLogs.write(
          createdEntry(logCtx(session, meta, names.get(session.userId)), "Notification", { id: record.id, label: record.title }, {
            Audience: audienceLabel(audienceKind, companyIds.length, null),
            Priority: record.priority,
            "Also email": record.alsoEmail ? "yes" : "no",
            ...(expiresAt ? { "Expires on": expiresAt } : {}),
          }, NOTIFICATIONS_LOG),
        );
        const hotelName = input.alsoEmail ? (await repos.hotelProfile.header()).name : "";
        const detail = await detailOf(repos, { ...record, readCount: 0 }, today);
        return { detail, emails, hotelName, record };
      });

      // after the commit: one mail per usable address, in batches (best effort; the notice is already in the portal)
      if (input.alsoEmail && deps.mail) {
        const mail = deps.mail;
        const queued = [...sent.emails.values()].flat();
        for (let i = 0; i < queued.length; i += SEND_BATCH) {
          await Promise.allSettled(
            queued.slice(i, i + SEND_BATCH).map((to) => {
              const payload: MailPayload = { name: to.name || "there", hotelName: sent.hotelName, subject: sent.record.title, message: sent.record.body };
              return mail.queue({ kind: "notification", hotelId: session.hotelId, toEmail: to.email, payload });
            }),
          );
        }
      }
      return sent.detail;
    },

    /** Hides it from the companies (their unread count drops); the history keeps it. Withdrawing twice changes nothing and is not logged twice. */
    async withdraw(session: VerifiedSession, id: string, meta: RequestMeta): Promise<NotificationDetail> {
      requirePermission(session, catalog, MODULE, "edit");
      const at = now();
      const today = todayIst(at);
      return unit.run(session, async (repos) => {
        const before = await repos.notifications.get(id);
        if (!before) throw new AppError("NOT_FOUND");
        if (before.withdrawnAt === null) {
          await repos.notifications.withdraw(id, session.userId, at);
          const names = await people.get([session.userId]);
          await repos.systemLogs.write({
            ...updatedEntry(logCtx(session, meta, names.get(session.userId)), "Notification", { id: before.id, label: before.title }, {}, {}, NOTIFICATIONS_LOG),
            summary: `Withdrew notification: ${before.title}`.slice(0, 500),
            details: { Audience: audienceLabel(before.audienceKind, before.targetCount, null), Read: `${before.readCount} of ${before.targetCount}` },
          });
        }
        const after = await repos.notifications.get(id);
        return detailOf(repos, after ?? before, today);
      });
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;

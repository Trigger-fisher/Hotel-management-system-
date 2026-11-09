import "server-only";
import { formatDate, formatINR } from "@shared/dashboards/format";
import type { HotelDashboard } from "@shared/dashboards/overview";
import type { MailPayload } from "../auth/mail";
import { mailWake } from "../auth/mailWake";
import { istMoment } from "../cash/ist";

// The owner's daily summary (MJ's plan, H10): every evening each hotel that filled "Daily summary to" (Settings > Email) gets one plain-text mail per address
// with the day as the dashboard shows it: the front desk, the cash book, the handovers, the salaries and what still needs attention. The mail goes through the
// hotel's own mail server (outbox kind daily_summary with the hotel id). A hotel is served at most once a day: the day it was queued for is kept in the
// hotel's own settings (email.daily_summary_sent_on), so a second cron call the same evening does nothing. The figures are read with a read-only
// super-admin view of the hotel (compose/dailySummary.ts); nothing here writes to the hotel but that one setting.

export const DAILY_SUMMARY_KEY = "email.daily_summary_to";
export const DAILY_SUMMARY_SENT_KEY = "email.daily_summary_sent_on";

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** The addresses of the setting: split on commas, semicolons or spaces, lower case, valid ones only, no doubles, at most 10. */
export function recipientsFrom(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (value ?? "").split(/[\s,;]+/)) {
    const a = raw.trim().toLowerCase();
    if (a && ADDRESS.test(a) && !out.includes(a)) out.push(a);
    if (out.length === 10) break;
  }
  return out;
}

const n = (x: number, one: string, many = `${one}s`): string => `${x} ${x === 1 ? one : many}`;

/** The day's email campaigns (Companies > Email Marketing): how many were sent today, to how many addresses, and how their mails stand in the queue. */
export interface CampaignDay {
  sent: number;
  recipients: number;
  delivered: number;
  failed: number;
  pending: number;
}

/** The summary's lines from the dashboard figures and, when the hotel sent a campaign today, its figures (pure; tested on its own). */
export function summaryText(d: HotelDashboard, campaigns?: CampaignDay | null): string {
  const lines: string[] = [];
  if (d.frontDesk) {
    const f = d.frontDesk;
    lines.push("FRONT DESK", `Arrivals ${f.arrivals} | Departures ${f.departures} | In house ${f.inHouse} | Rooms to clean ${f.roomsToClean} | Rooms ready ${f.roomsReady}`);
    lines.push("");
  }
  lines.push("CASH TODAY", `In ${formatINR(d.day.inPaise)} | Out ${formatINR(d.day.outPaise)} | Net ${formatINR(d.day.inPaise - d.day.outPaise)} (${n(d.day.count, "entry", "entries")})`);
  for (const b of d.books) lines.push(`${b.name}: in ${formatINR(b.todayInPaise)}, out ${formatINR(b.todayOutPaise)}`);
  lines.push(`Yesterday in: ${formatINR(d.day.yesterdayInPaise)}`, "");
  lines.push("MONTH TO DATE", `In ${formatINR(d.monthToDate.inPaise)} | Out ${formatINR(d.monthToDate.outPaise)} (last month to the same day: in ${formatINR(d.monthToDate.lastInPaise)}, out ${formatINR(d.monthToDate.lastOutPaise)})`, "");
  const h = d.handovers;
  lines.push("SHIFT HANDOVERS", h.today ? `${n(h.today, "handover")} today, ${formatINR(h.todayCashPaise)} counted${h.latest ? ` (last: ${h.latest.shift} by ${h.latest.by})` : ""}` : "No handover recorded today", "");
  const p = d.payroll;
  if (p) lines.push("STAFF", `${n(p.activeStaff, "active staff", "active staff")}; ${p.openCount ? `${n(p.openCount, "salary payment")} open, ${formatINR(p.openAmountPaise)} to pay${p.openSince ? ` (since ${p.openSince})` : ""}` : "no salary payment open"}`, "");
  if (campaigns && campaigns.sent > 0) {
    lines.push("CAMPAIGNS", `${n(campaigns.sent, "campaign")} sent today to ${n(campaigns.recipients, "address", "addresses")}: ${campaigns.delivered} delivered, ${campaigns.failed} failed, ${campaigns.pending} waiting`, "");
  }
  lines.push("NEEDS ATTENTION", ...(d.attention.length ? d.attention.map((a) => `- ${a.text}`) : ["Nothing: all clear."]));
  return lines.join("\n");
}

export interface DailySummaryRun {
  /** Hotels handled by THIS call (a pass over many hotels is several calls). */
  hotels: number;
  queued: number;
  skipped: number;
  failed: number;
  /** Present (true) only when hotels are left for another call: this call stopped at its batch size or time budget; the next one continues after the last hotel served. */
  more?: true;
}

/** Where a pass stands today: the hotels are taken in id order, `after` is the last one handled. `done` = the pass reached the end. */
export interface DailySummaryCursor {
  day: string;
  after: string | null;
  done: boolean;
}

/** Hotels one call handles at most (each costs a settings read and a dashboard: about 0.1-0.3 s), and the time it may spend before it hands over (the cron function lives 60 s). */
export const SUMMARY_BATCH = 150;
export const SUMMARY_BUDGET_MS = 40_000;
/** The cursor is written this often while a call runs (and always when it ends), so a call cut off mid-way loses at most this many hotels of progress; the per-hotel "sent today" mark stops a second mail anyway. */
const CURSOR_EVERY = 25;

export interface DailySummaryDeps {
  /** The active hotels. */
  hotels(): Promise<{ id: string; name: string }[]>;
  /** Once a day per active hotel, before anything else (also for a hotel that gets no mail): housekeeping other parts need. Its failure is reported and never stops the mail. */
  housekeeping?(hotelId: string): Promise<void>;
  /** The hotel's "Daily summary to" and the day it was last queued for. */
  settingsOf(hotelId: string): Promise<{ to: string | null; sentOn: string | null }>;
  markSent(hotelId: string, date: string): Promise<void>;
  /** The hotel's dashboard as its super admin sees it. */
  dashboardOf(hotelId: string): Promise<HotelDashboard>;
  /** The campaigns the hotel sent today, or null when none (absent: no Campaigns section; a failure here never stops the mail). */
  campaignsOf?(hotelId: string): Promise<CampaignDay | null>;
  /** One outbox row through the hotel's own mail server. */
  enqueue(hotelId: string, to: string, payload: MailPayload): Promise<void>;
  now(): Date;
  report?(message: string, error: unknown, hotelId: string): void;
  /** Where the day's pass stands (absent: every call starts from the first hotel, as before). */
  cursorOf?(): Promise<DailySummaryCursor | null>;
  saveCursor?(cursor: DailySummaryCursor): Promise<void>;
  /** Hotels per call (default SUMMARY_BATCH) and the milliseconds a call may run before it hands over (default SUMMARY_BUDGET_MS). */
  batch?: number;
  budgetMs?: number;
  /** A monotonic clock in ms for the budget (default Date.now); `now()` is the business clock. */
  tick?: () => number;
}

export function createDailySummaryService(deps: DailySummaryDeps) {
  return {
    /**
     * One call of the day's pass over the active hotels, taken in id order: `{hotels, queued, skipped, failed}`. A hotel with no addresses, or already served today, is
     * skipped. A call handles at most `batch` hotels or `budgetMs` of time (a cron function lives 60 s), then stops with `more: true`; the next call continues after the
     * last hotel handled (the cursor, kept in the platform settings). A call that finds the pass done starts a new one (a later call the same day serves a hotel that
     * named addresses meanwhile; one already served is skipped by its own "sent today" mark, so nobody gets a second mail).
     */
    async run(): Promise<DailySummaryRun> {
      const today = istMoment(deps.now()).date;
      const out: DailySummaryRun = { hotels: 0, queued: 0, skipped: 0, failed: 0 };
      const tick = deps.tick ?? Date.now;
      const started = tick();
      const batch = deps.batch ?? SUMMARY_BATCH;
      const budgetMs = deps.budgetMs ?? SUMMARY_BUDGET_MS;
      const all = [...(await deps.hotels())].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const cursor = deps.cursorOf ? await deps.cursorOf().catch(() => null) : null;
      const after = cursor && cursor.day === today && !cursor.done ? cursor.after : null;
      const todo = after === null ? all : all.filter((h) => h.id > after);
      let last = after;
      let more = false;
      const save = async (done: boolean): Promise<void> => {
        if (!deps.saveCursor) return;
        // a cursor that cannot be written never stops the mails: the next call would start over, and the "sent today" marks keep it from mailing anyone twice
        await deps.saveCursor({ day: today, after: done ? null : last, done }).catch((error: unknown) => deps.report?.("daily summary cursor could not be saved", error, ""));
      };
      for (const hotel of todo) {
        if (out.hotels >= batch || tick() - started > budgetMs) {
          more = true;
          break;
        }
        out.hotels += 1;
        try {
          if (deps.housekeeping) await deps.housekeeping(hotel.id).catch((error: unknown) => deps.report?.("daily housekeeping could not run", error, hotel.id));
          const settings = await deps.settingsOf(hotel.id);
          const to = recipientsFrom(settings.to);
          if (to.length === 0 || settings.sentOn === today) {
            out.skipped += 1;
            continue;
          }
          const dashboard = await deps.dashboardOf(hotel.id);
          const campaigns = deps.campaignsOf ? await deps.campaignsOf(hotel.id).catch(() => null) : null;
          const payload: MailPayload = { name: `${hotel.name} team`, hotelName: hotel.name, date: formatDate(today), summary: summaryText(dashboard, campaigns) };
          await deps.markSent(hotel.id, today);
          for (const address of to) await deps.enqueue(hotel.id, address, payload);
          out.queued += to.length;
        } catch (error) {
          out.failed += 1;
          deps.report?.("daily summary could not be queued", error, hotel.id);
        } finally {
          // the cursor moves past a hotel only once it was handled (a skip counts: it is `continue` above), so a call cut off mid-hotel serves that hotel next time
          last = hotel.id;
          if (out.hotels % CURSOR_EVERY === 0) await save(false);
        }
      }
      if (out.queued > 0) mailWake.touch();
      await save(!more);
      return more ? { ...out, more: true } : out;
    },
  };
}

export type DailySummaryService = ReturnType<typeof createDailySummaryService>;

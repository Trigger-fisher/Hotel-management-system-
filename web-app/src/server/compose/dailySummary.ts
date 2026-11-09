import "server-only";
import { getDatabase } from "../../db";
import { createCatalog } from "../auth/catalog";
import { PERMISSION_CATALOG } from "../auth/catalog.generated";
import type { VerifiedSession } from "../auth/session";
import { getLogger } from "../logger";
import { istMoment } from "../services/cash/ist";
import { createDailySummaryService, DAILY_SUMMARY_KEY, DAILY_SUMMARY_SENT_KEY, type CampaignDay, type DailySummaryCursor, type DailySummaryService } from "../services/overview/dailySummaryService";
import { getAdminUnit } from "./admin";
import { getPlatformUnit } from "./auth";
import { getMarketing } from "./companies";
import { getHotelDashboard } from "./overview";
import { getPlatformConsoleUnit } from "./platform";

// The composition root of the owners' daily summary (GET /api/v1/cron/daily-summary): the platform console's hotel list, each hotel's Email settings and
// dashboard through its own unit, and the platform outbox. The hotel is read with a fixed read-only super-admin view (no person is signed in).

const SUMMARY_USER = "00000000-0000-4000-8000-0000000000d5";
const catalog = createCatalog(PERMISSION_CATALOG);

/** A read-only super-admin view of one hotel: every part at the level it offers, no person behind it. */
export function summarySession(hotelId: string): VerifiedSession {
  return { userId: SUMMARY_USER, hotelId, accountRole: "hotel_admin", roleId: SUMMARY_USER, roleKey: "super_admin", roleLevel: 4, permissions: Object.fromEntries(catalog.entries.map((e) => [e.key, e.offers])), sessionId: SUMMARY_USER, client: "web" };
}

let service: DailySummaryService | null = null;

export function getDailySummary(): DailySummaryService {
  service ??= createDailySummaryService({
    hotels: async () => (await getPlatformConsoleUnit().run((r) => r.hotels.list({ words: [] }, new Date()))).filter((h) => h.status === "active").map((h) => ({ id: h.id, name: h.name })),
    settingsOf: (hotelId) =>
      getAdminUnit().run({ hotelId, userId: SUMMARY_USER, visit: undefined }, async (repos) => {
        const rows = await repos.adminSettings.get([DAILY_SUMMARY_KEY, DAILY_SUMMARY_SENT_KEY]);
        const value = (key: string): string | null => rows.find((r) => r.key === key)?.value ?? null;
        return { to: value(DAILY_SUMMARY_KEY), sentOn: value(DAILY_SUMMARY_SENT_KEY) };
      }),
    markSent: (hotelId, date) => getAdminUnit().run({ hotelId, userId: SUMMARY_USER, visit: undefined }, (repos) => repos.adminSettings.set([{ key: DAILY_SUMMARY_SENT_KEY, value: date, secret: false }], SUMMARY_USER)),
    dashboardOf: (hotelId) => getHotelDashboard().summary(summarySession(hotelId)),
    // the campaigns sent today (Email Marketing), summed from the overview's queue figures; none = no section
    campaignsOf: async (hotelId): Promise<CampaignDay | null> => {
      const today = istMoment(new Date()).date;
      const sent = (await getMarketing().overview(summarySession(hotelId))).campaigns.filter((c) => c.status === "sent" && c.sentAt !== null && istMoment(new Date(c.sentAt)).date === today);
      if (sent.length === 0) return null;
      return sent.reduce((acc, c) => ({ sent: acc.sent + 1, recipients: acc.recipients + c.recipients, delivered: acc.delivered + c.delivered, failed: acc.failed + c.failed, pending: acc.pending + c.pending }), { sent: 0, recipients: 0, delivered: 0, failed: 0, pending: 0 });
    },
    enqueue: (hotelId, to, payload) => getPlatformUnit().run((r) => r.outbox.enqueue({ userId: null, hotelId, kind: "daily_summary", toEmail: to, template: "daily-summary", payload: JSON.stringify(payload) }, new Date())),
    now: () => new Date(),
    report: (message, error, hotelId) => getLogger().error(message, { hotelId, error: error instanceof Error ? error.message : String(error) }),
    // where today's pass stands: one row of the platform settings (no migration: the table takes any key of this shape)
    cursorOf: readCursor,
    saveCursor: writeCursor,
  });
  return service;
}

/** The platform-settings key of the day's pass (value: { day, after, done }). */
export const DAILY_SUMMARY_CURSOR_KEY = "cron.daily_summary_cursor";

async function readCursor(): Promise<DailySummaryCursor | null> {
  const client = await getDatabase().pool.connect();
  try {
    const r = await client.query("SELECT value FROM platform.platform_settings WHERE key = $1", [DAILY_SUMMARY_CURSOR_KEY]);
    const v = r.rows[0]?.value as { day?: unknown; after?: unknown; done?: unknown } | undefined;
    if (!v || typeof v.day !== "string" || typeof v.done !== "boolean" || (v.after !== null && typeof v.after !== "string")) return null;
    return { day: v.day, after: v.after as string | null, done: v.done };
  } finally {
    client.release();
  }
}

async function writeCursor(cursor: DailySummaryCursor): Promise<void> {
  const client = await getDatabase().pool.connect();
  try {
    await client.query(
      "INSERT INTO platform.platform_settings (key, value, is_secret) VALUES ($1, $2::jsonb, false) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [DAILY_SUMMARY_CURSOR_KEY, JSON.stringify(cursor)],
    );
  } finally {
    client.release();
  }
}

/** Replaces the service (tests). */
export function configureDailySummary(next: DailySummaryService | null): void {
  service = next;
}

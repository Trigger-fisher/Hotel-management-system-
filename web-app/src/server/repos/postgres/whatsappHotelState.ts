import "server-only";
import type { WhatsAppTemplate } from "@shared/dashboards/whatsapp";

// What the hotel's Settings > WhatsApp card reads from the hotel's OWN schema (hotel 0057): its message templates and this month's counts. Counts only, never a message or a number.
type Query = { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

const SOURCES = ["guest_name", "room", "check_in", "check_out", "hotel_name"] as const;
type Source = (typeof SOURCES)[number];

/** The hotel's templates that were sent to Meta (a draft is not shown: it cannot be sent yet), newest first. */
export async function hotelTemplates(db: Query): Promise<WhatsAppTemplate[]> {
  const r = await db.query("SELECT id, name, language, category, body, variables, status FROM wa_templates WHERE status <> 'draft' ORDER BY created_at DESC LIMIT 200");
  return r.rows.map((x) => {
    const raw = Array.isArray(x.variables) ? (x.variables as { index?: unknown; name?: unknown }[]) : [];
    return {
      id: String(x.id),
      name: String(x.name),
      category: x.category as WhatsAppTemplate["category"],
      language: String(x.language),
      status: x.status as WhatsAppTemplate["status"],
      text: String(x.body),
      variables: raw
        .filter((v) => typeof v.index === "number")
        .map((v) => {
          const name = typeof v.name === "string" ? v.name : "";
          return { index: v.index as number, label: name.replace(/_/g, " "), ...((SOURCES as readonly string[]).includes(name) ? { source: name as Source } : {}) };
        }),
    };
  });
}

/** This month's counts from `wa_usage` (`from` = the first day of the month in the hotel's time zone, as YYYY-MM-DD): approved messages sent, free replies, messages received. */
export async function hotelMonthCounts(db: Query, from: string): Promise<{ templates: number; free: number; received: number }> {
  const r = await db.query(
    `SELECT coalesce(sum(sent) FILTER (WHERE category <> 'service'), 0)::int AS templates,
            coalesce(sum(sent) FILTER (WHERE category = 'service'), 0)::int AS free,
            coalesce(sum(received), 0)::int AS received
     FROM wa_usage WHERE day >= $1::date`,
    [from],
  );
  const x = r.rows[0] ?? {};
  return { templates: Number(x.templates ?? 0), free: Number(x.free ?? 0), received: Number(x.received ?? 0) };
}

/** The first day of `now`'s month in `zone` as YYYY-MM-DD (an unknown zone falls back to UTC). */
export function monthStartIn(now: Date, zone: string): string {
  let parts: Intl.DateTimeFormat;
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit" });
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit" });
  }
  const p = Object.fromEntries(parts.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-01`;
}

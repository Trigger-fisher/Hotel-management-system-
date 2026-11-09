import "server-only";
import { SENT_MAIL_KINDS, type SentMailPage, type SentMailRow, type SentMailStatus } from "@shared/dashboards/sentMail";
import { getDatabase } from "../../db";
import type { SentMailQueryInput } from "../services/conversations/schemas";

/** Reads one page of the mail queue for the Email pages' "Sent through Amazon SES" list. `hotelId` null = every mail (the platform's page); a hotel id = that hotel's mail only. */
export type SentMailLoader = (hotelId: string | null, q: SentMailQueryInput) => Promise<SentMailPage>;

const statusOf = (s: string): SentMailStatus => (s === "sent" ? "sent" : s === "failed" ? "failed" : "pending");
const likeOf = (s: string): string => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * Only who, what kind, when and how it went: the text of a mail, a code or a link (the payload) is never selected. The newest first; a mail that has not gone yet shows the time it was
 * queued. A failure shows the system's own sentence, cut to 160 characters.
 */
export function sentMailLoader(): SentMailLoader {
  return async (hotelId, q) => {
    const client = await getDatabase().pool.connect();
    try {
      const size = q.size;
      const search = (q.search ?? "").trim();
      const r = await client.query(
        `SELECT o.id, o.to_email, o.kind, o.status, o.attempts, o.created_at, o.sent_at, left(o.last_error, 160) AS problem, h.name AS hotel, count(*) OVER () AS total
           FROM platform.outbox o
           LEFT JOIN platform.hotels h ON h.id = o.hotel_id
          WHERE ($1::uuid IS NULL OR o.hotel_id = $1::uuid)
            AND ($2 = '' OR o.to_email ILIKE $3 OR o.kind ILIKE $3 OR coalesce(h.name, '') ILIKE $3)
            AND ($4 = 'all' OR ($4 = 'pending' AND o.status IN ('pending', 'sending')) OR o.status = $4)
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT $5 OFFSET $6`,
        [hotelId, search, likeOf(search), q.status, size, (q.page - 1) * size],
      );
      const rows: SentMailRow[] = r.rows.map((x) => ({
        id: String(x.id),
        to: String(x.to_email),
        label: SENT_MAIL_KINDS[String(x.kind)] ?? String(x.kind),
        hotel: x.hotel === null || x.hotel === undefined ? null : String(x.hotel),
        at: new Date((x.sent_at ?? x.created_at) as string | Date).toISOString(),
        status: statusOf(String(x.status)),
        attempts: Number(x.attempts),
        problem: typeof x.problem === "string" && x.problem !== "" ? x.problem : null,
      }));
      return { rows, total: r.rows.length > 0 ? Number(r.rows[0].total) : 0, page: q.page, size };
    } finally {
      client.release();
    }
  };
}

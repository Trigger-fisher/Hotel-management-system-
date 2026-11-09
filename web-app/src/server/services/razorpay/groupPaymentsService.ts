import "server-only";
import type { GroupPaymentsOverview, GroupPaymentsHotel, GroupPaymentRow } from "@shared/dashboards/groupPayments";
import type { VerifiedSession } from "../../auth/session";
import type { RazorpayRepo } from "../../repos/admin";
import type { RazorpayDisputeRepo } from "../../repos/razorpay";
import { istMoment } from "../cash/ist";

// The Group Hotel Admin's view of online payments across the hotels of its own group (MJ, 2 Nov 2026): for each member hotel the money in today and this month, failed payments, refunds, and the
// problems waiting for an answer, then the newest payments of all of them. READ ONLY: each hotel is read in a read-only transaction of its own, and only the hotels `hotels()` names are read (the
// group console proves they are the group's). What a guest paid with (phone, email) is not shown here; to act on a payment the admin opens that hotel ("Enter hotel"). One hotel that cannot be read
// is listed as unavailable and the rest still show; at most 25 hotels, four at a time, ten seconds each.

const MAX_HOTELS = 25;
const AT_A_TIME = 4;
const PER_HOTEL_MS = 10_000;

/** What the page reads inside one hotel. */
export interface HotelPaymentReads {
  razorpay: Pick<RazorpayRepo, "stats" | "counts" | "list">;
  disputes: Pick<RazorpayDisputeRepo, "list">;
}

export interface GroupPaymentsDeps {
  /** The live member hotels of the signed-in Group Hotel Admin's group (404/403 for anyone else is the group console's job). */
  hotels: (session: VerifiedSession) => Promise<{ id: string; name: string }[]>;
  /** Runs `work` inside ONE hotel, in a read-only transaction (the composition root binds the repositories). A hotel that cannot be opened rejects. */
  readHotel: <T>(hotelId: string, work: (repos: HotelPaymentReads) => Promise<T>) => Promise<T>;
  now: () => Date;
}

const within = <T>(work: Promise<T>): Promise<T> =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), PER_HOTEL_MS).unref?.())]);

export function createGroupPaymentsService(deps: GroupPaymentsDeps) {
  return {
    async overview(session: VerifiedSession): Promise<GroupPaymentsOverview> {
      const hotels = (await deps.hotels(session)).slice(0, MAX_HOTELS);
      const at = istMoment(deps.now());
      const todayFrom = new Date(`${at.date}T00:00:00+05:30`);
      const monthFrom = new Date(`${at.date.slice(0, 7)}-01T00:00:00+05:30`);

      const read = (h: { id: string; name: string }) =>
        within(
          deps.readHotel(h.id, async ({ razorpay, disputes }) => {
            const [stats, counts, recent, waiting] = await Promise.all([
              razorpay.stats(todayFrom, monthFrom),
              razorpay.counts(),
              razorpay.list({ page: 1, pageSize: 5 }),
              disputes.list({ status: "open", page: 1, pageSize: 1 }),
            ]);
            const row: GroupPaymentsHotel = {
              hotelId: h.id, hotelName: h.name, todayPaise: stats.todayPaise, monthPaise: stats.monthPaise, failed: stats.failed, refundedPaise: stats.refundedPaise,
              payments: counts.hotel + counts.food, openProblems: waiting.total,
            };
            const rows: GroupPaymentRow[] = recent.items.map((p) => ({
              hotelId: h.id, hotelName: h.name, paymentId: p.paymentId, business: p.business, status: p.status, method: p.method, amountPaise: p.amountPaise, amountRefundedPaise: p.amountRefundedPaise,
              description: p.description, at: (p.paidAt ?? p.createdAt).toISOString(),
            }));
            return { row, rows };
          }),
        );

      const done: { hotel: { id: string; name: string }; value: Awaited<ReturnType<typeof read>> | null }[] = [];
      for (let i = 0; i < hotels.length; i += AT_A_TIME) {
        const batch = hotels.slice(i, i + AT_A_TIME);
        const settled = await Promise.allSettled(batch.map(read));
        settled.forEach((s, k) => done.push({ hotel: batch[k], value: s.status === "fulfilled" ? s.value : null }));
      }
      const ok = done.filter((d) => d.value !== null).map((d) => d.value!);
      const rows = ok.map((o) => o.row);
      return {
        hotels: rows,
        totals: {
          todayPaise: rows.reduce((n, r) => n + r.todayPaise, 0),
          monthPaise: rows.reduce((n, r) => n + r.monthPaise, 0),
          failed: rows.reduce((n, r) => n + r.failed, 0),
          refundedPaise: rows.reduce((n, r) => n + r.refundedPaise, 0),
          openProblems: rows.reduce((n, r) => n + r.openProblems, 0),
        },
        recent: ok.flatMap((o) => o.rows).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
        unavailable: done.filter((d) => d.value === null).map((d) => ({ hotelId: d.hotel.id, hotelName: d.hotel.name })),
      };
    },
  };
}

export type GroupPaymentsService = ReturnType<typeof createGroupPaymentsService>;
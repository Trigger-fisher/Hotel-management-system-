import "server-only";
import { z } from "zod";
import { getAdminAccount } from "@/server/compose/admin";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

const query = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50)])).default(25),
});

// The guest's own sign-in history (round 3 d): newest first, from the same records as the hotel staff's own profile (the platform's sign-in log). Only the person's own rows;
// staff and company accounts are 403 here (they have their own profile page).
export const GET = route({
  permission: "session",
  query,
  handler: async ({ session, query }) => {
    await getGuestPortal().requireGuest(session);
    const list = await getAdminAccount().signIns(session, { page: query.page, pageSize: query.pageSize } as never);
    return {
      data: {
        items: list.page.items.map((r) => ({ id: r.id, at: r.at, ok: r.result === "success", device: r.device, ip: r.ip, ended: r.ended })),
        total: list.page.total,
        page: list.page.page,
        pageSize: list.page.pageSize,
        totals: list.totals,
      },
    };
  },
});
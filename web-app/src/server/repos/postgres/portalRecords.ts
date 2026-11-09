import "server-only";
import type { WithHotel } from "../../../db/withHotel";
import type { PortalRecords } from "../../services/admin/userService";

// The guest and company records a portal account can be linked to (decision 47), read from the hotel's own schema as the signed-in hotel Admin. Names and a short
// detail only (never an ID number); searches use position() so a typed "%" or "_" is just a letter.
export function createPgPortalRecords(withHotel: WithHotel): PortalRecords {
  return {
    async describe(session, links) {
      const out = new Map<string, { name: string; active: boolean }>();
      const ids = (kind: "guest" | "company") => links.filter((l) => l.kind === kind).map((l) => l.id);
      return withHotel(session, async (tx) => {
        const g = ids("guest");
        if (g.length > 0) for (const r of (await tx.query("SELECT id, name, is_active FROM customers WHERE id = ANY($1::uuid[])", [g])).rows) out.set(`guest:${String(r.id)}`, { name: String(r.name), active: r.is_active === true });
        const c = ids("company");
        if (c.length > 0) for (const r of (await tx.query("SELECT id, name, (deleted_at IS NULL) AS active FROM company_profiles WHERE id = ANY($1::uuid[])", [c])).rows) out.set(`company:${String(r.id)}`, { name: String(r.name), active: r.active === true });
        return out;
      });
    },
    async options(session, kind, q) {
      const word = q.trim().toLowerCase().slice(0, 100);
      return withHotel(session, async (tx) => {
        if (kind === "guest") {
          const r = await tx.query(
            "SELECT id, name, mobile, city FROM customers WHERE is_active AND ($1 = '' OR position($1 in lower(concat_ws(' ', name, mobile, city))) > 0) ORDER BY lower(name), id LIMIT 25",
            [word],
          );
          return r.rows.map((x) => ({ id: String(x.id), name: String(x.name), detail: [x.mobile, x.city].filter((v) => v !== null && v !== "").join(", ") }));
        }
        const r = await tx.query(
          "SELECT id, name, mobile_number, email FROM company_profiles WHERE deleted_at IS NULL AND ($1 = '' OR position($1 in lower(concat_ws(' ', name, mobile_number, email))) > 0) ORDER BY lower(name), id LIMIT 25",
          [word],
        );
        return r.rows.map((x) => ({ id: String(x.id), name: String(x.name), detail: [x.mobile_number, x.email].filter((v) => v !== null && v !== "").join(", ") }));
      });
    },
  };
}
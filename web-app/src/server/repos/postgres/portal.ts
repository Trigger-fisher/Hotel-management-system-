import "server-only";
// The portals' reads on PostgreSQL (repos/portal.ts; the in-memory double repos/memory/portal.ts is the reference). Values only through $n; the
// mobile is compared digits-only on both sides (regexp_replace), against the forms the service passes. A guest never gets a row with a company.
// Known gap: no functional index on the digits of the mobile columns yet, so the guest reads scan the bill/advance/stay tables (fine at one
// hotel's volume; a forward-only index migration can follow if EXPLAIN on real volume asks for it).
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type { PortalRepo, PortalRepos } from "../portal";
import type { Unit } from "../types";
import { advanceOf, billOf } from "./billing";
import { pgCompaniesRepos } from "./companies";
import { pgFrontOfficeRepos, reservationOf, stayOf } from "./frontOffice";
import { pgMenuRepo } from "./menu";
import { pgNotificationRepo } from "./notifications";
import { pgRoomServiceRepo } from "./roomService";
import { pgSupportRepo } from "./supportRequests";
import { numberSealer } from "./sealedNumbers";
import { createPgUnit } from "./unit";
import { pgWebsiteRepos } from "./website";

const DIGITS = (column: string): string => `regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g')`;

function pgPortal(tx: TxClient, hotelId: string): PortalRepo {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  const sealer = numberSealer(hotelId);
  return {
    async guestBills(forms, limit) {
      if (forms.length === 0) return [];
      const r = await q(`SELECT * FROM bill_master_bills WHERE deleted_at IS NULL AND company_id IS NULL AND ${DIGITS("mobile_number")} = ANY($1::text[]) ORDER BY bill_date DESC NULLS LAST, entry_no DESC LIMIT $2`, [forms, limit]);
      return r.rows.map(billOf);
    },
    async guestAdvances(forms, limit) {
      if (forms.length === 0) return [];
      const r = await q(`SELECT * FROM bill_master_advances WHERE deleted_at IS NULL AND company_id IS NULL AND ${DIGITS("mobile_number")} = ANY($1::text[]) ORDER BY payment_date DESC NULLS LAST, entry_no DESC LIMIT $2`, [forms, limit]);
      return r.rows.map(advanceOf);
    },
    async guestStays(forms, limit) {
      if (forms.length === 0) return [];
      const r = await q(`SELECT * FROM pms_stays WHERE company_id IS NULL AND ${DIGITS("mobile")} = ANY($1::text[]) ORDER BY check_in_at DESC, id DESC LIMIT $2`, [forms, limit]);
      return r.rows.map((row) => stayOf(row, sealer));
    },
    async companyReservations(companyId, limit) {
      const r = await q("SELECT * FROM pms_reservations WHERE company_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2", [companyId, limit]);
      return r.rows.map(reservationOf);
    },
  };
}

/** ONE withHotel transaction over the front office, companies (with billing), the website rooms and the portals' reads. */
export function createPgPortalUnit(withHotel: WithHotel): Unit<PortalRepos> {
  return createPgUnit(withHotel, (tx, hotelId) => ({ ...pgFrontOfficeRepos(tx, hotelId), ...pgCompaniesRepos(tx, hotelId), ...pgWebsiteRepos(tx), menuItems: pgMenuRepo(tx), portal: pgPortal(tx, hotelId), notifications: pgNotificationRepo(tx), roomService: pgRoomServiceRepo(tx), supportRequests: pgSupportRepo(tx) }) as PortalRepos);
}

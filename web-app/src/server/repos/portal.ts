import "server-only";
import type { AdminRepos } from "./admin";
import type { AdvanceRecord, BillRecord } from "./billing";
import type { CompaniesRepos } from "./companies";
import type { FrontOfficeRepos, ReservationRecord, StayRecord } from "./frontOffice";
import type { NotificationRepo } from "./notifications";
import type { RoomServiceRepo } from "./roomService";
import type { SupportRepo } from "./supportRequests";
import type { WebsiteRepos } from "./website";

// The guest and company PORTALS' own reads (HMS; Pallav's portal pages were previews on sample data, Support/PortalSample.php). A portal account sees only
// the records of the guest or company its account points at (recordScopeOf): a company's records are found by company_id; a guest's by their own mobile
// number (customers.mobile, unique), compared digits-only in its written forms ("9876543210", "+91 98765 43210", "09876543210"). Records billed to a company
// are the COMPANY's (its ledger, its portal) and never reach a guest portal, even when the guest's number is on them. No SQL here.

export interface PortalRepo {
  /** Live bills with NO company whose mobile number, digits only, is one of `mobiles`; newest bill date first, at most `limit`. */
  guestBills(mobiles: readonly string[], limit: number): Promise<BillRecord[]>;
  /** Live advances with NO company whose mobile number, digits only, is one of `mobiles`; newest payment first, at most `limit`. */
  guestAdvances(mobiles: readonly string[], limit: number): Promise<AdvanceRecord[]>;
  /** Stays with NO company whose mobile, digits only, is one of `mobiles`; newest check-in first, at most `limit`. */
  guestStays(mobiles: readonly string[], limit: number): Promise<StayRecord[]>;
  /** One company's reservations (pms_reservations.company_id), newest first, at most `limit`. */
  companyReservations(companyId: string, limit: number): Promise<ReservationRecord[]>;
}

/** What a portal service gets inside ONE unit of the hotel's database. */
export interface PortalRepos extends FrontOfficeRepos, CompaniesRepos, Pick<WebsiteRepos, "siteRooms" | "sitePlans" | "siteSettings">, Pick<AdminRepos, "menuItems"> {
  portal: PortalRepo;
  /** The company portal reads its own notifications through this (repos/notifications.ts; the staff side shares the repository). */
  notifications: NotificationRepo;
  /** Room-service orders with a status (repos/roomService.ts): the guest places and may cancel, the front desk moves them along. */
  roomService: RoomServiceRepo;
  /** Customer support requests (repos/supportRequests.ts): the guest writes, the front desk replies. */
  supportRequests: SupportRepo;
}

/**
 * The written forms of one mobile number that count as the same number, digits only: the 10-digit Indian number, with 91 in front and with 0 in front.
 * A number of other lengths matches only itself; fewer than 10 digits matches nothing (a short number could equal part of someone else's).
 */
export function mobileForms(mobile: string | null | undefined): string[] {
  const digits = (mobile ?? "").replace(/\D/g, "");
  if (digits.length < 10) return [];
  const core = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return core.length === 10 ? [core, `91${core}`, `0${core}`] : [core];
}

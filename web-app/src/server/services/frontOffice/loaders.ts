import "server-only";
import type { FrontOfficeRepos, ReservationRecord, StayRecord } from "../../repos/frontOffice";
import { companyIds, typeMap, type FrontOfficeDeps } from "./context";
import type { ReservationDtoContext, StayDtoContext } from "./dto";
import { maskNumber } from "../../crypto/fieldSeal";

// The data a page of reservations or stays needs for its DTOs, loaded in a FIXED number of repository calls whatever the page size (no N+1).

export async function loadReservationContext(repos: FrontOfficeRepos, rows: readonly ReservationRecord[]): Promise<ReservationDtoContext> {
  const ids = rows.map((r) => r.id);
  const stays = await repos.stays.byReservation(ids);
  const roomIds = [...new Set([...stays.values()].flat().map((s) => s.roomId))];
  const rooms = await repos.rooms.all();
  const enquiries = await repos.enquiries.getMany([...new Set(rows.flatMap((r) => (r.siteEnquiryId ? [r.siteEnquiryId] : [])))]);
  const enquiryRefs = new Map([...enquiries].map(([id, e]) => [id, e.reference]));
  return {
    types: await typeMap(repos),
    companies: await repos.companies.names(companyIds(rows)),
    advances: await repos.advances.byReservation(ids),
    stays,
    roomNumbers: new Map(rooms.filter((r) => roomIds.includes(r.id)).map((r) => [r.id, r.number])),
    enquiryRefs,
  };
}

/** A function giving each stay its DTO context. */
export async function loadStayContext(repos: FrontOfficeRepos, deps: Pick<FrontOfficeDeps, "now">, rows: readonly StayRecord[]): Promise<(s: StayRecord) => StayDtoContext> {
  const rooms = new Map((await repos.rooms.all()).map((r) => [r.id, r]));
  const types = await typeMap(repos);
  const companies = await repos.companies.names(companyIds(rows));
  const charges = await repos.charges.forStays(rows.map((s) => s.id));
  const reservationIds = [...new Set(rows.flatMap((s) => (s.reservationId ? [s.reservationId] : [])))];
  const references = new Map([...(await repos.reservations.getMany(reservationIds))].map(([id, r]) => [id, r.reference]));
  const advances = await repos.advances.byReservation(reservationIds);
  const bills = await repos.bills.getMany([...new Set(rows.flatMap((s) => (s.billId ? [s.billId] : [])))]);
  const now = deps.now();
  return (s) => ({
    room: rooms.get(s.roomId),
    types,
    companies,
    charges: charges.get(s.id) ?? [],
    reservationRef: s.reservationId ? (references.get(s.reservationId) ?? null) : null,
    advancePaise: (s.reservationId ? (advances.get(s.reservationId) ?? []) : []).reduce((t, a) => t + a.hotelBalancePaise + a.foodBalancePaise, BigInt(0)),
    bill: s.billId ? (bills.get(s.billId) ?? null) : null,
    // decision 74: the screens get the last 4 only; the whole number is the audited Show (StayService.revealIdNumbers)
    idNumber: maskNumber(s.idProofNumber),
    idMasked: Boolean(s.idProofNumber),
    now,
  });
}

import "server-only";
import type { WebEnquiry, WebRatePlan, WebRoom, WebRoomPhoto } from "@shared/dashboards/website";
import { paiseToNumber } from "../../money/paise";
import type { SitePlanRecord, SiteEnquiryRecord, SiteRoomRecord } from "../../repos/website";
import { guestsLabel } from "./rules";

// Records → the apps' shapes (ui-shared website.ts). Spec: docs/specs/website.md.

const n = paiseToNumber;
export { guestsLabel };

/** An enquiry. Pallav keeps `guests` as the TOTAL (adults and children); the apps' `guests` is the adults. "new" reads as pending. */
export function enquiryDto(e: SiteEnquiryRecord, roomName: string | null): WebEnquiry {
  const children = e.children ?? 0;
  return {
    id: e.id,
    reference: e.reference,
    name: e.name,
    phone: e.phone ?? "",
    email: e.email,
    roomId: e.roomId,
    roomName,
    checkIn: e.checkIn ?? "",
    checkOut: e.checkOut ?? "",
    guests: Math.max(0, (e.guests ?? 0) - children),
    children,
    message: e.message ?? "",
    status: e.status === "new" ? "pending" : e.status,
    createdAt: e.createdAt.toISOString(),
    ipAddress: e.ipAddress,
    decidedAt: e.decidedAt?.toISOString() ?? null,
    decidedByName: e.decidedByName,
    decisionNote: e.decisionNote,
  };
}

export const photoDto = (p: { path: string; name: string | null; alt: string | null }): WebRoomPhoto => ({ id: p.path, name: p.name ?? p.path, alt: p.alt ?? "" });

export function roomDto(r: SiteRoomRecord, x: { freeToday: number; plansCount: number }): WebRoom {
  return {
    id: r.id,
    name: r.name,
    bedType: r.bedType ?? "",
    size: r.size ?? "",
    maxGuests: r.maxGuests,
    totalCount: r.totalCount,
    badgeLabel: r.badgeLabel ?? "",
    note: r.note ?? "",
    showPrice: r.showPrice,
    available: r.available,
    photos: r.photos.map(photoDto),
    freeToday: x.freeToday,
    plansCount: x.plansCount,
  };
}

export const planDto = (p: SitePlanRecord): WebRatePlan => ({
  id: p.id,
  roomId: p.roomId,
  name: p.name,
  code: p.code,
  tiers: p.tiers.map((t) => ({ guests: t.guests, pricePaise: n(t.pricePaise) })),
  extraPersonPaise: p.extraPersonPaise === null ? null : n(p.extraPersonPaise),
  active: p.active,
});

import "server-only";
import { AppError } from "./AppError";

// Decision 47 (MJ, 12 Oct 2026): a portal account (guest, company) that has no record behind it, or whose record the hotel switched off, gets a clear 409 with a
// plain sentence and the portal kind in `details.fields.portal`, never a bare "Not allowed". Real permission failures (a staff account on a portal route, the other
// portal's account) stay 403.
export type PortalKind = "guest" | "company";

const WHAT: Record<PortalKind, string> = { guest: "a guest profile", company: "a company profile" };
const OWN: Record<PortalKind, string> = { guest: "guest profile", company: "company profile" };

export const portalNotLinked = (kind: PortalKind): AppError =>
  new AppError("PORTAL_NOT_LINKED", `Your account is not linked to ${WHAT[kind]} yet. Please ask the hotel front desk to link it.`, { fields: { portal: kind } });

export const portalInactive = (kind: PortalKind): AppError =>
  new AppError("PORTAL_INACTIVE", `Your ${OWN[kind]} is switched off at the hotel, so this page cannot open. Please ask the hotel front desk.`, { fields: { portal: kind } });
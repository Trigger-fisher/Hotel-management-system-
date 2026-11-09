import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createMemoryPortalHotel } from "../repos/memory/portal";
import { createPgPortalUnit } from "../repos/postgres/portal";
import { createSupportDesk, type SupportDesk } from "../services/support/deskService";
import { billingDefaults } from "./billing";

// The composition root of the hotel's customer-support desk (Front Office > Guest messages): the portal unit, the people directory and the permission catalog.
let desk: SupportDesk | null = null;

function build(): SupportDesk {
  const { people, catalog, now } = billingDefaults();
  const unit = getConfig().DATABASE_URL ? createPgPortalUnit(getDatabase().withHotel) : createMemoryPortalHotel().unit;
  return createSupportDesk({ unit, people, catalog, now });
}

export const getSupportDesk = (): SupportDesk => (desk ??= build());

/** Replaces the desk (start-up code and tests). */
export function configureSupportDesk(next: SupportDesk | null): void {
  desk = next;
}
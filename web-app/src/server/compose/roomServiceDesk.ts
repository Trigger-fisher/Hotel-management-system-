import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createMemoryPortalHotel } from "../repos/memory/portal";
import { createPgPortalUnit } from "../repos/postgres/portal";
import { createRoomServiceDesk, type RoomServiceDesk } from "../services/roomService/deskService";
import { billingDefaults } from "./billing";

// The composition root of the hotel's room-service desk (Front Office > Room service orders): the portal unit (the stays, charges and orders of the hotel, PostgreSQL when
// DATABASE_URL is set, the in-memory double otherwise), the people directory and the permission catalog.
let desk: RoomServiceDesk | null = null;

function build(): RoomServiceDesk {
  const { people, catalog, now } = billingDefaults();
  const unit = getConfig().DATABASE_URL ? createPgPortalUnit(getDatabase().withHotel) : createMemoryPortalHotel().unit;
  return createRoomServiceDesk({ unit, people, catalog, now });
}

export const getRoomServiceDesk = (): RoomServiceDesk => (desk ??= build());

/** Replaces the desk (start-up code and tests). */
export function configureRoomServiceDesk(next: RoomServiceDesk | null): void {
  desk = next;
}

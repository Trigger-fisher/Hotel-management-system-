import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createPgMoveStore } from "../repos/postgres/whatsappMove";
import { createMoveService, type MoveService } from "../services/whatsapp/moveService";
import { createMemoryMoveStore } from "../whatsapp/move";
import { getPlatformConsoleUnit } from "./platform";

// The composition of a hotel's move to its own number (Console > WhatsApp numbers): the store on the shared pool, and the count of approved messages the hotel has on its own number read from the
// hotel's own schema (a read-only look). The in-memory double without a database. Built on first use.
let service: MoveService | undefined;

export function getWhatsAppMove(): MoveService {
  if (service) return service;
  const c = getConfig();
  const live = Boolean(c.DATABASE_URL && c.HMS_HASH_KEY);
  service = createMoveService({
    unit: getPlatformConsoleUnit(),
    store: live ? createPgMoveStore(getDatabase().pool) : createMemoryMoveStore(),
    now: () => new Date(),
    approvedMessages: async (hotelId, lineId) => {
      if (!live) return 0;
      const r = await getDatabase().withHotel({ hotelId, readOnly: true }, (tx) => tx.query("SELECT count(*)::int AS n FROM wa_templates WHERE status = 'approved' AND line_id = $1", [lineId]));
      return Number(r.rows[0]?.n ?? 0);
    },
  });
  return service;
}

/** Replaces the service (start-up code and tests). */
export function configureWhatsAppMove(next: MoveService | null): void {
  service = next ?? undefined;
}

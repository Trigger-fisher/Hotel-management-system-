import "server-only";
import { getDatabase } from "../../db";
import { createPgWhatsAppEventStore, createPgWhatsAppLineStore } from "../repos/postgres/whatsapp";
import { whatsappConfig } from "../whatsapp/config";
import { createWhatsAppIntake, type WhatsAppIntake } from "../whatsapp/intake";
import type { WaEventStore, WaLineStore } from "../whatsapp/ports";

// The composition of WhatsApp (docs/plans/WHATSAPP-MASTER-PLAN.md): the stores on the shared pool and the intake Meta calls. Built on first use, so the build and the tests need no database.
// WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN and HMS_HASH_KEY must all be set or WhatsApp is off (the webhook answers 404).
let stores: { lines: WaLineStore; events: WaEventStore } | undefined;
let intake: WhatsAppIntake | undefined;

export function getWhatsAppStores(): { lines: WaLineStore; events: WaEventStore } {
  const pool = getDatabase().pool;
  stores ??= { lines: createPgWhatsAppLineStore(pool), events: createPgWhatsAppEventStore(pool) };
  return stores;
}

export function getWhatsAppIntake(): WhatsAppIntake {
  const s = getWhatsAppStores();
  // the processor is loaded on the first wake-up only (it pulls in the hotel and platform repositories), so a cold start of the webhook stays small
  intake ??= createWhatsAppIntake({ config: () => whatsappConfig(), lines: s.lines, events: s.events, wake: () => void import("./whatsappProcessor").then((m) => m.wakeWhatsAppProcessor()) });
  return intake;
}

import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createPgLineHotelsStore } from "../repos/postgres/whatsappLineHotels";
import { createLineHotelsService, type LineHotelsService } from "../services/whatsapp/lineHotelsService";
import { createMemoryLineHotelsStore } from "../whatsapp/lineHotels";
import { getPlatformConsoleUnit } from "./platform";

// The composition of "hotels on the shared number" (Console > WhatsApp numbers): the lines store on the shared pool (the in-memory double without a database). Built on first use.
let service: LineHotelsService | undefined;

export function getWhatsAppLineHotels(): LineHotelsService {
  const c = getConfig();
  service ??= createLineHotelsService({ unit: getPlatformConsoleUnit(), store: c.DATABASE_URL && c.HMS_HASH_KEY ? createPgLineHotelsStore(getDatabase().pool) : createMemoryLineHotelsStore(), now: () => new Date() });
  return service;
}

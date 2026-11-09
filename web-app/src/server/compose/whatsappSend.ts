import "server-only";
import { getDatabase } from "../../db";
import { liveSendStore } from "../live/liveStores";
import { createPgWhatsAppSendStore } from "../repos/postgres/whatsappSend";
import { whatsappConfig } from "../whatsapp/config";
import { createGraphClient } from "../whatsapp/graph";
import { createSender } from "../whatsapp/send";
import { openToken } from "../whatsapp/seal";
import { publishConvChanges } from "./convLive";

// The composition of the WhatsApp sender (plan part 12): the send pipeline on the PostgreSQL store, the real Graph client and the server's sealing key. Built on first use. Returns null when
// WhatsApp is not configured (WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN and HMS_HASH_KEY), so a caller answers "off" instead of throwing.
type Sender = ReturnType<typeof createSender>;
let sender: Sender | null | undefined;

export function getWhatsAppSender(): Sender | null {
  if (sender !== undefined) return sender;
  const config = whatsappConfig();
  if (config === null) return null; // not cached: the settings may be completed later
  const db = getDatabase();
  const store = liveSendStore(createPgWhatsAppSendStore({ pool: db.pool, withHotel: db.withHotel, hashKey: config.hashKey }), publishConvChanges);
  const graph = createGraphClient({ graphVersion: config.graphVersion });
  sender = createSender({ store, graph, openToken: (sealed, phoneNumberId) => openToken(config.sealKey, sealed, phoneNumberId) });
  return sender;
}

import "server-only";
import { WHATSAPP_NOT_CONNECTED, type WhatsAppAutomaticKey, type WhatsAppReplyInput, type WhatsAppSettings, type WhatsAppTemplate } from "@shared/dashboards/whatsapp";
import type { ChannelAdapter, InboundEntry } from "./channel";

// The WhatsApp channel of Conversations: DESIGN ONLY for now (decision 66, A7; MJ, 24 Oct 2026). The screens are complete on sample data; on the live site there is no adapter,
// so every WhatsApp answer is "not connected yet" and every WhatsApp write a 409. When the Meta integration is built, it adds ONE implementation of this interface (the Cloud API
// sender, the template list, the automatic-message switches) and a webhook route that hands Meta's events to `ingestWebhook`; the hub stores them through the same ingest as
// email (conv_messages already has every WhatsApp column) and no screen changes. A platform table "phone_number_id -> owner" may come with it.

export { windowOf } from "@shared/dashboards/whatsapp";

/** A connected number (the hotel's or the platform's); the token is kept sealed by the adapter, never here. */
export interface WhatsAppAccount {
  owner: { kind: "hotel"; hotelId: string } | { kind: "platform" };
  phoneNumberId: string;
}

export interface WhatsAppOutgoing {
  conversationId: string;
  to: string;
  reply: WhatsAppReplyInput;
}

export interface WhatsAppChannel extends ChannelAdapter<WhatsAppAccount, WhatsAppOutgoing, { externalId: string; status: "pending" | "sent" }> {
  state(account: WhatsAppAccount | null): Promise<WhatsAppSettings>;
  /** Meta's webhook payload (already signature-checked by the route) as hub entries and status updates. */
  ingestWebhook(account: WhatsAppAccount, payload: unknown): Promise<{ entries: InboundEntry[]; statuses: { externalId: string; status: "sent" | "delivered" | "read" | "failed"; failure?: string }[] }>;
  templates(account: WhatsAppAccount): Promise<WhatsAppTemplate[]>;
  setAutomatic(account: WhatsAppAccount, key: WhatsAppAutomaticKey, on: boolean): Promise<WhatsAppSettings>;
}

/** No adapter yet: the Meta integration sets this. */
export const whatsappChannel: WhatsAppChannel | null = null;

/** What the screens are told about WhatsApp on the live site. */
export const whatsappStateOf = async (): Promise<WhatsAppSettings> => WHATSAPP_NOT_CONNECTED;

/** The sentence of a WhatsApp write before the integration exists (409). */
export const WHATSAPP_NOT_CONNECTED_TEXT = "WhatsApp is not connected yet.";

import "server-only";
// Sealing for WhatsApp values (AES-256-GCM, crypto/secretBox.ts). Each kind of value is bound to the thing it belongs to through the cipher's context, so a token copied
// into another line's row, or a held message copied into another hold, does not open. Nothing here logs, and an unreadable value says only that it could not be opened.
import { open, seal } from "../crypto/secretBox";

const context = (kind: "token" | "pin" | "event" | "hold", scope: string): string => `whatsapp:${kind}:${scope}`;

/** The line's access token, bound to its Meta phone number id. */
export const sealToken = (key: Buffer, token: string, phoneNumberId: string): string => seal(key, token, context("token", phoneNumberId));
export const openToken = (key: Buffer, sealed: string, phoneNumberId: string): string => open(key, sealed, context("token", phoneNumberId));

/** The two-step verification PIN of a registered number. */
export const sealPin = (key: Buffer, pin: string, phoneNumberId: string): string => seal(key, pin, context("pin", phoneNumberId));
export const openPin = (key: Buffer, sealed: string, phoneNumberId: string): string => open(key, sealed, context("pin", phoneNumberId));

/** A saved webhook event (one change of Meta's call), bound to its line. */
export const sealEvent = (key: Buffer, value: unknown, lineId: string): string => seal(key, JSON.stringify(value), context("event", lineId));
export const openEvent = (key: Buffer, sealed: string, lineId: string): unknown => JSON.parse(open(key, sealed, context("event", lineId))) as unknown;

/** A guest message held while "which hotel?" is asked, bound to its line. */
export const sealHold = (key: Buffer, value: unknown, lineId: string): string => seal(key, JSON.stringify(value), context("hold", lineId));
export const openHold = (key: Buffer, sealed: string, lineId: string): unknown => JSON.parse(open(key, sealed, context("hold", lineId))) as unknown;

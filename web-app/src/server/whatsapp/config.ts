import "server-only";
// WhatsApp's server settings (MJ, 4 Nov 2026; docs/plans/WHATSAPP-MASTER-PLAN.md part 28.1). Read from the environment, never from a screen:
//   WHATSAPP_APP_SECRET    the Meta app's secret; every webhook call must carry an HMAC of its raw body made with it (X-Hub-Signature-256)
//   WHATSAPP_VERIFY_TOKEN  the word Meta sends when the webhook address is first registered (hub.verify_token); any long random text
//   WHATSAPP_SEAL_KEY      OPTIONAL base64 of 32 bytes that seals the line tokens, held messages and saved events. Without it the key is DERIVED from HMS_HASH_KEY (HKDF, info "hms-whatsapp-v1"),
//                          so there is nothing extra to set up (MJ's rule for the mail key). A value sealed under another key does not open: the line shows "needs reconnect".
//   WHATSAPP_GRAPH_VERSION the Graph API version in one place (default below; Meta retires versions, check it at build time, plan part 27.9)
// Anything missing means WhatsApp is OFF: the webhook answers 404 and nothing is sent. The settings key whatsapp.enabled (the kill switch, off by default) is read separately, by the services.
import { createHmac, hkdfSync } from "node:crypto";
import { parseHashKey } from "../crypto/hash";
import { parseSecretKey } from "../crypto/secretBox";

export const WHATSAPP_SEAL_INFO = "hms-whatsapp-v1";
/** The Graph API version used in every call (verify against Meta's current documentation at build time). */
export const DEFAULT_GRAPH_VERSION = "v22.0";

export interface WhatsAppConfig {
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly sealKey: Buffer;
  readonly hashKey: Buffer;
  readonly graphVersion: string;
}

export function deriveSealKey(hashKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", hashKey, Buffer.alloc(0), WHATSAPP_SEAL_INFO, 32));
}

/** The settings, or null when WhatsApp is not set up (an app secret, a verify token and the server's hash key are all needed). Never throws and never echoes a value. */
export function whatsappConfig(env: Record<string, string | undefined> = process.env): WhatsAppConfig | null {
  const appSecret = (env.WHATSAPP_APP_SECRET ?? "").trim();
  const verifyToken = (env.WHATSAPP_VERIFY_TOKEN ?? "").trim();
  const hash = (env.HMS_HASH_KEY ?? "").trim();
  if (appSecret === "" || verifyToken === "" || hash === "") return null;
  try {
    const hashKey = parseHashKey(hash);
    const override = (env.WHATSAPP_SEAL_KEY ?? "").trim();
    const sealKey = override !== "" ? parseSecretKey(override) : deriveSealKey(hashKey);
    const version = (env.WHATSAPP_GRAPH_VERSION ?? "").trim();
    return { appSecret, verifyToken, sealKey, hashKey, graphVersion: /^v\d{1,2}\.\d$/.test(version) ? version : DEFAULT_GRAPH_VERSION };
  } catch {
    return null;
  }
}

/** What the Super Admin screen may say about the settings: present or missing, never a value (plan 28.1). */
export function whatsappConfigStatus(env: Record<string, string | undefined> = process.env): { appSecret: boolean; verifyToken: boolean; sealKey: boolean; graphVersion: string } {
  const set = (name: string): boolean => (env[name] ?? "").trim() !== "";
  const cfg = whatsappConfig(env);
  return { appSecret: set("WHATSAPP_APP_SECRET"), verifyToken: set("WHATSAPP_VERIFY_TOKEN"), sealKey: cfg !== null, graphVersion: cfg?.graphVersion ?? DEFAULT_GRAPH_VERSION };
}

/** A guest's number as digits only, country code kept: "+91 98250-41236" is "919825041236". Null if it cannot be a number (8 to 15 digits). */
export function digitsOf(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return /^[0-9]{8,15}$/.test(digits) ? digits : null;
}

/** The keyed hash of a number used in routing tables (a hold, a suppression): the number itself never sits in a shared table. 32 bytes. */
export function hashNumber(hashKey: Buffer, digits: string): Buffer {
  return createHmac("sha256", hashKey).update(`whatsapp-number:${digits}`, "utf8").digest();
}

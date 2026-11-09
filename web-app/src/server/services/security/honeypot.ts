import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Decoy routes and canary tokens (plan section 8). No real user ever calls a decoy route, so any hit is Critical. A canary is a unique address on OUR OWN server (no third party, nothing
// installed on anyone's device): the decoy file carries it, and the first time anyone opens it the server alerts. Tracking only, by design.

export { isHoneypotPath, TRAP_PATH_HEADER, TRAP_ROUTE } from "../../../lib/honeypotPaths";

export const CANARY_ROUTE_PREFIX = "/api/v1/public/security/canary/";
const CANARY_SHAPE = /^[a-z0-9]{1,24}-[0-9a-f]{32}$/;

const mac = (key: Buffer, label: string): string => createHmac("sha256", key).update(`canary\0${label}`).digest("hex").slice(0, 32);

/** `<label>-<mac>`: the label says where the decoy was planted (e.g. "driveexport"), the mac proves WE made it, so a guessed address records nothing. */
export const canaryToken = (key: Buffer, label: string): string => `${label}-${mac(key, label)}`;

/** The label of a token we made, else null. */
export function verifyCanary(key: Buffer, token: string): string | null {
  if (!CANARY_SHAPE.test(token)) return null;
  const at = token.lastIndexOf("-");
  const label = token.slice(0, at);
  const given = Buffer.from(token.slice(at + 1));
  const want = Buffer.from(mac(key, label));
  return given.length === want.length && timingSafeEqual(given, want) ? label : null;
}

export const canaryUrl = (publicUrl: string, token: string): string => `${publicUrl.replace(/\/+$/, "")}${CANARY_ROUTE_PREFIX}${token}`;

/** A fake guest list (obviously invented people and numbers) whose "photo link" column is the canary address. Opening that link, or a script fetching every link, raises the alert. */
export function decoyGuestCsv(url: string): string {
  const rows = [
    ["booking_ref", "guest_name", "phone", "id_proof_no", "id_photo_link"],
    ["DEC-0001", "Test Decoy One", "+910000000001", "XXXX-DECOY-0001", url],
    ["DEC-0002", "Test Decoy Two", "+910000000002", "XXXX-DECOY-0002", url],
    ["DEC-0003", "Test Decoy Three", "+910000000003", "XXXX-DECOY-0003", url],
  ];
  return `${rows.map((r) => r.join(",")).join("\n")}\n`;
}

// ---- honeytokens: a fake API key that looks exactly like ours ----
// Same shape as a real key (`hms_pat_` + 43 characters), made from our own server key, so nobody can tell it apart, and nobody can make it without the server key. It is not in the key table,
// so it never works; the moment someone TRIES it, the sign-in layer says so (Critical). It is planted in the fake .env that /.env serves and in the decoy file.
export const HONEY_KEY_LABELS = ["dotenv", "decoyfile"] as const;
export type HoneyKeyLabel = (typeof HONEY_KEY_LABELS)[number];

export const honeyApiKey = (key: Buffer, label: HoneyKeyLabel): string => `hms_pat_${createHmac("sha256", key).update(`honey-api-key\0${label}`).digest("base64url")}`;

/** Which honeytoken a presented key is, else null (constant-time compare). */
export function honeyKeyLabel(key: Buffer, presented: string): HoneyKeyLabel | null {
  const given = Buffer.from(presented);
  for (const label of HONEY_KEY_LABELS) {
    const want = Buffer.from(honeyApiKey(key, label));
    if (given.length === want.length && timingSafeEqual(given, want)) return label;
  }
  return null;
}

/** The fake .env that /.env serves: invented values only, the honey API key, and a canary address as the "backup report" link. Nothing in it works. */
export function fakeEnvFile(key: Buffer, publicUrl: string | undefined): string {
  const filler = createHmac("sha256", key).update("honey-env\0password").digest("hex").slice(0, 24);
  const lines = [
    "# production",
    "NODE_ENV=production",
    `DATABASE_URL=postgres://hms_app:${filler}@db.internal.invalid:5432/hms`,
    `HMS_API_KEY=${honeyApiKey(key, "dotenv")}`,
  ];
  if (publicUrl) lines.push(`BACKUP_REPORT_URL=${canaryUrl(publicUrl, canaryToken(key, "dotenv"))}`);
  return `${lines.join("\n")}\n`;
}

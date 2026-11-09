import "server-only";
import { randomBytes, createHmac } from "node:crypto";
import { hmacHex, safeEqualHex, sha256Hex } from "../crypto/hash";

// Session tokens, the cookie, the signed "challenge" the code screens carry, and the signed token for choosing a new password.
// Nothing here is stored except a SHA-256 of a session token: a challenge and a change token are signed statelessly (HMAC under HMS_HASH_KEY).

/** 256 random bits, base64url: the value of the session cookie. Only its SHA-256 is stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
export const hashSessionToken = (token: string): string => sha256Hex(token);
export const SESSION_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** `__Host-` pins the cookie to this exact host over HTTPS with Path=/ and no Domain; HttpOnly keeps scripts away; SameSite=Lax is the CSRF floor. */
export const SESSION_COOKIE = "__Host-hms_session";
const COOKIE_FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax";

export const sessionCookie = (token: string): string => `${SESSION_COOKIE}=${token}; ${COOKIE_FLAGS}`;
export const clearedSessionCookie = (): string => `${SESSION_COOKIE}=; ${COOKIE_FLAGS}; Max-Age=0`;

/**
 * Sign-out without waiting (lib/auth/signOut.ts): the browser sets this cookie itself the moment the person signs out, shows the sign-in page at once and sends the
 * sign-out request in the background. Whatever request reaches the server next with the session cookie AND this mark ends that session (services/auth/sessionResolver.ts),
 * so a sign-out whose own request never arrived (offline, the tab closed) still ends it. A new session clears the mark (newSessionHeaders), so it never touches a later
 * sign-in. Not HttpOnly (the page sets it); it carries no secret, only "signed out".
 */
export const SIGNED_OUT_COOKIE = "__Host-hms_out";
export const clearedSignedOutCookie = (): string => `${SIGNED_OUT_COOKIE}=; Path=/; Secure; SameSite=Lax; Max-Age=0`;
export const hasSignedOutMark = (request: Request): boolean => readCookie(request, SIGNED_OUT_COOKIE) !== null;

/** The cookies of a NEW web session: the session itself, and the sign-out mark of an earlier one cleared. */
export const newSessionHeaders = (token: string): (readonly [string, string])[] => [["set-cookie", sessionCookie(token)], ["set-cookie", clearedSignedOutCookie()]];

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// ---- challenges: what the emailed-code screens hold ----
export interface DeviceBlob {
  platform: "web";
  name: string;
}

const sign = (key: Buffer, codeId: string, blob: string): string => hmacHex(key, "challenge", [codeId, blob]);

/** A sign-in challenge carries the device too (the verify call has only the code): `<codeId>.<device>.<signature>`. */
export function loginChallenge(key: Buffer, codeId: string, device: DeviceBlob): string {
  const blob = Buffer.from(JSON.stringify(device), "utf8").toString("base64url");
  return `${codeId}.${blob}.${sign(key, codeId, blob)}`;
}

/** A reset challenge is `<codeId>.<signature>`; a DUMMY one (for a username that does not exist) has exactly the same shape. */
export function resetChallenge(key: Buffer, codeId: string): string {
  return `${codeId}.${sign(key, codeId, "")}`;
}

/** A stateless dummy for an unknown username: a UUID-shaped id derived from the username and a valid-looking signature. No row stands behind it. */
export function dummyResetChallenge(key: Buffer, username: string): string {
  const h = hmacHex(key, "challenge-dummy", [username]);
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return resetChallenge(key, id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface ParsedChallenge {
  codeId: string;
  device: DeviceBlob | null;
}

/** The code id (and device) a challenge names, or null when it was not made by this server (bad shape or signature). */
export function parseChallenge(key: Buffer, challenge: string, kind: "login" | "reset"): ParsedChallenge | null {
  if (challenge.length > 600) return null;
  const parts = challenge.split(".");
  const expected = kind === "login" ? 3 : 2;
  if (parts.length !== expected || !UUID.test(parts[0])) return null;
  const blob = kind === "login" ? parts[1] : "";
  const signature = parts[parts.length - 1];
  if (!/^[0-9a-f]{64}$/.test(signature) || !safeEqualHex(signature, sign(key, parts[0], blob))) return null;
  if (kind === "reset") return { codeId: parts[0], device: null };
  try {
    const device = JSON.parse(Buffer.from(blob, "base64url").toString("utf8")) as DeviceBlob;
    return { codeId: parts[0], device };
  } catch {
    return null;
  }
}

// ---- the token for choosing a new password (a temporary password, or a reset whose code was right) ----
const fingerprint = (passwordHash: string): string => sha256Hex(passwordHash).slice(0, 16);

/** `<userId>.<expires epoch seconds>.<why>.<signature>`: stops working when it expires or the password changes (the signature holds a fingerprint of the hash). */
export function issueChangeToken(key: Buffer, args: { userId: string; passwordHash: string; why: "first" | "reset"; expiresAt: Date }): string {
  const exp = String(Math.floor(args.expiresAt.getTime() / 1000));
  const sig = createHmac("sha256", key).update(["change", args.userId, exp, args.why, fingerprint(args.passwordHash)].join("|")).digest("hex");
  return `${args.userId}.${exp}.${args.why}.${sig}`;
}

export function userOfChangeToken(token: string): string | null {
  const id = token.split(".")[0];
  return UUID.test(id) ? id : null;
}

export function verifyChangeToken(key: Buffer, token: string, passwordHash: string, now: Date): { userId: string; why: "first" | "reset" } | null {
  const parts = token.split(".");
  if (parts.length !== 4 || !UUID.test(parts[0]) || !/^\d{1,12}$/.test(parts[1]) || (parts[2] !== "first" && parts[2] !== "reset") || !/^[0-9a-f]{64}$/.test(parts[3])) return null;
  if (Number(parts[1]) * 1000 < now.getTime()) return null;
  const want = createHmac("sha256", key).update(["change", parts[0], parts[1], parts[2], fingerprint(passwordHash)].join("|")).digest("hex");
  return safeEqualHex(parts[3], want) ? { userId: parts[0], why: parts[2] } : null;
}

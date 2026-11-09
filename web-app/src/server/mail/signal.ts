import "server-only";
// The "new mail" ping (MJ, 3 Nov 2026: live updates like Gmail without a server that holds connections open). When mail lands, the server sends ONE tiny message with no content
// to a Supabase Realtime channel; the open pages listening on that channel then ask the normal, checked routes for what is new. The ping carries no subject, no name, no address:
// a person who learned a channel name could only make a page ask again. The channel name is a keyed hash (HMS_HASH_KEY) of who the mail is for, so it cannot be worked out.
// Off until MAIL_SIGNAL_URL (https://<project>.supabase.co) and MAIL_SIGNAL_KEY (the project's public anon/publishable key) are set; then nothing here ever throws or slows a delivery
// beyond a short, capped wait, and the pages keep their own timed checks as the safety net.
import { createHmac } from "node:crypto";
import type { VerifiedSession } from "../auth/session";

export type SignalKind = "hotel" | "platform" | "person" | "group";

export interface SignalConfig {
  readonly url: string;
  readonly key: string;
  readonly secret: string;
}

/** The settings, or null when the ping is not set up (a plain https address, a key and the hash key are all needed). */
export function signalConfig(env: Record<string, string | undefined> = process.env): SignalConfig | null {
  const url = (env.MAIL_SIGNAL_URL ?? "").trim().replace(/\/+$/, "");
  const key = (env.MAIL_SIGNAL_KEY ?? "").trim();
  const secret = (env.HMS_HASH_KEY ?? "").trim();
  if (!/^https:\/\/[^/\s?#]+$/.test(url) || key === "" || secret === "") return null;
  return { url, key, secret };
}

/** The channel for mail meant for a hotel, the platform desks or one person: "m" and 24 characters of a keyed hash, never the id itself. */
export function signalChannel(kind: SignalKind, id: string, secret: string): string {
  return `m${createHmac("sha256", secret).update(`mail-signal:${kind}:${id}`).digest("base64url").slice(0, 24)}`;
}

/**
 * The channels a signed-in person listens on: their own mailbox (any staff login), their hotel's Conversations (staff in their own hotel, never a visitor), the platform desks
 * (platform staff) and their group's inbox (its Group Admin, when the caller found the group).
 */
export function channelsForSession(session: Pick<VerifiedSession, "userId" | "hotelId" | "accountRole" | "visit" | "client">, secret: string, groupId: string | null = null): string[] {
  if (session.client !== "web") return [];
  const role = session.accountRole;
  if (role === "guest_user" || role === "corporate_user") return [];
  const out = [signalChannel("person", session.userId, secret)];
  if (role === "platform_admin" || role === "super_admin") out.push(signalChannel("platform", "desks", secret));
  else if ((role === "hotel_admin" || role === "hotel_user") && !session.visit && session.hotelId) out.push(signalChannel("hotel", session.hotelId, secret));
  else if (role === "group_hotel_admin" && !session.visit && groupId) out.push(signalChannel("group", groupId, secret));
  return out;
}

/** Tell the pages listening for this mail that something new arrived. Never throws; waits at most 1.5 seconds. */
export async function sendMailSignal(kind: SignalKind, id: string, env: Record<string, string | undefined> = process.env, fetchFn: typeof fetch = fetch): Promise<void> {
  const cfg = signalConfig(env);
  if (!cfg) return;
  try {
    await fetchFn(`${cfg.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: cfg.key, authorization: `Bearer ${cfg.key}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: signalChannel(kind, id, cfg.secret), event: "ping", payload: {}, private: false }] }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // the ping is a convenience: the pages still check on their own timer
  }
}

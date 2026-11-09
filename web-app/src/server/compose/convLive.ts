import "server-only";
import { after } from "next/server";
import { getDatabase, listenOn } from "../../db";
import type { VerifiedSession } from "../auth/session";
import { getConfig } from "../config/env";
import { AppError } from "../errors";
import { boxesForSession, createConvLive, NOTIFY_CHANNEL, PLATFORM_BOX, type ConvChange, type ConvLive, type LiveBox } from "../live/convLive";
import { liveRunner, liveUnit } from "../live/liveUnit";
import { sendMailSignal, signalConfig } from "../mail/signal";
import type { ConversationsRepo } from "../repos/conversations";
import type { Unit } from "../repos/types";
import { conversationsAccess, whatsappAccess } from "../services/conversations/conversationsService";
import { createCatalog } from "../auth/catalog";
import { PERMISSION_CATALOG } from "../auth/catalog.generated";

// The composition of live Email and WhatsApp (server/live/convLive.ts): NOTIFY on the shared pool and one LISTEN connection per server process when there is a database,
// the Supabase ping when it is set up, the stream only where the server holds connections (not on Vercel). One instance per process (kept across dev reloads).

const g = globalThis as typeof globalThis & { __hmsConvLive?: ConvLive };

function later(work: () => Promise<void>): void {
  try {
    after(() => work().catch(() => undefined));
  } catch {
    void work().catch(() => undefined);
  }
}

export function getConvLive(): ConvLive {
  if (g.__hmsConvLive) return g.__hmsConvLive;
  const config = getConfig();
  const serverless = Boolean(process.env.VERCEL);
  // no NOTIFY on a serverless host: nothing there LISTENs, so it would only take a pooled connection per change
  const hasDb = Boolean(config.DATABASE_URL) && !serverless;
  g.__hmsConvLive = createConvLive({
    serverless,
    later,
    ...(hasDb
      ? {
          notify: async (payload: string) => {
            const client = await getDatabase().pool.connect();
            try {
              await client.query("SELECT pg_notify($1, $2)", [NOTIFY_CHANNEL, payload]);
            } finally {
              client.release();
            }
          },
          listen: (onPayload: (p: string) => void, onState: (up: boolean) => void) => listenOn(NOTIFY_CHANNEL, onPayload, onState),
        }
      : {}),
    ...(signalConfig() ? { signal: (box: LiveBox) => sendMailSignal(box.kind, box.id) } : {}),
  });
  return g.__hmsConvLive;
}

/** Replaces the instance (tests). */
export function configureConvLive(next: ConvLive | null): void {
  g.__hmsConvLive = next ?? undefined;
}

export const publishConvChanges = (changes: ConvChange[]): void => getConvLive().publish(changes);

export const hotelBox = (hotelId: string): LiveBox => ({ kind: "hotel", id: hotelId });

/** A hotel's hub unit that publishes its changes (the session's hotel is the box). */
export const liveHotelUnit = <R extends { conversations: ConversationsRepo }>(unit: Unit<R>): Unit<R> => liveUnit(unit, (s) => (s.hotelId ? hotelBox(s.hotelId) : null), publishConvChanges);
/** A group's inbox (the group session carries the group's id where a hotel's would be). */
export const liveGroupUnit = <R extends { conversations: ConversationsRepo }>(unit: Unit<R>): Unit<R> => liveUnit(unit, (s) => (s.hotelId ? { kind: "group", id: s.hotelId } : null), publishConvChanges);
/** A person's own mailbox. */
export const livePersonUnit = <R extends { conversations: ConversationsRepo }>(unit: Unit<R>): Unit<R> => liveUnit(unit, (s) => (s.userId ? { kind: "person", id: s.userId } : null), publishConvChanges);
/** The platform's desks. */
export const livePlatformUnit = <R extends { conversations: ConversationsRepo }, U extends { run<T>(work: (repos: R) => Promise<T>): Promise<T> }>(unit: U): U => liveRunner<R, U>(unit, PLATFORM_BOX, publishConvChanges);

let catalog: ReturnType<typeof createCatalog> | null = null;

const mayRead = (check: () => unknown): boolean => {
  try {
    check();
    return true;
  } catch {
    return false;
  }
};

/**
 * The boxes this signed-in page may hear. A hotel's box needs Email or WhatsApp (View) in that hotel; a group's box is its Group Admin's. A guest, a company login, an API key
 * and a visit hear nothing of a hotel.
 */
export async function liveBoxesOf(session: VerifiedSession): Promise<LiveBox[]> {
  if (session.client !== "web" || session.token !== undefined) return [];
  const cat = (catalog ??= createCatalog(PERMISSION_CATALOG));
  const hotelInbox = (session.accountRole === "hotel_admin" || session.accountRole === "hotel_user") && session.hotelId !== "" && (mayRead(() => conversationsAccess(session, cat, "view")) || mayRead(() => whatsappAccess(session, cat, "view")));
  const groupId = session.accountRole === "group_hotel_admin" && session.visit === undefined ? await (await import("./groupConversations")).groupIdOfAdmin(session.userId).catch(() => null) : null;
  return boxesForSession(session, { hotelInbox, groupId });
}

/** The page's event stream; refused where the host cannot hold it open (the page then uses the ping and its own checks). */
export async function openConvStream(session: VerifiedSession, abort: AbortSignal | undefined): Promise<ReadableStream<Uint8Array>> {
  const live = getConvLive();
  if (live.transport() !== "sse") throw new AppError("CONFLICT", "Live updates use the ping on this server.");
  const boxes = await liveBoxesOf(session);
  if (boxes.length === 0) throw new AppError("FORBIDDEN", "Not available for this account.");
  return live.stream(boxes, abort);
}

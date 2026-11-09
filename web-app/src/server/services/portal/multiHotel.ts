import "server-only";
import type { RecordScope, VerifiedSession } from "../../auth/session";
import { AppError, isAppError } from "../../errors";
import { portalNotLinked } from "../../errors/portal";
import { getLogger } from "../../logger";

// Decision 48 (MJ, 12 Oct 2026): a guest or company login may be linked to SEVERAL hotels (one platform.user_hotels row per hotel, each with that hotel's own record id).
// Every portal data route takes `?hotel=<hotelId>|all`; this is the one place that turns that into the hotels to read and the session to read each with. A read for a hotel is
// the login's own session with the hotel and the record scope swapped for that hotel's (so every existing per-hotel rule, permission and query runs unchanged).

export type PortalKind = RecordScope["kind"];

export interface PortalMembership {
  hotelId: string;
  hotelName: string;
  subjectId: string;
}

export interface Memberships {
  list(userId: string, kind: PortalKind): Promise<PortalMembership[]>;
}

/** The hotels this login is linked to. Without a membership source (or with none found) the session's own hotel and record are the only one; none at all = "not linked". */
export async function membershipsOf(source: Memberships | undefined, session: VerifiedSession, kind: PortalKind): Promise<PortalMembership[]> {
  // staff and the other kind of portal account are refused (403); only a linked-less account of THIS kind is told "not linked" (409)
  if (session.accountRole !== (kind === "guest" ? "guest_user" : "corporate_user")) throw new AppError("FORBIDDEN");
  const found = source ? await source.list(session.userId, kind) : [];
  if (found.length > 0) return found;
  if (session.scope && session.scope.kind === kind) return [{ hotelId: session.hotelId, hotelName: "", subjectId: session.scope.id }];
  throw portalNotLinked(kind);
}

export const sessionFor = (session: VerifiedSession, kind: PortalKind, m: PortalMembership): VerifiedSession => ({ ...session, hotelId: m.hotelId, scope: { kind, id: m.subjectId } });

const isOpaqueId = (v: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

/** `all` / omitted = every linked hotel; an id = that hotel (403 when the login is not linked to it). */
export function chooseHotels(all: readonly PortalMembership[], hotel: string | undefined): PortalMembership[] {
  if (hotel === undefined || hotel === "" || hotel === "all") return [...all];
  const m = isOpaqueId(hotel) ? all.find((x) => x.hotelId === hotel) : undefined;
  if (!m) throw new AppError("FORBIDDEN", "You are not linked to that hotel.");
  return [m];
}

/** ONE hotel for a read or an action on one record: the id, or (omitted) the login's first linked hotel; `all` is refused. */
export async function oneHotel(source: Memberships | undefined, session: VerifiedSession, kind: PortalKind, hotel: string | undefined): Promise<{ session: VerifiedSession; hotel: PortalMembership }> {
  const all = await membershipsOf(source, session, kind);
  if (hotel === "all") throw new AppError("VALIDATION_FAILED", "Choose one hotel.", { fields: { hotel: "Choose one hotel." } });
  const m = hotel === undefined || hotel === "" ? all[0] : chooseHotels(all, hotel)[0];
  return { session: sessionFor(session, kind, m), hotel: m };
}

/** The limits of an "All hotels" read (MJ's plan PORTAL-ALL-HOTELS, 18 Oct 2026): how many linked hotels one call reads, how many at a time, and how long one hotel may take. */
export const PORTAL_MAX_HOTELS = 25;
export const PORTAL_CONCURRENCY = 4;
export const PORTAL_HOTEL_TIMEOUT_MS = 10_000;

export interface GatherLimits {
  maxHotels?: number;
  concurrency?: number;
  timeoutMs?: number;
}

/** A linked hotel that is missing from a partial answer. Only the account's OWN linked hotels are ever named, and never a reason or an error text. */
export interface UnavailableHotel {
  hotelId: string;
  hotelName: string;
}

export interface Gathered<T> {
  parts: { hotel: PortalMembership; value: T }[];
  unavailable: UnavailableHotel[];
}

const NONE_REACHED = "None of your hotels could be reached right now. Please try again in a moment.";

class HotelTimeout extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HotelTimeout()), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * Runs `work` for each chosen hotel, each in ITS OWN scoped transaction (the login's session with that hotel and that hotel's record), and keeps the answers that came.
 * - The login's linked hotels only (`chooseHotels`: an id it is not linked to is 403); at most `maxHotels` are read, the rest are listed as unavailable.
 * - At most `concurrency` run at a time, and one hotel may take `timeoutMs`. A hotel that fails or runs out of time is left out and listed in `unavailable` (its id and name,
 *   never the error); the answer is partial, not a 500. The failure is logged with the hotel's id.
 * - A hotel whose record is missing or switched off (PORTAL_NOT_LINKED / PORTAL_INACTIVE) is left out quietly, as before.
 * - A refusal that every hotel would give (a bad request, FORBIDDEN, NOT_FOUND ...) is thrown as it is.
 * - When no hotel answers: the first not-linked / inactive error, else 503 "none could be reached".
 */
export async function gather<T>(
  source: Memberships | undefined,
  session: VerifiedSession,
  kind: PortalKind,
  hotel: string | undefined,
  work: (s: VerifiedSession, m: PortalMembership) => Promise<T>,
  limits: GatherLimits = {},
): Promise<Gathered<T>> {
  const maxHotels = limits.maxHotels ?? PORTAL_MAX_HOTELS;
  const concurrency = Math.max(1, limits.concurrency ?? PORTAL_CONCURRENCY);
  const timeoutMs = limits.timeoutMs ?? PORTAL_HOTEL_TIMEOUT_MS;
  const all = chooseHotels(await membershipsOf(source, session, kind), hotel);
  const chosen = all.slice(0, maxHotels);
  const unavailable: UnavailableHotel[] = all.slice(maxHotels).map((m) => ({ hotelId: m.hotelId, hotelName: m.hotelName }));

  const done: ({ hotel: PortalMembership; value: T } | null)[] = chosen.map(() => null);
  const failed: boolean[] = chosen.map(() => false);
  let firstError: unknown = null;
  let refusal: unknown = null;
  let next = 0;
  const runner = async (): Promise<void> => {
    for (let i = next++; i < chosen.length; i = next++) {
      const m = chosen[i];
      try {
        done[i] = { hotel: m, value: await withTimeout(work(sessionFor(session, kind, m), m), timeoutMs) };
      } catch (error) {
        if (isAppError(error) && (error.code === "PORTAL_NOT_LINKED" || error.code === "PORTAL_INACTIVE")) firstError ??= error;
        // a linked hotel that no longer exists in the database answers FORBIDDEN "Hotel is not available" (db/withHotel.ts): that hotel is unavailable, not a refusal of the request
        else if (isAppError(error) && error.code !== "SERVER_ERROR" && error.code !== "UNKNOWN" && !(error.code === "FORBIDDEN" && error.message === "Hotel is not available")) refusal ??= error;
        else {
          failed[i] = true;
          // the cause goes to the server log only (never into the answer)
          getLogger().warn("portal hotel unavailable", { hotelId: m.hotelId, timedOut: error instanceof HotelTimeout, cause: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : typeof error });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chosen.length) }, runner));
  if (refusal !== null) throw refusal;
  chosen.forEach((m, i) => {
    if (failed[i]) unavailable.push({ hotelId: m.hotelId, hotelName: m.hotelName });
  });
  const parts = done.filter((d): d is { hotel: PortalMembership; value: T } => d !== null);
  if (parts.length === 0) {
    if (firstError !== null && unavailable.length === 0) throw firstError;
    if (unavailable.length > 0) throw new AppError("NETWORK_OFFLINE", NONE_REACHED);
  }
  return { parts, unavailable };
}

/** `gather` without the list of hotels that were left out (the guest reads, until they carry it too). */
export async function eachHotel<T>(
  source: Memberships | undefined,
  session: VerifiedSession,
  kind: PortalKind,
  hotel: string | undefined,
  work: (s: VerifiedSession, m: PortalMembership) => Promise<T>,
): Promise<{ hotel: PortalMembership; value: T }[]> {
  return (await gather(source, session, kind, hotel, work)).parts;
}
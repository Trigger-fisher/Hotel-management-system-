import "server-only";
import path from "node:path";
import { getDatabase } from "../../db";
import { getConfig, mediaDriverOf, photoStorageUnavailable } from "../config/env";
import { createDbMediaStore } from "../media/db";
import { s3MediaStoreFromConfig } from "../media/s3";
import { createLocalMediaStore, createMemoryMediaStore, createUnavailableMediaStore, type MediaStore } from "../media/store";
import { createIdPhotoService, type IdPhotoService } from "../services/frontOffice/idPhotoService";
import { createReservationService, type ReservationService } from "../services/frontOffice/reservationService";
import { createRoomService, type RoomService } from "../services/frontOffice/roomService";
import { createStayService, type StayService } from "../services/frontOffice/stayService";
import { createRequestService, type RequestService } from "../services/frontOffice/requestService";
import { billingDefaults, getBillingBills } from "./billing";

// The composition root of the front office: the SAME unit (one store) as billing, so check-out writes its bill in one transaction. The PostgreSQL
// repositories replace the in-memory ones here and in compose/billing.ts together.
let rooms: RoomService | null = null;
let reservations: ReservationService | null = null;
let stays: StayService | null = null;
let requests: RequestService | null = null;

const deps = () => ({ ...billingDefaults(), bills: getBillingBills() });

export function getFrontOfficeRooms(): RoomService {
  rooms ??= createRoomService(deps());
  return rooms;
}
export function getFrontOfficeReservations(): ReservationService {
  reservations ??= createReservationService(deps());
  return reservations;
}
export function getFrontOfficeStays(): StayService {
  stays ??= createStayService(deps(), getFrontOfficeRooms());
  return stays;
}

/** Replaces the front-office services (start-up code and tests). */
export function getFrontOfficeRequests(): RequestService {
  requests ??= createRequestService(deps());
  return requests;
}
export function configureFrontOffice(next: { rooms: RoomService; reservations: ReservationService; stays: StayService; requests?: RequestService } | null): void {
  rooms = next?.rooms ?? null;
  reservations = next?.reservations ?? null;
  stays = next?.stays ?? null;
  requests = next?.requests ?? null;
}

// The main guest's ID photos: a PRIVATE store, the folder "id-photos" next to the media folder (web-app/.data/id-photos, or beside HMS_MEDIA_DIR). No public
// route reads it (the website media route reads the media folder only); back it up with the media folder (docs/OPERATIONS.md). With MEDIA_DRIVER=s3 it is
// the prefix "id-photos/" of the same private bucket (the website media are under "media/"; the media route can never name a key outside that prefix).
let idPhotoStore: MediaStore | null = null;
let idPhotos: IdPhotoService | null = null;

export function getIdPhotoStore(): MediaStore {
  if (idPhotoStore) return idPhotoStore;
  const config = getConfig();
  const media = config.HMS_MEDIA_DIR ?? path.join(process.cwd(), ".data", "media");
  if (!config.DATABASE_URL) idPhotoStore = createMemoryMediaStore();
  // Vercel keeps no disk between requests: an ID photo answers a plain 503 until MEDIA_DRIVER=s3 (warned at boot and in System Health)
  else if (mediaDriverOf(config) === "db") idPhotoStore = createDbMediaStore(getDatabase().pool, "id-photos");
  else if (photoStorageUnavailable(config)) idPhotoStore = createUnavailableMediaStore();
  else idPhotoStore = config.MEDIA_DRIVER === "s3" ? s3MediaStoreFromConfig(config, "id-photos/") : createLocalMediaStore(path.join(path.dirname(media), "id-photos"));
  return idPhotoStore;
}

export function getIdPhotos(): IdPhotoService {
  idPhotos ??= createIdPhotoService({ ...billingDefaults(), photos: getIdPhotoStore() });
  return idPhotos;
}

/** Replaces the ID photo store and service (tests). */
export function configureIdPhotos(next: { store: MediaStore; service: IdPhotoService } | null): void {
  idPhotoStore = next?.store ?? null;
  idPhotos = next?.service ?? null;
}
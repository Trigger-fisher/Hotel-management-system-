import "server-only";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { compressImage } from "../../media/compress";
import { checkUpload, randomName, type MediaStore, type UploadInput } from "../../media/store";
import type { FrontOfficeRepos, StayRecord } from "../../repos/frontOffice";
import { unwrapVersioned } from "../../repos/unwrap";
import { actorOf, logLine, type FrontOfficeDeps } from "./context";

// The stay's ID images (a colour JPG or PNG). The main guest's is the first (idProofPath); further ones (the back of a card, the other guests' IDs) follow in order
// (guestDetails.idPhotos). All are kept in the PRIVATE ID-photo store (a folder no public route reads), under random names; the stay keeps only the names. Front Office: view to
// see them, edit to add, remove or reorder. The log names the stay and the count, never the guest; nothing is stored twice.
const PART = "pms.stays";
export const ID_PHOTO_TYPES = ["jpg", "png"] as const;
export const MAX_ID_PHOTO_BYTES = 8 * 1024 * 1024;
/** How many ID images a stay may keep. */
export const STORE_MAX_IMAGES = 12;

/** The stay's ID images in order: the main one first. */
export const idPhotosOf = (stay: Pick<StayRecord, "idProofPath" | "guestDetails">): string[] => [...(stay.idProofPath ? [stay.idProofPath] : []), ...(stay.guestDetails?.idPhotos ?? [])];

export interface IdPhotoListDto {
  version: number;
  /** In order; `id` names the image for the routes below (a random stored name, nothing about the guest). */
  photos: { id: string }[];
  storeMax: number;
}

export function createIdPhotoService(deps: Pick<FrontOfficeDeps, "unit" | "people" | "catalog"> & { photos: MediaStore }) {
  const { unit, catalog, photos } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta) => ({ session, meta, actor: await actorOf(deps, session) });
  const label = (id: string) => ({ id, label: `Stay ${id.slice(0, 8)}` });
  const listDto = (stay: StayRecord): IdPhotoListDto => ({ version: stay.version, photos: idPhotosOf(stay).map((id) => ({ id })), storeMax: STORE_MAX_IMAGES });

  /** Writes the stay's list in this order: the first becomes the main photo, the rest the further ones. */
  async function writeList(repos: FrontOfficeRepos, stay: StayRecord, version: number, list: string[], userId: string): Promise<StayRecord> {
    const [main, ...rest] = list;
    const details = { ...(stay.guestDetails ?? {}) };
    if (rest.length > 0) details.idPhotos = rest;
    else delete details.idPhotos;
    const empty = Object.keys(details).length === 0;
    return unwrapVersioned(await repos.stays.update(stay.id, version, { idProofPath: main ?? null, guestDetails: empty ? null : details }, userId));
  }

  /** A checked, compressed upload stored under a new random name (removed again by the caller when the stay does not take it). */
  async function store(session: VerifiedSession, input: UploadInput): Promise<string> {
    const file = checkUpload(input, ID_PHOTO_TYPES, MAX_ID_PHOTO_BYTES, "idPhoto");
    // stored as a JPEG of at most 1 MB (the police portal takes JPG/PNG only): media/compress.ts
    const small = await compressImage(file.bytes, "id-photo", file.type, "idPhoto");
    const name = `id-${randomName(small.type)}`;
    await photos.put(session.hotelId, name, small.bytes);
    return name;
  }

  return {
    /** Adds or replaces the MAIN photo; answers the stay's new version. */
    async put(session: VerifiedSession, stayId: string, input: UploadInput & { version: number }, meta: RequestMeta): Promise<{ version: number; hasIdPhoto: true }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      const name = await store(session, input);
      try {
        return await unit.run(session, async (repos) => {
          const stay = await repos.stays.get(stayId, { forUpdate: true });
          if (!stay) throw new AppError("NOT_FOUND");
          const updated = unwrapVersioned(await repos.stays.update(stay.id, input.version, { idProofPath: name }, session.userId));
          await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Stay", summary: stay.idProofPath ? "ID photo replaced" : "ID photo added", subject: label(stay.id) }));
          // the old file goes once the stay points at the new one
          if (stay.idProofPath) await photos.remove(session.hotelId, stay.idProofPath).catch(() => undefined);
          return { version: updated.version, hasIdPhoto: true as const };
        });
      } catch (error) {
        // the stay did not take it: no orphan file is left behind
        await photos.remove(session.hotelId, name).catch(() => undefined);
        throw error;
      }
    },

    /** The main photo itself, for staff. 404 when the stay has none. */
    async get(session: VerifiedSession, stayId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
      requirePermission(session, catalog, PART, "view");
      const stay = await unit.run(session, (repos) => repos.stays.get(stayId));
      if (!stay?.idProofPath) throw new AppError("NOT_FOUND");
      const file = await photos.get(session.hotelId, stay.idProofPath);
      if (!file) throw new AppError("NOT_FOUND");
      return file;
    },

    /** Removes the MAIN photo; a further one, if any, becomes the main one. */
    async remove(session: VerifiedSession, stayId: string, version: number, meta: RequestMeta): Promise<{ version: number; hasIdPhoto: boolean }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const stay = await repos.stays.get(stayId, { forUpdate: true });
        if (!stay) throw new AppError("NOT_FOUND");
        if (!stay.idProofPath) return { version: stay.version, hasIdPhoto: false };
        const updated = await writeList(repos, stay, version, idPhotosOf(stay).slice(1), session.userId);
        await repos.systemLogs.write(logLine(w, { action: "deleted", entity: "Stay", summary: "ID photo removed", subject: label(stay.id) }));
        await photos.remove(session.hotelId, stay.idProofPath).catch(() => undefined);
        return { version: updated.version, hasIdPhoto: updated.idProofPath !== null };
      });
    },

    // ---------------------------------------------------------------- all of the stay's ID images (several per stay)

    async list(session: VerifiedSession, stayId: string): Promise<IdPhotoListDto> {
      requirePermission(session, catalog, PART, "view");
      const stay = await unit.run(session, (repos) => repos.stays.get(stayId));
      if (!stay) throw new AppError("NOT_FOUND");
      return listDto(stay);
    },

    /** One of the stay's images; a name the stay does not hold is 404 (never another file of the hotel). */
    async getOne(session: VerifiedSession, stayId: string, photoId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
      requirePermission(session, catalog, PART, "view");
      const stay = await unit.run(session, (repos) => repos.stays.get(stayId));
      if (!stay || !idPhotosOf(stay).includes(photoId)) throw new AppError("NOT_FOUND");
      const file = await photos.get(session.hotelId, photoId);
      if (!file) throw new AppError("NOT_FOUND");
      return file;
    },

    /** Adds one image at the end (the first one of a stay becomes the main photo). At most STORE_MAX_IMAGES. */
    async add(session: VerifiedSession, stayId: string, input: UploadInput & { version: number }, meta: RequestMeta): Promise<IdPhotoListDto> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      const name = await store(session, input);
      try {
        return await unit.run(session, async (repos) => {
          const stay = await repos.stays.get(stayId, { forUpdate: true });
          if (!stay) throw new AppError("NOT_FOUND");
          const list = idPhotosOf(stay);
          if (list.length >= STORE_MAX_IMAGES) throw new AppError("VALIDATION_FAILED", `At most ${STORE_MAX_IMAGES} ID images per stay.`, { fields: { idPhoto: `At most ${STORE_MAX_IMAGES} ID images per stay.` } });
          const updated = await writeList(repos, stay, input.version, [...list, name], session.userId);
          await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Stay", summary: "ID image added", subject: label(stay.id), details: { "ID images": list.length + 1 } }));
          return listDto(updated);
        });
      } catch (error) {
        await photos.remove(session.hotelId, name).catch(() => undefined);
        throw error;
      }
    },

    /** Removes one of the stay's images (the next one moves up). */
    async removeOne(session: VerifiedSession, stayId: string, photoId: string, version: number, meta: RequestMeta): Promise<IdPhotoListDto> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const stay = await repos.stays.get(stayId, { forUpdate: true });
        if (!stay) throw new AppError("NOT_FOUND");
        const list = idPhotosOf(stay);
        if (!list.includes(photoId)) throw new AppError("NOT_FOUND");
        const updated = await writeList(repos, stay, version, list.filter((p) => p !== photoId), session.userId);
        await repos.systemLogs.write(logLine(w, { action: "deleted", entity: "Stay", summary: "ID image removed", subject: label(stay.id), details: { "ID images": list.length - 1 } }));
        await photos.remove(session.hotelId, photoId).catch(() => undefined);
        return listDto(updated);
      });
    },

    /** A new order of the SAME images (the first becomes the main photo). Anything else is a validation error. */
    async reorder(session: VerifiedSession, stayId: string, order: string[], version: number, meta: RequestMeta): Promise<IdPhotoListDto> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const stay = await repos.stays.get(stayId, { forUpdate: true });
        if (!stay) throw new AppError("NOT_FOUND");
        const list = idPhotosOf(stay);
        const same = order.length === list.length && new Set(order).size === order.length && order.every((p) => list.includes(p));
        if (!same) throw new AppError("VALIDATION_FAILED", "The order must name each of the stay's ID images once.", { fields: { order: "The order must name each of the stay's ID images once." } });
        const updated = await writeList(repos, stay, version, order, session.userId);
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Stay", summary: "ID images reordered", subject: label(stay.id) }));
        return listDto(updated);
      });
    },
  };
}

export type IdPhotoService = ReturnType<typeof createIdPhotoService>;

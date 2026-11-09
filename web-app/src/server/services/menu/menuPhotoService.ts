import "server-only";
import type { Catalog } from "../../auth/catalog";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { compressImage } from "../../media/compress";
import { checkUpload, randomName, type MediaStore, type UploadInput } from "../../media/store";
import type { PortalRepos } from "../../repos/portal";
import type { Unit } from "../../repos/types";
import type { PeopleDirectory } from "../cash/ports";
import { requireScope } from "../guest/portalKit";

// Menu photos (guest portal round 3 a, the last part; hotel migration 0043). One photo per room-service menu item, kept in the hotel's PRIVATE menu-photo store under a random
// name (no public address reads it): the hotel adds, replaces or removes it under Master Data (module masters: view to see it, edit to change it), a signed-in guest of that
// hotel sees it on the menu. Stored as WebP of at most 1 MB (media/compress.ts). The log names the item, never the file.

const PART = "masters";
export const MENU_PHOTO_TYPES = ["jpg", "png", "webp"] as const;
export const MAX_MENU_PHOTO_BYTES = 10 * 1024 * 1024;

export interface MenuPhotoDeps {
  unit: Unit<PortalRepos>;
  people: PeopleDirectory;
  catalog: Catalog;
  photos: MediaStore;
}

export function createMenuPhotoService(deps: MenuPhotoDeps) {
  const { unit, catalog, photos, people } = deps;
  const log = async (repos: PortalRepos, session: VerifiedSession, meta: RequestMeta, item: { id: string; name: string }, summary: string) => {
    const actor = (await people.get([session.userId])).get(session.userId);
    await repos.systemLogs.write({ module: "masters", action: "updated", entity: "Room service menu", subjectId: item.id, subjectLabel: item.name.slice(0, 255), summary: `${summary}: ${item.name}`.slice(0, 500), details: null, userId: session.userId, userName: actor?.name ?? "System", ipAddress: meta.ip, traceId: meta.traceId });
  };
  const fileOf = async (hotelId: string, name: string | null | undefined) => {
    if (!name) throw new AppError("NOT_FOUND");
    const file = await photos.get(hotelId, name);
    if (!file) throw new AppError("NOT_FOUND");
    return file;
  };

  return {
    /** Adds or replaces the item's photo (a JPG, PNG or WebP, base64 in JSON, up to 10 MB; kept as WebP of at most 1 MB). The old file goes once the item points at the new one. */
    async put(session: VerifiedSession, id: string, input: UploadInput, meta: RequestMeta): Promise<{ id: string; hasPhoto: true }> {
      requirePermission(session, catalog, PART, "edit");
      const file = checkUpload(input, MENU_PHOTO_TYPES, MAX_MENU_PHOTO_BYTES, "photo");
      const small = await compressImage(file.bytes, "gallery", file.type, "photo");
      const name = `menu-${randomName(small.type)}`;
      await photos.put(session.hotelId, name, small.bytes);
      try {
        return await unit.run(session, async (repos) => {
          const before = await repos.menuItems.setImage(id, name);
          if (!before) throw new AppError("NOT_FOUND");
          await log(repos, session, meta, before, before.imageFile ? "Replaced the photo of room service menu item" : "Added a photo to room service menu item");
          if (before.imageFile) await photos.remove(session.hotelId, before.imageFile).catch(() => undefined);
          return { id, hasPhoto: true as const };
        });
      } catch (error) {
        // the item did not take it: no orphan file is left behind
        await photos.remove(session.hotelId, name).catch(() => undefined);
        throw error;
      }
    },

    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string; hasPhoto: false }> {
      requirePermission(session, catalog, PART, "edit");
      return unit.run(session, async (repos) => {
        const item = await repos.menuItems.get(id);
        if (!item) throw new AppError("NOT_FOUND");
        if (!item.imageFile) return { id, hasPhoto: false as const };
        await repos.menuItems.setImage(id, null);
        await log(repos, session, meta, item, "Removed the photo of room service menu item");
        await photos.remove(session.hotelId, item.imageFile).catch(() => undefined);
        return { id, hasPhoto: false as const };
      });
    },

    /** The photo for the hotel's Master Data screen. 404 when the item has none. */
    async forStaff(session: VerifiedSession, id: string) {
      requirePermission(session, catalog, PART, "view");
      const item = await unit.run(session, (repos) => repos.menuItems.get(id));
      if (!item) throw new AppError("NOT_FOUND");
      return fileOf(session.hotelId, item.imageFile);
    },

    /** The photo on the guest's menu: a signed-in guest of THIS hotel (the session is already the chosen hotel's). 404 when the item is gone or has none. */
    async forGuest(session: VerifiedSession, id: string) {
      requireScope(session, "guest");
      const item = await unit.run(session, (repos) => repos.menuItems.get(id));
      if (!item) throw new AppError("NOT_FOUND");
      return fileOf(session.hotelId, item.imageFile);
    },
  };
}

export type MenuPhotoService = ReturnType<typeof createMenuPhotoService>;

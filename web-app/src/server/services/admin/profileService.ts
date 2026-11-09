import "server-only";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { compressImage } from "../../media/compress";
import { checkUpload, randomName, type MediaStore, type UploadInput } from "../../media/store";
import type { AdminPlatformUnit, UiTheme } from "../../repos/adminPlatform";

// The signed-in person's own display preferences (MJ 2026-10-06): the day / night choice is remembered per person. Any signed-in person may read
// and change their OWN; there is nothing here about anyone else, a hotel or a credential. Spec: docs/specs/admin.md §6.
// The person's own profile photo (MJ 2026-10-18, platform migration 0131; docs/plans/CENTRAL-GUEST-COMPANY-PLAN-2026-10-18.md): every login (guest, company, staff) may add,
// replace or remove their OWN. A JPG, PNG or WebP up to 10 MB, kept as WebP of at most 1 MB in the PRIVATE profile-photo store, in a folder of the person's own id; the
// database keeps only the random file name (a new photo always gets a new name, so the address changes with it). The account's "recent changes" get one line per change.

export interface ProfilePreferences {
  /** null = no choice yet: the screen follows the device on the first visit. */
  uiTheme: UiTheme | null;
}

export const PROFILE_PHOTO_TYPES = ["jpg", "png", "webp"] as const;
export const MAX_PROFILE_PHOTO_BYTES = 10 * 1024 * 1024;

/** Where the person's own photo is read from (the name in the query changes with every new photo, so a browser never shows an old one). */
export const profilePhotoUrl = (file: string | null): string | null => (file ? `/api/v1/profile/photo?v=${encodeURIComponent(file.replace(/\.webp$/, "").slice(-12))}` : null);

export interface ProfilePhotoState {
  hasPhoto: boolean;
  photoUrl: string | null;
}

interface ProfileDeps {
  platform: AdminPlatformUnit;
  /** The private profile-photo store (compose/profilePhotos.ts); asked for only when a photo is read or changed. */
  photos?: () => MediaStore;
  /** Writes the line on the person's own account history ("Profile photo changed"). */
  audit?: (session: VerifiedSession, action: "profile.photo_changed" | "profile.photo_removed", meta: RequestMeta) => Promise<void>;
}

export function createProfileService(deps: ProfileDeps) {
  const { platform } = deps;
  const store = (): MediaStore => {
    if (!deps.photos) throw new AppError("CONFLICT", "Photo storage is not set up on this server yet");
    return deps.photos();
  };
  const stateOf = (file: string | null): ProfilePhotoState => ({ hasPhoto: file !== null, photoUrl: profilePhotoUrl(file) });

  return {
    async preferences(session: VerifiedSession): Promise<ProfilePreferences> {
      return platform.run((repos) => repos.preferences.get(session.userId));
    },

    /** Only the fields sent change; null clears the choice. */
    async updatePreferences(session: VerifiedSession, patch: { uiTheme?: string | null }): Promise<ProfilePreferences> {
      if (patch.uiTheme !== undefined && patch.uiTheme !== null && patch.uiTheme !== "light" && patch.uiTheme !== "dark") {
        throw new AppError("VALIDATION_FAILED", "Choose day or night.", { fields: { uiTheme: "Choose day or night." } });
      }
      return platform.run((repos) => repos.preferences.set(session.userId, patch.uiTheme === undefined ? {} : { uiTheme: patch.uiTheme as UiTheme | null }));
    },

    /** The stored name of a person's photo, or null (GET /profile carries its address). */
    photoName(userId: string): Promise<string | null> {
      return platform.run((repos) => repos.photo.get(userId));
    },

    /** The person's own photo, for GET /profile/photo. 404 when there is none. */
    async photo(session: VerifiedSession): Promise<{ bytes: Uint8Array; contentType: string }> {
      const name = await platform.run((repos) => repos.photo.get(session.userId));
      if (!name) throw new AppError("NOT_FOUND");
      const file = await store().get(session.userId, name);
      if (!file) throw new AppError("NOT_FOUND");
      return file;
    },

    /** Adds or replaces the person's own photo. The old file goes once the account points at the new one; a failed save leaves no new file behind. */
    async putPhoto(session: VerifiedSession, input: UploadInput, meta: RequestMeta): Promise<ProfilePhotoState> {
      const file = checkUpload(input, PROFILE_PHOTO_TYPES, MAX_PROFILE_PHOTO_BYTES, "photo");
      const small = await compressImage(file.bytes, "icon", file.type, "photo");
      const name = `photo-${randomName(small.type)}`;
      const photos = store();
      await photos.put(session.userId, name, small.bytes);
      let before: string | null;
      try {
        before = await platform.run((repos) => repos.photo.set(session.userId, name));
      } catch (error) {
        await photos.remove(session.userId, name).catch(() => undefined);
        throw error;
      }
      if (before && before !== name) await photos.remove(session.userId, before).catch(() => undefined);
      await deps.audit?.(session, "profile.photo_changed", meta);
      return stateOf(name);
    },

    /** Removes the person's own photo (nothing to remove is fine). */
    async removePhoto(session: VerifiedSession, meta: RequestMeta): Promise<ProfilePhotoState> {
      const before = await platform.run((repos) => repos.photo.set(session.userId, null));
      if (before) {
        await store().remove(session.userId, before).catch(() => undefined);
        await deps.audit?.(session, "profile.photo_removed", meta);
      }
      return stateOf(null);
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;

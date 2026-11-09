import "server-only";
import type { WebPhoto } from "@shared/dashboards/website";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import { compressImage } from "../../media/compress";
import { checkUpload, GALLERY_TYPES, MAX_GALLERY_BYTES, slugOf, uniqueName, type UploadInput } from "../../media/store";
import type { GalleryPhotoRecord } from "../../repos/website";
import { diffDetails } from "../cash/syslog";
import { actorOf, conflict, fieldError, logLine, notFound, type WebsiteDeps, type Who } from "./context";
import { matchWords } from "../../validation/listQuery";

// The website's gallery (Pallav Website/GalleryController): photos uploaded in batches and named for search engines (the caption names the file), a caption
// and alt text each, put in order. Part `website.gallery`. Files go to the media store under the hotel's own folder; the database keeps the stored name.
// Spec: docs/BACKEND.md section 14b.

const PART = "website.gallery";
const FALLBACK_NAME = "hotel-photo";

/** A photo as the apps get it: the contract's fields plus `file` (the stored name) and `url` (where the signed-in screens fetch it). */
interface PhotoDto extends WebPhoto {
  file: string;
  url: string;
}

export const mediaUrl = (file: string): string => `/api/v1/website/media/${file}`;
const cut = (s: string, max: number): string => Array.from(s.trim()).slice(0, max).join("");

export function photoDto(p: GalleryPhotoRecord, index: number): PhotoDto {
  return { id: p.id, caption: p.caption ?? "", altText: p.altText ?? "", shade: index % 6, file: p.path, url: mediaUrl(p.path) };
}

export function createGalleryService(deps: WebsiteDeps) {
  const { unit, catalog, media } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });
  const listAll = async (repos: Parameters<Parameters<typeof unit.run>[1]>[0]): Promise<PhotoDto[]> => (await repos.gallery.list()).map(photoDto);

  return {
    async list(session: VerifiedSession, search?: string): Promise<PhotoDto[]> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => matchWords(await listAll(repos), search, (p) => [p.caption, p.altText]));
    },

    /** store (:20-48): one photo per file, all with the same caption (also the alt text, else the file's own name); every file is checked before any is kept. */
    async add(session: VerifiedSession, input: { caption: string; files: UploadInput[] }, meta: RequestMeta): Promise<PhotoDto[]> {
      requirePermission(session, catalog, PART, "create");
      if (input.files.length === 0) throw fieldError("photos", "Pick at least one photo.");
      const caption = cut(input.caption, 150);
      const checked = input.files.map((f) => ({ file: f, ...checkUpload(f, GALLERY_TYPES, MAX_GALLERY_BYTES, "photos") }));
      const w = await who(session, meta);
      const kept: string[] = [];
      try {
        const made = await unit.run(session, async (repos) => {
          const out: GalleryPhotoRecord[] = [];
          for (const c of checked) {
            const base = slugOf(caption, slugOf(c.file.fileName.replace(/\.[^.]+$/, ""), FALLBACK_NAME));
            // stored small (WebP, at most 1 MB) whatever came in: media/compress.ts
            const small = await compressImage(c.bytes, "gallery", c.type, "photos");
            const name = await uniqueName(media, session.hotelId, base, small.type);
            await media.put(session.hotelId, name, small.bytes);
            kept.push(name);
            const label = caption || c.file.fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 255);
            out.push(await repos.gallery.create({ path: name, caption: caption || null, altText: label || null }, session.userId));
          }
          await repos.systemLogs.write(logLine(w, { action: "created", entity: "Gallery photo", summary: `Uploaded ${out.length} gallery ${out.length === 1 ? "photo" : "photos"}`, subject: null }));
          return out;
        });
        const all = await unit.run(session, (repos) => listAll(repos));
        return all.filter((p) => made.some((m) => m.id === p.id));
      } catch (error) {
        // the rows were rolled back with the unit: the files saved for them must not stay behind
        for (const name of kept) await media.remove(session.hotelId, name).catch(() => undefined);
        throw error;
      }
    },

    /** update (:50-60): caption up to 150, alt text up to 255; empty = none. */
    async update(session: VerifiedSession, id: string, input: { caption: string; altText: string }, meta: RequestMeta): Promise<PhotoDto> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const before = await repos.gallery.get(id);
        if (!before) throw notFound();
        const saved = await repos.gallery.update(id, { caption: cut(input.caption, 150) || null, altText: cut(input.altText, 255) || null }, session.userId);
        const changes = diffDetails({ caption: before.caption ?? "", alt_text: before.altText ?? "" }, { caption: saved.caption ?? "", alt_text: saved.altText ?? "" });
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Gallery photo", summary: `Changed Gallery photo: ${saved.caption || saved.path}`, subject: { id, label: saved.caption || saved.path }, details: changes }));
        const all = await repos.gallery.list();
        return photoDto(saved, Math.max(0, all.findIndex((p) => p.id === id)));
      });
    },

    /** destroy (:62-70): the row and the file. */
    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, PART, "full");
      const w = await who(session, meta);
      const path = await unit.run(session, async (repos) => {
        const photo = await repos.gallery.get(id);
        if (!photo) throw notFound();
        await repos.gallery.remove(id);
        await repos.systemLogs.write(logLine(w, { action: "deleted", entity: "Gallery photo", summary: `Deleted Gallery photo: ${photo.caption || photo.path}`, subject: { id, label: photo.caption || photo.path }, details: { File: photo.path } }));
        return photo.path;
      });
      await media.remove(session.hotelId, path).catch(() => undefined);
      return { id };
    },

    /** The contract moves a photo one place; at an end nothing can move (409). Answers the whole list in its new order. */
    async move(session: VerifiedSession, id: string, direction: "up" | "down", meta: RequestMeta): Promise<PhotoDto[]> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const list = await repos.gallery.list();
        const at = list.findIndex((p) => p.id === id);
        if (at < 0) throw notFound();
        const to = direction === "up" ? at - 1 : at + 1;
        if (to < 0 || to >= list.length) throw conflict("This photo cannot move any further.");
        const ids = list.map((p) => p.id);
        [ids[at], ids[to]] = [ids[to], ids[at]];
        await repos.gallery.setOrder(ids);
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Gallery photo", summary: "Reordered gallery photos", subject: null }));
        return (await repos.gallery.list()).map(photoDto);
      });
    },

    /** One stored file for the signed-in screens: only this hotel's folder is ever read. */
    async file(session: VerifiedSession, name: string): Promise<{ bytes: Uint8Array; contentType: string }> {
      requirePermission(session, catalog, "website", "view");
      const f = await media.get(session.hotelId, name).catch(() => null);
      if (!f) throw notFound();
      return f;
    },
  };
}

export type GalleryService = ReturnType<typeof createGalleryService>;

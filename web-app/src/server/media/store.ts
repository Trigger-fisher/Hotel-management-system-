import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors";

// The media store: the website's uploaded photos, icons, logo and browser icon (Pallav Support/Site/Uploads.php). One folder per hotel; the database keeps only
// the stored FILE NAME ("hotel-lobby.jpg"), and a file is always read for the signed-in session's own hotel, so one hotel can never name another's file.
// What goes in is checked by its CONTENT, not its name: the bytes must really be one of the allowed image types, the size is capped, and an SVG that carries
// anything active (script, event handler, external reference) is refused. The local adapter writes under web-app/.data/media (git-ignored; override with
// HMS_MEDIA_DIR); the S3-compatible adapter (media/s3.ts, MEDIA_DRIVER=s3) keeps the same files in a private bucket.

type ImageType = "jpg" | "png" | "gif" | "webp" | "svg" | "ico";

/** Pallav Uploads::IMAGES (gallery) and ICONS (+ ico for the branding files). */
export const GALLERY_TYPES: readonly ImageType[] = ["jpg", "png", "webp", "gif"];
export const ICON_TYPES: readonly ImageType[] = ["jpg", "png", "webp", "gif", "svg"];
export const BRANDING_TYPES: readonly ImageType[] = ["jpg", "png", "webp", "gif", "svg", "ico"];

export const MAX_GALLERY_BYTES = 20 * 1024 * 1024;
export const MAX_ICON_BYTES = 2 * 1024 * 1024;

const CONTENT_TYPE: Record<ImageType | "gz", string> = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", gz: "application/gzip" };
export const contentTypeOf = (name: string): string => CONTENT_TYPE[(name.split(".").pop() ?? "") as ImageType] ?? "application/octet-stream";

/** The file name as stored: lower-case letters, digits, dot, dash, underscore; no folder part. A picture, or a nightly backup copy (.ndjson.gz; the backup store only). */
const STORED_NAME = /^[a-z0-9][a-z0-9._-]{0,119}\.(jpg|png|gif|webp|svg|ico|ndjson\.gz)$/;

interface MediaFile {
  bytes: Uint8Array;
  contentType: string;
}

export interface MediaStore {
  /** Keeps the file for this hotel under `name` and returns that name. */
  put(hotelId: string, name: string, bytes: Uint8Array): Promise<string>;
  get(hotelId: string, name: string): Promise<MediaFile | null>;
  has(hotelId: string, name: string): Promise<boolean>;
  remove(hotelId: string, name: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A hotel id and a stored file name, or a refusal (shared by every adapter: local, memory, S3). */
export function assertSafe(hotelId: string, name: string): void {
  if (!UUID.test(hotelId) || !STORED_NAME.test(name)) throw new AppError("SERVER_ERROR", "Not a stored file name");
}

/** Files on this server's disk. */
export function createLocalMediaStore(root: string): MediaStore {
  const file = (hotelId: string, name: string): string => path.join(root, hotelId, name);
  return {
    async put(hotelId, name, bytes) {
      assertSafe(hotelId, name);
      await mkdir(path.join(root, hotelId), { recursive: true });
      await writeFile(file(hotelId, name), bytes);
      return name;
    },
    async get(hotelId, name) {
      assertSafe(hotelId, name);
      try {
        return { bytes: new Uint8Array(await readFile(file(hotelId, name))), contentType: contentTypeOf(name) };
      } catch {
        return null;
      }
    },
    async has(hotelId, name) {
      return (await this.get(hotelId, name)) !== null;
    },
    async remove(hotelId, name) {
      assertSafe(hotelId, name);
      await rm(file(hotelId, name), { force: true });
    },
  };
}

/** The test double: the same rules, in memory. */
export function createMemoryMediaStore(): MediaStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(hotelId, name, bytes) {
      assertSafe(hotelId, name);
      files.set(`${hotelId}/${name}`, new Uint8Array(bytes));
      return name;
    },
    async get(hotelId, name) {
      assertSafe(hotelId, name);
      const bytes = files.get(`${hotelId}/${name}`);
      return bytes ? { bytes: new Uint8Array(bytes), contentType: contentTypeOf(name) } : null;
    },
    async has(hotelId, name) {
      return files.has(`${hotelId}/${name}`);
    },
    async remove(hotelId, name) {
      assertSafe(hotelId, name);
      files.delete(`${hotelId}/${name}`);
    },
  };
}

/** The sentence a photo upload answers (503) when this server has no lasting place for photos (Vercel with MEDIA_DRIVER=local). */
export const PHOTO_STORAGE_UNAVAILABLE = "Photo storage is not set up on this server yet";

/**
 * The store of a server whose disk does not last (Vercel without MEDIA_DRIVER=s3): every put is refused with a plain 409 CONFLICT and the sentence (never NETWORK_OFFLINE: the browser would say "You're offline") instead of
 * writing a file that would vanish; nothing can be read (a photo answers 404) and removing is a no-op.
 */
export function createUnavailableMediaStore(): MediaStore {
  return {
    async put() {
      throw new AppError("CONFLICT", PHOTO_STORAGE_UNAVAILABLE);
    },
    async get() {
      return null;
    },
    async has() {
      return false;
    },
    async remove() {
      return undefined;
    },
  };
}

/* ---------------------------------------------------------------- what an uploaded file really is */

/** The image type from the first bytes, or null. A file's name and the type the browser claimed are never trusted. */
export function sniffImage(b: Uint8Array): ImageType | null {
  const starts = (...sig: number[]): boolean => sig.every((v, i) => b[i] === v);
  if (starts(0xff, 0xd8, 0xff)) return "jpg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (starts(0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  if (starts(0x00, 0x00, 0x01, 0x00) && (b[4] ?? 0) > 0) return "ico";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.slice(0, 2048)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return null;
}

/** Anything in an SVG that can run or fetch: the file is refused, not cleaned (a logo has no need for any of it). */
const SVG_ACTIVE = /<\s*(script|foreignobject|iframe|object|embed|audio|video|link|meta|style\b[^>]*@import)|\son[a-z]+\s*=|javascript:|data:text\/html|<!doctype|<!entity|xlink:href\s*=\s*["']\s*(?!#)|\shref\s*=\s*["']\s*(?!#)/i;
export function svgIsSafe(bytes: Uint8Array): boolean {
  return !SVG_ACTIVE.test(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
}

export interface UploadInput {
  fileName: string;
  /** The file itself, base64 (the API reads JSON only). */
  dataBase64: string;
}

/** A readable, safe file name made from some text ("Hotel lobby!" -> "hotel-lobby"). */
export const slugOf = (text: string, fallback: string): string => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || fallback;

/**
 * Checks one uploaded file: base64, size, real type, allowed here, and for an SVG nothing active. Returns its bytes and type. The messages are plain
 * sentences for the field the upload came from.
 */
export function checkUpload(input: UploadInput, allowed: readonly ImageType[], maxBytes: number, field: string): { bytes: Uint8Array; type: ImageType } {
  const refuse = (message: string): AppError => new AppError("VALIDATION_FAILED", message, { fields: { [field]: message } });
  const data = (input.dataBase64 ?? "").replace(/\s/g, "");
  if (data === "" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1) throw refuse("That file could not be read. Pick it again.");
  const bytes = new Uint8Array(Buffer.from(data, "base64"));
  if (bytes.length === 0) throw refuse("That file is empty.");
  if (bytes.length > maxBytes) throw refuse(`That file is too big: the limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
  const type = sniffImage(bytes);
  if (!type || !allowed.includes(type)) throw refuse(`Pick a ${allowed.map((t) => t.toUpperCase()).join(", ")} image.`);
  if (type === "svg" && !svgIsSafe(bytes)) throw refuse("That SVG contains scripts or links and was not uploaded.");
  return { bytes, type };
}

/** A name nobody uses yet in this hotel's store: "hotel-lobby.jpg", "hotel-lobby-2.jpg" ... (Uploads::uniqueName). */
export async function uniqueName(store: MediaStore, hotelId: string, base: string, ext: ImageType): Promise<string> {
  let name = `${base}.${ext}`;
  for (let n = 2; await store.has(hotelId, name); n += 1) name = `${base}-${n}.${ext}`;
  return name;
}

export const randomName = (ext: ImageType): string => `${randomBytes(12).toString("hex")}.${ext}`;

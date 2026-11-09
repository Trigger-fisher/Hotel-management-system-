import "server-only";
import type { RawObjects } from "../mail/files";
import type { GraphClient } from "./graph";

// WhatsApp media (phase 4): a photo, voice note, video or document a guest sends is DOWNLOADED from Meta (the link expires within minutes), CHECKED by its bytes, and kept in the private bucket under
// the hotel's own folder (whatsapp/hotels/<hotel id>/...) or the platform's (whatsapp/platform/...). Nothing is trusted from the guest: the type comes from the bytes, never the name, anything that is not on
// the short list below is refused (no programs, no scripts, no web pages, no SVG), the size is capped, and a file is only ever served as a download or as a plain image/audio/video with nosniff.
// There is no virus scanner: the policy is that only inert formats are kept and none is ever executed or rendered as a page.
/** The defaults of what the Super Admin sets on the Rules screen (whatsapp.media_max_mb, media_keep_days, media_keep_days_platform); the limits are those of the Rules service. */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;
export const MEDIA_KEEP_DAYS = 30;
export interface MediaPolicy {
  /** The largest file kept, in bytes. */
  maxBytes: number;
  /** Days a hotel's files stay in the bucket (the sweep removes older ones; the chat then says the file is no longer kept). */
  keepDaysHotel: number;
  /** Days the files of the Super Admin's and Platform Admin's side stay. */
  keepDaysPlatform: number;
}
export const DEFAULT_MEDIA_POLICY: MediaPolicy = { maxBytes: MEDIA_MAX_BYTES, keepDaysHotel: MEDIA_KEEP_DAYS, keepDaysPlatform: MEDIA_KEEP_DAYS };

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";
export interface KnownType {
  mime: string;
  ext: string;
  /** Shown inline in the chat (the browser plays or draws it); everything else is a download. */
  inline: boolean;
}

const T = {
  jpeg: { mime: "image/jpeg", ext: "jpg", inline: true },
  png: { mime: "image/png", ext: "png", inline: true },
  webp: { mime: "image/webp", ext: "webp", inline: true },
  gif: { mime: "image/gif", ext: "gif", inline: true },
  pdf: { mime: "application/pdf", ext: "pdf", inline: false },
  ogg: { mime: "audio/ogg", ext: "ogg", inline: true },
  mp3: { mime: "audio/mpeg", ext: "mp3", inline: true },
  amr: { mime: "audio/amr", ext: "amr", inline: false },
  mp4: { mime: "video/mp4", ext: "mp4", inline: true },
  audioMp4: { mime: "audio/mp4", ext: "m4a", inline: true },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx", inline: false },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx", inline: false },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx", inline: false },
  doc: { mime: "application/msword", ext: "doc", inline: false },
  xls: { mime: "application/vnd.ms-excel", ext: "xls", inline: false },
} as const satisfies Record<string, KnownType>;

const at = (b: Uint8Array, offset: number, text: string): boolean => text.split("").every((c, i) => b[offset + i] === c.charCodeAt(0));
const OFFICE_BY_MIME = new Map<string, KnownType>([[T.docx.mime, T.docx], [T.xlsx.mime, T.xlsx], [T.pptx.mime, T.pptx], [T.doc.mime, T.doc], [T.xls.mime, T.xls]]);

/** What the bytes really are, from a short list; null for anything else. `declared` (Meta's word) only decides between Office files, which share their first bytes. */
export function sniffMedia(b: Uint8Array, declared: string | null): KnownType | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return T.jpeg;
  if (b[0] === 0x89 && at(b, 1, "PNG")) return T.png;
  if (at(b, 0, "GIF8")) return T.gif;
  if (at(b, 0, "RIFF") && at(b, 8, "WEBP")) return T.webp;
  if (at(b, 0, "%PDF-")) return T.pdf;
  if (at(b, 0, "OggS")) return T.ogg;
  if (at(b, 0, "#!AMR")) return T.amr;
  if (at(b, 0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return T.mp3;
  if (at(b, 4, "ftyp")) return declared?.startsWith("audio/") ? T.audioMp4 : T.mp4;
  // a zip (OOXML) or an old Office file: only when Meta says it is one of the Office types
  const zip = b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
  const ole = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  const office = declared ? OFFICE_BY_MIME.get(declared.toLowerCase()) : undefined;
  if (office && ((zip && office.ext.length === 4) || (ole && office.ext.length === 3))) return office;
  return null;
}

/** Does the kind the guest used fit what the bytes are? A picture must be a picture; a document may be a PDF, an Office file or a picture. */
export function kindFits(kind: string, t: KnownType): boolean {
  if (kind === "image" || kind === "sticker") return t.mime.startsWith("image/");
  if (kind === "video") return t.mime === "video/mp4";
  if (kind === "audio") return t.mime.startsWith("audio/");
  if (kind === "document") return t.mime === "application/pdf" || t.mime.startsWith("application/vnd.") || t.mime === "application/msword" || t.mime.startsWith("image/");
  return false;
}

/**
 * Where a file belongs. A hotel has its own folder. On the platform side there are three: `platform` (the company's shared number, which the Super Admin and the Platform Admins work in together),
 * and one each for the personal numbers of a Super Admin (`super-admin`) and of a Platform Admin (`platform-admin`), by the role of the login that owns the number.
 */
export type PlatformFolder = "platform" | "super-admin" | "platform-admin";
export type MediaScope = { kind: "hotel"; hotelId: string } | { kind: "platform"; folder?: PlatformFolder };

/** The object key: the folder, then a name made from the message. The name never comes from the guest. */
export const mediaKey = (scope: MediaScope, messageId: string, ext: string): string => `${mediaPrefix(scope)}${messageId}.${ext}`;
export const mediaPrefix = (scope: MediaScope): string => (scope.kind === "hotel" ? `whatsapp/hotels/${scope.hotelId}/` : `whatsapp/${scope.folder ?? "platform"}/`);
/** Every folder of the platform side: what the Console's chats may open (never a hotel's folder). */
export const PLATFORM_PREFIXES: readonly string[] = (["platform", "super-admin", "platform-admin"] as const).map((f) => mediaPrefix({ kind: "platform", folder: f }));

/** What is written into the message's media record once the file is kept (or why it was not). */
export type MediaOutcome =
  | { stored: true; key: string; size: number; mime: string; sha256: string | null; inline: boolean }
  | { stored: false; reason: "too_large" | "type_not_allowed" | "download_failed" | "no_storage" | "no_reference" };

export interface MediaCaptureDeps {
  /** The bucket (null on a server without one: files are then not kept and the chat says so). */
  objects: RawObjects | null;
  graph: Pick<GraphClient, "downloadMedia">;
}

/** Downloads one media item of a guest's message and keeps it. Never throws; the reason of a refusal is a short code. */
export async function captureMedia(deps: MediaCaptureDeps, input: { token: string; scope: MediaScope; messageId: string; kind: string; mediaId: string | null; declaredMime: string | null; /** The Super Admin's size limit in bytes (default 16 MB). */ maxBytes?: number }): Promise<MediaOutcome> {
  if (!input.mediaId) return { stored: false, reason: "no_reference" };
  if (!deps.objects) return { stored: false, reason: "no_storage" };
  const maxBytes = input.maxBytes ?? MEDIA_MAX_BYTES;
  let got: Awaited<ReturnType<GraphClient["downloadMedia"]>>;
  try {
    got = await deps.graph.downloadMedia(input.token, input.mediaId, maxBytes);
  } catch {
    return { stored: false, reason: "download_failed" };
  }
  if (got.kind !== "ok") return { stored: false, reason: got.kind === "policy" && got.code === "media_too_large" ? "too_large" : "download_failed" };
  if (got.bytes.length > maxBytes) return { stored: false, reason: "too_large" };
  const type = sniffMedia(got.bytes, got.mimeType ?? input.declaredMime);
  if (!type || !kindFits(input.kind, type)) return { stored: false, reason: "type_not_allowed" };
  const key = mediaKey(input.scope, input.messageId, type.ext);
  try {
    await deps.objects.put(key, got.bytes);
  } catch {
    return { stored: false, reason: "download_failed" };
  }
  return { stored: true, key, size: got.bytes.length, mime: type.mime, sha256: got.sha256, inline: type.inline };
}

export interface StoredMediaFile {
  bytes: Uint8Array;
  type: string;
  name: string;
  /** Draw or play it in the page; else it is a download. */
  inline: boolean;
}

const cleanName = (name: unknown, ext: string): string => {
  // only the last part of whatever path the guest's phone put there, then letters, digits, dot, dash, underscore and space
  const base = (typeof name === "string" ? (name.split(/[\\/]/).pop() ?? "") : "").replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/^\.+/, "").slice(0, 80).trim();
  return base === "" ? `file.${ext}` : base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
};

/**
 * Reads a kept file for a message's media record, only from the folder it belongs to (`prefix`: the hotel's own or the platform's), and checks the bytes again before they leave. `"gone"` is a file the
 * keep time removed (or that was never kept); null is a record that is not a kept file.
 */
export async function openStoredMedia(objects: Pick<RawObjects, "get">, record: unknown, allowed: string | readonly string[]): Promise<StoredMediaFile | "gone" | null> {
  const r = (typeof record === "object" && record !== null ? record : {}) as { stored?: unknown; key?: unknown; mime?: unknown; name?: unknown };
  const prefix = typeof r.key === "string" ? (typeof allowed === "string" ? [allowed] : allowed).find((p) => (r.key as string).startsWith(p)) : undefined;
  if (r.stored !== true || typeof r.key !== "string" || prefix === undefined || r.key.includes("..") || r.key.slice(prefix.length).includes("/")) return null;
  const bytes = await objects.get(r.key);
  if (!bytes) return "gone";
  const type = sniffMedia(bytes, typeof r.mime === "string" ? r.mime : null);
  if (!type) return null;
  return { bytes, type: type.mime, name: cleanName(r.name, type.ext), inline: type.inline };
}

/** Removes kept files older than the keep time (the sweep). Returns how many went. A bucket that cannot be listed removes nothing. */
export async function purgeOldMedia(objects: RawObjects, now: Date, keep: number | { hotel: number; platform: number } = MEDIA_KEEP_DAYS): Promise<number> {
  const days = typeof keep === "number" ? { hotel: keep, platform: keep } : keep;
  let removed = 0;
  for (const o of await objects.list("whatsapp/")) {
    // a hotel's files and the platform side's have their own keep times (the Super Admin sets both)
    const cutoff = now.getTime() - (o.key.startsWith("whatsapp/hotels/") ? days.hotel : days.platform) * 86_400_000;
    if (o.modified.getTime() < cutoff) {
      await objects.remove(o.key);
      removed += 1;
    }
  }
  return removed;
}

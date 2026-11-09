import "server-only";
import type { Metadata } from "sharp";
import { AppError } from "../errors";
import { sharpOf } from "./sharp";

// Every uploaded picture is made small before it is stored (MJ: a 20 MB photo must end as about 1 MB with the same look): decoded with sharp, turned the right way
// up (EXIF orientation), stripped of every metadata block (no camera, place or time leaves with the file), drawn no larger than the profile's longest side, and
// written as WebP at the best quality that fits the target size. Quality steps down only as far as the target needs; if the ladder is used up the picture is
// drawn 15% smaller and the ladder starts again from the second step. Called by the services AFTER checkUpload (real type, size cap, safe SVG) and BEFORE
// media.put, so the stored name's extension always matches what is stored.
//
// Profiles: gallery (website photos, 2560 px), icon (logo, favicon, list icons, 1024 px), id-photo (the guest's ID for the police portal: JPEG, never WebP,
// because the ID-photo store accepts only JPG and PNG; 2000 px). SVG and ICO are kept as they are (vector / multi-size), and so is an animated GIF under the
// target size (its animation would be lost); a bigger one becomes a still WebP of its first frame.

export type CompressProfile = "gallery" | "icon" | "id-photo";
export type StoredType = "webp" | "jpg" | "png" | "gif" | "svg" | "ico";

export interface CompressedImage {
  bytes: Uint8Array;
  type: StoredType;
  width: number;
  height: number;
}

/** The stored size every raster picture stays under: 1 MB. */
export const TARGET_BYTES = 1_048_576;
/** The longest side per profile. */
export const MAX_SIDE: Record<CompressProfile, number> = { gallery: 2560, icon: 1024, "id-photo": 1600 };
/** The stored size per profile: an ID photo is kept IN THE DATABASE (MEDIA_DRIVER=db), so it stays about 400 KB (1600 px is still readable on the police portal). */
export const TARGET_BYTES_BY: Record<CompressProfile, number> = { gallery: TARGET_BYTES, icon: TARGET_BYTES, "id-photo": 400 * 1024 };
/** WebP / JPEG qualities, best first; the first attempt under the target wins. */
export const QUALITY_LADDER: readonly number[] = [82, 76, 70, 64, 58, 52];
/** How much smaller the longest side is drawn when the ladder is used up. */
export const SHRINK_STEP = 0.85;
/** Pictures above this many pixels are refused before decoding (a decompression bomb would otherwise eat the memory of the server). */
export const MAX_INPUT_PIXELS = 80_000_000;

const NOT_READABLE = "That picture could not be read. Pick it again.";
/** The refusal names the upload's own field, like checkUpload does, so the form marks the right box. */
const notReadable = (field: string): AppError => new AppError("VALIDATION_FAILED", NOT_READABLE, { fields: { [field]: NOT_READABLE } });

/** The type sharp found, as the store names it; null for a kind this module does not handle. */
function kindOf(format: string | undefined): StoredType | null {
  switch (format) {
    case "jpeg":
      return "jpg";
    case "png":
    case "webp":
    case "gif":
    case "svg":
      return format;
    default:
      return null;
  }
}

/**
 * Makes one uploaded picture small enough to store. `declared` is what checkUpload sniffed (svg and ico never go through sharp). Throws a VALIDATION_FAILED
 * AppError on `field` when the bytes do not decode as a picture.
 */
export async function compressImage(bytes: Uint8Array, profile: CompressProfile, declared: StoredType, field = "file"): Promise<CompressedImage> {
  if (declared === "svg" || declared === "ico") return { bytes, type: declared, width: 0, height: 0 };

  let meta: Metadata;
  try {
    const sharp = await sharpOf();
    meta = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS, animated: declared === "gif" }).metadata();
  } catch {
    throw notReadable(field);
  }
  const kind = kindOf(meta.format);
  if (!kind || !meta.width || !meta.height) throw notReadable(field);

  // An animated GIF that already fits stays a GIF (its frames would be lost in a still); the sizes below are of one frame.
  const frames = meta.pages ?? 1;
  if (kind === "gif" && frames > 1 && bytes.length <= TARGET_BYTES) {
    const swapped = (meta.orientation ?? 1) >= 5;
    return { bytes, type: "gif", width: swapped ? meta.pageHeight ?? meta.height : meta.width, height: swapped ? meta.width : (meta.pageHeight ?? meta.height) };
  }

  // Page the picture through the ladder: each attempt is one decode + rotate + resize + encode (sharp keeps nothing between attempts).
  const asJpeg = profile === "id-photo";
  const longest = Math.max(meta.width, meta.pageHeight ?? meta.height);
  let side = Math.min(longest, MAX_SIDE[profile]);
  let ladder = QUALITY_LADDER;
  let best: CompressedImage | null = null;
  for (let round = 0; round < 12; round += 1) {
    for (const quality of ladder) {
      const out = await encode(bytes, { side, quality, asJpeg, field });
      if (best === null || out.bytes.length < best.bytes.length) best = out;
      if (out.bytes.length <= TARGET_BYTES_BY[profile]) return out;
    }
    side = Math.max(64, Math.round(side * SHRINK_STEP));
    ladder = QUALITY_LADDER.slice(1);
  }
  // Twelve rounds take any picture well under the target; this only guards the loop.
  if (!best) throw notReadable(field);
  return best;
}

async function encode(bytes: Uint8Array, o: { side: number; quality: number; asJpeg: boolean; field: string }): Promise<CompressedImage> {
  try {
    const sharp = await sharpOf();
    // `rotate()` with no angle applies the EXIF orientation; the metadata is then dropped because withMetadata is never called.
    let image = sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize({ width: o.side, height: o.side, fit: "inside", withoutEnlargement: true });
    image = o.asJpeg ? image.flatten({ background: "#ffffff" }).jpeg({ quality: o.quality, mozjpeg: true }) : image.webp({ quality: o.quality, effort: 4 });
    const { data, info } = await image.toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), type: o.asJpeg ? "jpg" : "webp", width: info.width, height: info.height };
  } catch {
    throw notReadable(o.field);
  }
}

// The upload compressor (src/server/media/compress.ts). What must hold: a very large photo (more than 20 MB as PNG) comes out as WebP under 1 MB with its longest side
// at most 2560 px; a sideways photo (EXIF orientation 6) is turned upright and carries no metadata any more; the guest's ID photo stays a JPEG under 1 MB; an icon
// is at most 1024 px; SVG and ICO pass through untouched; bytes that are not a picture are refused with a plain VALIDATION_FAILED.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import sharp, { type Sharp } from "sharp";
import { AppError } from "../../src/server/errors";
import { compressImage, MAX_SIDE, TARGET_BYTES, TARGET_BYTES_BY } from "../../src/server/media/compress";

/** A noisy picture (random pixels do not compress, so the PNG is big). */
async function noisy(width: number, height: number, format: "png" | "jpeg", extra: (s: Sharp) => Sharp = (s) => s): Promise<Uint8Array> {
  // random pixels compress to nothing: a PNG of them is huge, which is the point
  const raw = randomBytes(width * height * 3);
  let s = sharp(raw, { raw: { width, height, channels: 3 } });
  s = extra(s);
  const out = await (format === "png" ? s.png({ compressionLevel: 1 }) : s.jpeg({ quality: 95 })).toBuffer();
  return new Uint8Array(out);
}

describe("compressImage", () => {
  test("a photo of more than 20 MB becomes a WebP under 1 MB, longest side 2560", async () => {
    const big = await noisy(3200, 2400, "png");
    assert.ok(big.length > 20 * 1024 * 1024, `the input must be above 20 MB, was ${big.length}`);
    const out = await compressImage(big, "gallery", "png");
    assert.equal(out.type, "webp");
    assert.ok(out.bytes.length <= TARGET_BYTES, `stored size ${out.bytes.length}`);
    assert.ok(Math.max(out.width, out.height) <= MAX_SIDE.gallery);
    assert.equal((await sharp(out.bytes).metadata()).format, "webp");
    console.info(`[compress] ${(big.length / 1048576).toFixed(1)} MB PNG ${3200}x${2400} -> ${(out.bytes.length / 1048576).toFixed(2)} MB WebP ${out.width}x${out.height}`);
  });

  test("a small, already fine JPEG is still written as WebP and never enlarged", async () => {
    const small = await noisy(640, 480, "jpeg");
    const out = await compressImage(small, "gallery", "jpg");
    assert.equal(out.type, "webp");
    assert.deepEqual([out.width, out.height], [640, 480]);
  });

  test("EXIF orientation is applied (a sideways photo comes out upright) and no metadata is kept", async () => {
    const sideways = await noisy(800, 400, "jpeg", (s) => s.withMetadata({ orientation: 6 }));
    assert.equal((await sharp(sideways).metadata()).orientation, 6);
    const out = await compressImage(sideways, "gallery", "jpg");
    assert.deepEqual([out.width, out.height], [400, 800]);
    const meta = await sharp(out.bytes).metadata();
    assert.equal(meta.orientation, undefined);
    assert.equal(meta.exif, undefined);
  });

  test("the guest's ID photo stays a JPEG (the police portal takes JPG/PNG only), under 400 KB and at most 1600 px", async () => {
    const big = await noisy(4000, 3000, "jpeg");
    const out = await compressImage(big, "id-photo", "jpg");
    assert.equal(out.type, "jpg");
    assert.ok(out.bytes.length <= TARGET_BYTES_BY["id-photo"], `stored size ${out.bytes.length}`);
    assert.ok(Math.max(out.width, out.height) <= MAX_SIDE["id-photo"]);
    assert.equal((await sharp(out.bytes).metadata()).format, "jpeg");
  });

  test("an icon is at most 1024 px", async () => {
    const out = await compressImage(await noisy(3000, 1000, "png"), "icon", "png");
    assert.equal(out.type, "webp");
    assert.ok(Math.max(out.width, out.height) <= MAX_SIDE.icon);
  });

  test("SVG and ICO pass through untouched", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    assert.deepEqual(await compressImage(svg, "icon", "svg"), { bytes: svg, type: "svg", width: 0, height: 0 });
    const ico = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]);
    assert.equal((await compressImage(ico, "icon", "ico")).type, "ico");
  });

  test("bytes that are not a picture are refused with VALIDATION_FAILED", async () => {
    const junk = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    await assert.rejects(compressImage(junk, "gallery", "png"), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_FAILED");
  });
});

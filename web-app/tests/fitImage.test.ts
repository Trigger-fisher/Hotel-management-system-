// Unit tests for the pure part of src/lib/image/fitImage.ts (the size plan of the website image uploads).
// Run with `npm test` or `node --test tests/fitImage.test.ts` (Node's built-in runner; Node strips the TypeScript types).
// The canvas part (decode, draw, encode) needs a browser and is checked by hand.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

// The app writes extensionless relative imports (bundler style). Plain Node needs the extension.
type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { FIT_MAX_BYTES, FIT_MAX_SIDE, fileKind, fitError, isFitError, keepsType, planFit, renameFor, sideSteps, sizeFor } = await import("../src/lib/image/fitImage");

const MB = 1_048_576;

describe("limits", () => {
  test("3 MB sent at most (4/3 as base64 stays under a 4.5 MB request), 2560 px longest side", () => {
    assert.equal(FIT_MAX_BYTES, 3_145_728);
    assert.equal(FIT_MAX_BYTES, 3 * MB);
    assert.ok(FIT_MAX_BYTES < 4_194_304);
    assert.equal(FIT_MAX_SIDE, 2560);
  });
});

describe("sideSteps", () => {
  test("starts at min(original, 2560) and shrinks about 15% a step", () => {
    const s = sideSteps(4000);
    assert.equal(s[0], 2560);
    assert.equal(s[1], Math.floor(2560 * 0.85));
    for (let i = 1; i < s.length; i++) {
      assert.ok(s[i]! < s[i - 1]!, "strictly smaller");
      assert.ok(s[i]! >= Math.floor(s[i - 1]! * 0.85) - 1 && s[i]! <= Math.ceil(s[i - 1]! * 0.85), "about 15% smaller");
    }
    assert.ok(s[s.length - 1]! >= 320, "stops at the minimum side");
    assert.ok(Math.floor(s[s.length - 1]! * 0.85) < 320, "goes down as far as it can");
  });
  test("never upscales: a small picture starts at its own size", () => {
    assert.equal(sideSteps(1200)[0], 1200);
    assert.deepEqual(sideSteps(300), [300]);
  });
  test("custom maxSide", () => {
    assert.equal(sideSteps(5000, 1000)[0], 1000);
  });
});

describe("planFit", () => {
  test("passes through a JPEG already under the limit and the max side", () => {
    assert.deepEqual(planFit({ width: 2000, height: 1500, bytes: 2 * MB, type: "image/jpeg", hasAlpha: false }), { passThrough: true, attempts: [] });
    assert.equal(planFit({ width: 2560, height: 1440, bytes: FIT_MAX_BYTES, type: "image/png", hasAlpha: true }).passThrough, true);
    assert.equal(planFit({ width: 800, height: 800, bytes: 100_000, type: "image/webp", hasAlpha: false }).passThrough, true);
  });

  test("a small file that is too wide is still redrawn at 2560", () => {
    const p = planFit({ width: 6000, height: 4000, bytes: 3 * MB, type: "image/jpeg", hasAlpha: false });
    assert.equal(p.passThrough, false);
    assert.deepEqual(p.attempts[0], { side: 2560, type: "image/jpeg", quality: 0.9 });
  });

  test("a big phone photo: 0.9, 0.8, 0.7 at each side, then a step down", () => {
    const p = planFit({ width: 4032, height: 3024, bytes: 9 * MB, type: "image/jpeg", hasAlpha: false });
    assert.equal(p.passThrough, false);
    assert.deepEqual(p.attempts.slice(0, 4), [
      { side: 2560, type: "image/jpeg", quality: 0.9 },
      { side: 2560, type: "image/jpeg", quality: 0.8 },
      { side: 2560, type: "image/jpeg", quality: 0.7 },
      { side: 2176, type: "image/jpeg", quality: 0.9 },
    ]);
    assert.equal(p.attempts.length, sideSteps(4032).length * 3);
    assert.ok(p.attempts.every((a) => a.type === "image/jpeg"));
  });

  test("never upscales: a heavy but small picture starts at its own side", () => {
    const p = planFit({ width: 1800, height: 1200, bytes: 6 * MB, type: "image/png", hasAlpha: false });
    assert.equal(p.attempts[0]!.side, 1800);
    assert.ok(p.attempts.every((a) => a.side <= 1800));
  });

  test("a PNG without transparency becomes JPEG", () => {
    const p = planFit({ width: 3000, height: 2000, bytes: 8 * MB, type: "image/png", hasAlpha: false });
    assert.ok(p.attempts.every((a) => a.type === "image/jpeg"));
  });

  test("a see-through PNG tries PNG at every side first, then JPEG", () => {
    const p = planFit({ width: 3000, height: 3000, bytes: 8 * MB, type: "image/png", hasAlpha: true });
    const sides = sideSteps(3000);
    const png = p.attempts.filter((a) => a.type === "image/png");
    assert.deepEqual(png.map((a) => a.side), sides);
    assert.ok(png.every((a) => a.quality === undefined));
    const firstJpeg = p.attempts.findIndex((a) => a.type === "image/jpeg");
    assert.equal(firstJpeg, sides.length, "every PNG try comes before the first JPEG");
    assert.deepEqual(p.attempts[firstJpeg], { side: 2560, type: "image/jpeg", quality: 0.9 });
  });

  test("transparency of a JPEG source is ignored", () => {
    const p = planFit({ width: 3000, height: 3000, bytes: 8 * MB, type: "image/jpeg", hasAlpha: true });
    assert.ok(p.attempts.every((a) => a.type === "image/jpeg"));
  });

  test("types the server does not keep (BMP, HEIC) are always re-encoded", () => {
    assert.equal(planFit({ width: 400, height: 300, bytes: 360_000, type: "image/bmp", hasAlpha: false }).passThrough, false);
    assert.equal(planFit({ width: 1000, height: 800, bytes: 500_000, type: "image/heic", hasAlpha: false }).attempts[0]!.side, 1000);
  });

  test("a lower limit (icons and logo, 2 MB) is respected", () => {
    assert.equal(planFit({ width: 1000, height: 1000, bytes: 2.5 * MB, type: "image/jpeg", hasAlpha: false, maxBytes: 2 * MB }).passThrough, false);
    assert.equal(planFit({ width: 1000, height: 1000, bytes: 1.5 * MB, type: "image/jpeg", hasAlpha: false, maxBytes: 2 * MB }).passThrough, true);
  });
});

describe("helpers", () => {
  test("sizeFor keeps the aspect and never upscales", () => {
    assert.deepEqual(sizeFor(4032, 3024, 2560), { width: 2560, height: 1920 });
    assert.deepEqual(sizeFor(3024, 4032, 2560), { width: 1920, height: 2560 });
    assert.deepEqual(sizeFor(800, 600, 2560), { width: 800, height: 600 });
    assert.deepEqual(sizeFor(10000, 1, 100), { width: 100, height: 1 });
  });

  test("renameFor changes or adds the extension", () => {
    assert.equal(renameFor("Lobby.HEIC", "image/jpeg"), "Lobby.jpg");
    assert.equal(renameFor("logo.webp", "image/png"), "logo.png");
    assert.equal(renameFor("my.room.photo.png", "image/jpeg"), "my.room.photo.jpg");
    assert.equal(renameFor("noext", "image/jpeg"), "noext.jpg");
    assert.equal(renameFor(".png", "image/jpeg"), "image.jpg");
  });

  test("fileKind: SVG, GIF and ICO are sent as they are; non-pictures are refused", () => {
    assert.equal(fileKind("image/svg+xml", "a.svg"), "asIs");
    assert.equal(fileKind("image/gif", "a.gif"), "asIs");
    assert.equal(fileKind("", "favicon.ico"), "asIs");
    assert.equal(fileKind("image/jpeg", "a.jpg"), "raster");
    assert.equal(fileKind("", "IMG_1234.HEIC"), "raster");
    assert.equal(fileKind("application/pdf", "menu.pdf"), "unknown");
    assert.equal(fileKind("", "notes.txt"), "unknown");
  });

  test("keepsType", () => {
    assert.ok(keepsType("image/jpeg") && keepsType("image/png") && keepsType("image/webp"));
    assert.ok(!keepsType("image/bmp") && !keepsType("image/heic"));
  });

  test("fit errors carry a code", () => {
    const e = fitError("TOO_LARGE", false, "x");
    assert.ok(e instanceof Error);
    assert.ok(isFitError(e));
    assert.equal(e.code, "TOO_LARGE");
    assert.equal(e.shrinkable, false);
    assert.ok(!isFitError(new Error("plain")));
  });
});

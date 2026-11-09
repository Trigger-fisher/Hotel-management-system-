// WhatsApp media (4 Nov 2026): the bytes decide the type, only inert formats are kept, each in its own folder (hotel or platform), a file is read back only from its own folder, old files go.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.media.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { checkWhatsAppStorage, configureWhatsAppObjects } from "@/server/compose/whatsappMedia";
import type { RawObjects } from "@/server/mail/files";
import { createFakeMeta } from "@/server/whatsapp/fakeMeta";
import { createGraphClient } from "@/server/whatsapp/graph";
import { captureMedia, kindFits, MEDIA_MAX_BYTES, mediaKey, mediaPrefix, openStoredMedia, PLATFORM_PREFIXES, purgeOldMedia, sniffMedia } from "@/server/whatsapp/media";

const pad = (head: number[] | string, n = 64): Uint8Array => {
  const b = new Uint8Array(n);
  (typeof head === "string" ? [...head].map((c) => c.charCodeAt(0)) : head).forEach((v, i) => (b[i] = v));
  return b;
};
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = pad("%PDF-1.7");
const OGG = pad("OggS");
const MP4 = (() => {
  const b = pad("");
  "ftypisom".split("").forEach((c, i) => {
    b[4 + i] = c.charCodeAt(0);
  });
  return b;
})();
const ZIP = pad([0x50, 0x4b, 0x03, 0x04]);
const EXE = pad("MZ");
const HTML = pad("<html><script>alert(1)</script></html>");
const SVG = pad("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>");

const memoryObjects = (): RawObjects & { map: Map<string, { bytes: Uint8Array; modified: Date }> } => {
  const map = new Map<string, { bytes: Uint8Array; modified: Date }>();
  return {
    map,
    put: async (key, bytes) => void map.set(key, { bytes, modified: new Date("2026-11-04T10:00:00Z") }),
    get: async (key) => map.get(key)?.bytes ?? null,
    size: async (key) => map.get(key)?.bytes.length ?? null,
    remove: async (key) => void map.delete(key),
    list: async (prefix) => [...map].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.bytes.length, modified: v.modified })),
  };
};
const HOTEL = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";

describe("what the bytes are", () => {
  test("pictures, PDF, voice, video and Office files are known; programs, web pages and SVG are not; a name or a declared type cannot change that", () => {
    assert.equal(sniffMedia(JPEG, "application/pdf")?.mime, "image/jpeg");
    assert.equal(sniffMedia(PNG, null)?.ext, "png");
    assert.equal(sniffMedia(PDF, "image/png")?.mime, "application/pdf");
    assert.equal(sniffMedia(OGG, "audio/ogg")?.mime, "audio/ogg");
    assert.equal(sniffMedia(MP4, "video/mp4")?.mime, "video/mp4");
    assert.equal(sniffMedia(MP4, "audio/mp4")?.mime, "audio/mp4");
    assert.equal(sniffMedia(ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")?.ext, "docx");
    assert.equal(sniffMedia(ZIP, "application/zip"), null, "a zip that does not say it is an Office file");
    assert.equal(sniffMedia(ZIP, null), null);
    for (const bad of [EXE, HTML, SVG, pad("")]) assert.equal(sniffMedia(bad, "image/jpeg"), null);
    assert.equal(sniffMedia(new Uint8Array(4), null), null, "too short");
  });

  test("a kind must fit the bytes: a photo is a picture, a document may be a PDF, an Office file or a picture, never audio", () => {
    const jpeg = sniffMedia(JPEG, null)!;
    const pdf = sniffMedia(PDF, null)!;
    const ogg = sniffMedia(OGG, null)!;
    assert.deepEqual([kindFits("image", jpeg), kindFits("image", pdf), kindFits("sticker", jpeg)], [true, false, true]);
    assert.deepEqual([kindFits("document", pdf), kindFits("document", ogg), kindFits("audio", ogg), kindFits("video", ogg)], [true, false, true, false]);
  });
});

describe("keeping a guest's file", () => {
  const run = async (bytes: Uint8Array, mime: string, kind: string, scope: { kind: "hotel"; hotelId: string } | { kind: "platform" } = { kind: "hotel", hotelId: HOTEL }, objects: RawObjects | null = memoryObjects()) => {
    const meta = createFakeMeta();
    meta.setMedia(bytes, mime);
    const graph = createGraphClient({ fetch: meta.fetch });
    return { out: await captureMedia({ objects, graph }, { token: "tok", scope, messageId: "abc123", kind, mediaId: "media-1", declaredMime: mime }), objects };
  };

  test("a picture is kept in the hotel's own folder, the platform's in its own; the key never carries the guest's name", async () => {
    const hotel = await run(JPEG, "image/jpeg", "image");
    assert.deepEqual(hotel.out, { stored: true, key: `whatsapp/hotels/${HOTEL}/abc123.jpg`, size: 64, mime: "image/jpeg", sha256: "abc", inline: true });
    assert.ok((hotel.objects as ReturnType<typeof memoryObjects>).map.has(`whatsapp/hotels/${HOTEL}/abc123.jpg`));
    const platform = await run(PDF, "application/pdf", "document", { kind: "platform" });
    assert.equal(platform.out.stored && platform.out.key, "whatsapp/platform/abc123.pdf");
    assert.equal(mediaKey({ kind: "platform" }, "x", "pdf"), "whatsapp/platform/x.pdf");
  });

  test("refusals have a short reason and keep nothing: a program, a wrong kind, too large, no reference, no bucket", async () => {
    const exe = await run(EXE, "image/jpeg", "image");
    assert.deepEqual(exe.out, { stored: false, reason: "type_not_allowed" });
    assert.equal((exe.objects as ReturnType<typeof memoryObjects>).map.size, 0);
    assert.deepEqual((await run(PDF, "application/pdf", "image")).out, { stored: false, reason: "type_not_allowed" });
    assert.deepEqual((await run(new Uint8Array(MEDIA_MAX_BYTES + 1).fill(0xff, 0, 3), "image/jpeg", "image")).out, { stored: false, reason: "too_large" });
    assert.deepEqual((await run(JPEG, "image/jpeg", "image", { kind: "platform" }, null)).out, { stored: false, reason: "no_storage" });
    const meta = createFakeMeta();
    assert.deepEqual(await captureMedia({ objects: memoryObjects(), graph: createGraphClient({ fetch: meta.fetch }) }, { token: "t", scope: { kind: "platform" }, messageId: "m", kind: "image", mediaId: null, declaredMime: null }), { stored: false, reason: "no_reference" });
  });
});

describe("the file storage check", () => {
  test("a working bucket passes (the test file is gone afterwards); a missing, wrong or undeletable bucket fails with a sentence", async () => {
    const good = memoryObjects();
    configureWhatsAppObjects(good);
    assert.equal((await checkWhatsAppStorage()).ok, true);
    assert.equal(good.map.size, 0, "nothing left behind");
    configureWhatsAppObjects(null);
    const none = await checkWhatsAppStorage();
    assert.deepEqual([none.ok, /not set up/.test(none.message)], [false, true]);
    configureWhatsAppObjects({ ...good, get: async () => new Uint8Array([1, 2, 3]) });
    assert.match((await checkWhatsAppStorage()).message, /did not give the same bytes/);
    const stuck = memoryObjects();
    configureWhatsAppObjects({ ...stuck, remove: async () => undefined });
    assert.match((await checkWhatsAppStorage()).message, /did not delete/);
    configureWhatsAppObjects({ ...good, put: async () => { throw new Error("secret detail"); } });
    const down = await checkWhatsAppStorage();
    assert.equal(down.ok, false);
    assert.ok(!down.message.includes("secret detail"), "no detail of the failure leaks");
    configureWhatsAppObjects(null);
  });
});

describe("serving and purging", () => {
  test("a file is read back only from its own folder and only when the record says it is kept; the bytes are checked again; the name is made safe", async () => {
    const objects = memoryObjects();
    await objects.put(`whatsapp/hotels/${HOTEL}/abc.jpg`, JPEG);
    await objects.put(`whatsapp/hotels/${OTHER}/def.jpg`, JPEG);
    await objects.put(`whatsapp/hotels/${HOTEL}/evil.jpg`, EXE);
    const mine = mediaPrefix({ kind: "hotel", hotelId: HOTEL });
    const ok = await openStoredMedia(objects, { stored: true, key: `${mine}abc.jpg`, mime: "image/jpeg", name: "../../My Room Photo!.png" }, mine);
    assert.ok(typeof ok === "object" && ok !== null);
    if (typeof ok === "object" && ok !== null) assert.deepEqual([ok.type, ok.inline, ok.name], ["image/jpeg", true, "My Room Photo_.png.jpg"]);
    assert.equal(await openStoredMedia(objects, { stored: true, key: `whatsapp/hotels/${OTHER}/def.jpg` }, mine), null, "another hotel's folder");
    assert.equal(await openStoredMedia(objects, { stored: true, key: `${mine}../x.jpg` }, mine), null);
    assert.equal(await openStoredMedia(objects, { stored: true, key: `${mine}sub/x.jpg` }, mine), null);
    assert.equal(await openStoredMedia(objects, { stored: false, reason: "type_not_allowed" }, mine), null);
    assert.equal(await openStoredMedia(objects, { stored: true, key: `${mine}evil.jpg` }, mine), null, "bytes that are not a known type never leave");
    assert.equal(await openStoredMedia(objects, { stored: true, key: `${mine}missing.jpg` }, mine), "gone");
  });

  test("the platform side has three folders (company number, Super Admin's number, Platform Admin's number); the Console opens all three and never a hotel's", async () => {
    const objects = memoryObjects();
    const scopes = [{ kind: "platform" as const }, { kind: "platform" as const, folder: "super-admin" as const }, { kind: "platform" as const, folder: "platform-admin" as const }];
    assert.deepEqual(scopes.map((s) => mediaKey(s, "m1", "jpg")), ["whatsapp/platform/m1.jpg", "whatsapp/super-admin/m1.jpg", "whatsapp/platform-admin/m1.jpg"]);
    for (const s of scopes) await objects.put(mediaKey(s, "m1", "jpg"), JPEG);
    await objects.put(mediaKey({ kind: "hotel", hotelId: HOTEL }, "m1", "jpg"), JPEG);
    for (const s of scopes) assert.ok(typeof (await openStoredMedia(objects, { stored: true, key: mediaKey(s, "m1", "jpg") }, PLATFORM_PREFIXES)) === "object");
    assert.equal(await openStoredMedia(objects, { stored: true, key: mediaKey({ kind: "hotel", hotelId: HOTEL }, "m1", "jpg") }, PLATFORM_PREFIXES), null);
    assert.equal(await openStoredMedia(objects, { stored: true, key: mediaKey(scopes[1], "m1", "jpg") }, mediaPrefix({ kind: "hotel", hotelId: HOTEL })), null, "a hotel's chat never opens a platform folder");
  });

  test("the Super Admin's size limit decides what is kept: a file over it is refused, one under it is kept", async () => {
    const meta = createFakeMeta();
    const big = new Uint8Array(3 * 1024 * 1024);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    meta.setMedia(big, "image/jpeg");
    const base = { objects: memoryObjects(), graph: createGraphClient({ fetch: meta.fetch }) };
    const input = { token: "t", scope: { kind: "platform" as const }, messageId: "m", kind: "image", mediaId: "x", declaredMime: "image/jpeg" };
    assert.deepEqual(await captureMedia(base, { ...input, maxBytes: 2 * 1024 * 1024 }), { stored: false, reason: "too_large" });
    assert.equal((await captureMedia(base, { ...input, maxBytes: 4 * 1024 * 1024 })).stored, true);
  });

  test("a hotel's files and the platform side's have their own keep times", async () => {
    const objects = memoryObjects();
    await objects.put(`whatsapp/hotels/${HOTEL}/a.jpg`, JPEG);
    await objects.put("whatsapp/super-admin/b.jpg", JPEG);
    // both written 2026-11-04; ten days later the hotel's 7-day files go, the platform side's 30-day files stay
    assert.equal(await purgeOldMedia(objects, new Date("2026-11-14T10:00:00Z"), { hotel: 7, platform: 30 }), 1);
    assert.deepEqual([...objects.map.keys()], ["whatsapp/super-admin/b.jpg"]);
  });

  test("the sweep removes only whatsapp files older than the keep time", async () => {
    const objects = memoryObjects();
    await objects.put("whatsapp/platform/old.jpg", JPEG);
    await objects.put("mail/other.bin", JPEG);
    assert.equal(await purgeOldMedia(objects, new Date("2026-11-20T10:00:00Z"), 30), 0, "16 days old");
    assert.equal(await purgeOldMedia(objects, new Date("2026-12-10T10:00:00Z"), 30), 1, "36 days old");
    assert.deepEqual([...objects.map.keys()], ["mail/other.bin"]);
  });
});

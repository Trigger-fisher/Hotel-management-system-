// The S3-compatible media store (MEDIA_DRIVER=s3) against a tiny in-process fake S3 server (node:http). What must hold: put/get/has/remove round trip
// under `${prefix}${hotelId}/${name}`; every request carries a well-formed AWS Signature V4 that an independent check in this file accepts; a missing
// object is null / false; path-style and virtual-host addresses; the same name rules as the local store; no secret in any thrown error. The signer is
// also checked against AWS's published example signatures.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { createS3MediaStore, objectUrl, s3MediaStoreFromConfig, signV4 } from "../../src/server/media/s3";

const HOTEL = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5b";
const OTHER = "0190f1e2-3c4d-7e5f-8a9b-0c1d2e3f4a5c";
const ACCESS = "AKIATESTACCESSKEY01";
const SECRET = "test/Secret+Key-that-must-never-leak-0123456789";
const REGION = "ap-south-1";

interface Seen { method: string; path: string; authorization: string; amzDate: string; contentSha: string; validSignature: boolean }
const objects = new Map<string, Buffer>();
let seen: Seen[] = [];
let forceStatus: number | null = null;
let server: Server;
let endpoint = "";

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const hmac = (k: Buffer | string, d: string): Buffer => createHmac("sha256", k).update(d).digest();

/** An independent SigV4 check of what reached the server (not the code under test). */
function verify(req: IncomingMessage, body: Buffer): boolean {
  const auth = String(req.headers.authorization ?? "");
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m || m[1] !== ACCESS || m[3] !== REGION) return false;
  const amzDate = String(req.headers["x-amz-date"] ?? "");
  if (!/^\d{8}T\d{6}Z$/.test(amzDate) || amzDate.slice(0, 8) !== m[2]) return false;
  const payloadHash = String(req.headers["x-amz-content-sha256"] ?? "");
  if (payloadHash !== sha256(body)) return false;
  const signed = m[4].split(";");
  if (!signed.includes("host") || !signed.includes("x-amz-date") || !signed.includes("x-amz-content-sha256")) return false;
  const canonicalHeaders = signed.map((h) => `${h}:${String(req.headers[h] ?? "").trim()}\n`).join("");
  const url = new URL(req.url ?? "/", "http://x");
  const canonical = [req.method, url.pathname, "", canonicalHeaders, m[4], payloadHash].join("\n");
  const scope = `${m[2]}/${REGION}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, m[2]), REGION), "s3"), "aws4_request");
  return createHmac("sha256", key).update(toSign).digest("hex") === m[5];
}

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      const validSignature = verify(req, body);
      seen.push({ method: req.method ?? "", path, authorization: String(req.headers.authorization ?? ""), amzDate: String(req.headers["x-amz-date"] ?? ""), contentSha: String(req.headers["x-amz-content-sha256"] ?? ""), validSignature });
      if (forceStatus !== null) return void res.writeHead(forceStatus, { "content-type": "application/xml" }).end(`<Error><Code>Nope</Code><Key>${path}</Key></Error>`);
      if (!validSignature) return void res.writeHead(403).end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
      if (req.method === "PUT") {
        objects.set(path, body);
        return void res.writeHead(200, { etag: '"x"' }).end();
      }
      const obj = objects.get(path);
      if (req.method === "DELETE") {
        objects.delete(path);
        return void res.writeHead(204).end();
      }
      if (!obj) return void res.writeHead(404, { "content-type": "application/xml" }).end(req.method === "HEAD" ? undefined : "<Error><Code>NoSuchKey</Code></Error>");
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(obj.length) });
      res.end(req.method === "HEAD" ? undefined : obj);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  objects.clear();
  seen = [];
  forceStatus = null;
});

const store = (prefix = "media/") => createS3MediaStore({ endpoint, region: REGION, bucket: "hms-test", accessKeyId: ACCESS, secretAccessKey: SECRET, prefix, forcePathStyle: true, timeoutMs: 5000 });
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe("the S3 media store", () => {
  test("put, get, has and remove round trip under prefix/hotel/name, each request signed", async () => {
    const s = store();
    assert.equal(await s.put(HOTEL, "lobby.jpg", JPG), "lobby.jpg");
    assert.ok(objects.has(`/hms-test/media/${HOTEL}/lobby.jpg`));
    assert.equal(await s.has(HOTEL, "lobby.jpg"), true);
    const got = await s.get(HOTEL, "lobby.jpg");
    assert.ok(got);
    assert.deepEqual([...got.bytes], [...JPG]);
    assert.equal(got.contentType, "image/jpeg");
    await s.remove(HOTEL, "lobby.jpg");
    assert.equal(await s.has(HOTEL, "lobby.jpg"), false);
    assert.equal(await s.get(HOTEL, "lobby.jpg"), null);
    assert.deepEqual(seen.map((x) => x.method), ["PUT", "HEAD", "GET", "DELETE", "HEAD", "GET"]);
    for (const x of seen) {
      assert.ok(x.validSignature, `${x.method} signature`);
      assert.match(x.authorization, new RegExp(`^AWS4-HMAC-SHA256 Credential=${ACCESS}/\\d{8}/${REGION}/s3/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$`));
      assert.ok(!x.authorization.includes(SECRET));
    }
    assert.equal(seen[0].contentSha, sha256(Buffer.from(JPG)));
  });

  test("a missing object: get null, has false, remove is fine; another hotel's file is never reached", async () => {
    const s = store();
    await s.put(HOTEL, "logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    assert.equal(await s.get(OTHER, "logo.png"), null);
    assert.equal(await s.has(OTHER, "logo.png"), false);
    await s.remove(OTHER, "missing.png");
    assert.ok(objects.has(`/hms-test/media/${HOTEL}/logo.png`));
  });

  test("the ID photo prefix is separate: the media store cannot read an ID photo with the same hotel and name", async () => {
    await store("id-photos/").put(HOTEL, "a1b2c3.jpg", JPG);
    assert.ok(objects.has(`/hms-test/id-photos/${HOTEL}/a1b2c3.jpg`));
    assert.equal(await store("media/").get(HOTEL, "a1b2c3.jpg"), null);
  });

  test("the same name rules as the local store: a bad hotel id or name is refused before any request", async () => {
    const s = store();
    for (const [h, n] of [["not-a-uuid", "a.jpg"], [HOTEL, "../x.jpg"], [HOTEL, "a/b.jpg"], [HOTEL, "A.JPG"], [HOTEL, "x.exe"], [HOTEL, ""]]) {
      await assert.rejects(s.get(h, n));
      await assert.rejects(s.put(h, n, JPG));
    }
    assert.equal(seen.length, 0);
    assert.throws(() => store("../"));
    assert.throws(() => store("/abs/"));
  });

  test("a refusal or an unreachable store: an error that names the operation and status, never the secret, the key or the address", async () => {
    forceStatus = 500;
    for (const run of [() => store().get(HOTEL, "a.jpg"), () => store().put(HOTEL, "a.jpg", JPG), () => store().has(HOTEL, "a.jpg"), () => store().remove(HOTEL, "a.jpg")]) {
      await assert.rejects(run(), (e: Error) => /HTTP 500/.test(e.message) && !e.message.includes(SECRET) && !e.message.includes(HOTEL) && !e.message.includes(ACCESS));
    }
    forceStatus = 403;
    await assert.rejects(store().get(HOTEL, "a.jpg"), (e: Error) => /HTTP 403/.test(e.message));
    const dead = createS3MediaStore({ endpoint: "http://127.0.0.1:1", region: REGION, bucket: "hms-test", accessKeyId: ACCESS, secretAccessKey: SECRET, prefix: "media/", forcePathStyle: true, timeoutMs: 2000 });
    await assert.rejects(dead.get(HOTEL, "a.jpg"), (e: Error) => /could not be reached/.test(e.message) && !e.message.includes(SECRET) && !e.message.includes("127.0.0.1") && (e as Error & { cause?: unknown }).cause === undefined);
  });

  test("addresses: path-style and virtual-host style", () => {
    const key = `media/${HOTEL}/lobby.jpg`;
    assert.equal(objectUrl({ endpoint: "https://s3.ap-south-1.amazonaws.com", bucket: "hms-media", forcePathStyle: false }, key).href, `https://hms-media.s3.ap-south-1.amazonaws.com/${key}`);
    assert.equal(objectUrl({ endpoint: "https://s3.ap-south-1.amazonaws.com/", bucket: "hms-media", forcePathStyle: true }, key).href, `https://s3.ap-south-1.amazonaws.com/hms-media/${key}`);
    assert.equal(objectUrl({ endpoint: "http://127.0.0.1:9000", bucket: "hms", forcePathStyle: true }, key).href, `http://127.0.0.1:9000/hms/${key}`);
    assert.equal(objectUrl({ endpoint: "https://acc.r2.cloudflarestorage.com", bucket: "b", forcePathStyle: false }, "test$file.text").pathname, "/test%24file.text");
  });

  test("the signer matches AWS's published examples (Signature V4, S3 GET and PUT object)", () => {
    const common = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", now: new Date("2013-05-24T00:00:00Z") };
    const get = signV4({ ...common, method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), headers: { range: "bytes=0-9" }, payloadHash: sha256("") });
    assert.equal(get.authorization, "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    const put = signV4({
      ...common, method: "PUT", url: objectUrl({ endpoint: "https://s3.amazonaws.com", bucket: "examplebucket", forcePathStyle: false }, "test$file.text"),
      headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" }, payloadHash: sha256("Welcome to Amazon S3."),
    });
    assert.match(put.authorization, /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
  });

  test("from the app config: a missing setting names the variable, never a value", () => {
    assert.throws(() => s3MediaStoreFromConfig({ S3_ENDPOINT: endpoint, S3_REGION: REGION, S3_BUCKET: "b", S3_SECRET_ACCESS_KEY: SECRET }, "media/"), (e: Error) => /S3_ACCESS_KEY_ID/.test(e.message) && !e.message.includes(SECRET));
    assert.ok(s3MediaStoreFromConfig({ S3_ENDPOINT: endpoint, S3_REGION: REGION, S3_BUCKET: "b", S3_ACCESS_KEY_ID: ACCESS, S3_SECRET_ACCESS_KEY: SECRET, S3_FORCE_PATH_STYLE: "1" }, "media/"));
  });
});

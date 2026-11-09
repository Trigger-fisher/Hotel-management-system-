import "server-only";
import { createHash, createHmac } from "node:crypto";
import { AppError } from "../errors";
import { assertSafe, contentTypeOf, type MediaStore } from "./store";

// The S3-compatible media store (MEDIA_DRIVER=s3): the same port as the local folder, for a host with no lasting disk (Vercel). Plain fetch and AWS
// Signature Version 4 with node:crypto only (no SDK). Works with AWS S3, Cloudflare R2, MinIO and other S3-compatible stores.
// - Object key = `${prefix}${hotelId}/${name}`; the hotel id and the name pass the same assertSafe rules as the local store, so a key can never leave
//   its hotel's folder. The website media use the prefix "media/", the guests' ID photos "id-photos/" in the SAME private bucket: the website media
//   route reads only the media store, so an ID photo is never served publicly. The bucket itself must stay private (no public policy, no public URL).
// - The content type is taken from the stored name (as the local store does), never from what the bucket answers.
// - No error carries a key, a signature or the secret: a refusal names only the operation and the HTTP status.

export interface S3StoreOptions {
  /** http(s)://host[:port] (https://s3.ap-south-1.amazonaws.com, https://<account>.r2.cloudflarestorage.com, http://127.0.0.1:9000), with a fixed path only for Supabase Storage (https://<project>.storage.supabase.co/storage/v1/s3). */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Key prefix, ending in "/" ("media/", "id-photos/"). */
  prefix: string;
  /** true: endpoint/bucket/key (MinIO, most self-hosted); false: bucket.endpoint/key (virtual-host style, AWS default). */
  forcePathStyle: boolean;
  /** Milliseconds before one call is given up. Default 20 s. */
  timeoutMs?: number;
  /** For tests: the clock used for the signature. */
  now?: () => Date;
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const PREFIX = /^([a-z0-9][a-z0-9._-]*\/)*$/;

const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data, "utf8").digest();
/** RFC 3986 encoding of one path segment (S3: every byte except unreserved characters). */
const encodeSegment = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The address of one object, path-style or virtual-host style. */
export function objectUrl(options: Pick<S3StoreOptions, "endpoint" | "bucket" | "forcePathStyle">, key: string): URL {
  const base = new URL(options.endpoint);
  const path = key.split("/").map(encodeSegment).join("/");
  // an endpoint may carry a fixed path (Supabase Storage: /storage/v1/s3); it comes before the bucket
  const root = base.pathname.replace(/\/+$/, "");
  if (options.forcePathStyle) return new URL(`${base.protocol}//${base.host}${root}/${encodeSegment(options.bucket)}/${path}`);
  return new URL(`${base.protocol}//${options.bucket}.${base.host}${root}/${path}`);
}

interface SignInput {
  method: string;
  url: URL;
  /** Headers to sign besides host, x-amz-date and x-amz-content-sha256 (lower-case names). */
  headers?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  now: Date;
}

/**
 * AWS Signature Version 4 for one request (header form). Returns every header to send, Authorization included. The path is used as already encoded in
 * `url` (S3 does not encode it twice); the query string is sorted and encoded.
 */
export function signV4(input: SignInput): Record<string, string> {
  const service = input.service ?? "s3";
  const amzDate = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...input.headers, host: input.url.host, "x-amz-date": amzDate, "x-amz-content-sha256": input.payloadHash };
  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names.map((n) => `${n}:${String(lower[n]).trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [input.method, input.url.pathname || "/", query, canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

export function createS3MediaStore(options: S3StoreOptions): MediaStore {
  if (!PREFIX.test(options.prefix)) throw new AppError("SERVER_ERROR", "The file store prefix is not valid");
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 20_000;

  async function call(operation: string, method: string, hotelId: string, name: string, body?: Uint8Array): Promise<Response> {
    assertSafe(hotelId, name);
    const url = objectUrl(options, `${options.prefix}${hotelId}/${name}`);
    // content-length is set by fetch itself and is not signed (SigV4 needs only host and the x-amz-* headers signed)
    const extra: Record<string, string> = body ? { "content-type": contentTypeOf(name) } : {};
    const headers = signV4({ method, url, headers: extra, payloadHash: body ? sha256Hex(body) : EMPTY_SHA256, accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, region: options.region, now: now() });
    delete headers.host;
    try {
      return await fetch(url, { method, headers, body: body as BodyInit | undefined, signal: AbortSignal.timeout(timeoutMs), cache: "no-store", redirect: "error" });
    } catch {
      // the cause (a network error) is dropped on purpose: it may carry the address; nothing here may reach a log with a key in it
      throw new AppError("SERVER_ERROR", `The file store could not be reached (${operation})`);
    }
  }
  const refused = (operation: string, status: number): AppError => new AppError("SERVER_ERROR", `The file store refused the ${operation} (HTTP ${status})`);

  return {
    async put(hotelId, name, bytes) {
      const res = await call("upload", "PUT", hotelId, name, bytes);
      await res.arrayBuffer().catch(() => undefined);
      if (!res.ok) throw refused("upload", res.status);
      return name;
    },
    async get(hotelId, name) {
      const res = await call("read", "GET", hotelId, name);
      if (res.status === 404) {
        await res.arrayBuffer().catch(() => undefined);
        return null;
      }
      if (!res.ok) {
        await res.arrayBuffer().catch(() => undefined);
        throw refused("read", res.status);
      }
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: contentTypeOf(name) };
    },
    async has(hotelId, name) {
      const res = await call("check", "HEAD", hotelId, name);
      if (res.status === 404) return false;
      if (!res.ok) throw refused("check", res.status);
      return true;
    },
    async remove(hotelId, name) {
      const res = await call("delete", "DELETE", hotelId, name);
      await res.arrayBuffer().catch(() => undefined);
      // S3 answers 204 whether or not the object existed; some stores answer 404 for a missing one: both mean "gone"
      if (!res.ok && res.status !== 404) throw refused("delete", res.status);
    },
  };
}

/** The store for one prefix from the app config (MEDIA_DRIVER=s3). A missing setting names the variable, never a value. */
export function s3MediaStoreFromConfig(
  config: { S3_ENDPOINT?: string; S3_REGION?: string; S3_BUCKET?: string; S3_ACCESS_KEY_ID?: string; S3_SECRET_ACCESS_KEY?: string; S3_FORCE_PATH_STYLE?: "1" },
  prefix: string,
): MediaStore {
  const { S3_ENDPOINT: endpoint, S3_REGION: region, S3_BUCKET: bucket, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = config;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    const missing = (["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const).filter((n) => !config[n]);
    throw new AppError("SERVER_ERROR", `MEDIA_DRIVER is s3 but ${missing.join(", ")} is not set`);
  }
  return createS3MediaStore({ endpoint, region, bucket, accessKeyId, secretAccessKey, prefix, forcePathStyle: config.S3_FORCE_PATH_STYLE === "1" });
}

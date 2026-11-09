import "server-only";
import { createHash, createHmac } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors";
import type { RawObjects } from "../mail/files";
import { objectUrl, signV4, type S3StoreOptions } from "./s3";

// The bucket and the local folder as plain objects by full key, for the files of an email (mail/files.ts). Plain fetch and AWS Signature Version 4 like media/s3.ts. The browser
// uploads with an address signed here (query-string SigV4, PUT, valid minutes): the file goes straight to the bucket, because a function on Vercel refuses a body over 4.5 MB.
// No error carries a key, a signature or the secret.

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data, "utf8").digest();
const enc = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** A PUT address that works for `expiresSeconds`: the signature is in the query string; only the host is signed, the body is not. */
export function presignPutUrl(options: Pick<S3StoreOptions, "endpoint" | "bucket" | "forcePathStyle" | "region" | "accessKeyId" | "secretAccessKey">, key: string, expiresSeconds: number, now: Date): string {
  const url = objectUrl(options, key);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${options.region}/s3/aws4_request`;
  const params: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${options.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const query = params.map(([k, v]) => `${enc(k)}=${enc(v)}`).sort().join("&");
  const canonical = ["PUT", url.pathname, query, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${options.secretAccessKey}`, day), options.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign, "utf8").digest("hex");
  return `${url.protocol}//${url.host}${url.pathname}?${query}&X-Amz-Signature=${signature}`;
}

const xmlText = (block: string, tag: string): string | null => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block)?.[1] ?? null;
const unxml = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function createS3Objects(options: Omit<S3StoreOptions, "prefix">): RawObjects {
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 20_000;
  const refused = (operation: string, status: number): AppError => new AppError("SERVER_ERROR", `The file store refused the ${operation} (HTTP ${status})`);

  async function call(operation: string, method: string, url: URL, body?: Uint8Array): Promise<Response> {
    const headers = signV4({ method, url, payloadHash: body ? sha256Hex(body) : EMPTY_SHA256, accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, region: options.region, now: now() });
    delete headers.host;
    try {
      return await fetch(url, { method, headers, body: body as BodyInit | undefined, signal: AbortSignal.timeout(timeoutMs), cache: "no-store", redirect: "error" });
    } catch {
      throw new AppError("SERVER_ERROR", `The file store could not be reached (${operation})`);
    }
  }
  const drain = (res: Response): Promise<unknown> => res.arrayBuffer().catch(() => undefined);

  return {
    async put(key, bytes) {
      const res = await call("upload", "PUT", objectUrl(options, key), bytes);
      await drain(res);
      if (!res.ok) throw refused("upload", res.status);
    },
    async get(key) {
      const res = await call("read", "GET", objectUrl(options, key));
      if (res.status === 404) {
        await drain(res);
        return null;
      }
      if (!res.ok) {
        await drain(res);
        throw refused("read", res.status);
      }
      return new Uint8Array(await res.arrayBuffer());
    },
    async size(key) {
      const res = await call("check", "HEAD", objectUrl(options, key));
      await drain(res);
      if (res.status === 404) return null;
      if (!res.ok) throw refused("check", res.status);
      const n = Number(res.headers.get("content-length"));
      return Number.isFinite(n) ? n : null;
    },
    async remove(key) {
      const res = await call("delete", "DELETE", objectUrl(options, key));
      await drain(res);
      if (!res.ok && res.status !== 404) throw refused("delete", res.status);
    },
    async list(prefix) {
      const out: { key: string; size: number; modified: Date }[] = [];
      let token: string | null = null;
      do {
        const url = objectUrl(options, "");
        url.searchParams.set("list-type", "2");
        url.searchParams.set("prefix", prefix);
        if (token) url.searchParams.set("continuation-token", token);
        const res = await call("list", "GET", url);
        if (!res.ok) {
          await drain(res);
          throw refused("list", res.status);
        }
        const xml = await res.text();
        for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
          const key = xmlText(block, "Key");
          const modified = xmlText(block, "LastModified");
          if (key !== null && modified !== null) out.push({ key: unxml(key), size: Number(xmlText(block, "Size") ?? 0), modified: new Date(modified) });
        }
        token = xmlText(xml, "IsTruncated") === "true" ? unxml(xmlText(xml, "NextContinuationToken") ?? "") || null : null;
      } while (token);
      return out;
    },
    presignPut: (key, expiresSeconds) => presignPutUrl(options, key, expiresSeconds, now()),
  };
}

/** The same objects on this machine's disk (development). Uploads go through the server there. */
export function createLocalObjects(root: string): RawObjects {
  const file = (key: string): string => {
    const full = path.resolve(root, key);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new AppError("SERVER_ERROR", "Not a stored file name");
    return full;
  };
  const walk = async (dir: string): Promise<string[]> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) out.push(...(e.isDirectory() ? await walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    return out;
  };
  return {
    async put(key, bytes) {
      const f = file(key);
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, bytes);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(file(key)));
      } catch {
        return null;
      }
    },
    async size(key) {
      try {
        return (await stat(file(key))).size;
      } catch {
        return null;
      }
    },
    async remove(key) {
      await rm(file(key), { force: true });
    },
    async list(prefix) {
      const base = path.resolve(root);
      const out: { key: string; size: number; modified: Date }[] = [];
      for (const f of await walk(path.join(base, prefix))) {
        const s = await stat(f);
        out.push({ key: path.relative(base, f).split(path.sep).join("/"), size: s.size, modified: s.mtime });
      }
      return out;
    },
  };
}

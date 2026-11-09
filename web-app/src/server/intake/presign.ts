import "server-only";
import { createHash, createHmac } from "node:crypto";
import { objectUrl, type S3StoreOptions } from "../media/s3";

// A read address for one object (query-string SigV4, GET, valid for minutes), the twin of presignPutUrl in media/s3Objects.ts. The reader worker downloads the
// picture with it; nothing else is signed but the host.
const sha256Hex = (data: string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data, "utf8").digest();
const enc = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

type Access = Pick<S3StoreOptions, "endpoint" | "bucket" | "forcePathStyle" | "region" | "accessKeyId" | "secretAccessKey">;

export function presignGetUrl(options: Access, key: string, expiresSeconds: number, now: Date): string {
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
  const canonical = ["GET", url.pathname, query, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${options.secretAccessKey}`, day), options.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign, "utf8").digest("hex");
  return `${url.protocol}//${url.host}${url.pathname}?${query}&X-Amz-Signature=${signature}`;
}

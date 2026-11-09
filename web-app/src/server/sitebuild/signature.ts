import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// The "Create hotel site" job proves who it is by signing what it reports (HMAC-SHA256 over "<unix seconds>.<build id>.<body>" with the shared SITE_BUILD_SECRET).
// A report older than ten minutes, or one with a wrong or missing signature, is refused, so a copied request cannot be replayed later and nobody without the
// secret can mark a site live. The build id is signed too, so a report for one build can never be replayed against another build's address. The same two functions are used by the tests and (as plain JavaScript) by website-templates/tools/report-build.mjs.

export const SITE_BUILD_MAX_AGE_SECONDS = 600;

/** "sha256=<hex>" for this build's report body at this time. */
export function signSiteBuild(secret: string, timestampSeconds: number, buildId: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestampSeconds}.${buildId.toLowerCase()}.${body}`).digest("hex")}`;
}

/** True only for a fresh, correctly signed report. Compares in constant time. */
export function verifySiteBuild(secret: string, buildId: string, timestampHeader: string | null, signatureHeader: string | null, body: string, now: Date): boolean {
  if (!timestampHeader || !signatureHeader || !/^\d{1,12}$/.test(timestampHeader)) return false;
  const ts = Number(timestampHeader);
  if (Math.abs(now.getTime() / 1000 - ts) > SITE_BUILD_MAX_AGE_SECONDS) return false;
  const want = Buffer.from(signSiteBuild(secret, ts, buildId, body));
  const got = Buffer.from(signatureHeader);
  return want.length === got.length && timingSafeEqual(want, got);
}

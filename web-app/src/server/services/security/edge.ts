import "server-only";

// What Cloudflare tells us about a request (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 3 of the architecture: "approximate location" of a decoy touch).
// `CF-IPCountry` is a two-letter country code Cloudflare adds ("XX" = unknown, "T1" = Tor). It is only true when the request really came through Cloudflare: anyone who reaches the
// server directly can write it. So it is shown as a hint in alerts and never used to decide anything, and the origin lock (security plan section 5) is what makes it reliable.
const COUNTRY = /^(?:[A-Z]{2}|T1)$/;

/** The country code Cloudflare sent, upper-cased, or null when the header is missing or not of that shape. */
export function edgeCountry(request: Request): string | null {
  const raw = (request.headers.get("cf-ipcountry") ?? "").trim().toUpperCase();
  return COUNTRY.test(raw) ? raw : null;
}

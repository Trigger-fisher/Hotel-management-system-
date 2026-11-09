// The security headers every response carries (applied by next.config.ts). Plain data with no imports, so a test can read it.
// The app loads nothing from other sites (fonts, scripts, styles and images are its own), so the policy allows only itself. Next.js writes small inline
// scripts and styles into each page, so those two keep 'unsafe-inline' (a per-request nonce needs middleware on every page, which HMS does not use).
// HSTS and the content policy are production-only: development runs on plain http with hot reload (which needs eval and websockets).

export interface Header {
  key: string;
  value: string;
}

/** Cloudflare Turnstile (the sign-in security check): its script, its frame and its own requests. */
const TURNSTILE_HOST = "https://challenges.cloudflare.com";

/**
 * The bucket's own address (https://<project>.storage.supabase.co), only on a server that keeps files in a bucket (MEDIA_DRIVER=s3): the browser sends the files of an email straight to it
 * with an address signed for 15 minutes (mail/files.ts; a function on Vercel refuses a body over 4.5 MB). Nothing else is allowed, and nothing is read back from it by the page.
 */
export function bucketOrigin(env: Record<string, string | undefined> = process.env): string | null {
  if (env.MEDIA_DRIVER !== "s3" || !env.S3_ENDPOINT) return null;
  const m = /^(https:\/\/[^/\s?#]+)/.exec(env.S3_ENDPOINT);
  return m ? (m[1] as string) : null;
}

/**
 * The Realtime address of the "new mail" ping (MAIL_SIGNAL_URL, https://<project>.supabase.co; server/mail/signal.ts): the page opens ONE web socket to it and nothing else.
 * Both spellings are listed because browsers differ on whether wss: is covered by an https: source.
 */
export function signalOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const m = /^https:\/\/([^/\s?#]+)\/*$/.exec((env.MAIL_SIGNAL_URL ?? "").trim());
  return m ? [`https://${m[1]}`, `wss://${m[1]}`] : [];
}

export function contentSecurityPolicy(env: Record<string, string | undefined> = process.env): string {
  const bucket = bucketOrigin(env);
  const signal = signalOrigins(env);
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${TURNSTILE_HOST}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    ["connect-src 'self'", TURNSTILE_HOST, ...(bucket ? [bucket] : []), ...signal].join(" "),
    `frame-src ${TURNSTILE_HOST}`,
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function securityHeaders(production: boolean): Header[] {
  const always: Header[] = [
    // Reset and invite tokens live in the URL; never leak them to other sites.
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  ];
  if (!production) return always;
  return [
    ...always,
    // Six months, this host only, for the first deployments: raise to two years with includeSubDomains once every subdomain of the domain is https.
    { key: "Strict-Transport-Security", value: "max-age=15552000" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  ];
}
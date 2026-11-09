// The decoy addresses (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 8). Pure and free of server-only so the proxy (src/proxy.ts) can use it; the canary side is in server/services/security/honeypot.ts.

/** Paths nobody legitimate asks for. Lower case; matched on the path without the query, with a trailing slash ignored. */
const DECOYS: readonly RegExp[] = [
  /^\/wp-admin(\/|$)/, /^\/wp-login\.php$/, /^\/xmlrpc\.php$/, /^\/\.env(\.[a-z0-9_-]{1,20})?$/, /^\/admin\/\.git(\/|$)/, /^\/\.git(\/|$)/, /^\/phpmyadmin(\/|$)/, /^\/\.aws\/credentials$/,
  // more scanner favourites (none is a page or route of this app): PHP leftovers, other version-control folders, database dumps, SSH keys, framework consoles
  /^\/(wp-content|wp-includes|wp-json|cgi-bin|administrator)(\/|$)/, /^\/(adminer|phpinfo|config|info|shell)\.php$/, /^\/\.(svn|hg|ssh|docker|npmrc|ds_store)(\/|$)/, /^\/(backup|db|database|dump|site)\.(sql|zip|tar\.gz)$/,
  /^\/id_(rsa|ed25519)$/, /^\/(server-status|actuator(\/.*)?)$/, /^\/vendor\/phpunit(\/|$)/,
];

export function isHoneypotPath(pathname: string): boolean {
  let p: string;
  try {
    p = decodeURIComponent(pathname).toLowerCase();
  } catch {
    return false;
  }
  p = p.length > 1 ? p.replace(/\/+$/, "") : p;
  return DECOYS.some((d) => d.test(p));
}

/** The address the proxy sends a decoy hit to, and the header that carries the path that was asked for. */
export const TRAP_ROUTE = "/api/v1/public/security/trap";
export const TRAP_PATH_HEADER = "x-hms-trap-path";

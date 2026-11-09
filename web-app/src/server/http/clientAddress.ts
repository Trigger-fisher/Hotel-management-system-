import "server-only";

// The caller's address, in ONE place (security review round 3, R3-6). It used to be the FIRST X-Forwarded-For entry everywhere, which is the entry the CALLER may have written: a proxy that
// appends (nginx $proxy_add_x_forwarded_for) leaves whatever the client sent in front and adds the address it really saw LAST. A caller could pick their address and so slip an IP limit
// (the sign-in throttles) or an API key's address allow-list. Now the entry counted from the RIGHT is used: the one the nearest trusted proxy added.
//
// There is no socket address to fall back on: a route handler gets a Request without it, so the header is the only source. How many proxies in front of the app each add one entry:
//   Vercel                      1 (the platform sets the header itself, so there is exactly one entry, theirs) - always, whatever the setting
//   anywhere else               HMS_PROXY_HOPS, default 1 (Caddy replaces the header, nginx appends: the last entry is right for both). Two proxies in a row (a CDN, then Caddy): 2.
//                               0 = no proxy in front: the header is not trusted at all and the address is unknown.
// An app that is reachable WITHOUT its proxy can be told any address by the caller: the proxy must be the only way in (docs/deploy/DEPLOY-VPS.md).

/** How many entries from the right belong to trusted proxies. */
export function trustedHops(env: Record<string, string | undefined> = process.env): number {
  if (env.VERCEL) return 1;
  const raw = env.HMS_PROXY_HOPS;
  if (raw === undefined || !/^\d$/.test(raw.trim()) || Number(raw) > 5) return 1;
  return Number(raw);
}

/** The caller's address as the nearest trusted proxy saw it; null when the header is missing, has fewer entries than there are proxies, or no proxy is trusted. */
export function clientAddress(request: Request, env: Record<string, string | undefined> = process.env): string | null {
  const hops = trustedHops(env);
  if (hops === 0) return null;
  const entries = (request.headers.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
  return entries.length >= hops ? entries[entries.length - hops] : null;
}

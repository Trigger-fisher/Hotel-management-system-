import "server-only";
import { isIP } from "node:net";
import type { ResetStep } from "../../repos/security";
import type { ResetContext, ResetExecutor } from "./resets";

// What each layer's reset actually does. Layer 1 talks to Cloudflare's API (works on any Cloudflare plan: it uses IP access rules and reads the zone's settings). Layers 2 and 3 need the VPS and the
// Supabase project, which do not exist yet (about 14 Nov 2026), so they say so plainly instead of pretending: the reset ends "unhealthy: not connected".

const CF = "https://api.cloudflare.com/client/v4";

interface CfResponse {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: unknown;
}

export function createCloudflareExecutor(config: { token?: string; zoneId?: string; fetch?: typeof fetch }): ResetExecutor {
  const doFetch = config.fetch ?? fetch;
  const configured = (): boolean => Boolean(config.token && config.zoneId && /^[0-9a-f]{32}$/.test(config.zoneId));

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<CfResponse> {
    const response = await doFetch(`${CF}${path}`, {
      method, headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    return (await response.json().catch(() => ({}))) as CfResponse;
  }

  const zone = (): string => `/zones/${config.zoneId}`;
  const DUPLICATE = 10009;

  return {
    configured,
    describe: () => (configured() ? "Connected to the Cloudflare zone." : "Not connected: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID."),
    async run(context: ResetContext): Promise<ResetStep[]> {
      if (context.ip === null) return [{ name: "block_ip", ok: true, detail: "No address given: nothing to block." }];
      if (isIP(context.ip) === 0) return [{ name: "block_ip", ok: false, detail: "Not a valid address." }];
      const r = await call("POST", `${zone()}/firewall/access_rules/rules`, { mode: "block", configuration: { target: isIP(context.ip) === 6 ? "ip6" : "ip", value: context.ip }, notes: "HMS emergency reset" });
      const duplicate = r.errors?.some((e) => e.code === DUPLICATE) === true;
      return [{ name: "block_ip", ok: r.success === true || duplicate, detail: r.success === true ? `Blocked ${context.ip} at the edge.` : duplicate ? `${context.ip} was already blocked.` : `Cloudflare refused: ${r.errors?.[0]?.message ?? "no reason given"}` }];
    },
    async health(context: ResetContext) {
      const [ssl, https, hsts] = await Promise.all([call("GET", `${zone()}/settings/ssl`), call("GET", `${zone()}/settings/always_use_https`), call("GET", `${zone()}/settings/security_header`)]);
      const value = (r: CfResponse): unknown => (r.result as { value?: unknown } | undefined)?.value;
      const problems: string[] = [];
      if (value(ssl) !== "strict") problems.push("SSL/TLS mode is not Full (strict)");
      if (value(https) !== "on") problems.push("Always Use HTTPS is off");
      const sts = (value(hsts) as { strict_transport_security?: { enabled?: boolean } } | undefined)?.strict_transport_security;
      if (sts?.enabled !== true) problems.push("HSTS is off");
      if (context.ip !== null) {
        const rule = await call("GET", `${zone()}/firewall/access_rules/rules?mode=block&configuration.value=${encodeURIComponent(context.ip)}`);
        if (!Array.isArray(rule.result) || rule.result.length === 0) problems.push(`${context.ip} is not blocked`);
      }
      return problems.length === 0 ? { ok: true, detail: "SSL strict, HTTPS forced, HSTS on" + (context.ip ? `, ${context.ip} blocked.` : ".") } : { ok: false, detail: problems.join("; ") + "." };
    },
  };
}

/** A layer that cannot be reached yet. Always unhealthy, always says why. */
export function createUnconnectedExecutor(note: string): ResetExecutor {
  return {
    configured: () => false,
    describe: () => note,
    run: async () => [],
    health: async () => ({ ok: false, detail: note }),
  };
}

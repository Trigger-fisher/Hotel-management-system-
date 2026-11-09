import "server-only";
// Picks the AI database that serves a hotel, a group or the platform (MJ, 3 Nov 2026): the same idea as shardRouter.ts, with one deliberate difference. A hotel that is not on the hotel
// map falls back to the main database, so nothing breaks; a scope that is not on the AI map, or is switched off, is REFUSED. AI costs money and handles private text, so it is on only where
// someone turned it on, and a map that cannot be read means "not now", never "use the default". The map is platform.ai_routes on the main database; the address of an AI database is the
// server setting DATABASE_URL_AI_<KEY>, never a table.

export const AI_URL_PREFIX = "DATABASE_URL_AI_";

/** The environment variable that holds the database URL of an AI database key ("eu-1" -> DATABASE_URL_AI_EU_1). */
export const aiUrlName = (key: string): string => `${AI_URL_PREFIX}${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

/** Who the AI is for. A hotel's scope is always made from the signed-in session, never from a request. */
export type AiScope = { readonly kind: "hotel"; readonly hotelId: string } | { readonly kind: "group"; readonly groupId: string } | { readonly kind: "platform" };

/** One line of the AI map as the router needs it. */
export interface AiRoute {
  /** The key of the AI database (platform.ai_databases.key). */
  readonly databaseKey: string;
  readonly enabled: boolean;
  /** What may be used. Empty means nothing. */
  readonly features: readonly string[];
  readonly dailyRequestLimit: number;
  readonly monthlyBudgetPaise: number;
}

export type AiRefusal = "NO_ROUTE" | "SWITCHED_OFF" | "FEATURE_OFF" | "NO_DATABASE" | "MAP_UNAVAILABLE";

/** Why AI was not used. The API layer turns each reason into a plain sentence; none of them names an address, a key or another hotel. */
export class AiRefused extends Error {
  constructor(readonly reason: AiRefusal) {
    super(reason);
    this.name = "AiRefused";
  }
}

export interface AiRouterOptions<C> {
  /** The route of a scope from the map on the main database; null when it has none. */
  lookup: (scope: AiScope) => Promise<AiRoute | null>;
  /** The connection to an AI database by key; null when no address is set for it on this server. */
  connect: (key: string) => C | null;
  /** How long a route is remembered (ms). Short, so a switch turned off takes effect within a minute; default 60 s. */
  ttlMs?: number;
  now?: () => number;
}

export interface AiRouter<C> {
  /** The route and the connection for a scope, or a refusal. `feature` names the one thing about to be used. */
  resolve(scope: AiScope, feature?: string): Promise<{ readonly route: AiRoute; readonly database: C }>;
  /** Forget what is remembered for a scope (after the map was changed). */
  forget(scope: AiScope): void;
}

const scopeKey = (scope: AiScope): string => (scope.kind === "hotel" ? `hotel:${scope.hotelId}` : scope.kind === "group" ? `group:${scope.groupId}` : "platform");

export function createAiRouter<C>(options: AiRouterOptions<C>): AiRouter<C> {
  const ttl = options.ttlMs ?? 60_000;
  const now = options.now ?? (() => Date.now());
  const seen = new Map<string, { route: AiRoute | null; at: number }>();
  const routeOf = async (scope: AiScope): Promise<AiRoute | null> => {
    const key = scopeKey(scope);
    const hit = seen.get(key);
    if (hit && now() - hit.at < ttl) return hit.route;
    let route: AiRoute | null;
    try {
      route = await options.lookup(scope);
    } catch {
      // the map could not be read: AI is not used now (never a default), and nothing is remembered, so the next request asks again
      throw new AiRefused("MAP_UNAVAILABLE");
    }
    if (seen.size > 5000) seen.clear();
    seen.set(key, { route, at: now() });
    return route;
  };
  return {
    async resolve(scope, feature) {
      const route = await routeOf(scope);
      if (!route) throw new AiRefused("NO_ROUTE");
      if (!route.enabled) throw new AiRefused("SWITCHED_OFF");
      if (feature !== undefined && !route.features.includes(feature)) throw new AiRefused("FEATURE_OFF");
      const database = options.connect(route.databaseKey);
      if (database === null) throw new AiRefused("NO_DATABASE");
      return { route, database };
    },
    forget(scope) {
      seen.delete(scopeKey(scope));
    },
  };
}

/** The AI databases named in the environment, by variable name: DATABASE_URL_AI_EU_1=... serves the AI database with key "eu-1". */
export function aiUrlsFrom(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (name.startsWith(AI_URL_PREFIX) && value) out[name] = value;
  return out;
}

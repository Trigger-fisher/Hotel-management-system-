import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import type { Session } from "@shared/auth-pallav";
import { getAuthService, getSessionResolver } from "@/server/compose/auth";
import { dashboardKindFor } from "@shared/dashboards/nav";
import { routeForPath, type Route } from "@shared/dashboards/routes";
import { homeOf, mayOpenRoute, menuFor, type Viewer } from "@shared/dashboards/access";
import { subNav } from "@shared/dashboards/nav";
import { rootFor, subKeyFor } from "@/dashboards/shell/navModel";
import { PANELS_COOKIE, parsePanels, type ShellPanels } from "@/lib/shellPanels";
import { SESSION_COOKIE } from "@/server/auth/tokens";

/**
 * The signed-in person as the SHELL needs to draw itself (sidebar, top bar), read on the server from the httpOnly session cookie (R48, docs/plans/R48-SHELL-DESIGN.md).
 * It is the answer of `GET /auth/session` with the personal contact details taken out (no e-mail, no user name, no token): display name, role, hotel and group names,
 * the menu grants and abilities, and the idle expiry. The client replaces it with the full answer a moment after it starts. Nothing here is trusted by any API:
 * every route verifies the cookie itself.
 *
 * Verification is read-only (the same resolver as the routes, without the idle "touch"). Any problem (no cookie, a bad or expired session, a database that does not
 * answer) means "no seed": the page then runs the ordinary client-side restore and sign-in. Only a real sign-in sets the cookie, so a mock-mode preview never has one.
 */
export interface ShellSeed {
  session: Session;
  /** The saved sidebar and panel choices (a plain preference cookie, no personal data), so the first paint already has the right widths. Null = nothing saved yet. */
  panels: ShellPanels | null;
  /** The page the address names for this person's dashboard (decision 49: the URL decides); null for "/" and for an address that is not a page of their dashboard (the shell then opens the first page and corrects the address). */
  route: Route | null;
  /** The address is not a page this person may open (another role's, outside their grants, a visit that ended): the page answers with a redirect to "/". */
  redirectHome: boolean;
  /** The page the dashboard opens on (route or the first page) and whether it has a second panel, so the first HTML has the right stylesheets and body classes. */
  opening: { viewId: string; sub: boolean };
  /**
   * When the page was drawn (ms), for the top bar's clock strip: its first frame shows that time on both sides. Nothing else of the header is read here: the
   * bell's items and the accounting years are the browser's own reads (they used to be read with the page and kept it and two pool connections waiting).
   */
  header: { at: number };
}

const cookieValue = (cookie: string, name: string): string | null => {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookie);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1] ?? "");
  } catch {
    return null;
  }
};

export type SessionEnd = "SESSION_REPLACED" | "SESSION_REVOKED" | "SESSION_EXPIRED";

/**
 * When there is no seed but the request still carries a session cookie: why that session is over (signed in on another device, ended by an admin, expired).
 * The page then opens straight on "your session ended" instead of first drawing the last dashboard outline and asking the server again. Null = no cookie,
 * or a session signed out on purpose. Read once per request.
 */
export const getSessionEnd = cache(async (): Promise<SessionEnd | null> => {
  try {
    const cookie = (await headers()).get("cookie");
    if (!cookie || !cookie.includes(`${SESSION_COOKIE}=`)) return null;
    return await getSessionResolver().endedReason(new Request("https://shell-seed.invalid/", { headers: { cookie } }));
  } catch {
    return null;
  }
});

/**
 * Whether this request carries a session cookie at all (no database work). The page tells the app when it does not, so the app shows the sign-in form at once instead of
 * first asking the server for a session that cannot exist (sign-in speed, 18 Oct 2026). A sign-in in another tab sets the cookie, so the next load restores as before.
 */
export const hasSessionCookie = cache(async (): Promise<boolean> => {
  try {
    const cookie = (await headers()).get("cookie");
    return Boolean(cookie && cookie.includes(`${SESSION_COOKIE}=`));
  } catch {
    // unknown: behave as before (ask the server)
    return true;
  }
});

/** A live session whose screen is locked: "/" then opens the app on the lock screen instead of the website. One resolver read, only when there was no seed. */
export const hasLockedSession = cache(async (): Promise<boolean> => {
  try {
    const cookie = (await headers()).get("cookie");
    if (!cookie || !cookie.includes(`${SESSION_COOKIE}=`)) return false;
    const verified = await getSessionResolver().resolveSession(new Request("https://shell-seed.invalid/", { headers: { cookie } }));
    return verified?.locked === true;
  } catch {
    return false;
  }
});

export const getShellSeed = cache(async (): Promise<ShellSeed | null> => {
  try {
    const h = await headers();
    // a page of the public website (proxy.ts marks them): the website's own look, never a dashboard shell, whoever is signed in
    if (h.get("x-hms-site") === "1") return null;
    const cookie = h.get("cookie");
    // no session cookie at all (a first visit, a bot, a 404 with only the preference cookie): no database work
    if (!cookie || !cookie.includes(`${SESSION_COOKIE}=`)) return null;
    const resolver = getSessionResolver();
    const verified = await resolver.resolveSession(new Request("https://shell-seed.invalid/", { headers: { cookie } }));
    // a locked screen draws no dashboard: the app restores the session and opens on the lock screen
    if (!verified || verified.locked) return null;
    // the access record the resolver just built the session from: the session answer loads nothing twice
    const outcome = await getAuthService().getSession(verified, resolver.accessOf(verified));
    const session = (outcome as { data?: Session }).data;
    if (!session) return null;
    const saved = cookieValue(cookie, PANELS_COOKIE);
    // the address, as the proxy saw it (src/proxy.ts sets these two headers on every page request, so they never come from the browser)
    const kind = dashboardKindFor(session.user.role, false, null);
    if (!kind) return null;
    const path = h.get("x-hms-path") ?? "/";
    const viewer: Viewer = { kind, role: session.user.role, grants: session.user.grants ?? null };
    const found = routeForPath(kind, path, h.get("x-hms-search") ?? "");
    const route = found && mayOpenRoute(viewer, found) ? found : null;
    const home = homeOf(viewer);
    const viewId = route?.viewId ?? home;
    const subKey = subKeyFor(kind, viewId, rootFor(kind, viewId, home));
    return {
      session: { ...session, token: null, user: { ...session.user, email: "", username: null } },
      panels: saved ? parsePanels(saved) : null,
      route,
      redirectHome: path !== "/" && route === null,
      opening: { viewId, sub: subKey !== null && menuFor(viewer, subNav[subKey] ?? []).length > 0 },
      header: { at: Date.now() },
    };
  } catch {
    return null;
  }
});

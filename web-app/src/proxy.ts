import { NextResponse, type NextRequest } from "next/server";
import { badPortalHotel, isAppPath, PORTAL_HOTEL_PARAM } from "@shared/dashboards/routes";
import { sitePages } from "@shared/site/copy";
import { isHoneypotPath, TRAP_PATH_HEADER, TRAP_ROUTE } from "./lib/honeypotPaths";

// Every dashboard page has its own address (decision 49: the URL decides; ui-shared/dashboards/routes.ts). They are all ONE page, app/page.tsx:
// an address that some role has is rewritten to "/" inside the server (the address bar keeps it), and the page and the root layout learn the
// address from the x-hms-path header set here (a layout is not given the path otherwise). An address no role has is left alone, so it reaches
// no route and gets the static 404 (app/global-not-found.tsx) without any session work. The header is always set here, never taken from the client.
const PATH_HEADER = "x-hms-path";

/** The sign-in page (app/login/page.tsx, MJ 25 Oct 2026). It reads the session cookie (a signed-in person is sent to "/"), so nothing may cache it. */
const SIGN_IN_PATH = "/login";
/** The website's own pages (app/features, ...): marked so the root layout draws the website, not a signed-in person's dashboard shell (server/shell/seed.ts). */
const SITE_HEADER = "x-hms-site";
const SITE_PAGES: ReadonlySet<string> = new Set(sitePages);

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Vercel-CDN-Cache-Control", "no-store");
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Decoy addresses no real person asks for (/wp-admin, /.env, /admin/.git ...): the hit is recorded as a Critical security event and the caller gets the ordinary 404
  // (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 8). The header is always set here, never taken from the client.
  if (isHoneypotPath(pathname)) {
    const headers = new Headers(request.headers);
    headers.set(TRAP_PATH_HEADER, pathname.slice(0, 200));
    const target = request.nextUrl.clone();
    target.pathname = TRAP_ROUTE;
    target.search = "";
    return noStore(NextResponse.rewrite(target, { request: { headers } }));
  }
  if (pathname === SIGN_IN_PATH || pathname === `${SIGN_IN_PATH}/`) return noStore(NextResponse.next());
  if (SITE_PAGES.has(pathname.replace(/\/+$/, ""))) {
    const site = new Headers(request.headers);
    site.set(SITE_HEADER, "1");
    return NextResponse.next({ request: { headers: site } });
  }
  if (!isAppPath(pathname)) return NextResponse.next();
  // The portals' `?hotel=` (routes.ts): a value that is neither a hotel id nor "all" is dropped from the address, so a mangled link opens on All hotels.
  if (badPortalHotel(request.nextUrl.search)) {
    const clean = request.nextUrl.clone();
    clean.searchParams.delete(PORTAL_HOTEL_PARAM);
    return NextResponse.redirect(clean, 307);
  }
  const headers = new Headers(request.headers);
  headers.delete(SITE_HEADER);
  headers.set(PATH_HEADER, pathname);
  headers.set("x-hms-search", request.nextUrl.search);
  const target = request.nextUrl.clone();
  target.pathname = "/";
  const response = pathname === "/" ? NextResponse.next({ request: { headers } }) : NextResponse.rewrite(target, { request: { headers } });
  // The page is drawn from the person's session (their name, their menu; at "/" the website or the dashboard): no shared cache may keep it, and the browser may not either.
  return noStore(response);
}

export const config = {
  // pages only: not the API, Next's own files, Pallav's assets, the dev previews or a file (robots.txt, icon.svg). A record id may hold a dot
  // (a guest bill is "<uuid>.hotel"), so only real file extensions are left out, not every dot.
  matcher: ["/((?!api/|_next/|pallav/|dev/|opengraph-image|.*\\.(?:txt|xml|svg|png|jpe?g|gif|webp|ico|js|css|map|json|webmanifest|woff2?)$).*)"],
};

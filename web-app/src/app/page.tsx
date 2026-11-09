import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { siteCopy } from "@shared/site/copy";
import { AuthEntry } from "@/components/auth/AuthEntry";
import { SeededApp } from "@/components/auth/SeededApp";
import { MockSessionReturn } from "@/components/site/MockSessionReturn";
import { SiteHome } from "@/components/site/SiteHome";
import { getSessionEnd, getShellSeed, hasLockedSession, hasSessionCookie } from "@/server/shell/seed";

/** The query keys of links made before sign-in moved to /login; at "/" they are forwarded there. */
const SIGN_IN_KEYS = ["reset", "invite", "hotel", "api"] as const;

// One page behind "/" and every dashboard address (proxy.ts rewrites those here and passes the address in x-hms-path).
// R48: for a person with a live session the SHELL (sidebar, top bar) is rendered here on the server, from the verified httpOnly session cookie (docs/plans/R48-SHELL-DESIGN.md).
// MJ, 25 Oct 2026: "/" is the public website for a signed-out visitor, and the sign-in page lives at /login (app/login/page.tsx). A signed-in person's "/"
// stays their dashboard home, so nothing in the dashboards' addresses changed.
// This makes the page dynamic: it is rendered per request and never cached (see the headers of "/" in next.config.ts).
export const dynamic = "force-dynamic";

/** The address the proxy saw ("/" or a dashboard page) and its query string. */
async function requested(): Promise<{ path: string; search: string }> {
  const h = await headers();
  return { path: h.get("x-hms-path") ?? "/", search: h.get("x-hms-search") ?? "" };
}

/** The website's title at "/" for a signed-out visitor; the sign-in title (root layout) everywhere else. */
export async function generateMetadata(): Promise<Metadata> {
  const [{ path }, cookie] = await Promise.all([requested(), hasSessionCookie()]);
  if (path !== "/" || cookie) return {};
  // The one page search engines may read (the layout closes the rest); the share card comes from app/opengraph-image.tsx.
  return {
    metadataBase: new URL(siteCopy.url),
    title: siteCopy.title,
    description: siteCopy.description,
    alternates: { canonical: "/" },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url: "/", siteName: siteCopy.brand.name, title: siteCopy.title, description: siteCopy.description, locale: "en_IN" },
    twitter: { card: "summary_large_image", title: siteCopy.title, description: siteCopy.description },
  };
}

export default async function Home() {
  const seed = await getShellSeed();
  // Signed in, but the address is not a page this person may open: straight to their dashboard (a real redirect, so nothing of that page is drawn).
  if (seed?.redirectHome) redirect("/");
  if (seed) return <SeededApp seed={seed.session} panels={seed.panels} route={seed.route} header={seed.header} opening={seed.opening} />;
  const { path, search } = await requested();
  // The session cookie names a session that is over: the app opens on "your session ended" (why) without asking the server again.
  // No session cookie at all: the app shows the sign-in form at once, without first asking the server for a session (sign-in speed, 18 Oct 2026).
  const [ended, cookie, locked] = await Promise.all([getSessionEnd(), hasSessionCookie(), hasLockedSession()]);
  // a locked screen stays locked after a reload: the app restores the session and opens on the lock screen, never the dashboard or the website
  if (locked) return <AuthEntry ended={null} noSession={false} />;
  if (path === "/") {
    // Links made before sign-in moved to /login point at "/" with their query: an emailed reset link (?reset=), an invitation (?invite=), a hotel website's
    // Sign in (?hotel=), the developer's ?api=real. Those go on to /login with the query kept. Any other query (fbclid, gclid, utm_* on a shared link) is
    // the website's. A leftover cookie of an ended session is not a reason to leave the website: only sign-out clears that cookie, so forwarding on it would
    // keep the website (and the sign-in card's "Visit our website") out of reach for the rest of the browser session.
    const query = new URLSearchParams(search);
    if (SIGN_IN_KEYS.some((key) => query.has(key))) redirect(`${siteCopy.signInPath}${search}`);
    return (
      <>
        <SiteHome />
        {/* Test mode and the local demo keep the session in the tab, not in a cookie: a signed-in tab that reloads "/" goes back to its dashboard. */}
        {(process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO === "1") && <MockSessionReturn />}
      </>
    );
  }
  // Signed out on a dashboard address (a copied link): the sign-in form right here, and the address is kept, so the page opens after sign-in when allowed.
  return <AuthEntry ended={ended} noSession={!cookie} />;
}

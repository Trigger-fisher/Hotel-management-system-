import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { copy, productName } from "@shared/auth/copy";
import { auth } from "@shared/tokens";
import { themeCss } from "@/lib/theme";
import { LocalDemoBadge } from "./LocalDemoBadge";
import { PALLAV_BASE_URLS, PALLAV_CSS_ATTR, PALLAV_SSR_ATTR, pallavHeadSheets } from "@/dashboards/pallav/assets";
import { getSessionEnd, getShellSeed } from "@/server/shell/seed";
import { dashboardKindFor } from "@shared/dashboards/nav";
import { pageSheetsFor } from "@/dashboards/pallav/pageCss";
import { ScreenTranslator } from "@/components/ScreenTranslator";
import "./globals.css";

// The two fonts are files in this repository (the latin subset), not a download at build time: a build never depends on Google's servers, and the
// content-security rule (font-src 'self') already allows them.
const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

const playfair = localFont({
  src: "./fonts/playfair-display-latin.woff2",
  variable: "--font-playfair",
  weight: "400 900",
  display: "swap",
  // Only the brand name and its mark use it.
});

export const metadata: Metadata = {
  title: `${copy.signIn.title} · ${productName}`,
  referrer: "no-referrer",
  robots: { index: false, follow: false },
  applicationName: productName,
  appleWebApp: { capable: true, title: productName, statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // The browser bar matches the day page: the app opens light whatever the device says (MJ, 5 Nov 2026).
  themeColor: auth.background.stops[0],
  colorScheme: "light",
  // the page may draw under the notch and the home strip; the bars keep clear with env(safe-area-inset-*)
  viewportFit: "cover",
};

// The day / night choice before the first paint (the same rule as dashboards/pallav/theme.ts: the signed-in person's choice as this browser remembers it, else day;
// never the device's setting). Static text, no user data.
const THEME_SCRIPT = "(function(){try{document.documentElement.dataset.theme=localStorage.getItem('pms-theme')==='dark'?'dark':'light'}catch(e){}})()";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // R48: a person with a live session gets the dashboard shell rendered on the server, so its stylesheets are render-blocking links in the first HTML (no unstyled flash);
  // the sign-in page keeps only its own styles. The seed is read once per request (cached) and only decides this.
  const seed = await getShellSeed();
  // The browser's session is over (signed in on another device, ended by an admin, expired): the page opens on "your session ended", so no dashboard outline is drawn first.
  const ended = seed ? null : await getSessionEnd();
  // The classes Pallav's CSS reads from <body> to place the rail and the page, as the shell will set them a moment later: the dashboard's first page has no side panel,
  // and the saved rail and panel choices come from the preference cookie. Right at first paint, so nothing moves when the scripts run (no layout shift).
  const openingKind = seed ? dashboardKindFor(seed.session.user.role, false, null) : undefined;
  const openingSheets = seed ? pageSheetsFor(seed.opening.viewId) : [];
  const shellBody = seed ? [seed.opening.sub ? 'has-subnav' : 'no-subnav', seed.opening.sub && seed.panels?.subHidden ? 'subnav-hidden' : '', openingKind === 'guest' || openingKind === 'corporate' || openingKind === 'hotel' || openingKind === 'platform' || openingKind === 'group' ? 'portal-mobile' : '', openingKind === 'guest' ? 'hms-guest' : '', 'hms-glass', openingKind === 'guest' || openingKind === 'corporate' ? '' : 'hms-staff', seed.panels?.collapsed ? 'sidebar-collapsed' : ''].filter(Boolean).join(' ') : '';
  return (
    <html lang="en-IN" className={`${inter.variable} ${playfair.variable} h-full`} suppressHydrationWarning>
      <head>
        <style>{themeCss}</style>
        {/* R48: a verified session: the shell is rendered right here on the server, with its stylesheets render-blocking. Otherwise the snapshot outline below. */}
        {seed ? (
          <>
            <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
            {/* the menu icons are a font: fetched with the stylesheets, so the rail never shows empty icon boxes */}
            <link rel="preload" as="font" type="font/woff2" crossOrigin="anonymous" href="/pallav/fonts/bootstrap-icons.woff2?dd67030699838ea613ee6dbda90effa6" />
            {pallavHeadSheets(openingSheets).map((s) => (
              <link key={s.name} rel="stylesheet" href={s.href} {...{ [PALLAV_CSS_ATTR]: s.name, [PALLAV_SSR_ATTR]: "" }} />
            ))}
          </>
        ) : ended ? null : (
          <>
        {/* Before the first paint of a reload: a browser that had a dashboard open (dashboards/shell/shellFlag.ts) gets the neutral dashboard outline in its
            remembered theme and rail width (globals.css .hms-sk-app), never the graphite sign-in page. Reads three localStorage words, writes nothing. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var d=document.documentElement,s=localStorage;if(s.getItem("hms-shell")==="app"){d.dataset.shell="app";var t=s.getItem("pms-theme");d.dataset.theme=t==="dark"?"dark":"light";if(s.getItem("pms.sidebarCollapsed")==="1")d.dataset.skCollapsed="";var l=document.querySelectorAll("link[data-sk-preload]");for(var i=0;i<l.length;i++)l[i].rel="preload";}}catch(e){}',
          }}
        />
        {/* The dashboard's stylesheets, fetched together with the outline when the script above turns these into preloads (an idle <link> otherwise). */}
        {PALLAV_BASE_URLS.map((href) => (
          <link key={href} data-sk-preload="" rel="prefetch" as="style" href={href} />
        ))}
          </>
        )}
      </head>
      <body className={`min-h-full ${shellBody}`.trim()}>
        {/* the screen translator: puts the chosen language on every English text of the page (no markup of its own) */}
        <ScreenTranslator />
        {children}
        {/* The outline gets the last shell snapshot's words (dashboards/shell/shellSnapshot.ts: brand, menu labels, page title, person) before any script of the
            app runs, so a reload's first paint already reads like the dashboard. Reads one localStorage entry, writes nothing, draws text only. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(document.documentElement.dataset.shell==="app"){var s=JSON.parse(localStorage.getItem("hms-shell-snap")||"null");var t=function(c,x){var e=document.createElement("span");e.className=c;e.textContent=x;return e;};var fill=function(){var r=null,all=document.querySelectorAll(".hms-sk-app:not(.hms-sk-always):not(.hms-sk-words)");for(var k=0;k<all.length;k++){if(!all[k].closest("[hidden],template"))r=all[k];}if(!r)return false;r.classList.add("hms-sk-words");var rail=r.querySelector(".hms-sk-rail");if(rail){rail.textContent="";rail.appendChild(t("hms-sk-logo",s.brandName));var n=0;for(var i=0;i<s.sections.length&&n<14;i++){rail.appendChild(t("hms-sk-group",s.sections[i].title));for(var j=0;j<s.sections[i].items.length&&n<14;j++){var it=s.sections[i].items[j];if(it.hidden)continue;rail.appendChild(t("hms-sk-nav"+(it.id===s.activeId?" hms-sk-on":""),it.label));n++;}}}var top=r.querySelector(".hms-sk-top");if(top){top.textContent="";var h=t("hms-sk-title","");h.appendChild(t("hms-sk-eyebrow",s.header.eyebrow));h.appendChild(t("hms-sk-h1",s.header.title));top.appendChild(h);top.appendChild(t("hms-sk-chip",s.user.displayName));}return true;};if(s){fill();var mo=new MutationObserver(fill);mo.observe(document.documentElement,{childList:true,subtree:true});setTimeout(function(){mo.disconnect();},10000);}}}catch(e){}',
          }}
        />
        {/* Local demo build only (docs/UI.md): never rendered, and never present in the bundle, unless the build-time flag is set. */}
        {process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO === "1" && <LocalDemoBadge />}
      </body>
    </html>
  );
}

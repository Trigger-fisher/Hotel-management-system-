import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteCopy as c } from "@shared/site/copy";
import type { SitePageMeta } from "@shared/site/pages";
import { BrandLogo } from "@/components/BrandLogo";

// The frame of every public website page (MJ, 2 Nov 2026): the top bar with the sections, Sign in and Book a demo; the page; and the footer with the product, company
// and legal links. `current` marks the section the visitor is on. Server component.

export function SiteShell({ current, children }: { current?: string; children: ReactNode }) {
  return (
    <div className="hp">
      <a className="hp-skip" href="#main">Skip to content</a>
      <header className="hp-top">
        <div className="hp-wrap hp-top-row">
          <a className="hp-brand" href={c.path}>
            <BrandLogo />
          </a>
          <nav className="hp-nav" aria-label="Website">
            {c.nav.map((n) => (
              <a key={n.href} href={n.href} aria-current={current === n.href ? "page" : undefined}>{n.label}</a>
            ))}
          </nav>
          <div className="hp-actions">
            <a className="hp-btn hp-btn-ghost" href={c.signInPath}>{c.signIn}</a>
            <a className="hp-btn hp-btn-solid hp-hide-sm" href={c.demoPath}>{c.demo}</a>
          </div>
        </div>
        {/* phones: the sections as one scrolling row under the bar */}
        <nav className="hp-nav-sm" aria-label="Website sections">
          <div className="hp-wrap">
            {c.nav.map((n) => (
              <a key={n.href} href={n.href} aria-current={current === n.href ? "page" : undefined}>{n.label}</a>
            ))}
          </div>
        </nav>
      </header>

      <main id="main">{children}</main>

      <footer className="hp-foot">
        <div className="hp-wrap">
          <div className="hp-foot-grid">
            <div className="hp-foot-brand">
              <a className="hp-brand" href={c.path}>
                <BrandLogo />
              </a>
              <p>{c.hero.eyebrow}.</p>
              <a href={`mailto:${c.contactEmail}`}>{c.contactEmail}</a>
            </div>
            {c.footer.columns.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <p className="hp-foot-h">{col.title}</p>
                {col.links.map((l) => (
                  <a key={l.href} href={l.href}>{l.label}</a>
                ))}
              </nav>
            ))}
          </div>
          <p className="hp-foot-note">© {new Date().getFullYear()} {c.brand.name}. {c.footer.rights}</p>
        </div>
      </footer>
    </div>
  );
}

/** A website page's metadata: its own title and description, the canonical address, open to search engines (the root layout closes everything else). */
export function sitePageMetadata(m: SitePageMeta): Metadata {
  return {
    metadataBase: new URL(c.url),
    title: m.title,
    description: m.description,
    alternates: { canonical: m.path },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url: m.path, siteName: c.brand.name, title: m.title, description: m.description, locale: "en_IN" },
    twitter: { card: "summary_large_image", title: m.title, description: m.description },
  };
}

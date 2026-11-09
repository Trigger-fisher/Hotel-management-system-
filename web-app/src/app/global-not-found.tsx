import type { Metadata, Viewport } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import { copy, productName } from "@shared/auth/copy";
import { auth } from "@shared/tokens";
import { Icon } from "@/components/ui";
import { themeCss } from "@/lib/theme";
import "./globals.css";

// An address that matches no route at all (a typo, an old link, a bot probing /wp-admin). Next.js answers it with this page WITHOUT the root layout
// (experimental.globalNotFound in next.config.ts), so it is a static page from the CDN: no function call, no session lookup, no dashboard styles.
// The same card as not-found.tsx, which still serves notFound() calls inside the app.

const inter = localFont({ src: "./fonts/inter-latin.woff2", variable: "--font-inter", weight: "100 900", display: "swap" });
const playfair = localFont({ src: "./fonts/playfair-display-latin.woff2", variable: "--font-playfair", weight: "400 900", display: "swap" });

export const metadata: Metadata = {
  title: `Page not found · ${productName}`,
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: auth.background.stops[0],
  colorScheme: "light",
};

export default function GlobalNotFound() {
  return (
    <html lang="en-IN" className={`${inter.variable} ${playfair.variable} h-full`}>
      <head>
        <style>{themeCss}</style>
      </head>
      <body className="min-h-full">
        <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
          <div className="w-full max-w-[440px] rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-graphite-100 text-primary">
              <Icon name="link_off" size={24} />
            </div>
            <h1 className="text-title font-bold text-ink">We couldn&apos;t find that page</h1>
            <Link
              href="/login"
              className="hms-press mt-6 inline-flex h-12 w-full items-center justify-center rounded-button bg-primary px-5 text-body-lg font-semibold text-on-primary hover:bg-primary-hover"
            >
              {copy.common.backToSignIn}
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}

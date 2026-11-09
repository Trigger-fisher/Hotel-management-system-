import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "./security-headers";

// The id of this build (R48 soft refresh): the page carries it (NEXT_PUBLIC_BUILD_ID) and the server reports it in the x-hms-build header of /api/v1/health, so a page that was loaded
// before a new deployment can notice it and reload once. Opaque on purpose (a time stamp, or the first 12 characters of the commit on Vercel); it says nothing else.
// It must be the SAME value every time this file is read (the build reads it in several workers), so it is never a time stamp taken here: HMS_BUILD_ID, else the commit of the build, else the git HEAD.
const BUILD_ID = process.env.HMS_BUILD_ID || (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 12) || gitHead() || "local";
function gitHead(): string {
  try {
    return execSync("git rev-parse --short=12 HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

// The server functions that read or test a mailbox (Conversations, decision 66): the hotel and platform hubs, the cron that checks mailboxes, and Hotel Settings' connection test.
// Platform Settings' own test is under /api/v1/platform/conversations/mailbox/test. A new route that reads mail must be added here (tests/server/conversations.bundle.test.ts checks it).
export const MAIL_FUNCTIONS = "/api/v1/{conversations,platform/conversations,platform/setup,cron/conversations,cron/mail-files,admin/settings/email/connection-test}{,/**}";

/** These packages and everything they depend on (resolved like Node does, nested copies included), as include globs relative to this folder: their code and data files only. */
function packageClosure(roots: string[]): string[] {
  const found = new Set<string>();
  const visit = (name: string, from: string): void => {
    for (let dir = from; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, "node_modules", name);
      if (fs.existsSync(path.join(candidate, "package.json"))) {
        if (found.has(candidate)) return;
        found.add(candidate);
        const pkg = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8")) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
        for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dep, candidate);
        return;
      }
      if (path.dirname(dir) === dir) return;
    }
  };
  for (const root of roots) visit(root, __dirname);
  return [...found].map((dir) => `./${path.relative(__dirname, dir).replace(/\\/g, "/")}/**/*.{js,cjs,mjs,json}`).sort();
}

const nextConfig: NextConfig = {
  generateBuildId: async () => BUILD_ID,
  // The same folder for file tracing: on Vercel (Root Directory web-app, "include files outside the Root Directory") the build output must be
  // traced from the parent too, or the shared ui-shared files could be missed in the deployed functions. Next warns when the two differ.
  outputFileTracingRoot: path.join(__dirname, ".."),
  poweredByHeader: false,
  // Always inline the local-demo flag (empty when unset), so a normal production build sees a constant and drops the mock, quick login and badge.
  env: { NEXT_PUBLIC_HMS_LOCAL_DEMO: process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO ?? "", NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // The dev badge sits over the sidebar logo and ends up in review screenshots.
  devIndicators: false,
  // PDFs (MJ #22): pdfkit reads its own data files at run time, so it stays outside the bundle; the bundled fonts are copied next to every API route's build.
  // Conversations (decision 66): the IMAP client and the MIME parser load their own modules (and mailparser its own nodemailer) at run time, so they stay outside the bundle too.
  serverExternalPackages: ["pdfkit", "sharp", "imapflow", "mailparser"],
  // ui-shared/ sits next to web-app/, so Turbopack must see the parent folder.
  turbopack: { root: path.join(__dirname, "..") },
  outputFileTracingIncludes: {
    "/api/**": ["./src/server/documents/fonts/**"],
    // Conversations email (decision 66): imapflow and mailparser are loaded with turbopackIgnore (mail/imap.ts, mail/mime.ts), so the build traces them into no function;
    // they (and every package they need) ship with the email functions only, not with the other ~500.
    [MAIL_FUNCTIONS]: packageClosure(["imapflow", "mailparser"]),
  },
  // Backend and review builds set NEXT_DIST_DIR (e.g. .next-backend) so they never overwrite the dev server's .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // A second dev server (own NEXT_DIST_DIR) sets NEXT_TSCONFIG to its own tsconfig file, so Next never rewrites the committed tsconfig.json.
  typescript: { tsconfigPath: process.env.NEXT_TSCONFIG ?? "tsconfig.json" },
  // React Compiler (approved by MJ): memoises components automatically, so screens need no useMemo/useCallback.
  reactCompiler: true,
  // Unmatched addresses get app/global-not-found.tsx without the root layout: a static 404 (the root layout reads the session cookie for the server-rendered shell).
  experimental: { globalNotFound: true },
  // Dev only: lets another PC on the same Wi-Fi / hotspot open the dev server by this PC's IP (private ranges only).
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*", "172.16.*.*", "172.17.*.*", "172.18.*.*", "172.19.*.*", "172.2*.*.*", "172.30.*.*", "172.31.*.*"],
  // The /dev previews exist only in development and in the local demo build; a normal production build answers a real 404 before any page renders.
  async rewrites() {
    const noDev = process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO !== "1";
    return { beforeFiles: noDev ? [{ source: "/dev/:path*", destination: "/__no-dev-routes__" }] : [], afterFiles: [], fallback: [] };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV === "production"),
      },
      // R48: the page at "/" is rendered per request from the person's session cookie and carries their name (the dashboard shell). No shared cache (CDN, proxy) may keep it,
      // and the browser may not keep it either (also not for the back-forward cache): private, no-store, per cookie.
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          { key: "Vary", value: "Cookie" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Vercel-CDN-Cache-Control", value: "no-store" },
        ],
      },
      { source: "/api/v1/health", headers: [{ key: "x-hms-build", value: BUILD_ID }] },
      // Hotel Pallav's vendored scripts, styles and images keep their file names, so a day of caching (and a quiet refresh after) is the safe middle.
      {
        source: "/pallav/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
};

export default nextConfig;

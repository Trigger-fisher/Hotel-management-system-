"use client";

import dynamic from "next/dynamic";

import { loadMocks } from "@/lib/api/mockLoader";

// Dev-only helper (agreement section 3). Gate (docs/UI.md, dev quick login / local demo): only dev builds or
// local-demo builds (NEXT_PUBLIC_HMS_LOCAL_DEMO=1) contain the panel; both checks are literal, so a normal
// production build removes the panel and the demo data (accounts, passwords) entirely. The demo accounts come with
// the mocks (lib/api/mockLoader.ts), loaded together with the panel.
// The panel itself also renders nothing unless apiMode() === "mock" (never in real mode).
const DemoPanel =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO === "1"
    ? dynamic(
        () =>
          Promise.all([import("./DemoPanel"), loadMocks()]).then(([panel, demo]) => {
            return function LoadedDemoPanel() {
              return <panel.DemoPanel demo={demo} />;
            };
          }),
        { ssr: false },
      )
    : null;

export function DemoAccounts() {
  return DemoPanel ? <DemoPanel /> : null;
}

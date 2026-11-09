"use client";

import { useEffect } from "react";

/**
 * Test mode and the local demo only (app/page.tsx renders this behind a literal build check, so a normal production build drops it).
 * The mock keeps its session in the tab (sessionStorage), never in a cookie, so the server shows the website at "/" even to a signed-in mock tab.
 * Such a tab goes on to the sign-in page, which restores the mock session and opens the dashboard. Renders nothing.
 */
export function MockSessionReturn() {
  useEffect(() => {
    let live = true;
    void Promise.all([import("@/lib/api/mode"), import("@/lib/auth/api")])
      .then(([{ apiMode }, { hasStoredMockSession }]) => {
        if (live && apiMode() === "mock" && hasStoredMockSession()) window.location.replace("/login");
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return null;
}

"use client";

import dynamic from "next/dynamic";
import { AuthShellSkeleton } from "./AuthShell";

// The auth app reads the address bar (email links) and browser history on start,
// so it runs only in the browser. The server sends the shell outline as a placeholder.
// A link with ?invite=<token> (an emailed hotel / group invitation) opens the PUBLIC onboarding form instead of the sign-in flow: no sign-in,
// no dashboard styles (Frontend 2's groups/platform/Onboarding; mock links look like /?invite=<token>).
const AuthApp = dynamic<{ ended?: "SESSION_REPLACED" | "SESSION_REVOKED" | "SESSION_EXPIRED" | null; noSession?: boolean }>(
  async () => {
    if (new URLSearchParams(window.location.search).has("invite")) {
      const m = await import("@/dashboards/groups/platform/Onboarding");
      const token = m.readInviteToken();
      if (token) {
        return function Invite() {
          return <m.PlatformOnboarding token={token} />;
        };
      }
    }
    return (await import("./AuthApp")).AuthApp;
  },
  { ssr: false, loading: () => <AuthShellSkeleton /> },
);

/** `ended`: the server found this browser's session over (app/page.tsx), and why. `noSession`: the request carried no session cookie at all (nothing to restore). */
export function AuthEntry({ ended = null, noSession = false }: { ended?: "SESSION_REPLACED" | "SESSION_REVOKED" | "SESSION_EXPIRED" | null; noSession?: boolean }) {
  return <AuthApp ended={ended} noSession={noSession} />;
}

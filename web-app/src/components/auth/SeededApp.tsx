"use client";

// R48: the app for a person whose session cookie the server verified. Imported straight by app/page.tsx (a server component), so the browser only downloads it for a
// signed-in page, and nothing in it is lazy: the server draws the real sidebar and top bar in the first HTML, never a placeholder that is swapped out a moment later
// (no snapshot outline, no flat outline). The sign-in flow without a session keeps its own client-only entry (AuthEntry).
import type { Session } from "@shared/auth-pallav";
import { RoleDashboard, type RoleDashboardProps } from "@/dashboards/shell";
import { OpeningGroup } from "@/dashboards/shell/OpeningGroup";
import type { ShellPanels } from "@/lib/shellPanels";
import type { Route } from "@shared/dashboards/routes";
import { AuthApp } from "./AuthApp";
import { DirectDashboard } from "./directDashboard";

export function SeededApp({ seed, panels, route, header, opening }: { seed: Session; panels: ShellPanels | null; route: Route | null; header: { at: number }; opening: { viewId: string } }) {
  // the page the address names (drawn by the server), so the dashboard starts on it; the seed's visit (platform and group staff inside a hotel) saves the shell
  // its own session read for the banner (speed, 24 Oct 2026)
  const drawDashboard = (props: RoleDashboardProps) => <RoleDashboard {...props} initialRoute={route} initialHeader={header} initialVisit={seed.visit ?? null} />;
  return (
    <DirectDashboard value={drawDashboard}>
      <AuthApp seed={seed} panels={panels} />
      {/* the opening screen's chunk, preloaded by the first HTML (speed, 24 Oct 2026) */}
      <OpeningGroup viewId={opening.viewId} />
    </DirectDashboard>
  );
}

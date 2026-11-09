"use client";

import dynamic from "next/dynamic";
import { AppShellSkeleton } from "@/components/ui/AppShellSkeleton";

// A reload's first dashboard frame (dashboards/shell/SnapshotShell): the real sidebar and top bar from the last shell snapshot, with a page skeleton inside.
// One dynamic import shared by the restore (AuthApp) and the dashboard's own loading state (SignedInStep), so the chunk loads once and the hand-over to the
// real dashboard is seamless. Until the chunk arrives the CSS outline stays.
export const DashboardPlaceholder = dynamic(() => import("@/dashboards/shell").then((m) => m.SnapshotShell), {
  ssr: false,
  loading: () => <AppShellSkeleton always />,
});

"use client";

// The "LOCAL DEMO" badge of the local demo build (docs/UI.md, "Local demo build"). The literal env check stays in layout.tsx, so a normal build
// never contains this component; here the mock mode is checked as well, so a demo build opened with `?api=real` (talking to the real server)
// does not claim to be a demo.
import { useSyncExternalStore } from "react";
import { apiMode } from "@/lib/api/mode";

const never = () => () => {};

export function LocalDemoBadge() {
  const mock = useSyncExternalStore(never, () => apiMode() === "mock", () => false);
  if (!mock) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed", right: 12, bottom: 12, zIndex: 2147483000, pointerEvents: "none", padding: "4px 10px", borderRadius: 999,
        background: "var(--hms-gold)", color: "var(--hms-text)", font: "700 11px/1.4 var(--font-inter), system-ui, sans-serif", letterSpacing: ".08em",
        boxShadow: "var(--hms-shadow-md)",
      }}
    >
      LOCAL DEMO
    </div>
  );
}

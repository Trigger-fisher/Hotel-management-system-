import { ImageResponse } from "next/og";
import { siteCopy } from "@shared/site/copy";

// The card a shared link shows (WhatsApp, LinkedIn, Slack): ink and white, the name and the one line. Drawn here, no file to keep in step.
export const alt = siteCopy.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#111114", color: "#ffffff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 16, background: "#ffffff", color: "#111114", fontSize: 30, fontWeight: 800 }}>{siteCopy.brand.mark}</div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>{siteCopy.brand.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 84, lineHeight: 1.04, fontWeight: 800, letterSpacing: -2 }}>{siteCopy.hero.title}</div>
          <div style={{ fontSize: 30, color: "#a1a1aa" }}>Reservations, GST billing, cash, companies and payroll.</div>
        </div>
      </div>
    ),
    size,
  );
}

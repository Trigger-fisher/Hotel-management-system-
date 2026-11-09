"use client";

import { useState } from "react";
import type { Role } from "@shared/auth/types";
import type { HmsUser } from "@shared/auth-pallav/types";
import { RoleDashboard } from "@/dashboards/shell";

export type PreviewRole = "guest" | "corporate" | "hotel" | "hotelUser" | "platform" | "superadmin" | "group";

const hotel = { id: "h-1", name: "Hotel Sunrise, Rajkot", foodName: "Sunrise Foods" };

// platform, superadmin and group mirror the mock logins "platform", "superadmin" and "groupadmin" (ui-shared/auth-pallav/mock.ts): the mock console is chosen by that username (nav.ts dashboardKindFor)
const demo: Record<PreviewRole, { role: Role; name: string; email: string; hotel: HmsUser["hotel"]; group: HmsUser["group"]; id?: string; username?: string }> = {
  platform: { role: "platform_admin", name: "Neha Kapoor", email: "platform@demo.hms", hotel: null, group: null, id: "u-platform", username: "platform" },
  superadmin: { role: "super_admin", name: "Rajiv Malhotra", email: "superadmin@demo.hms", hotel: null, group: null, id: "u-superadmin", username: "superadmin" },
  group: { role: "group_hotel_admin", name: "Kavita Desai", email: "groupadmin@demo.hms", hotel: null, group: { id: "g-1", name: "Sunrise Group" }, id: "u-group", username: "groupadmin" },
  guest: { role: "guest_user", name: "Amit Joshi", email: "guest@demo.hms", hotel, group: null },
  corporate: { role: "corporate_user", name: "Deepa Iyer", email: "corporate@demo.hms", hotel: null, group: { id: "g-tcs", name: "Tata Consultancy Services" } },
  hotel: { role: "hotel_admin", name: "Anita Shah", email: "anita@demo.hms", hotel, group: null },
  hotelUser: { role: "hotel_user", name: "Ravi Kumar", email: "ravi@demo.hms", hotel, group: null },
};

function demoUser(r: PreviewRole, abilities?: string[]): HmsUser {
  const d = demo[r];
  return {
    // the guest preview is the demo guest of the mock sign-in (ui-shared/auth-pallav/mock.ts), so it shows the seeded stay, bills and history
    id: d.id ?? (r === "guest" ? "u-guest" : `dev-${r}`),
    displayName: d.name,
    email: d.email,
    username: d.username ?? null,
    role: d.role,
    hotel: d.hotel,
    group: d.group,
    abilities: abilities ?? (r === "hotel" ? ["system.backdate", "system.recycle", "system.force"] : []),
  };
}

/** Dev-only wrapper: shows the dashboard for a demo user. Sign out and lock just show a note here. */
export function Preview({ role, abilities }: { role: PreviewRole; abilities?: string[] }) {
  const [note, setNote] = useState<"signedOut" | "locked" | null>(null);
  if (note) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 font-sans">
        <div className="max-w-[360px] text-center">
          <p>{note === "signedOut" ? "Signed out (preview)." : "Screen locked (preview)."}</p>
          <button type="button" onClick={() => setNote(null)} className="mt-3 min-h-11 px-5">
            Back to the dashboard
          </button>
        </div>
      </main>
    );
  }
  return <RoleDashboard user={demoUser(role, abilities)} onSignOut={() => setNote("signedOut")} onLockScreen={() => setNote("locked")} />;
}

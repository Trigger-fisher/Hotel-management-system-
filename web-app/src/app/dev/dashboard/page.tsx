import { notFound } from "next/navigation";
import type { PreviewRole } from "./Preview";

const ROLES: PreviewRole[] = ["guest", "corporate", "hotel", "hotelUser", "platform", "superadmin", "group"];

// Answered per request, so a production build never prerenders a page for this route: it is a real 404 there.
export const dynamic = "force-dynamic";

// Dev-only preview of the role dashboards (S03): /dev/dashboard?role=guest|corporate|hotel|hotelUser|platform|superadmin|group.
// Optional `abilities=system.backdate,system.force` sets the demo user's special abilities (default: the hotel admin may backdate and use recycle bins).
// Production builds answer 404 and the preview code is not bundled.
export default async function DevDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A literal NODE_ENV branch, so production builds drop the preview and its demo users entirely.
  if (process.env.NODE_ENV !== "production") {
    const { Preview } = await import("./Preview");
    const raw = (await searchParams).role;
    const asked = Array.isArray(raw) ? raw[0] : raw;
    const role = ROLES.find((r) => r === asked) ?? "hotel";
    const rawAbilities = (await searchParams).abilities;
    const abilities = (Array.isArray(rawAbilities) ? rawAbilities[0] : rawAbilities)?.split(",").filter(Boolean);
    return <Preview role={role} abilities={abilities} />;
  }
  notFound();
}

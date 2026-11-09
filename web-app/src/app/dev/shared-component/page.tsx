import { notFound } from "next/navigation";

// Answered per request, so a production build never prerenders this page. Dev server and the local demo build only.
export const dynamic = "force-dynamic";

export const metadata = { title: "Shared Component" };

export default async function SharedComponentPage() {
  // Literal checks, so a normal production build drops the page and everything it imports (next.config.ts also answers /dev/* with a 404).
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO === "1") {
    const { SharedComponent } = await import("./SharedComponent");
    return <SharedComponent />;
  }
  notFound();
}

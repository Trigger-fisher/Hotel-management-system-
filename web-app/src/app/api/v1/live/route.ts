import "server-only";
import { openConvStream } from "@/server/compose/convLive";
import { route } from "@/server/http/route";

// Live Email and WhatsApp (MJ, 5 Nov 2026): the page's event stream. Each event names the page and the conversation ids that changed, nothing else; the page then asks the
// normal, checked routes. Staff in a browser only (a guest, a company login, an API key: 403); only the boxes this person may see (compose/convLive.ts liveBoxesOf). Closed after
// five minutes so the page opens a new one with its session checked again. Where the host cannot hold a stream (Vercel) it answers 409 and the page uses the ping.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = route({
  permission: "session",
  touch: false,
  limits: [{ name: "live", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, request }) => ({ data: null, eventStream: await openConvStream(session, request.signal) }),
});

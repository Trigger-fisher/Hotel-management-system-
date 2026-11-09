import "server-only";
import { getMarketing } from "@/server/compose/companies";
import { publicRoute } from "@/server/http/route";
import { unsubscribeQuery } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

// The link at the foot of every campaign mail (no sign-in): h = the hotel, e = the address, t = its signature. A wrong link answers 404. Rate-limited like the other public doors.
//  - GET only ASKS (security review round 2, L3): a mail program or a link scanner that opens every link must not unsubscribe anybody. The page has one button, which POSTs.
//  - POST records the opt-out: that button, or a mail program's one-click unsubscribe (RFC 8058: the mail carries List-Unsubscribe-Post: List-Unsubscribe=One-Click, and the
//    program POSTs "List-Unsubscribe=One-Click" to this same address). Twice is fine.
const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
const page = (title: string, body: string): Uint8Array =>
  new TextEncoder().encode(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#F6F6F7;color:#18181B;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}main{background:#fff;border:1px solid #E4E4E7;border-radius:16px;padding:32px 28px;max-width:420px;margin:16px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;color:#52525B;line-height:1.5}button{font:inherit;font-weight:600;background:#3A3A42;color:#fff;border:0;border-radius:8px;padding:12px 24px;cursor:pointer}</style></head>
<body><main>${body}</main></body></html>`);
const html = (title: string, body: string) => ({ data: null, binary: { bytes: page(title, body), contentType: "text/html; charset=utf-8", filename: "unsubscribe.html", disposition: "inline" as const } });

export const GET = publicRoute({
  query: unsubscribeQuery,
  idempotency: "off",
  limits: [{ name: "unsubscribe", max: 30, windowSeconds: 60, by: "ip" }],
  handler: async ({ query, request }) => {
    const { email } = getMarketing().checkUnsubscribe(query);
    // the form posts to this very address (its query carries the signed link)
    const action = esc(new URL(request.url).pathname + new URL(request.url).search);
    return html("Unsubscribe", `<h1>Stop these emails?</h1><p>${esc(email)} will get no more offers and news from this hotel. Booking confirmations and bills still reach you.</p><form method="post" action="${action}"><button type="submit">Unsubscribe</button></form>`);
  },
});

export const POST = publicRoute({
  query: unsubscribeQuery,
  idempotency: "off",
  limits: [{ name: "unsubscribe", max: 30, windowSeconds: 60, by: "ip" }],
  handler: async ({ query }) => {
    const { email } = await getMarketing().unsubscribe(query);
    return html("Unsubscribed", `<h1>You are unsubscribed</h1><p>${esc(email)} will not get these emails any more. Booking confirmations and bills still reach you.</p>`);
  },
});

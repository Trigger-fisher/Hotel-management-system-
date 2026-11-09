import "server-only";
import { isPortalAccount } from "@/server/auth/permissions";
import { groupIdOfAdmin } from "@/server/compose/groupConversations";
import { AppError } from "@/server/errors";
import { channelsForSession, signalConfig } from "@/server/mail/signal";
import { route } from "@/server/http/route";

// Which "new mail" channels this page may listen on (see server/mail/signal.ts). Nothing but channel names: no mail, no count. Without the settings it says enabled: false
// and the page keeps to its timed checks. The key is the project's public anon key, meant for browsers.
export const dynamic = "force-dynamic";

type Answer = { enabled: false } | { enabled: true; url: string; key: string; channels: string[] };

export const GET = route({
  permission: "session",
  touch: false,
  limits: [{ name: "mail-signal", max: 20, windowSeconds: 60, by: "user" }],
  handler: async ({ session }): Promise<{ data: Answer }> => {
    // staff only, from a browser: a guest, a company login and an API key have no mailbox to hear about
    if (session.client === "token" || session.token !== undefined || isPortalAccount(session)) throw new AppError("FORBIDDEN", "Not available for this account.");
    const cfg = signalConfig();
    if (!cfg) return { data: { enabled: false } };
    const channels = channelsForSession(session, cfg.secret, session.accountRole === "group_hotel_admin" ? await groupIdOfAdmin(session.userId).catch(() => null) : null);
    if (channels.length === 0) return { data: { enabled: false } };
    return { data: { enabled: true, url: cfg.url, key: cfg.key, channels } };
  },
});

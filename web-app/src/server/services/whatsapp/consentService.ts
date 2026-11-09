import "server-only";
import type { Catalog } from "../../auth/catalog";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { ConversationsRepos } from "../../repos/conversations";
import type { WaConsent, WaConsentRepo } from "../../repos/postgres/whatsappConsent";
import type { Unit } from "../../repos/types";
import type { PeopleDirectory } from "../cash/ports";
import { whatsappAccess } from "../conversations/conversationsService";

// A guest's agreement to automatic WhatsApp messages (MJ, 4 Nov 2026): the tick staff record when the guest says yes (at booking or check-in), with who and when, and the way to take it back. The sender
// refuses automatic messages and templates outside the 24 hours to a guest without it (send.ts, check 4). The same right as Conversations (View to read, Edit to change).
export interface ConsentRepos {
  consent: WaConsentRepo;
  systemLogs: ConversationsRepos["systemLogs"];
}

export function createConsentService(deps: { unit: Unit<ConsentRepos>; people: PeopleDirectory; catalog: Catalog; now: () => Date }) {
  const { unit, catalog, now } = deps;
  return {
    async get(session: VerifiedSession, customerId: string): Promise<WaConsent> {
      whatsappAccess(session, catalog, "view");
      return unit.run(session, async (repos) => {
        const c = await repos.consent.get(customerId);
        if (!c) throw new AppError("NOT_FOUND");
        return c;
      });
    },

    async set(session: VerifiedSession, customerId: string, on: boolean, meta: RequestMeta): Promise<WaConsent> {
      whatsappAccess(session, catalog, "edit");
      return unit.run(session, async (repos) => {
        const before = await repos.consent.get(customerId);
        if (!before) throw new AppError("NOT_FOUND");
        if (on && !before.hasMobile) throw new AppError("CONFLICT", "This guest has no mobile number on the record, so the agreement could not be matched to their WhatsApp. Add the number first.");
        const c = await repos.consent.set(customerId, on, session.userId, now());
        if (!c) throw new AppError("NOT_FOUND");
        if (before.on !== c.on) {
          const name = (await deps.people.get([session.userId])).get(session.userId)?.name ?? "System";
          await repos.systemLogs.write({ module: "conversations", action: "updated", entity: "WhatsApp consent", subjectId: customerId, subjectLabel: "Guest", summary: c.on ? "Guest agreed to WhatsApp messages" : "Guest's WhatsApp agreement withdrawn", details: null, userId: session.userId, userName: name, ipAddress: meta.ip, traceId: meta.traceId });
        }
        return c;
      });
    },
  };
}
export type ConsentService = ReturnType<typeof createConsentService>;

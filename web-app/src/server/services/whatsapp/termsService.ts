import "server-only";
import type { Catalog } from "../../auth/catalog";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { ConversationsRepos } from "../../repos/conversations";
import type { Unit } from "../../repos/types";
import { termsAcceptanceOf, WA_TERMS_KEY, WA_TERMS_POINTS, WA_TERMS_TITLE, WA_TERMS_VERSION, type WaTermsAcceptance } from "../../whatsapp/terms";
import type { PeopleDirectory } from "../cash/ports";
import { whatsappAccess } from "../conversations/conversationsService";

// The WhatsApp terms (plan part 3, the legal gate): the hotel's admin accepts them once; until then the hotel sends no WhatsApp message to a guest. Anyone with the Conversations right can READ the
// terms and see whether they were accepted; only the Hotel Admin can accept (an acceptance is a statement of the hotel). A new version of the terms asks again.
export interface TermsRepos {
  adminSettings: { get(keys: readonly string[]): Promise<{ key: string; value: string | null }[]>; set(rows: readonly { key: string; value: string | null; secret: boolean }[], by: string): Promise<void> };
  systemLogs: ConversationsRepos["systemLogs"];
}

export interface TermsView {
  title: string;
  version: string;
  points: readonly string[];
  accepted: { at: string; byName: string } | null;
  /** Only the Hotel Admin accepts. */
  canAccept: boolean;
}

export function createTermsService(deps: { unit: Unit<TermsRepos>; people: PeopleDirectory; catalog: Catalog; now: () => Date }) {
  const { unit, catalog, now } = deps;
  const nameOf = async (id: string): Promise<string> => (await deps.people.get([id])).get(id)?.name ?? "Former staff";
  const view = async (repos: TermsRepos, session: VerifiedSession): Promise<TermsView> => {
    const row = (await repos.adminSettings.get([WA_TERMS_KEY]))[0];
    const a = termsAcceptanceOf(row?.value);
    return { title: WA_TERMS_TITLE, version: WA_TERMS_VERSION, points: WA_TERMS_POINTS, accepted: a ? { at: a.at, byName: await nameOf(a.by) } : null, canAccept: session.accountRole === "hotel_admin" && session.visit === undefined };
  };
  return {
    async get(session: VerifiedSession): Promise<TermsView> {
      whatsappAccess(session, catalog, "view");
      return unit.run(session, (repos) => view(repos, session));
    },

    async accept(session: VerifiedSession, meta: RequestMeta): Promise<TermsView> {
      whatsappAccess(session, catalog, "edit");
      if (session.accountRole !== "hotel_admin" || session.visit !== undefined) throw new AppError("FORBIDDEN", "Only the hotel admin can accept the WhatsApp terms.");
      return unit.run(session, async (repos) => {
        const current = termsAcceptanceOf((await repos.adminSettings.get([WA_TERMS_KEY]))[0]?.value);
        if (!current) {
          const value: WaTermsAcceptance = { version: WA_TERMS_VERSION, at: now().toISOString(), by: session.userId };
          await repos.adminSettings.set([{ key: WA_TERMS_KEY, value: JSON.stringify(value), secret: false }], session.userId);
          await repos.systemLogs.write({ module: "conversations", action: "updated", entity: "WhatsApp terms", subjectId: null, subjectLabel: null, summary: "WhatsApp terms accepted", details: null, userId: session.userId, userName: await nameOf(session.userId), ipAddress: meta.ip, traceId: meta.traceId });
        }
        return view(repos, session);
      });
    },
  };
}
export type TermsService = ReturnType<typeof createTermsService>;

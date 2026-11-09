import "server-only";
import type { WebContent } from "@shared/dashboards/website";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { PageContentFields } from "../../repos/website";
import { diffDetails } from "../cash/syslog";
import { actorOf, logLine, type WebsiteDeps, type Who } from "./context";
import { pointLines } from "./mapTools";
import { hasVisibleText, richText } from "./sanitizer";

// The home page wording (Pallav Website/ContentController): hero, availability bar, about, enquiry section, the form's messages and the footer.
// Rich text is edited as HTML and printed unescaped on the public site, so each rich field goes through the allow-list cleaner. Spec: docs/specs/website.md §7.

const PART = "website.content";
const REQUIRED = "Please fill in all required fields.";

/** Edited as rich text and printed unescaped, so each is cleaned. */
const RICH = ["heroLead", "aboutP1", "aboutP2", "aboutP3", "enquireLead", "footerTagline", "bookingTermsText", "policiesFooterNote"] as const;
/** Rich fields that may be left empty. */
const RICH_OPTIONAL = new Set<string>(["aboutP1", "aboutP2", "aboutP3", "bookingTermsText", "policiesFooterNote"]);
/** Plain text boxes, all required, with the longest each may be. */
const PLAIN: Record<string, number> = {
  heroTitleLine1: 100, heroTitleEmphasis: 100, quickCheckTitle: 100,
  qcMsgPickDates: 200, qcMsgAvailable: 200, qcMsgUnavailable: 300, qcMsgError: 200,
  fmMsgName: 150, fmMsgPhone: 150, fmMsgEmail: 150, fmMsgCheckin: 150, fmMsgCheckout: 150, fmMsgRoom: 150, fmMsgAdults: 150, fmMsgChildren: 150, fmMsgMessage: 150, fmMsgTerms: 150,
  fmMsgSuccess: 250, aboutKicker: 50, aboutHeading: 150, enquireHeading: 150,
};

const snake = (k: string): string => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/(\D)(\d)/g, "$1_$2");

/** The wording as the apps get it: a rich field left empty reads as "". */
function contentDto(c: PageContentFields): WebContent {
  return { ...c, heroLead: c.heroLead ?? "", aboutP1: c.aboutP1 ?? "", aboutP2: c.aboutP2 ?? "", aboutP3: c.aboutP3 ?? "", enquireLead: c.enquireLead ?? "", bookingTermsText: c.bookingTermsText ?? "", policiesFooterNote: c.policiesFooterNote ?? "", footerTagline: c.footerTagline ?? "", enquirePoints: [...c.enquirePoints] };
}

/** Rich text and lists as one line each, so the log can say what changed (ContentController::flatten). */
const flatten = (c: PageContentFields, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.map((k) => {
    const v = (c as unknown as Record<string, unknown>)[k];
    return [snake(k), Array.isArray(v) ? v.join(" | ") : String(v ?? "").replace(/<[^>]*>/g, "")];
  }));

export function createContentService(deps: WebsiteDeps) {
  const { unit, catalog } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });

  return {
    async get(session: VerifiedSession): Promise<WebContent> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => contentDto(await repos.content.get()));
    },

    /** update (:35-70): rich fields cleaned first, then every plain box must be filled, then each required rich field must hold visible text. */
    async update(session: VerifiedSession, input: WebContent, meta: RequestMeta): Promise<WebContent> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      const given = input as unknown as Record<string, string>;
      const cleaned = Object.fromEntries(RICH.map((k) => [k, richText(given[k])])) as Record<(typeof RICH)[number], string>;
      const missing: Record<string, string> = {};
      for (const k of Object.keys(PLAIN)) if (given[k].trim() === "") missing[k] = "Required.";
      for (const k of RICH) if (!RICH_OPTIONAL.has(k) && !hasVisibleText(cleaned[k])) missing[k] = "Required.";
      if (Object.keys(missing).length > 0) throw new AppError("VALIDATION_FAILED", REQUIRED, { fields: missing });
      const values: Partial<PageContentFields> = {};
      for (const [k, max] of Object.entries(PLAIN)) (values as Record<string, unknown>)[k] = Array.from(given[k].trim()).slice(0, max).join("");
      // an editor left empty still holds an empty paragraph: that is nothing
      for (const k of RICH) (values as Record<string, unknown>)[k] = hasVisibleText(cleaned[k]) ? cleaned[k] : null;
      values.enquirePoints = pointLines(input.enquirePoints.join("\n"));
      return unit.run(session, async (repos) => {
        const before = await repos.content.get();
        const saved = await repos.content.update(values, session.userId);
        const keys = Object.keys(values);
        const changes = diffDetails(flatten(before, keys), flatten(saved, keys));
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Home page wording", summary: `Changed Home page wording: Home page (${Object.keys(changes).join(", ") || "no change"})`, subject: null, details: changes }));
        return contentDto(saved);
      });
    },
  };
}

export type ContentService = ReturnType<typeof createContentService>;

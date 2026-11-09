import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { pgBillingRepos } from "../repos/postgres/billing";
import { createPgWhatsAppSendStore } from "../repos/postgres/whatsappSend";
import { pgWaTemplatesRepo } from "../repos/postgres/whatsappTemplates";
import { createPgUnit } from "../repos/postgres/unit";
import { AppError } from "../errors";
import type { Unit } from "../repos/types";
import { createTemplatesService, type TemplateMeta, type TemplatesRepos, type TemplatesService } from "../services/whatsapp/templatesService";
import { createMemoryTemplatesRepo } from "../whatsapp/templatesStore";
import { whatsappConfig } from "../whatsapp/config";
import { createGraphClient, type GraphFailure } from "../whatsapp/graph";
import { metaLanguageCode } from "../whatsapp/language";
import { openToken } from "../whatsapp/seal";
import { statusFromMeta, type TemplateRecord } from "../whatsapp/templates";
import { billingDefaults } from "./billing";

// The composition of the hotel's template service (Settings > WhatsApp). The templates are rows of the hotel's own schema; Meta is reached on the hotel's current line with that line's sealed token.
// Needs the database. While WhatsApp is not set up the service still lists and drafts, and a submission answers that WhatsApp is not connected yet.
const sentence = (f: GraphFailure): string => {
  if (f.kind === "auth") return "WhatsApp refused the connection. Ask the platform team to check the number's token.";
  if (f.kind === "policy") return "Meta did not accept this message. Check the wording and the examples, then try again.";
  return "Meta could not be reached. Try again in a minute.";
};

/** On the shared number every hotel writes into one Meta account, so the name carries a short tag of the hotel (two hotels can then both have a "welcome"). */
export const metaNameOf = (hotelId: string, name: string, lineKind: string, language = "en"): string => {
  const tag = `h${hotelId.replace(/-/g, "").slice(0, 8)}_`;
  const tagged = lineKind === "shared" && !name.startsWith(tag) ? `${tag}${name}`.slice(0, 500) : name;
  // a Hinglish message goes to Meta as English, so its name must differ from the English one of the same words
  return language === "hinglish" && !tagged.endsWith("_hl") ? `${tagged}_hl` : tagged;
};

function metaPort(): TemplateMeta | undefined {
  const config = whatsappConfig();
  if (config === null) return undefined;
  const db = getDatabase();
  const store = createPgWhatsAppSendStore({ pool: db.pool, withHotel: db.withHotel, hashKey: config.hashKey });
  const graph = createGraphClient({ graphVersion: config.graphVersion });
  const lineOf = async (hotelId: string) => {
    const line = await store.currentLine({ kind: "hotel", hotelId });
    if (line === null || (line.status !== "test" && line.status !== "active")) return null;
    return { line, token: openToken(config.sealKey, line.sealedToken, line.phoneNumberId) };
  };
  const NO_LINE = "This hotel has no WhatsApp number yet.";
  return {
    async submit(hotelId, t) {
      const l = await lineOf(hotelId);
      if (!l) return { ok: false, message: NO_LINE };
      const metaName = metaNameOf(hotelId, t.name, l.line.kind, t.language);
      const r = await graph.createTemplate(l.token, l.line.wabaId, { name: metaName, language: metaLanguageCode(t.language), category: t.category, body: t.body, examples: t.variables.map((v) => v.example), buttons: t.buttons ?? [] });
      if (r.kind !== "ok") return { ok: false, message: sentence(r) };
      return { ok: true, metaTemplateId: r.metaId, status: statusFromMeta(r.status), lineId: l.line.id, metaName };
    },
    async check(hotelId, t: TemplateRecord) {
      const l = await lineOf(hotelId);
      if (!l) return { ok: false, message: NO_LINE };
      const r = await graph.templateStatus(l.token, l.line.wabaId, t.name);
      if (r.kind !== "ok") return { ok: false, message: sentence(r) };
      return { ok: true, found: r.found, status: statusFromMeta(r.status), reason: r.reason };
    },
    async remove(hotelId, t: TemplateRecord) {
      const l = await lineOf(hotelId);
      if (!l) return { ok: false, message: NO_LINE };
      const r = await graph.deleteTemplate(l.token, l.line.wabaId, t.name);
      // a template Meta no longer has (a 100 "does not exist" answer) is as good as removed
      if (r.kind === "ok" || (r.kind === "policy" && r.metaCode === 100)) return { ok: true, message: "" };
      return { ok: false, message: sentence(r) };
    },
  };
}

let service: TemplatesService | null = null;

export function getWhatsAppTemplates(): TemplatesService {
  if (service) return service;
  const base = billingDefaults();
  // without a database (tests and the local demo server) the templates live in memory, with the same rules, so the access checks answer exactly as on the live site
  const memory = createMemoryTemplatesRepo();
  const unit: Unit<TemplatesRepos> = getConfig().DATABASE_URL
    ? createPgUnit(getDatabase().withHotel, (tx) => ({ templates: pgWaTemplatesRepo(tx), systemLogs: pgBillingRepos(tx).systemLogs }))
    : {
        run: async (session, work) => {
          if (session.hotelId === "") throw new AppError("FORBIDDEN", "This account is not inside a hotel. Open a hotel first, or use the console.");
          return work({ templates: memory, systemLogs: { write: async () => undefined } as unknown as TemplatesRepos["systemLogs"] });
        },
      };
  // Meta is looked up at each call: WhatsApp may be set up after this server started
  const OFF = { ok: false as const, message: "WhatsApp is not connected yet. The message is saved as a draft." };
  const off: TemplateMeta = { submit: async () => OFF, check: async () => OFF, remove: async () => OFF };
  const port = (): TemplateMeta => metaPort() ?? off;
  const meta: TemplateMeta = {
    submit: (h, t) => port().submit(h, t),
    check: (h, t) => port().check(h, t),
    remove: (h, t) => port().remove(h, t),
  };
  service = createTemplatesService({ unit, people: base.people, catalog: base.catalog, meta });
  return service;
}

/** Replaces the service (start-up code and tests). */
export function configureWhatsAppTemplates(next: TemplatesService | null): void {
  service = next;
}

import "server-only";
import type { Catalog } from "../../auth/catalog";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { ConversationsRepos } from "../../repos/conversations";
import type { Unit } from "../../repos/types";
import { checkTemplate, isEditable, statusFromMeta, templateNameOf, type TemplateButton, type TemplateRecord, type TemplateStatus } from "../../whatsapp/templates";
import type { WaTemplatesRepo } from "../../whatsapp/templatesStore";
import type { PeopleDirectory } from "../cash/ports";
import { whatsappAccess } from "../conversations/conversationsService";
import type { TemplateBody } from "./templatesSchemas";

// The hotel's WhatsApp message templates (MJ, 4 Nov 2026; Settings > WhatsApp): write one, send it to Meta for approval, see Meta's decision, remove it. The same right as Conversations (View to read, Edit
// to change; the Hotel Admin always). Only a draft or a rejected template can be edited (Meta holds the text of the others); a sent one is shown as "Waiting for Meta" until Meta decides (the webhook or the
// Check button). Nothing here sends a message to a guest. Meta is reached through `meta`, absent while WhatsApp is not set up (then a submission answers a plain sentence and the draft is kept).
export interface TemplateMeta {
  /** Sends the template to Meta on the hotel's current line; `message` is a plain sentence when it cannot. */
  submit(hotelId: string, t: TemplateRecord): Promise<{ ok: true; metaTemplateId: string; status: TemplateStatus; lineId: string; /** the name Meta holds it under (a tag in front on the shared number, so two hotels can use the same words) */ metaName: string } | { ok: false; message: string }>;
  /** Meta's current word on a template that was submitted. */
  check(hotelId: string, t: TemplateRecord): Promise<{ ok: true; found: boolean; status: TemplateStatus; reason: string | null } | { ok: false; message: string }>;
  /** Removes a submitted template at Meta. A template Meta no longer has counts as removed. */
  remove(hotelId: string, t: TemplateRecord): Promise<{ ok: boolean; message: string }>;
}

export interface TemplateView {
  id: string;
  name: string;
  language: string;
  category: TemplateRecord["category"];
  body: string;
  variables: TemplateRecord["variables"];
  buttons: TemplateButton[];
  starterKey: string | null;
  status: TemplateStatus;
  statusReason: string | null;
  /** Can the text still be changed (a draft, or one Meta rejected). */
  editable: boolean;
  updatedAt: string;
}

export interface TemplatesRepos {
  templates: WaTemplatesRepo;
  systemLogs: ConversationsRepos["systemLogs"];
}

export interface TemplatesDeps {
  unit: Unit<TemplatesRepos>;
  people: PeopleDirectory;
  catalog: Catalog;
  meta?: TemplateMeta;
}

const viewOf = (t: TemplateRecord): TemplateView => ({ id: t.id, name: t.name, language: t.language, category: t.category, body: t.body, variables: t.variables, buttons: t.buttons ?? [], starterKey: t.starterKey ?? null, status: t.status, statusReason: t.statusReason, editable: isEditable(t.status), updatedAt: t.updatedAt.toISOString() });
const TAKEN = "A message with this name and language already exists. Choose a different name.";

export function createTemplatesService(deps: TemplatesDeps) {
  const { unit, catalog } = deps;
  const actorName = async (s: VerifiedSession): Promise<string> => (await deps.people.get([s.userId])).get(s.userId)?.name ?? "System";
  const log = async (repos: TemplatesRepos, s: VerifiedSession, meta: RequestMeta, summary: string, t: TemplateRecord | null, action: "created" | "updated" | "deleted"): Promise<void> => {
    await repos.systemLogs.write({ module: "conversations", action, entity: "WhatsApp message", subjectId: t?.id ?? null, subjectLabel: t?.name ?? null, summary, details: null, userId: s.userId, userName: await actorName(s), ipAddress: meta.ip, traceId: meta.traceId });
  };
  const draftOf = (b: TemplateBody) => checkTemplate({ name: templateNameOf(b.name), language: b.language, category: b.category, body: b.body, variables: b.variables ?? [], buttons: b.buttons ?? [], starterKey: b.starterKey ?? null });
  const need = (s: VerifiedSession, level: "view" | "edit"): void => void whatsappAccess(s, catalog, level);
  const found = async (repos: TemplatesRepos, id: string): Promise<TemplateRecord> => {
    const t = await repos.templates.get(id);
    if (!t) throw new AppError("NOT_FOUND");
    return t;
  };

  return {
    async list(session: VerifiedSession): Promise<TemplateView[]> {
      need(session, "view");
      return unit.run(session, async (repos) => (await repos.templates.list()).map(viewOf));
    },

    async create(session: VerifiedSession, body: TemplateBody, meta: RequestMeta): Promise<TemplateView> {
      need(session, "edit");
      const draft = draftOf(body);
      return unit.run(session, async (repos) => {
        const made = await repos.templates.create(draft, null);
        if (made === "taken") throw new AppError("CONFLICT", TAKEN);
        await log(repos, session, meta, "WhatsApp message written", made, "created");
        return viewOf(made);
      });
    },

    async update(session: VerifiedSession, id: string, body: TemplateBody, meta: RequestMeta): Promise<TemplateView> {
      need(session, "edit");
      const draft = draftOf(body);
      return unit.run(session, async (repos) => {
        const current = await found(repos, id);
        if (!isEditable(current.status)) throw new AppError("CONFLICT", "Meta holds this message now. Remove it and write a new one to change the text.");
        const next = await repos.templates.update(id, draft);
        if (next === "taken") throw new AppError("CONFLICT", TAKEN);
        if (!next) throw new AppError("NOT_FOUND");
        await log(repos, session, meta, "WhatsApp message changed", next, "updated");
        return viewOf(next);
      });
    },

    /** Sends a draft (or a rejected message, after its edit) to Meta. The message waits as "Waiting for Meta" until Meta decides. */
    async submit(session: VerifiedSession, id: string, meta: RequestMeta): Promise<TemplateView> {
      need(session, "edit");
      if (!deps.meta) throw new AppError("CONFLICT", "WhatsApp is not connected yet. The message is saved as a draft.");
      const current = await unit.run(session, async (repos) => found(repos, id));
      if (!isEditable(current.status)) throw new AppError("CONFLICT", "This message was already sent to Meta.");
      const sent = await deps.meta.submit(session.hotelId, current);
      if (!sent.ok) throw new AppError("CONFLICT", sent.message);
      return unit.run(session, async (repos) => {
        const next = await repos.templates.setStatus(id, sent.status, { reason: null, metaTemplateId: sent.metaTemplateId, lineId: sent.lineId, name: sent.metaName });
        if (!next) throw new AppError("NOT_FOUND");
        await log(repos, session, meta, "WhatsApp message sent to Meta", next, "updated");
        return viewOf(next);
      });
    },

    /** Asks Meta for its decision now (it also arrives by itself). */
    async check(session: VerifiedSession, id: string, meta: RequestMeta): Promise<TemplateView> {
      need(session, "edit");
      if (!deps.meta) throw new AppError("CONFLICT", "WhatsApp is not connected yet.");
      const current = await unit.run(session, async (repos) => found(repos, id));
      if (isEditable(current.status)) throw new AppError("CONFLICT", "This message has not been sent to Meta.");
      const asked = await deps.meta.check(session.hotelId, current);
      if (!asked.ok) throw new AppError("CONFLICT", asked.message);
      const status = asked.found ? asked.status : current.status;
      return unit.run(session, async (repos) => {
        const next = await repos.templates.setStatus(id, status, { reason: asked.reason });
        if (!next) throw new AppError("NOT_FOUND");
        if (next.status !== current.status) await log(repos, session, meta, "WhatsApp message decision read", next, "updated");
        return viewOf(next);
      });
    },

    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ removed: true }> {
      need(session, "edit");
      const current = await unit.run(session, async (repos) => found(repos, id));
      if (current.metaTemplateId !== null) {
        // it exists at Meta: take it away there first, so the name is free again and nothing can still be sent with it
        if (!deps.meta) throw new AppError("CONFLICT", "WhatsApp is not connected yet, so this message cannot be removed at Meta now.");
        const gone = await deps.meta.remove(session.hotelId, current);
        if (!gone.ok) throw new AppError("CONFLICT", gone.message);
      }
      return unit.run(session, async (repos) => {
        if (!(await repos.templates.remove(id))) throw new AppError("NOT_FOUND");
        await log(repos, session, meta, "WhatsApp message removed", current, "deleted");
        return { removed: true as const };
      });
    },
  };
}
export type TemplatesService = ReturnType<typeof createTemplatesService>;

/** Meta's word on a decision, as our status (used by the check and the webhook alike). */
export const templateStatusOf = statusFromMeta;

import "server-only";
import type { Catalog } from "../../auth/catalog";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { ConversationsRepos } from "../../repos/conversations";
import type { Unit } from "../../repos/types";
import { checkCampaign, type CampaignAudience, type CampaignRecord, type CampaignStatus } from "../../whatsapp/campaigns";
import type { CampaignRunsStore } from "../../whatsapp/campaignRunner";
import type { CampaignStore } from "../../whatsapp/campaignStore";
import type { PeopleDirectory } from "../cash/ports";
import { whatsappAccess } from "../conversations/conversationsService";

// A hotel's WhatsApp campaigns (phase 6): write one (a draft), see how many guests it would reach, start it, pause, resume or cancel it, remove it. Anyone with Conversations Edit can write a draft; only the
// Hotel Admin starts, resumes or cancels one (a message to many guests is the hotel's decision). Starting needs the accepted WhatsApp terms, an approved message and at least one guest; it fixes the audience
// at that moment. The sending itself is the runner's (whatsapp/campaignRunner.ts): a few guests a minute through the sender, so STOP, consent and the limits decide each guest.
export interface CampaignRepos {
  campaigns: CampaignStore;
  systemLogs: ConversationsRepos["systemLogs"];
}

export interface CampaignView {
  id: string;
  name: string;
  templateId: string;
  templateName: string | null;
  audience: CampaignAudience;
  variables: string[];
  status: CampaignStatus;
  statusReason: string | null;
  recipientCount: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Still to go (only while it runs or paused). */
  waiting: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  can: { edit: boolean; start: boolean; pause: boolean; resume: boolean; cancel: boolean; remove: boolean };
}

export interface CampaignInput {
  name: string;
  templateId: string;
  audience: CampaignAudience;
  variables: string[];
}

export function createCampaignService(deps: {
  unit: Unit<CampaignRepos>;
  runs: CampaignRunsStore;
  people: PeopleDirectory;
  catalog: Catalog;
  now: () => Date;
  /** Has the hotel's admin accepted the WhatsApp terms? */
  termsAccepted: (hotelId: string) => Promise<boolean>;
}) {
  const { unit, catalog, now } = deps;
  const log = async (repos: CampaignRepos, s: VerifiedSession, meta: RequestMeta, summary: string, c: CampaignRecord | null, action: "created" | "updated" | "deleted"): Promise<void> => {
    const name = (await deps.people.get([s.userId])).get(s.userId)?.name ?? "System";
    await repos.systemLogs.write({ module: "conversations", action, entity: "WhatsApp campaign", subjectId: c?.id ?? null, subjectLabel: c?.name ?? null, summary, details: null, userId: s.userId, userName: name, ipAddress: meta.ip, traceId: meta.traceId });
  };
  const admin = (s: VerifiedSession): void => {
    if (s.accountRole !== "hotel_admin" || s.visit !== undefined) throw new AppError("FORBIDDEN", "Only the hotel admin can start, resume or cancel a campaign.");
  };
  const found = async (repos: CampaignRepos, id: string): Promise<CampaignRecord> => {
    const c = await repos.campaigns.get(id);
    if (!c) throw new AppError("NOT_FOUND");
    return c;
  };
  async function viewOf(repos: CampaignRepos, c: CampaignRecord, level: "edit" | "view", isAdmin: boolean): Promise<CampaignView> {
    const t = await repos.campaigns.template(c.templateId);
    const waiting = c.status === "running" || c.status === "paused" ? await repos.campaigns.queued(c.id) : 0;
    const editable = level === "edit";
    return {
      id: c.id,
      name: c.name,
      templateId: c.templateId,
      templateName: t?.name ?? null,
      audience: c.audience,
      variables: c.variables,
      status: c.status,
      statusReason: c.statusReason,
      recipientCount: c.recipientCount,
      sent: c.sent,
      failed: c.failed,
      skipped: c.skipped,
      waiting,
      startedAt: c.startedAt?.toISOString() ?? null,
      finishedAt: c.finishedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      can: {
        edit: editable && c.status === "draft",
        start: editable && isAdmin && c.status === "draft",
        pause: editable && c.status === "running",
        resume: editable && isAdmin && c.status === "paused",
        cancel: editable && isAdmin && (c.status === "running" || c.status === "paused"),
        remove: editable && (c.status === "draft" || c.status === "done" || c.status === "cancelled"),
      },
    };
  }
  /** The campaign's message must exist and its blanks must have a value each. */
  async function checkAgainstTemplate(repos: CampaignRepos, input: CampaignInput): Promise<{ name: string; audience: CampaignAudience; variables: string[] }> {
    const clean = checkCampaign(input);
    const t = await repos.campaigns.template(input.templateId);
    if (!t) throw new AppError("VALIDATION_FAILED", "Choose one of your messages.", { fields: { templateId: "Choose one of your messages." } });
    if (t.status === "draft" || t.status === "rejected") throw new AppError("VALIDATION_FAILED", "That message has not been approved by Meta yet.", { fields: { templateId: "That message has not been approved by Meta yet." } });
    if (clean.variables.length !== t.blanks) throw new AppError("VALIDATION_FAILED", `That message has ${t.blanks} blank${t.blanks === 1 ? "" : "s"}: give a value for each.`, { fields: { variables: `That message has ${t.blanks} blank${t.blanks === 1 ? "" : "s"}: give a value for each.` } });
    return clean;
  }
  const levelOf = (s: VerifiedSession, need: "view" | "edit") => (whatsappAccess(s, catalog, need).canEdit ? ("edit" as const) : ("view" as const));
  const isAdmin = (s: VerifiedSession): boolean => s.accountRole === "hotel_admin" && s.visit === undefined;

  return {
    async list(session: VerifiedSession): Promise<CampaignView[]> {
      const level = levelOf(session, "view");
      return unit.run(session, async (repos) => Promise.all((await repos.campaigns.list()).map((c) => viewOf(repos, c, level, isAdmin(session)))));
    },

    /** How many guests this audience reaches now (before it is saved or started). */
    async audience(session: VerifiedSession, audience: CampaignAudience): Promise<{ guests: number }> {
      levelOf(session, "view");
      const checked = checkCampaign({ name: "x", audience, variables: [] }).audience;
      return unit.run(session, async (repos) => ({ guests: await repos.campaigns.audienceSize(checked) }));
    },

    async create(session: VerifiedSession, input: CampaignInput, meta: RequestMeta): Promise<CampaignView> {
      levelOf(session, "edit");
      return unit.run(session, async (repos) => {
        const clean = await checkAgainstTemplate(repos, input);
        const made = await repos.campaigns.create({ ...clean, templateId: input.templateId }, session.userId);
        await log(repos, session, meta, "WhatsApp campaign written", made, "created");
        return viewOf(repos, made, "edit", isAdmin(session));
      });
    },

    async update(session: VerifiedSession, id: string, input: CampaignInput, meta: RequestMeta): Promise<CampaignView> {
      levelOf(session, "edit");
      return unit.run(session, async (repos) => {
        const current = await found(repos, id);
        if (current.status !== "draft") throw new AppError("CONFLICT", "Only a draft can be changed.");
        const clean = await checkAgainstTemplate(repos, input);
        const next = await repos.campaigns.update(id, { ...clean, templateId: input.templateId });
        if (!next) throw new AppError("CONFLICT", "Only a draft can be changed.");
        await log(repos, session, meta, "WhatsApp campaign changed", next, "updated");
        return viewOf(repos, next, "edit", isAdmin(session));
      });
    },

    /** Fixes the audience and starts sending. */
    async start(session: VerifiedSession, id: string, meta: RequestMeta): Promise<CampaignView> {
      levelOf(session, "edit");
      admin(session);
      if (!(await deps.termsAccepted(session.hotelId))) throw new AppError("CONFLICT", "Accept the WhatsApp terms in Settings > WhatsApp first.");
      // the sweep's list first, a minute ahead: if starting fails below, the runner finds a draft and drops the entry; if it works, the list already has it (never a running campaign nobody sends)
      await deps.runs.schedule(session.hotelId, id, new Date(now().getTime() + 60_000));
      const started = await unit.run(session, async (repos) => {
        const c = await found(repos, id);
        if (c.status !== "draft") throw new AppError("CONFLICT", "This campaign was already started.");
        const clean = await checkAgainstTemplate(repos, { name: c.name, templateId: c.templateId, audience: c.audience, variables: c.variables });
        const t = await repos.campaigns.template(c.templateId);
        if (!t || t.status !== "approved") throw new AppError("CONFLICT", "The campaign's message is not approved.");
        const guests = await repos.campaigns.enroll(id, clean.audience);
        if (guests === 0) throw new AppError("CONFLICT", "No guest has agreed to WhatsApp messages yet, so there is nobody to send this to. Tick the guest's agreement on their chat first.");
        const next = await repos.campaigns.setStatus(id, ["draft"], "running", null, now());
        if (!next) throw new AppError("CONFLICT", "This campaign was already started.");
        await log(repos, session, meta, "WhatsApp campaign started", next, "updated");
        return next;
      });
      return unit.run(session, (repos) => viewOf(repos, started, "edit", true));
    },

    async pause(session: VerifiedSession, id: string, meta: RequestMeta): Promise<CampaignView> {
      levelOf(session, "edit");
      const next = await unit.run(session, async (repos) => {
        const n = await repos.campaigns.setStatus(id, ["running"], "paused", "Paused by the hotel.", now());
        if (!n) throw new AppError("CONFLICT", "Only a running campaign can be paused.");
        await log(repos, session, meta, "WhatsApp campaign paused", n, "updated");
        return n;
      });
      await deps.runs.remove(session.hotelId, id);
      return unit.run(session, (repos) => viewOf(repos, next, "edit", isAdmin(session)));
    },

    async resume(session: VerifiedSession, id: string, meta: RequestMeta): Promise<CampaignView> {
      levelOf(session, "edit");
      admin(session);
      await deps.runs.schedule(session.hotelId, id, new Date(now().getTime() + 60_000));
      const next = await unit.run(session, async (repos) => {
        const n = await repos.campaigns.setStatus(id, ["paused"], "running", null, now());
        if (!n) throw new AppError("CONFLICT", "Only a paused campaign can be resumed.");
        await log(repos, session, meta, "WhatsApp campaign resumed", n, "updated");
        return n;
      });
      return unit.run(session, (repos) => viewOf(repos, next, "edit", true));
    },

    async cancel(session: VerifiedSession, id: string, meta: RequestMeta): Promise<CampaignView> {
      levelOf(session, "edit");
      admin(session);
      const next = await unit.run(session, async (repos) => {
        const n = await repos.campaigns.setStatus(id, ["running", "paused"], "cancelled", "Cancelled by the hotel.", now());
        if (!n) throw new AppError("CONFLICT", "Only a running or paused campaign can be cancelled.");
        await log(repos, session, meta, "WhatsApp campaign cancelled", n, "updated");
        return n;
      });
      await deps.runs.remove(session.hotelId, id);
      return unit.run(session, (repos) => viewOf(repos, next, "edit", true));
    },

    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ removed: true }> {
      levelOf(session, "edit");
      return unit.run(session, async (repos) => {
        const c = await found(repos, id);
        if (!(await repos.campaigns.remove(id))) throw new AppError("CONFLICT", "A running or paused campaign has to be cancelled first.");
        await log(repos, session, meta, "WhatsApp campaign removed", c, "deleted");
        return { removed: true as const };
      });
    },
  };
}
export type CampaignService = ReturnType<typeof createCampaignService>;

import "server-only";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { PlatformUnit, SiteBuildRecord, SiteBuildStatus } from "../../repos/auth";
import { AppError } from "../../errors";
import { verifySiteBuild } from "../../sitebuild/signature";
import { conflict, fieldError, notFound, type WebsiteDeps } from "./context";
import { siteBuildReportBody } from "./schemas";
import { SITE_TEMPLATES, templateOf, type SiteTemplate } from "./siteTemplates";

// A hotel's website design (website-templates/docs/PLAN-CUSTOM-HOTEL-SITES.md). The hotel picks one of the listed templates; HMS records the pick (platform.hotel_site_builds,
// migration 0160) and STARTS the "Create hotel site" job, which copies the template into the hotel's own site folder and deploys it. The job reports back to the signed
// route POST /api/v1/public/site-builds/<id>: building, then live or failed. Needs the website settings part, like the website switch.
//  - One build at a time per hotel (the database's partial unique index backs the check). Picking the design that is already live is refused.
//  - A build whose job never answered is failed after 30 minutes the next time anyone looks, so the page cannot stay "building" for ever.
//  - Nothing here changes the hotel's content: only which design shows it.

const PART = "website.settings";
const HISTORY = 10;
/** How long a build may stay queued or building before it counts as failed. */
export const STALE_BUILD_MINUTES = 30;
const STALE_MESSAGE = "The build did not finish in 30 minutes. Try again.";

export interface SiteBuildDto {
  id: string;
  template: string;
  templateName: string;
  status: SiteBuildStatus;
  message: string | null;
  /** The job's log page. */
  runUrl: string | null;
  /** The address the site went live on. */
  siteUrl: string | null;
  requestedAt: string;
  finishedAt: string | null;
}

export interface SiteTemplateStateDto {
  /** False on a server where the build job is not connected (GITHUB_SITES_*): the designs can be seen, not applied. */
  configured: boolean;
  templates: SiteTemplate[];
  /** The design the website runs now (the newest build that went live), or null before the first. */
  current: SiteBuildDto | null;
  /** A build being made now (queued or building), or null. */
  active: SiteBuildDto | null;
  /** The newest builds, newest first (the first one tells a failure and why). */
  history: SiteBuildDto[];
}

/** What the job's report did to a build. */
export interface SiteBuildReport {
  status: Exclude<SiteBuildStatus, "queued">;
  message?: string | undefined;
  runUrl?: string | undefined;
  siteUrl?: string | undefined;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function createSiteTemplateService(deps: WebsiteDeps) {
  const platform = (): PlatformUnit => {
    if (!deps.platform) throw new AppError("SERVER_ERROR", "Website designs are not available on this server.");
    return deps.platform;
  };
  const base = deps.publicUrl.replace(/\/+$/, "");
  const configured = (): boolean => deps.siteBuilder?.configured === true && !!deps.siteBuildSecret;
  const dto = (b: SiteBuildRecord): SiteBuildDto => ({
    id: b.id, template: b.templateKey, templateName: templateOf(b.templateKey)?.name ?? b.templateKey, status: b.status, message: b.message, runUrl: b.runUrl, siteUrl: b.siteUrl,
    requestedAt: b.requestedAt.toISOString(), finishedAt: iso(b.finishedAt),
  });
  const staleBefore = (): Date => new Date(deps.now().getTime() - STALE_BUILD_MINUTES * 60_000);

  async function state(hotelId: string): Promise<SiteTemplateStateDto> {
    const builds = await platform().run(async (r) => {
      await r.siteBuilds.failStale(hotelId, staleBefore(), STALE_MESSAGE, deps.now());
      return r.siteBuilds.recent(hotelId, 50);
    });
    return {
      configured: configured(),
      templates: [...SITE_TEMPLATES],
      current: ((b) => (b ? dto(b) : null))(builds.find((x) => x.status === "live")),
      active: ((b) => (b ? dto(b) : null))(builds.find((x) => x.status === "queued" || x.status === "building")),
      history: builds.slice(0, HISTORY).map(dto),
    };
  }

  async function report(buildId: string, input: SiteBuildReport): Promise<{ build: SiteBuildDto; repeated: boolean }> {
    const message = input.message?.trim() ? input.message.trim() : null;
    const { row, repeated } = await platform().run(async (r) => {
      const moved = await r.siteBuilds.advance(buildId, { status: input.status, message, runUrl: input.runUrl ?? null, siteUrl: input.siteUrl ?? null }, deps.now());
      if (moved) return { row: moved, repeated: false };
      const existing = await r.siteBuilds.byId(buildId);
      if (!existing) throw notFound();
      if (existing.status === input.status || input.status === "building") return { row: existing, repeated: true };
      throw conflict("This website build has already finished.");
    });
    if (!repeated && row.status !== "building" && row.requestedBy) {
      await deps.audit.record({ action: "website.template_built", userId: row.requestedBy, hotelId: row.hotelId, details: { template: row.templateKey, build: row.id, status: row.status } });
    }
    return { build: dto(row), repeated };
  }

  return {
    async get(session: VerifiedSession): Promise<SiteTemplateStateDto> {
      requirePermission(session, deps.catalog, PART, "view");
      return state(session.hotelId);
    },

    /** The hotel picks a design: records it, starts the job, answers with the new state (a job that could not be started is a failed build with the reason). */
    async choose(session: VerifiedSession, input: { template: string }): Promise<SiteTemplateStateDto> {
      requirePermission(session, deps.catalog, PART, "edit");
      if (!templateOf(input.template)) throw fieldError("template", "Choose one of the listed designs.");
      const builder = deps.siteBuilder;
      if (!builder || !configured()) throw conflict("Website designs are not set up on this server yet. Ask the platform team to connect GitHub.");
      const { site, build } = await platform().run(async (r) => {
        const found = await r.sites.byHotel(session.hotelId);
        if (!found) throw notFound();
        await r.siteBuilds.failStale(session.hotelId, staleBefore(), STALE_MESSAGE, deps.now());
        const live = (await r.siteBuilds.recent(session.hotelId, 50)).find((x) => x.status === "live");
        if (live?.templateKey === input.template) throw conflict("That design is already live on the website.");
        const queued = await r.siteBuilds.queue(session.hotelId, input.template, session.userId, deps.now());
        if (!queued) throw conflict("A website change is already being built. Wait for it to finish.");
        return { site: found, build: queued };
      });
      // the job is started AFTER the pick is saved, outside the transaction: a slow GitHub never holds the database
      const started = await builder.start({ buildId: build.id, hotelSlug: site.slug, templateKey: build.templateKey, callbackUrl: `${base}/api/v1/public/site-builds/${build.id}` });
      if (!started.ok) await platform().run((r) => r.siteBuilds.advance(build.id, { status: "failed", message: started.error.slice(0, 500), runUrl: null, siteUrl: null }, deps.now()));
      await deps.audit.record({ action: "website.template_chosen", userId: session.userId, hotelId: session.hotelId, details: { template: build.templateKey, build: build.id, started: started.ok } });
      return state(session.hotelId);
    },

    /**
     * The build job's signed report (the public route hands over the raw body and the two headers). No secret set up, or a wrong, missing or old signature, is refused
     * before anything is read. `building` moves a queued build on; `live` and `failed` finish it. A repeat of a report already taken, or a late `building` after the build
     * finished, changes nothing; a different report for a finished build is a conflict.
     */
    async receive(buildId: string, raw: { timestamp: string | null; signature: string | null; body: string }): Promise<{ build: SiteBuildDto; repeated: boolean }> {
      if (!deps.siteBuildSecret) throw notFound();
      if (!verifySiteBuild(deps.siteBuildSecret, buildId, raw.timestamp, raw.signature, raw.body, deps.now())) throw new AppError("FORBIDDEN", "The report is not signed correctly.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.body);
      } catch {
        throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Not valid JSON" } });
      }
      const checked = siteBuildReportBody.safeParse(parsed);
      if (!checked.success) throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "The report is not in the expected shape" } });
      return report(buildId, checked.data);
    },
  };
}

export type SiteTemplateService = ReturnType<typeof createSiteTemplateService>;

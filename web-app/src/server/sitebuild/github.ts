import "server-only";
import type { SiteBuilder } from "../services/website/context";

// Starts the "Create hotel site" workflow (.github/workflows/create-hotel-site.yml) with GitHub's repository_dispatch. The token only has to be allowed to do that one
// thing on the one repository; it is sent in the Authorization header and never appears in a log, an answer or an error text.

export const SITE_BUILD_EVENT = "create-hotel-site";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function githubSiteBuilder(options: { token: string; repo: string; fetch?: Fetch }): SiteBuilder {
  const send = options.fetch ?? fetch;
  return {
    configured: true,
    async start(job) {
      let response: Response;
      try {
        response = await send(`https://api.github.com/repos/${options.repo}/dispatches`, {
          method: "POST",
          headers: { accept: "application/vnd.github+json", authorization: `Bearer ${options.token}`, "x-github-api-version": "2022-11-28", "user-agent": "hms-site-builds", "content-type": "application/json" },
          body: JSON.stringify({ event_type: SITE_BUILD_EVENT, client_payload: { build_id: job.buildId, hotel: job.hotelSlug, template: job.templateKey, callback_url: job.callbackUrl } }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        return { ok: false, error: "Could not reach GitHub. Try again in a minute." };
      }
      if (response.status === 204) return { ok: true };
      if (response.status === 401 || response.status === 403) return { ok: false, error: "GitHub did not accept the saved access key." };
      if (response.status === 404) return { ok: false, error: "GitHub could not find the website repository, or the access key cannot see it." };
      if (response.status === 422) return { ok: false, error: "GitHub refused the request." };
      return { ok: false, error: `GitHub answered with an error (${response.status}).` };
    },
  };
}

/** The builder of a server where GITHUB_SITES_* are not set: the page says so, and no job can be started. */
export const noSiteBuilder: SiteBuilder = {
  configured: false,
  start: async () => ({ ok: false, error: "Website designs are not set up on this server yet." }),
};

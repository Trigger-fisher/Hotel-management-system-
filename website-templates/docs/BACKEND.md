# Hotel website designs: the HMS backend

How a hotel picks a website design in HMS and how that becomes its own site. The plan is `PLAN-CUSTOM-HOTEL-SITES.md`; this file says what is built and how to switch it on.

## The flow
1. A person with the website settings part opens Website and picks a design: `PUT /api/v1/website/site-template` with `{ "template": "template-3" }`.
2. HMS saves the pick as one row in `platform.hotel_site_builds` (status `queued`) and starts the GitHub workflow **Create hotel site** with `repository_dispatch` (`sitebuild/github.ts`). Only the hotel's slug, the template folder name and a callback address are sent.
3. The workflow (`.github/workflows/create-hotel-site.yml`) reports `building`, runs `website-templates/tools/create-site.mjs` (copies `templates/<template>` to `sites/<hotel>`), commits and pushes, optionally calls the host's deploy hook, then reports `live`. Any failed step reports `failed` with a plain sentence and the log page.
4. Each report is a signed `POST /api/v1/public/site-builds/<build id>`. HMS moves the build on and the page shows it.
5. `GET /api/v1/website/site-template` gives the page everything: the ten designs, the one that is live, a build in progress, and the last ten builds.

## Rules the backend keeps
- One build per hotel at a time (the service checks, and the partial unique index in migration 0160 backs it). The design that is already live cannot be picked again.
- A build whose job never answered is failed after 30 minutes, the next time anyone reads the page.
- Reports are signed: HMAC-SHA256 over `<unix seconds>.<build id>.<body>` with `SITE_BUILD_SECRET`, headers `x-hms-timestamp` and `x-hms-signature` (the build id is signed so a report cannot be replayed against another build). Older than ten minutes, wrong, signed for another build, or missing is 403; a server with no secret answers 404. A repeat of a report is 200 and changes nothing.
- HMS holds a GitHub token that can only start that one workflow on that one repository. It never writes code. The token and the secret are never logged, returned or put in an error.
- No API key may change a design (`website/site-template` is in `WRITE_DENIED`).
- The hotel name and template name are checked against strict patterns twice (HMS and `create-site.mjs`) and the copy must stay inside `sites/`.
- Every pick and every result is in the platform audit (`website.template_chosen`, `website.template_built`).

## Switching it on
1. Run migration 0160 (`npm run db:cli -- migrate`).
2. In the GitHub repository that holds `website-templates/`: make a fine-grained token (Contents: read and write, this repository only) and a secret of at least 32 random characters. Save the secret as the repository secret `SITE_BUILD_SECRET`.
3. In HMS's environment (Vercel project settings): `GITHUB_SITES_TOKEN`, `GITHUB_SITES_REPO` (owner/name) and `SITE_BUILD_SECRET` (the same secret). All three or none.
4. Optional: repository secret `SITES_DEPLOY_HOOK_URL` (a deploy hook of the host) and repository variable `SITES_URL_PATTERN` such as `https://{hotel}.yourhms.in`, so the live report carries the site address.

## What is not built yet
- The Website > Choose design screen in HMS (the API above is ready for it).
- The deploy step: where each hotel's folder is hosted (Vercel, or Hostinger) is an open decision, so the workflow only calls a deploy hook when one is saved. Until then a `live` report means "the site folder is copied and committed".
- Domains per hotel (`platform.hotel_site_domains` already holds them) are not yet attached to a hosting project by the job.
- The templates are coming soon pages; the real designs and `site-kit` come next.

## Where the code is
| Part | File |
|---|---|
| Table | `common/db/migrations/platform/0160_hotel_site_builds.sql` |
| Repository (memory and PostgreSQL) | `web-app/src/server/repos/auth.ts` (`siteBuilds`), `repos/memory/auth.ts`, `repos/postgres/auth.ts` |
| Service, list of designs | `web-app/src/server/services/website/siteTemplateService.ts`, `siteTemplates.ts` |
| Signature, GitHub call | `web-app/src/server/sitebuild/signature.ts`, `github.ts` |
| Routes | `web-app/src/app/api/v1/website/site-template/route.ts`, `public/site-builds/[id]/route.ts` |
| The job | `.github/workflows/create-hotel-site.yml`, `website-templates/tools/create-site.mjs`, `report-build.mjs` |
| Tests | `web-app/tests/server/website.siteTemplate.test.ts`, `website.siteBuildTools.test.ts`, `web-app/tests/db/siteBuilds.repo.test.ts` |

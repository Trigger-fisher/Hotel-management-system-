# Plan: custom hotel sites (1 Nov 2026, MJ)

Every hotel gets its own website code, copied from one of 10 templates, that can be changed for that hotel alone. The HMS app (admin panel and the rest) stays one shared app and is not changed by this.

## How it works
1. A hotel (or MJ, from the Platform console) picks a template, for example `template-3` for Grand Palace.
2. HMS starts a GitHub job **Create hotel site** with `hotel = grandpalace`, `template = template-3`. HMS only holds a key that can start this job, not one that can write code.
3. The job copies `templates/template-3` to `sites/grandpalace`, writes the hotel's ID into its config, commits, creates a hosting project for the folder and attaches the hotel's domain.
4. The site builds and goes live. From then on `sites/grandpalace` is that hotel's own code.

## Everyday cases
- Hotel edits a room or photo: saved in HMS; the page refreshes within a minute. No rebuild.
- Hotel wants a custom change: edit only its folder in `sites/`; only that site rebuilds.
- Bug in shared parts (form, SEO, sitemap): fix once in `packages/site-kit`; every site gets it.
- Hotel switches template: the job runs again; the old folder stays in Git history.

## Rules
- Sites import `site-kit`; they never paste its code.
- Pin the kit version per site; roll risky kit changes to a few hotels first.
- Before deploy every site must build, have a title, description and sitemap, and pass a phone speed check.
- Each site keeps a short `CUSTOM.md` listing what differs from its template.
- No template sample text goes live (SEO): the build fails if the hotel's description matches the sample.

## Order of work
1. Folder layout (this folder).
2. `site-kit`: read hotel content from the HMS website API, SEO tags, sitemap, enquiry form.
3. Turn today's public website into `templates/template-1`.
4. The **Create hotel site** GitHub job.
5. "Choose template" screen in HMS that starts the job and shows its status.
6. First real hotel, then templates `template-2` to `template-10`.

## Open decisions
- Hosting: Vercel (recommended) or Hostinger.
- Who launches a site: the hotel admin, or only MJ from the Platform console.
- Domains: hotel's own domain, `hotel.yourhms.in`, or both.

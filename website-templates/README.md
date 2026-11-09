# website-templates

The hotel websites: 10 starting templates, the shared site kit, and one folder per hotel with that hotel's own website code. Each hotel's site reads its content (rooms, photos, text, prices) from HMS through the website API; hotels keep editing content in the HMS admin panel. Not started.

| Folder | What |
|---|---|
| `templates/` | The 10 starting designs, `template-1` to `template-10`. Never deployed; copied into `sites/` when a hotel picks one |
| `packages/site-kit/` | Shared by every hotel site: reading hotel data from HMS, SEO tags, sitemap, enquiry form, booking button, images. Sites import it, never copy it |
| `sites/` | One folder per hotel (for example `sites/grandpalace`), copied from a template and then customised for that hotel only |
| `docs/` | Plans, specs and notes for the hotel websites |

| `tools/` | `create-site.mjs` (copies a template into a hotel's folder), `report-build.mjs` (signed report back to HMS), `demo/` (local demo of the Choose design page) |

Plan: `docs/PLAN-CUSTOM-HOTEL-SITES.md`. The HMS backend that records a hotel's pick and starts the job: `docs/BACKEND.md`.

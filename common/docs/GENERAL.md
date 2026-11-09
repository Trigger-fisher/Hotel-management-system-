# HMS project folders: the common points

This file holds what is common to the six project folders, in the order MJ gave them. Each folder has its own `docs/` folder for its own documents.

## The six folders

| No. | Folder | What it is for | Status | Its own documents |
|---|---|---|---|---|
| 1 | `website/` | The company website | Empty, not started | `website/docs/` |
| 2 | `web-app/` | The web app of the project (Next.js, hosted on Vercel) | Built and running | `web-app/docs/` |
| 3 | `desktop-app/` | The desktop app of the project | Empty, not started | `desktop-app/docs/` |
| 4 | `security/` | Security | Holds the security reviews (rounds 2 and 3) | `security/docs/` |
| 5 | `ai/` | AI and reading services | Holds the planned ID-reading (OCR) service and its research note | `ai/docs/` |
| 6 | `other-features/` | Features that belong to none of the five above | Empty | `other-features/docs/` |

## Common points

1. **One job per folder.** A folder is used only for the job in the table above.
2. **Its own documents.** Every folder keeps its documents in its own `docs/` folder. A note about the website goes in `website/docs/`, a note about security in `security/docs/`, and so on.
3. **Project-wide documents.** Anything that covers the whole project (decisions, backend, operations, deploy guides, this file) stays in the main `docs/` folder.
4. **No secrets.** No password, key or connection string is ever saved in a folder or a document.
5. **Real people.** No real guest, company or staff data in any folder. Samples are invented.
6. **Push only when MJ says so.** Nothing is pushed to main unless MJ asks for it.
7. **Test what changed.** A change is checked with the tests of the files it touched, plus the type check and lint.
8. **Plain words.** Documents are written in plain language, with numbered points.

## Where things stand today

1. The web app is the only folder with code. What it shares with the other folders sits in one folder, `common/`: `common/db/` (database migrations, seeds, scripts), `common/ui-shared/` (shared screen contracts), `common/scripts/` (the mail worker) and `common/docs/` (this file and the project documents).
2. The company website and the desktop app have not been started. Their folders are ready.
3. The hotel-website admin module (the screens a hotel uses to run its own website) is part of the web app, not of folder 1.

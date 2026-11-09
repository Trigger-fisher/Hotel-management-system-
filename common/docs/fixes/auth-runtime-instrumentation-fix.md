# Production sign-in 500: instrumentation import

## Symptom

Vercel returned HTTP 500 for both `GET /api/v1/auth/session` and `POST /api/v1/auth/sign-in`. The runtime log reported that the instrumentation hook could not load `playwright-core` because `web-app/node_modules/playwright-core/browsers.json` was missing from the serverless function bundle.

## Cause

The Node instrumentation module imported the online Pathik runner at module load. That runner imports Playwright Core, so Next.js tried to initialize a browser dependency for every Node function, including authentication routes. Vercel only traces the browser files into the Pathik cron function.

## Fix

- Instrumentation now starts through an awaited `registerNode()` function and imports the online Pathik runner only when `HMS_PATHIK_RUNNER=online`.
- The runner imports Playwright Core only when it actually launches a browser.
- The Pathik cron function explicitly includes `playwright-core/browsers.json` in its Vercel file trace.

This keeps browser startup dependencies out of sign-in and session requests while retaining the online Pathik runner.

## Verification

- `npm run build` completed successfully.
- The generated sign-in route trace does not include Playwright Core.
- The generated Pathik cron route trace includes `playwright-core/browsers.json`.

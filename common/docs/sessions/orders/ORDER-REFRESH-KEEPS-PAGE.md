# Order: refresh keeps the session and the page, for ALL roles (decision 49, MJ, 12 Oct 2026). ZERO TESTING (commit note "tests not run, per MJ"), no agents.

Seen on the live site: pressing refresh shows the sign-in page again. MJ's rule for every role (hotel, platform, company, guest, employee):
1. Reload (F5 / refresh button) while signed in: NO sign-in page, not even a flash; the person returns to the SAME page (same menu item and sub-page; the open tab or filter is a bonus, not required).
2. A new visit (new tab, typed address, bookmark to the root) lands on the dashboard of their role.
3. A hard refresh (Ctrl+Shift+R): the browser does not tell the page apart from a normal reload, so it behaves like a reload (same page). Do not try to detect it; say so in UI.md.
4. A signed-out or expired session still shows the sign-in page (and after signing in goes to the dashboard, or to the page they were on if the sign-in came from an expired session).

## UI [be5337] (screens / client)
- Find why the session is not restored on the live site although commit e1e5125 (restoreSession, GET /auth/session on start) exists: check that the restore runs for EVERY role's entry (the role dashboards, the portals, the platform console), that the shell does not render the sign-in frame before the restore answers, and that the HTTP client's 401 handling does not clear the session on the restore call. Make the restore the single start-up path for all roles.
- Remember the current page: keep it in the URL (hash or path) or in sessionStorage keyed by role (wrapped in try/catch; storage can be blocked) and restore it on a reload (use performance.getEntriesByType("navigation")[0].type === "reload" or an equivalent); a fresh navigation ("navigate") goes to the dashboard. If a remembered page is not allowed for the role any more, fall back to the dashboard.
- Mock mode behaves the same. UI.md: one paragraph "Refresh behaviour". Local commit, hash to me.

## Backend [f948b5] (server)
- Check that GET /auth/session answers a live session for EVERY account type (super_admin, platform_admin, group_hotel_admin, hotel_admin, hotel_user, employee_user, corporate_user, guest_user), with and without a hotel, and with the new password-only sign-in (decision 46): that the session cookie is set with the right attributes on https://www.easyhotelsolutions.in (Secure, HttpOnly, SameSite, Path=/, no Domain mismatch between the apex and www), lives as long as the session, and is not dropped by any redirect or a Vercel header. Fix anything on the server side; tell me and UI [be5337] what you found (one short message). Local commit if you change code, hash to me.

# Order: remove the header search, add a search bar on every list page (decision 51, MJ, 12 Oct 2026). NO AGENTS, ZERO TESTING (commit note "tests not run, per MJ").

MJ: remove the search bar from the header for ALL roles and portals. Every list page gets its own search bar with the SAME capability as the Handover page's search, in the SAME position (the Handover list's search placement). One shared component, no one-off search boxes.

## d7 [1a94a6] (read-only audit, docs only, FIRST, quick)
Write docs/sessions/audits/SEARCH-AUDIT.md: (1) how Handover's search works (the component/file, the props, where it sits, what it searches, debounce, query parameter name, how the server list route handles it); (2) a table of EVERY list page of EVERY role and portal (hotel, platform, group, company, guest, employee): page, screen file, its list route, whether it already has a search box, whether its server route accepts `search`, and what it would search. No code changes. Hash to me; UI and Backend use it as their checklist.

## UI [be5337] (after the refresh fix, before the corporate portal work; use d7's audit)
1. Remove the header search (the global search box and its shortcut hint, the results panel, copy and any menu entry) for every role and portal; keep the code of the global search route untouched but unreferenced by the screens.
2. Put the shared list search (the Handover one) on every list page that lacks it, same position, same behaviour (type, debounce, clear button, empty-result state), wired to the page's list route `search` parameter. Pages that already have a search box: make them use the shared component in the Handover position so all look the same.
3. Mock mode filters rows by the text. UI.md: replace the header-search text with the page-search rule. Local commit, hash to me.

## Backend [f948b5] (after the refresh and portal server work; use d7's audit)
Every list route that a page search calls must accept `search` with the Handover route's semantics (case-insensitive, trims, matches the visible columns of that list, paged, fast: no full scans on big tables, use the existing indexes or the pg_trgm ones), with a limit on the text length. Add `search` where the audit shows it missing. Do not remove the global search route. docs/BACKEND.md: one line per route that got `search`. Local commit, hash to me.

## CLARIFICATION (MJ, 12 Oct 2026): "in all pages"
The page search goes on EVERY page of EVERY role and portal that shows a list, table or set of cards/rows (including the tabs of a page, each with its own list). Pages that are only a form, a single record or a dashboard of numbers have nothing to search: list them in the audit under "no list" so MJ can say if he wants a search there too. When a page has several lists (tabs), each tab's list gets the search in the same position.

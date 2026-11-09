# Notifications: the hotel sends, the company (and later the guest) reads them in the sidebar (PM, 18 Oct 2026)

MJ: "add a Notifications option in the sidebar where the hotel will send notifications". Nothing like it exists yet (checked: no notification table or screen; the bell counts guest requests only; platform announcements go platform -> hotels only).

## Scope (defaults; MJ can change)
- First: HOTEL -> COMPANY (Company portal). Built so the guest portal can reuse it later (audience = company | guest).
- In-app first. An optional "also send by email" tick uses the hotel's mail (lane 0 is for system mail; this is a normal hotel mail, rate-limited, never a campaign blast).

## Hotel side (staff)
- Sidebar: Companies > "Notifications" (permission: the Companies module, write level to send, read to see history).
- Send form: audience = one company / selected companies / all companies (searchable list), title (max 120), message (max 2,000, plain text with line breaks), optional link to a company page (e.g. a bill), priority (normal / important), optional expiry date, optional "also email". Preview before send. A sent notification cannot be edited; it can be withdrawn (hidden from the companies, kept in history).
- History list: date, title, audience, delivered count, read count, status; a detail page shows which companies read it and when.

## Company portal (reader)
- Sidebar item "Notifications" with an unread badge, plus the header bell opening the latest 5 and a link to the page.
- Page: newest first, unread highlighted, important ones marked, "Mark as read" per item and "Mark all as read", expired and withdrawn ones hidden, empty state sentence, 25 per page. The portal shows only that company's notifications (row-level security like migration 0035).

## Backend
- Hotel tables (hotel migration, next free number at commit time; coordinate with Session A who holds 0038 for campaigns): `notifications` (id, title, body, link_view, link_id, priority, audience_kind, expires_at, withdrawn_at, also_email, created_by, created_at) and `notification_targets` (notification_id, company_id, read_at, email_status) unique (notification_id, company_id). Sending to "all companies" creates targets in chunks. Indexes for unread count per company.
- RLS policies for the company scope (same pattern as 0035), grants to the hotel role, Neon SQL file docs/neon-sql/NEON-SQL-<n>-NOTIFICATIONS.sql.
- API: staff POST /companies/notifications, GET list, GET /{id} (with read receipts), POST /{id}/withdraw; company portal GET /corporate/notifications (+ unread count in the existing portal summary), POST /corporate/notifications/{id}/read, POST /corporate/notifications/read-all. Rate limit for send (e.g. 20 an hour per user), audit log entry per send, no HTML in messages.
- "Also email": queue one mail per company address through the hotel's mail with kind `notification` (route = hotel, lane 0), only when the tick is set.

## Frontend (Session C)
- Hotel: Companies > Notifications (send form + history + detail), company portal: sidebar item, bell, page. Existing look, phone friendly, empty/loading/error states, mock data for both.

## Tests
- Send to one / selected / all; a company sees only its own; mark read idempotent; withdrawn and expired hidden; unread badge count; permission checks; RLS (a company cannot read another's); email only when ticked.

## Order
1. Backend (migration, routes, tests, Neon SQL) -> 2. contract + mocks -> 3. UI -> 4. QA by d3 (sweep, company portal on a phone) -> 5. MJ runs the Neon SQL, then push.

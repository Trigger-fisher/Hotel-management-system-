# Platform console: real-server wiring checklist (11 Oct 2026)

Contract: `PlatformApi` in `ui-shared/dashboards/platform.ts` (the UI's truth; the adapter maps the server's DTOs to it). Routes: `docs/BACKEND.md` section 14 (Backend's route table, commit ff179e4).

Files: `web-app/src/lib/api/adapters/platform.ts` assembles `createHttpPlatformApi()` = `{ ...createPlatformConsoleRealApi() (Frontend 2: adapters/platformConsole.ts), ...Frontend 1 sections (adapters/platform/{groups,hotelAdmins,platformStaff,health,settings,archived,enter}.ts) }`; shared helpers in `adapters/platform/shared.ts`. Switch: `dashboards/groups/platform/api.ts` uses `chooseApi(createHttpPlatformApi, <mock>)` (mock stays the default; real with `?api=real` or `NEXT_PUBLIC_API=real`).

Status words: **written** = adapter calls the route of section 14 with its exact keys, compiles, NOT yet tested against the live server (Backend builds the routes in P2 hotels/groups/admins, P3 invitations/onboarding/approve, P4 Enter hotel, P5 Super Admin). Frontend 2's rows (`platformConsole.ts`, pushed in 945020b) are **written** too (checked by Frontend 2 with a fake network, 20 cases). After Backend pushes a phase: live-test its rows with `?api=real` and set **tested**.

Errors: key on `error.code` (VALIDATION_FAILED is HTTP 422 with `details.fields`; CONFLICT 409 with the sentence in `message`; FORBIDDEN; NOT_FOUND; RATE_LIMITED). The adapter passes them through `client.ts` unchanged.

| Method | Owner | Route (method + path) | Who | Status |
|---|---|---|---|---|
| getOverview | Frontend 2 | GET /platform/overview | PA | **tested** (11 Oct, live, by Frontend 1) |
| listHotels | Frontend 2 | GET /platform/hotels | PA | **tested** (11 Oct, live, by Frontend 1) |
| getHotel | Frontend 2 | GET /platform/hotels/{id} | PA | **tested** (11 Oct, live, by Frontend 1) |
| checkSlug | Frontend 2 | GET /platform/hotels/check-slug?slug= | PA | **tested** (11 Oct, live, by Frontend 1) |
| createHotel | Frontend 2 | POST /platform/hotels | PA | written |
| suspendHotel | Frontend 2 | POST /platform/hotels/{id}/suspend | PA | **tested** (11 Oct, live, by Frontend 1) |
| reactivateHotel | Frontend 2 | POST /platform/hotels/{id}/reactivate | PA | **tested** (11 Oct, live, by Frontend 1) |
| approveHotel | Frontend 2 | POST /platform/hotels/{id}/approve | PA | **tested** (11 Oct, live, 3f5f085): hotel active, new admin signs in to an empty hotel |
| rejectHotel | Frontend 2 | POST /platform/hotels/{id}/reject | PA | **tested** (11 Oct, live, by Frontend 1) |
| archiveHotel | Frontend 2 | POST /platform/hotels/{id}/archive | PA | **tested** (11 Oct, live, by Frontend 1) |
| restoreHotel | Frontend 2 | POST /platform/hotels/{id}/restore | PA | **tested** (11 Oct, live, by Frontend 1) |
| listInvitations | Frontend 2 | GET /platform/invitations | PA | **tested** (11 Oct, live, by Frontend 1) |
| listDevLinks | Frontend 2 | GET /platform/invitations/dev-links (answers [] on the real server) | PA | **tested** (11 Oct, live, by Frontend 1) |
| sendInvitation | Frontend 2 | POST /platform/invitations | PA | **tested** (11 Oct, live, by Frontend 1) |
| resendInvitation | Frontend 2 | POST /platform/invitations/{id}/resend | PA | **tested** (11 Oct, live, by Frontend 1) |
| cancelInvitation | Frontend 2 | POST /platform/invitations/{id}/cancel | PA | **tested** (11 Oct, live, by Frontend 1) |
| getInvitationByToken (public) | Frontend 2 | GET /api/v1/onboarding/{token} (no session) | public | **tested** (11 Oct, live, by Frontend 1) |
| submitOnboarding (public) | Frontend 2 | POST /api/v1/onboarding/{token} (no session) | public | **tested** (11 Oct, live, by Frontend 1) |
| listUsers | Frontend 2 | GET /platform/users | SA | **tested** (11 Oct, live) |
| disableUser | Frontend 2 | POST /platform/users/{id}/disable | SA | **tested** (11 Oct, live, dev.superadmin) |
| enableUser | Frontend 2 | POST /platform/users/{id}/enable | SA | **tested** (11 Oct, live, dev.superadmin) |
| unlockUser | Frontend 2 | POST /platform/users/{id}/unlock | SA | **tested** (11 Oct, live, dev.superadmin) |
| resetUserPassword | Frontend 2 | POST /platform/users/{id}/reset-password | SA | **tested** (11 Oct, live, dev.superadmin) |
| listActivity | Frontend 2 | GET /platform/activity | PA | **tested** (11 Oct, live, by Frontend 1) |
| listAudit | Frontend 2 | GET /platform/audit (CSV: GET /platform/audit/export, SA, 50,000 cap) | SA | **tested** (11 Oct, live, dev.superadmin) |
| listSignIns | Frontend 2 | GET /platform/sign-ins | SA | **tested** (11 Oct, live, dev.superadmin) |
| listGroups | Frontend 1 | GET /platform/groups (unpaged array) | PA | **tested** (11 Oct, live, dev.platform) |
| getGroup | Frontend 1 | GET /platform/groups/{id} | PA | **tested** (11 Oct, live, dev.platform) |
| createGroup | Frontend 1 | POST /platform/groups | PA | **tested** (11 Oct, live, dev.platform) |
| addHotelToGroup | Frontend 1 | POST /platform/groups/{id}/hotels | PA | **tested** (11 Oct, live, dev.platform) |
| removeHotelFromGroup | Frontend 1 | DELETE /platform/groups/{id}/hotels/{hotelId} | PA | **tested** (11 Oct, live, dev.platform) |
| setGroupAdmin | Frontend 1 | PUT /platform/groups/{id}/admin | PA | **tested** (11 Oct, live, dev.platform) |
| approveGroup | Frontend 1 | POST /platform/groups/{id}/approve | PA | **tested** (11 Oct, live, by Frontend 1) |
| rejectGroup | Frontend 1 | POST /platform/groups/{id}/reject | PA | **tested** (11 Oct, live) |
| listHotelAdmins | Frontend 1 | GET /platform/hotel-admins | PA | **tested** (11 Oct, live, dev.platform) |
| addHotelAdmin | Frontend 1 | POST /platform/hotels/{hotelId}/admins | PA | **tested** (11 Oct, live, dev.platform) |
| resetAdminPassword | Frontend 1 | POST /platform/hotel-admins/{id}/reset-password | PA | **tested** (11 Oct, live, dev.platform) |
| unlockAdmin | Frontend 1 | POST /platform/hotel-admins/{id}/unlock | PA | **tested** (11 Oct, live, dev.platform) |
| disableAdmin | Frontend 1 | POST /platform/hotel-admins/{id}/disable | PA | **tested** (11 Oct, live, dev.platform) |
| enableAdmin | Frontend 1 | POST /platform/hotel-admins/{id}/enable | PA | **tested** (11 Oct, live, dev.platform) |
| listPlatformStaff | Frontend 1 | GET /platform/staff | SA | **tested** (11 Oct, live, dev.superadmin) |
| createPlatformStaff | Frontend 1 | POST /platform/staff | SA | **tested** (11 Oct, live, dev.superadmin) |
| disablePlatformStaff | Frontend 1 | POST /platform/staff/{id}/disable | SA | **tested** (11 Oct, live, dev.superadmin) |
| enablePlatformStaff | Frontend 1 | POST /platform/staff/{id}/enable | SA | **tested** (11 Oct, live, dev.superadmin) |
| unlockPlatformStaff | Frontend 1 | POST /platform/staff/{id}/unlock | SA | **tested** (11 Oct, live, dev.superadmin) |
| resetPlatformStaffPassword | Frontend 1 | POST /platform/staff/{id}/reset-password | SA | **tested** (11 Oct, live, dev.superadmin) |
| getPlatformHealth | Frontend 1 | GET /platform/health | SA | **tested** (11 Oct, live, dev.superadmin) |
| runHealthCheck | Frontend 1 | POST /platform/health/check | SA | **tested** (11 Oct, live, dev.superadmin) |
| getPlatformSettings | Frontend 1 | GET /platform/settings | SA | **tested** (11 Oct, live, dev.superadmin) |
| updatePlatformSettings | Frontend 1 | PUT /platform/settings | SA | **tested** (11 Oct, live, dev.superadmin) |
| listArchivedHotels | Frontend 1 | GET /platform/archived-hotels | SA | **tested** (11 Oct, live, dev.superadmin) |
| exportHotelData | Frontend 1 | POST /platform/hotels/{id}/export | SA | written; NOT live-tested (destructive permanent delete needs MJ approval) |
| deleteHotelPermanently | Frontend 1 | POST /platform/hotels/{id}/delete-permanently `{confirmSlug}` | SA | written; NOT live-tested (destructive permanent delete needs MJ approval) |
| enterHotel | Frontend 1 | POST /platform/hotels/{id}/enter `{reason}` (5 to 500) | PA | **tested** (11 Oct, live, by Frontend 1) |
| exitHotel | Frontend 1 | POST /platform/hotels/{id}/exit | PA | **tested** (11 Oct, live, by Frontend 1) |
| setActor | Frontend 1 | none (local no-op: the server takes the actor from the session) | - | done |
| resetToSeed | Frontend 1 | none (local no-op: mock demo only) | - | done |

Live status 11 Oct 2026 (Backend P2, e172a25): groups (list, detail, create, link/unlink hotel, set admin) and hotel admins (list, add, reset, unlock, disable, enable) tested against the dev server with the API calls and the screens (Groups, Group details, Hotel admins). Approve/reject group wait for P3. Findings: (1) in real mode the shell now opens the Platform console by ROLE (platform_admin, super_admin) in ui-shared nav.ts dashboardKindFor; (2) Dashboard 'Some figures could not be loaded' and Hotels 'Last activity, admin email and user counts could not be loaded' for a Platform Admin: Frontend 2's loadHotelFacts (hotelParts.tsx) calls listUsers = GET /platform/users, which is Super Admin only (403); (3) the server answers unlock on an unlocked account with 409 CONFLICT 'This account is not locked.'; (4) pageSize outside the allowed set (e.g. 5, 7) is 422, the adapter snaps it; (5) sign-in refusals come as ACCOUNT_BLOCKED with details.reason = the key (contract: blockedReasonOf now reads it; hotel_rejected added).

Live findings 11 Oct (P3): (6) a Platform Admin can POST /platform/users/{id}/disable|enable|reset-password (200), the checklist says Super Admin only; (7) the Set up your hotel checklist is mock-only: a real new admin (live.ownd011193) lands on an empty dashboard without it (SetupChecklist useHotelSetup needs a 'new hotel' flag from the session).

Live findings 11 Oct (P5, 840edf8): Super Admin screens (All users, Audit log with CSV export, Sign-in history, Platform admins, Health, Settings, Archived) load real data; Platform Admin gets 403 on users writes; the screens' 'Test version' footers (Health, Archived) are now shown in mock mode only. Hotel details export toast ('Test version') is Frontend 2's.

PA = Platform Admin and Super Admin; SA = Super Admin only. A group_admin gets 403 on every route until the Group console server exists.

## Notes and open points
1. **enterHotel answer (done).** The contract's `PlatformEnterResult` now has the optional `auditId`, `visitId`, `expiresAt` (ISO) and `readOnly` (the mock fills them too); the adapter passes them on, `groups/platform/enter.ts` hands `expiresAt` to the shell, and the shell shows it as the end of the visit (banner 'ends hh:mm' and the automatic exit), with its own 60-minute clock only when it is absent. The reason (5 to 500 characters) is required by contract, mock and server; the adapter sends the typed reason. The server also refuses hotel writes during a visit (403 FORBIDDEN 'You are viewing {hotel} as platform staff. This is read-only.').
2. **The real read-only guard** (`chooseApi` write-method refusal in the browser) is a second line behind the server's own refusal; the server's 403 FORBIDDEN is shown with its sentence if it ever gets through.
3. **Real mode and the mock-only helpers.** The real adapter has no mock hooks (`PlatformMockHooks`, auth-mock account wrappers, 'Reset demo data'): the real server creates the admin account itself at approval and answers sign-in refusals by `details.reason` (`hotel_pending`, `group_pending`, `hotel_suspended`, `hotel_archived`, `hotel_rejected`, `disabled`).
4. **Not wired anywhere yet:** `PlatformApi` methods used only by screens in mock mode must be checked when live-testing: the onboarding page (public, no session), CSV export of the audit log (screens build it client-side today), the Super Admin 'Reset demo data' button (mock only: must be hidden in real mode).

## Archive, export, delete permanently: live on the throwaway Live Test Hotel Z (11 Oct 2026, MJ allowed it in this session's window)

| Step | Who | Result |
|---|---|---|
| Archive POST /platform/hotels/{id}/archive with a reason | Super Admin | 200, status archived |
| Export POST /platform/hotels/{id}/export | Super Admin | 200, file live-test-z-export-2026-10-11-6174ee7e.ndjson.gz kept in private server storage |
| Delete permanently POST /platform/hotels/{id}/delete-permanently {confirmSlug} | Super Admin | 409 CONFLICT: "This hotel is still in its grace period (90 days left)." The hotel was NOT deleted; waiting on Backend (grace period) |
| Export and delete-permanently | Platform Admin | 403 FORBIDDEN "Only the Super Admin can do this." on both |


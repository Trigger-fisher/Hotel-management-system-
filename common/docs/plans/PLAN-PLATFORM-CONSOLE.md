# Plan: Platform Admin first, then Super Admin (10 Oct 2026, Project Manager)

MJ (10 Oct): Super Admin has the same features as Platform Admin plus a few extras. So: design and build the Platform Admin console first, then add the Super Admin extras on top.
Status: DESIGN. Nothing built. Working assumptions = my recommended answers to the 5 questions (below) until MJ says otherwise.

## MJ's basic model (10 Oct 2026, MJ's own explanation; this wins over anything below)
1. Two kinds of hotel: **individual (standalone)** and **group hotels**.
2. A **Group Hotel Admin** manages their group: can **add and delete hotels** in that group.
3. A hotel joins by **invitation link**: an invitation is sent to the hotel, the hotel **fills an onboarding form** and onboarding starts from there.
4. Every hotel is **fully isolated** (its own data; nobody sees another hotel's data).
5. **Super Admin can also manage users.**

What this changes in the design below:
- Page 3 "New hotel" becomes **Invite hotel**: enter hotel name, contact person, email (and group, if any) -> an invitation link is emailed -> the hotel opens a public onboarding form -> on submit the hotel and its first admin account are created.
- New list **Invitations**: sent, opened, submitted, expired; resend or cancel.
- New **Group Hotel Admin console** (it was "later"; now needed): its group's hotels, invite a hotel into the group, remove (delete) a hotel from the group, its hotels' admins.
- Isolation stays as built: one schema + role per hotel; a group admin reaches only member hotels through the audited path; an invitation is bound to one hotel.
- Super Admin's "Platform users" covers every user, not only admins (see question 5).

## Where we are
- The Hotel dashboard (Hotel Admin, Hotel User) is built on mock data.
- Today the account roles `platform_admin` and `super_admin` just open a hotel's dashboard (`ui-shared/dashboards/nav.ts`, `dashboardForRole`). No platform screens exist.
- Database side exists: `platform` schema, atomic `create-hotel` (CLI only), one schema + role per hotel, audited read path for group admins (BACKEND.md 4.1, 4.6).
- Naming: inside a hotel, "SuperAdmin" is the permission role `super_admin` held by a hotel admin. The ACCOUNT roles `platform_admin` / `super_admin` are the platform level. This plan is about the account roles.
- MJ's plan v1: Platform Admin creates every hotel and group. Super Admin has full control of the platform, every action audit logged. Each role creates users only at its own level and below.

## Platform Admin console (build first)
New dashboard kind `platform` in nav.ts. Menu: Overview, Hotels, Groups, Hotel admins, My Profile.

| # | Page | What the screen has |
|---|---|---|
| 1 | Platform dashboard | Tiles: hotels (active / suspended), groups, hotel admins, locked accounts, hotels created this month. List "Recent hotels". Box "Needs attention": locked accounts, hotels without an admin, suspended hotels. |
| 2 | Hotels | Table: name, slug, city, group, status, admins, created. Search, status filter, button New hotel. Row actions: Enter hotel, Details. |
| 3 | New hotel (3 steps) | 1 Hotel: name, slug (auto, editable), city, state, GSTIN, time zone. 2 First Hotel Admin: name, username, email, mobile. 3 Review, Create. Success screen: hotel created, temporary password emailed (shown in the dev log for now), buttons Enter hotel / Back to hotels. Errors: slug taken, email invalid, creation failed (nothing is left behind). |
| 4 | Hotel details | Tabs: Overview, Admins, Settings, Activity. Actions: Enter hotel, Suspend / Reactivate (confirm window), Reset admin password, Unlock admin, Add another admin. |
| 5 | Groups | List of groups with member count. Group details: member hotels (add / remove), Group Hotel Admin (set / change). Create group. |
| 6 | Hotel admins | All Hotel Admins across hotels: hotel, status, last sign-in. Create, disable, reset password, unlock. (Platform Admin handles Hotel Admins and below, never other Platform Admins.) |
| 7 | My Profile | Same as the hotel dashboard (password, emailed code, sign-in history). |
| - | Enter hotel | Opens that hotel's dashboard as its Super Admin permission role; a banner "You are inside Hotel X, Exit"; every entry and exit is written to the audit log. |

## Super Admin extras (build second)
Everything above, plus:
| # | Extra page | What it has |
|---|---|---|
| 8 | Platform admins | Create, disable, reset, unlock Platform Admins (and everyone below). |
| 9 | Audit log | Every platform action: who, what, hotel, time. Filters. |
| 10 | Sign-in history | Successful and failed sign-ins across all hotels, locked accounts. |
| 11 | Platform health | Per hotel: migrations applied, database, mail, last backup. |
| 12 | Platform settings | Defaults for new hotels (permission roles, GST default 5%, time zone), mail sender. |
| 13 | Hotel archive | Archive a hotel (soft, never deleted) and restore it. |

## Work split
| Phase | What | Who |
|---|---|---|
| P1 | `platform` menu in nav.ts (Frontend 2 may edit it for this), mock API + sample data (5 hotels, 2 groups, 8 admins) in ui-shared | Frontend 2 |
| P2 | Platform Admin pages 1 to 7 on mock | Frontend 2 (pages 1-4), Frontend 1 (pages 5-7) once its fix round is done |
| P3 | Super Admin extras 8 to 13 on mock | Frontend 1 and 2 |
| P4 | MJ clicks through | MJ |
| P5 | Backend: /platform routes, create-hotel API, groups, audit, Enter hotel + tests (after MJ approves the screens) | Backend |
| P6 | Wire, one review, one fix round, one full test | all |

**First user (MJ, 10 Oct):** when a hotel is created, its FIRST and only user is the **Hotel Admin** (the person who filled the onboarding form). After signing in, that Hotel Admin sets up the hotel and adds the other users of that hotel. Platform/Super/Group Admins do not create a hotel's staff users.
Effect: the onboarding form stays short (hotel basics + the admin's own account); everything else is set up inside the hotel on first sign-in through a "Set up your hotel" checklist (task A10).

## ASSIGNED WORK PLAN (10 Oct 2026; replaces the "Work split" table further down)
Frontend first on mock data (MJ's order), backend after MJ approves the screens. Test logins (mock): `platform` (Platform Admin), `superadmin` (Super Admin), `groupadmin` (Group Hotel Admin of "Sunrise Group"), password Demo@Pass2026, code 123456; plus quick-login buttons. `mihir` stays on the Hotel dashboard.

| ID | Task | Owner | Depends on | Done when |
|---|---|---|---|---|
| A1 | Contract: nav kinds `platform` and `group`; `ui-shared/dashboards/platform.ts` types + mock API + data (6 hotels: 3 individual, 3 in "Sunrise Group"; 2 groups; 5 invitations in every state; 10 admins; 25 users; 40 audit rows) | Frontend 2 | - | types compile, mock answers every call |
| A2 | Platform Admin pages: Dashboard, Hotels list (Individual / Group filter), Hotel details (tabs, Approve/Reject, Archive/Restore, Enter hotel) | Frontend 2 | A1 | works on mock, all states, day/night |
| A3 | Invite hotel + Invitations list (sent, opened, submitted, expired; resend, cancel) and the public Onboarding form from the link (form, submitted = waiting for approval, expired link, used link) | Frontend 2 | A1 | full invite -> form -> approve -> hotel live flow on mock |
| A4 | Shell: registry groups `platform` and `group`, Enter hotel / Exit banner, new quick logins, brand per console | Frontend 1 | A1 | each login lands on its console; Enter/Exit works |
| A5 | Groups page (create group, add/remove member hotels, set Group Hotel Admin) and Hotel admins page (create, disable, reset, unlock) | Frontend 1 | A1, A4 | works on mock |
| A6 | Group Hotel Admin console: its hotels only, invite a hotel into the group, remove (unlink) / archive a member hotel, its hotels' admins, Enter hotel | Frontend 1 | A3 components, A5 | groupadmin sees only member hotels |
| A7 | Super Admin extras part 1: All users (every level), Audit log, Sign-in history | Frontend 2 | A2 | works on mock |
| A8 | Super Admin extras part 2: Platform admins, Platform health, Platform settings, Archived hotels | Frontend 1 | A5 | works on mock |
| A10 | "Set up your hotel" checklist on a new Hotel Admin's first sign-in (Hotel dashboard): hotel profile and logo, GST numbers and default %, room types and rooms, plans and rates, users and roles, then "Finish"; each step links to the existing screen (Settings, Master Data, Rooms, User Accounts) and ticks when done; can be skipped and reopened from the Dashboard | Frontend 1 | A4 | new hotel admin (mock login `newhotel`) sees it, finishes it |
| A9 | One review across A1-A8 and A10, one fix round, commit, rebuild :3010, screenshots for MJ | Frontend 1 + 2 | A1-A8 | MJ can click through |
| GATE | MJ clicks through and answers the 5 questions | MJ | A9 | MJ says OK |
| B1 | Backend: invitations (hashed single-use token, 72 h), onboarding submit -> pending, approve -> create-hotel in one transaction, reject | Backend | GATE | tests green |
| B2 | Backend: groups and membership, group-admin audited access, archive / restore, platform users, audit log, enter-hotel context | Backend | GATE | tests green |
| B3 | Isolation tests: group admin cannot reach a non-member hotel; an invite cannot create or touch another hotel; Platform Admin sees no business data outside Enter hotel | Backend | B1, B2 | all pass |
| C1 | Connect screens to the routes, live test, one full review + test | all | B3 | MJ says done |

## Gap questions on MJ's model (waiting for MJ)
| # | Question | Recommendation |
|---|---|---|
| 1 | Who can send an invitation? | **ANSWERED by MJ (10 Oct):** an INDIVIDUAL hotel is invited by Super Admin or Platform Admin; a GROUP hotel is invited by that group's Group Hotel Admin, only into their own group. **Group start (MJ, 10 Oct):** Super Admin / Platform Admin send ONE invitation to the group's person (the future Group Hotel Admin). That person onboards (group + their own account). After that, the Group Hotel Admin invites and adds the group's hotels. Platform/Super Admin do NOT invite hotels into a group themselves. So there are two invitation types: "Invite individual hotel" and "Invite group (its admin)". |
| 2 | When the hotel submits the form: live at once, or approved first? | Platform Admin reviews and approves, then the hotel goes live (stops fake or wrong sign-ups). |
| 3 | What does the onboarding form ask? | Hotel: name, address, city, state, PIN, GSTIN, phone, email, logo. First admin: name, username, email, mobile, own password. Rooms and rates are set later inside the hotel. |
| 4 | "Delete a hotel": remove forever, or archive? | Archive: sign-in blocked, data kept, can be restored; removing from a group just unlinks it. Permanent delete only by Super Admin after a data export. (Money and booking records are never hard deleted, MASTER 4.4.) |
| 5 | Super Admin "manage users": which users? | Every user on the platform (Platform Admins, Group Admins, Hotel Admins, Hotel Users): view, create, disable, reset, unlock, all audited. Platform Admin: Group and Hotel Admins only. Group Admin: admins of its member hotels. Invitation links valid 72 hours, single use, can be resent. |

## Working assumptions = my recommendations (MJ may overrule)
1. Platform Admin and Super Admin open the Platform console first, with an "Enter hotel" button (audited).
2. Business data (bills, guests, payroll) is visible only after "Enter hotel", every entry audited.
3. Groups are in the console now; the Group Hotel Admin's own dashboard comes later.
4. Creating a hotel: name, slug, city, state, GSTIN, time zone; first admin username, email, mobile; temporary password by email.
5. No product flags and no billing plans in the pilot.

## Percent
Design 100%, build 0%.

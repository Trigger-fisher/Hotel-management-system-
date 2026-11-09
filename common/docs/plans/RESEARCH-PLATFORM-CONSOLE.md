# Research: platform consoles (Super Admin, Platform Admin, Group Admin), 10 Oct 2026

Web research by a Project Manager sub-agent. No code changed. Hotel PMS vendors publish little about their internal consoles; most facts come from Stripe, WorkOS, Auth0, Clerk, Shopify, Google and Salesforce docs. "Pattern" = common practice, not a documented feature of a named product. Use with docs/plans/PLAN-PLATFORM-CONSOLE.md.

## MUST for the pilot (adopted into the plan unless MJ says otherwise)
1. Hotels list: name, group, type, status, created, last activity, Hotel Admin email, user count; filters by status and group. Dashboard counts by status, invites pending/expired, hotels stuck in setup, hotels inactive N days.
2. Invitations: single use, stored only as a hash, one active invite per hotel/group, resend = revoke and reissue, status Pending / Accepted / Expired / Revoked. Expired or used link shows "ask your admin for a new link", never a generic sign-up. Expiry: research suggests 7 days (Auth0 default 7, Clerk ~30, WorkOS 30); earlier plan said 72 hours -> MJ to choose.
3. Hotel lifecycle: Invited, Onboarding, Pending review, Active, Suspended, Archived, Deleted; every change records who, why, when. Suspended blocks logins but keeps data; export (CSV / schema dump) offered before archiving.
4. Enter hotel: a written reason, a 60-minute limit (WorkOS ends impersonation after 60 min), a permanent banner "Viewing <Hotel> as platform staff, ends hh:mm, Exit", read-only by default, every action stamped with the platform user AND the hotel.
5. Roles: Super Admin only 2-3 people (manage platform staff, delete/restore hotels, emergency access). Platform Admin: invite, onboard, approve, suspend, read-only Enter hotel; cannot hard-delete, change platform roles or raise own rights. Group Admin: only its group's hotels, invites them, group reports; no platform rights.
6. Audit record: actor (id, role, platform-staff-inside-hotel flag), action, targets (hotel id, record), time, IP, browser, result, reason for sensitive actions; append-only, outside hotel schemas, kept at least 1 year.
7. Two-step sign-in REQUIRED for all platform roles and Group Admins.
8. New Hotel Admin first sign-in checklist: password and 2FA, hotel profile + GSTIN + invoice details, room types and rooms, rates and taxes (GST), policies (check-in/out, cancellation), invite staff with roles, test booking and test invoice, then go live.

## SHOULD
- Health column per hotel (last login, errors, migration version); group view with group totals.
- Onboarding form: legal and trade name, GSTIN (derive state from digits 1-2, PAN from 3-12), address, phone, email, room count, check-in/out times, GST type (regular or composition). Check GSTIN format at once; live GST check later via the GST portal or a paid API (vendor claims need checking).
- Approve-then-activate (Pending review -> Active) until a GSTIN API exists.
- Archive grace period (e.g. 90 days) then hard delete with a second approval; restore only inside the grace period.
- Hotel consent for support access: a Hotel Admin switch "Allow HMS support access for N days"; Super Admin emergency override, logged and shown to the hotel. Hotel admins see an "HMS staff access" log. Mask guest ID numbers and bank details during support access.
- A separate read-only Support role. CSV export of the audit log by hotel and date. Short idle timeout for platform sessions. A dashboard progress bar until setup is done; "setup incomplete" hotels listed in the console.

## LATER
- Usage and billing metrics; temporary role grants; IP allow-list for platform roles; sealed break-glass Super Admin account; streaming logs to outside storage; channel manager / payment gateway / data import in setup.

## Legal notes to confirm with a lawyer (not legal advice)
- India DPDP Rules 2025, Rule 8(3): keep processing logs at least 1 year for listed purposes (in force around May 2027).
- CERT-In 2022 directions: ICT logs on a rolling 180 days; check whether still in force.

## Sources
docs.stripe.com/api/account_links · workos.com/docs/admin-portal/a-setup-link-from-workos-dashboard · workos.com/docs/audit-logs/index · workos.com/changelog/expanded-audit-log-retention-periods · workos.com/docs/authkit/impersonation · workos.com/blog/support-impersonation-delegated-sessions · auth0.com/docs/fr-ca/api/management/v2/organizations/post-invitations · clerk.com/docs/users/invitations · clerk.com/docs/references/backend/organization/revoke-organization-invitation · shopify.dev/docs/storefronts/themes/tools/collaborator-accounts · knowledge.workspace.google.com/admin/users/security-best-practices-for-administrator-accounts · help.mews.com (user roles, employee profiles, multi-property) · community.mews.com (granular permissions) · hotelogix.com/faqs/how-does-hotelogix-handle-multiple-properties · hospitalitynet.org (Hotelogix multi-property manager) · myfrontdesk.cloudbeds.com (onboarding, property setup) · tallysolutions.com/gst/gst-pan-search · scconline.com (DPDP Rules 2025) · mondaq.com (CERT-In 2022). Third-party/vendor: shipaid.com, greytrix.com, zoftwarehub.com, smartorder.ai, surepass.io.
Not found: public docs of Cloudbeds/Mews/RMS/eZee/Little Hotelier internal consoles or support-access controls; Atlassian support-access grants; current status of CERT-In 2022.

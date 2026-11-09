# Order: Guest / Company / Employee portals understandable (decision 47, MJ, 12 Oct 2026). UPDATING ONLY, NO TESTS (MJ: zero testing for now). Different tasks, no overlap.

**Update 12 Oct (decision 58): the Employee portal is removed with the Employee User role. Wherever this order says "employee" portal, ignore it; the Guest and Company portals stay.**

Seen on the live site: the test guest account (and the company one) is linked to the hotel but not to a guest/company record, and "My account" shows a bare "Not allowed" with a Try again button. MJ wants the portal accounts to be visible and to work so that a real guest can actually understand them.

## Backend [f948b5] (server only)
1. The portal routes (guest, corporate, employee) must not answer a bare 403 FORBIDDEN when the account has NO subject record (platform.user_hotels.subject_kind/subject_id empty or the record gone/inactive). Answer a specific, stable code with a plain sentence the screen can show, e.g. 409 `PORTAL_NOT_LINKED` with message "Your account is not linked to a guest profile yet. Please ask the hotel front desk to link it." (company: "...to a company profile...", employee: "...to a staff record..."), and `fields: { portal: "guest" | "company" | "employee" }`. A linked but inactive record: 409 `PORTAL_INACTIVE` with its own sentence. Real permission failures keep 403.
2. Hotel side: a route for a hotel Admin (Users screen) to LINK an existing portal account to a guest/company record (`PUT /admin/users/{id}/portal-link { kind: "guest"|"company", recordId }`, audited, same hotel only, the record must exist and be active) and to UNLINK. Reuse user_hotels.subject_kind/subject_id (no new migration unless unavoidable; if one is needed, tell me the number when final).
3. No tests this round (commit message: "tests not run, per MJ"). Update docs/BACKEND.md. Local commit; hash to me.

## UI [be5337] (screens only)
1. Guest, Company and Employee portals: when a portal call answers `PORTAL_NOT_LINKED` or `PORTAL_INACTIVE`, show a friendly full-page state in every portal page (icon, a short title "Your account is not set up yet", the server's sentence, what to do, and a "Contact the hotel" hint with the hotel name/phone if the session has it), never "Not allowed" and never a bare Try again.
2. Make the linked portals easy to understand for a real guest/company: a short "What you can do here" intro on the first page, plain page titles and one-line help under each section, clear empty states ("No bills yet", "No stays yet") with a next step, consistent buttons, no admin jargon. Mobile first (390 px). Shared kit only; add copy to the existing copy objects.
3. Hotel Users screen (admin): in the user's detail, for portal accounts, a "Linked to" row with a picker to link/unlink a guest or company (uses Backend's route; agree the names with Backend), and a "Not linked" warning chip in the list.
4. Mock mode shows both states. No tests this round (commit message "tests not run, per MJ"); update UI.md. Local commit; hash to me.

## d7 [1a94a6]
Nothing now (docs refresh already done); I will ask for a docs update when both parts are in.

Rules: local commits only, nothing pushed; I run the clean-copy check before any push. Report to Project Manager 2 [7485b3].

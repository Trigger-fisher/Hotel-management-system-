# Order: Guest portal redesign (decision 52, MJ, 12 Oct 2026). NO AGENTS. ZERO TESTING (commit note "tests not run, per MJ").

**Update 12 Oct (decision 59): the Add member parts of this order (People with me, ID scan, scan limits, confirmation) were removed; the rest stands.**
Queue: after the company portal, then page search. Backend = server, UI = screens, different files. Backend publishes the contract in docs/BACKEND.md and by message to UI early.

## MJ's list (guest user, "MJ Guest")
1. MY PROFILE: show the user's details like the Super Admin profile, but LIMITED and READ-ONLY (name, username, mobile, email, last sign-in; no editing of these details). The email is used only for bills and notices (say so in one line). Nothing more than the user details, not too much. (The password change and the sign-in code switch stay available.)
2. REMOVE "Book a room" (menu, page, routes used by the guest screens).
3. HOTEL SELECTOR in the sidebar, same as the company portal (decision 48): default All hotels, pick one, every page refreshes for it.
4. BILLS and HISTORY: same design as the company portal accounts (list + drop-down per row, Handover pattern, shared kit).
5. BILLS page = ALL the guest's bills. HISTORY page = PAYMENT history (payments and advances).
6. EVERY LIST in EVERY ROLE shows the LATEST first (newest date first, ties by entry number): sort order check on every list route and screen default.
7. ROOM SERVICE ("order to room"): the only ordering option; allowed ONLY while the guest is staying (an in-house/occupied stay), otherwise a clear friendly page says why. Better design (menu groups, cart, clear totals, simple steps). SCHEDULE option: order now or at a chosen time (within the active hours, within the stay). The ACTIVE HOURS of the restaurant are set by the HOTEL ADMIN (hours per day, and a switch "accepting orders"); outside the hours only a scheduled order inside them is possible.
8. ADD MEMBER: a guest in the hotel can add a person to their stay. Flow: first step UPLOAD the person's ID; the server reads it with OCR/scanning and pre-fills the basic details (name, ID type, ID number, date of birth, address if present, mobile asked); the guest checks and confirms; the member is added to the stay's members (the same list Pathik uses, name 10+ chars, ID number 8+). The scan has LIMITS and REJECTS with a plain reason: not JPG/PNG/PDF-image, over 3 MB, too small or blurry/unreadable (low confidence), not a supported ID type (Aadhaar, Driving Licence, Passport, Voter ID, PAN), name or number not found, expired (passport/licence), the same ID already on the stay, more members than adults allow. The uploaded image is kept only as the member's ID photo (private store, like the main guest's ID photo). The OCR engine is NOT chosen yet (MJ decides after d7's docs/plans/OCR-OPTIONS.md): build behind a provider interface with a manual-entry fallback so the rest works now.
9. BILLS show FULL DETAIL including how many persons stayed (adults and children, and names where known), on EVERY bill page of EVERY role (guest, company, hotel Billing, Bill Master, PDFs if the data exists).

## Backend [f948b5]
- Guest routes (all `?hotel=`): profile read (limited fields), bills (all), history (payment history), order-to-room guarded by an in-house stay (409 with a plain sentence when not staying), schedule field on orders, restaurant hours + accepting switch (hotel-admin Settings route and storage: new hotel migration if needed, tell me the number), menu route returns the hours and whether ordering is open, the add-member routes (upload ID image, scan -> extracted fields or a rejection with reason code and sentence, confirm -> member added to the stay), bill DTO with persons (adults, children, member names) for guest, company and hotel bills and PDFs.
- Latest-first on every list route (audit all list routes of all roles; fix the default order).
- OCR behind `IdScanProvider` interface: `scan(image) -> { type, fields, confidence } | rejection`; ship a `manual` provider now (returns "enter the details yourself"), a stub for the real one; the rejection rules above live in the service, independent of the engine.
- Contract in docs/BACKEND.md; hash to me; say if a migration is needed.

## UI [be5337]
- Guest sidebar and pages per the list: no Book a room; hotel selector; My profile read-only; Bills (all) and History (payments) in the company accounts design; room service redesign with the not-staying state, schedule picker and the open/closed hours line; Add member flow (upload first, scan, review, confirm, plain rejection messages); bills show persons; latest first. Hotel admin Settings: a "Restaurant hours" card (hours per day, accepting orders switch). Mock mode covers all states. UI.md. Hash to me.

## d7 [1a94a6]
Research note docs/plans/OCR-OPTIONS.md (see my message). Docs only.

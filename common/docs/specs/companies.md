# Behaviour spec: Companies (Company Profiles, Customers, Email Marketing, Company Ledger)

Source: Pallav `app/Http/Controllers/{CompanyProfileController,CustomerController,CrmController,CompanyLedgerController}.php`,
`app/Models/{CompanyProfile,Customer,CrmLead,CrmActivity}.php`, `app/Support/CompanyLedger.php`, `resources/views/company_ledger/*`.
**HMS:** marks a deliberate difference. Golden fixtures: `db/scripts/php/generate-companies-fixtures.php` → `fixtures/companies.json`
(verbatim PHP of the ledger); tests `tests/server/companies*.test.ts`. Tables: `company_profiles`, `customers`, `mail_campaigns`, `mail_campaign_recipients`, `mail_optouts` (the `crm_*` tables of 0002 stay, unused, since 13 Oct 2026)
(hotel migration 0002); the ledger has NO table (derived from Bill Master). Contract: `ui-shared/dashboards/companies.ts`, `common.ts`
(`LookupItem`, `Statement<Row>`).

## 1. Permissions (`Support/Permissions.php:124-135`)

Module `companies` (view, create, edit, delete; routes `company.*` and `customer.*`, so Customers and Email Marketing live under it) and its part
`companies.ledger` (view). HMS levels: create = create, edit = edit, delete = full. CRM `activity`, `stage` and `convert` POSTs are creates
(`Permissions.php:651`). A module grant spreads to its parts (HMS engine); the ledger part alone opens the ledger but not the company list.
The lookups and the options call need the module's view.

## 2. Company profiles

- Fields (`:99-126`): name required max 100, unique among live companies ("The name has already been taken.", case-insensitive); address
  max 100; country, nationality max 100; email (Laravel `email`) max 254; pincode max 20; mobile, phone max 15; discount, GST, TCS, TDS
  percentages between 0 and 100 ("The {x} percentage field must be between 0 and 100."; display only: no computation uses them, B1 finding);
  instruction; GST number max 50 and unique ("A company with this GST number already exists.", `:157-159`).
- Contacts (`:118-150`): rows the form leaves empty are dropped first; at least one ("Add at least one person to contact."), at most 30; each
  needs a name ("Every contact person needs a name."); role max 60, email, mobile max 15.
- Edit (`Models/CompanyProfile.php:28-31`): someone who can write, over a company they may manage (the SuperAdmin; an Admin unless a
  SuperAdmin added it; anyone else only their own): "Only an Admin or whoever added this company can edit it."
- Delete (`:37-46`): Full Access, and the SuperAdmin, or an Admin over a company a SuperAdmin did not add: "Only an Admin can delete a
  company." To the recycle bin (Recyclable); restore and purge for recycle-bin users; **HMS:** a company that bills or advances still name is
  never purged.
- List: newest first; every word or "quoted phrase" anywhere (fields and contacts); numbers on top: total, with GST, contact people, added
  this month (IST). Log module `companies`, entity `Company`, details GST number, Email, Mobile, People.
- Lookup (decided): `GET /companies/lookup?q=&limit=` → `LookupItem { id, label: name, hint: GST number }`, prefix, at most 50.

## 3. Customers

- Fields (`CustomerController.php:44-64`): name required max 100; mobile required, spaces/dashes/+ removed first, digits only 10-15 ("Enter
  the mobile number as digits only, 10 to 15 of them."), unique ("A customer with this mobile number already exists."); email; address max
  255; city max 100; ID proof type max 60; number max 50 (**HMS:** plain data, MJ: stored and returned as typed; the
  input `idProofNumber` absent = keep); notes max 2000; active flag.
- The portal login (**HMS**, ruled): Pallav keeps a password on the customer row; HMS keeps it on the PLATFORM through the `GuestAccounts`
  port (Worker A): create issues a login (a temporary password emailed through the outbox), "Reset login" issues a new one ("Add an email
  address for {name} first: the new password is sent there."), the list shows the last sign-in. Until the port exists: no login, emailed false.
- Edit: someone who can write, over a record they may manage (no creator: anyone who can write). Delete: Full Access and an Admin or the
  SuperAdmin ("Only an Admin can delete a customer."); a hard delete (no recycle bin in Pallav); a lead that named it keeps going.
- List: newest first, every word (never the encrypted number), tabs active/off, numbers: total, self sign-up, with email, this month.

## 4. Email Marketing (HMS, 13 Oct 2026; replaces the CRM in the menu)

- A campaign: subject required max 150; message required max 5000 (plain text; `{name}` is each person's name); audience `customers` (active
  customers with an email), `companies` (live company profiles' own address and their contacts'), `guests` (the stays' guests with an email) or
  `all`. Each address counts once (lower case; the first name seen wins); an address in `mail_optouts` is never included.
- Draft: created, edited and deleted (`companies` edit) while a draft; a sent campaign answers 409 to both and stays as the record of what went
  out. Every change is a system-log line (`Campaign`).
- Send (`POST /companies/marketing/campaigns/{id}/send`, once): refused 422 (`fields.mail`) until the hotel's mail server is set up (`email.host`
  and `email.from_address`), 422 (`fields.audience`) when nobody in the audience has an address; else the campaign is marked sent with its
  addresses (`mail_campaign_recipients`) in the hotel's transaction, then one outbox row per address is queued (kind `campaign`, the hotel's id,
  template `campaign-<id>`, payload: subject, the message written for that person with the greeting and the hotel's sign-off, that person's
  unsubscribe link) and the worker woken. Delivered / failed / waiting are read back from the outbox by the template name.
- Test (`POST .../test`): the same mail to the signed-in person's platform address (422 without one), template `campaign-test`.
- Unsubscribe (`GET /api/v1/public/unsubscribe?h&e&t`, no sign-in, 30 a minute per IP): `t` is 32 url-safe characters of an HMAC under
  HMS_HASH_KEY over `<hotel id>\n<address>`; a valid link records the opt-out (twice is fine) and answers a plain HTML page; a wrong one 404.

## 5. The company ledger (`Support/CompanyLedger.php`)

- Lines (golden): an advance paid (credit; never an "Excessive / ..." one), its refund (debit), a bill (debit), an advance held under another
  company used on the bill (credit "Advance used"), what was paid at the desk on sides not on Debit less the advance used on them (credit
  "Paid at checkout"), each later instalment (credit "Payment"). Same-day order: advance, bill, advance used / paid at checkout, payment,
  refund; then the record, then the instalment. Balance = debits − credits (above zero the company owes).
- **Overview** (ruled for scale): `summaryByCompany()` (one aggregate per company; the MySQL repository computes it in SQL) for every company
  on the list; who owes most first, then in credit, then the quiet ones, by name; Show all/owing/credit/settled; numbers: owed, owing,
  held, holding, billed and received this month; paid percent = floor(received / (billed + refunded) × 100), at most 100. A property test
  proves the aggregate equals the line-by-line ledger for every company.
- **Account** (Pallav's screen): a quick period (all, this month, last month, this year) or From/To (an end before the start is swapped);
  opening carried in; totals; search over guest, room, refs, modes, notes, kind, `#0001`, dates in four forms, amounts; written like a book:
  without a page it opens on the LAST page; last payment; open bills.
- **Statement** (decided shape): `GET /companies/{id}/statement?from&to` → opening, every row with the server's running balance, closing,
  debit/credit totals. **HMS:** from must not be after to ("The to date must be on or after the from date."); at most three years ("Choose a
  period of at most three years."); more than 5,000 rows: "This period has N entries, more than 5,000: choose a shorter period."

## 6. Options (`GET /companies/options`)

ID proof types (`id_proof_types`), contact roles (Master Data `company_contact_role`), CRM sources (`crm_source`, else Pallav's list): the
apps stop using their constants (contract request).

# One common guest and company profile: plan (B, 18 Oct 2026)

MJ wants:
- one table for all logins (`platform.users`, which already exists);
- one table for all guests (`platform.guests`) and a separate one for all companies (`platform.companies`).

"My profile" of a guest or company is **one profile across all hotels**. It is edited once, and every hotel sees it. Hotel records keep only hotel-specific data and the link. Bills, stays and RLS stay in each hotel, unchanged.

## Tables
**Platform 0131 (profile photo).** `platform.users.photo_file`: the photo of any login (guest, company, staff).
- Stored as WebP of at most 1 MB in the private media store.
- On Vercel it needs `MEDIA_DRIVER=s3`; without that the server answers 503 with a clear sentence.

**Platform 0132 (central profiles).**
- **`platform.guests`:**
  - `id`, `display_name`, `mobile` (+91 normalised), `email`, `address`, `city`
  - `user_id` (the guest's login; unique, nullable)
  - `merged_into` (set by a review merge; never deleted), timestamps
- **`platform.companies`:**
  - `id`, `name`, `main_contact_name`, `gstin`, `email`, `mobile`, `landline`, `address`, `pincode`, `country`, `contacts`
  - `user_id`, `merged_into`, timestamps
- **`platform.guest_hotels`** `(guest_id, hotel_id, customer_id)` and **`platform.company_hotels`** `(company_id, hotel_id, company_profile_id)`: **the link**, one row per hotel record, unique on `(hotel_id, record id)`.
- **`platform.profile_kept_apart`** `(kind, left_id, right_id, decided_by, decided_at)`: pairs the Super Admin marked "not the same".

**No hotel migration.** The link lives in `platform`, beside the profile. A hotel transaction cannot read `platform` (it runs as the hotel's role, with `search_path` set to its own schema), so a link column inside the hotel would only be a second copy that can drift.

The hotel's `customers` and `company_profiles` rows stay as they are, because they are the hotel's working copy:
- bills match a guest by mobile;
- RLS uses the hotel record id (`user_hotels.subject_id` keeps pointing at it);
- Pathik, search, backups and exports read them.

Hotel-only data stays only in the hotel:
- ID proof, notes and active for guests;
- discount/GST/TCS/TDS percentages, instruction and contacts for companies.

## Which field lives where (PM condition, 18 Oct 2026)
**CENTRAL** fields are the one profile, edited once. Staff screens and the portal both read them from the central row, through the platform unit and never inside the hotel transaction.

**HOTEL-only** fields stay in the hotel's schema. The hotel copy of a central field is used only for bill matching, Pathik and search.

| | CENTRAL (`platform.guests` / `platform.companies`, photo on `platform.users`) | HOTEL-only (`customers` / `company_profiles` and the hotel's tables) |
|---|---|---|
| Guest | name, email, address, city, photo (of the login) | the mobile used for bill matching (reception changes it, as before), ID proof type and number, ID scans, notes, active switch, stays, bills, advances, charges, orders, requests |
| Company | name, main contact, email, mobile, landline, address, pincode, country, GSTIN, contacts, photo (of the login) | discount / GST / TCS / TDS percentages, instruction, active state, bookings, bills, payments, ledger |

The central row also keeps a copy of the guest's mobile, for the duplicates list and to show it. It never changes a hotel's bill matching.

## Profile and portals
- **Guest profile.** `GET /guest/profile` and `PUT /guest/profile` read and write the central guest row. That is one edit, with **no fan-out** to hotel copies.
  - The answer carries `photoUrl`.
  - `updatedHotels` and `unavailable` are dropped (optional in the contract, so nothing breaks for C).
  - The mobile stays reception's to change (MJ's pending decision).
- **Company profile.**
  - The contact fields are central, and `PUT /corporate/profile` no longer needs `?hotel=`.
  - The pricing block stays per hotel and read-only: `GET /corporate/profile?hotel=` still shows that hotel's percentages.
- **Photo** for every login: `GET`, `PUT` and `DELETE /profile/photo` (own account). The guest and company profiles show it.
- **All hotels, bills and stays:** unchanged (`user_hotels` and the hotel records).
- **Hotel staff screens** that show a linked guest's or company's profile read the central row (service layer, platform unit), so staff and the guest see the same profile. The hotel copy stays only for bill matching, Pathik and search.

## Existing data: no silent merges
- A backfill gives **every existing hotel record its own central row** and its link. Records already tied to the same portal login share one central row, because the login is the person's own proof.
- The backfill is idempotent. It runs as `db:cli central-profiles --dry-run | --apply`, reading each hotel as the owner and writing only to `platform`.
- **Possible duplicates** for the Super Admin are computed live, never stored:
  - guests with the same mobile (last 10 digits) or the same email across hotels;
  - companies with the same GSTIN or the same email.
- A **merge** is an explicit action. One row is kept, the other gets `merged_into`, and its links and login move across. It is audited and can be undone, because the links are kept.
- **"Keep apart"** hides a pair from the list.

## New records after the backfill
- When a hotel creates a customer or company profile, the platform creates its central row and link right after the hotel commit.
- A failure is retried later and never blocks the hotel's save.
- Linking a portal login links its central row too. If the login already has one, the pair appears as a possible duplicate; it is not merged automatically.

## Steps
1. Migrations 0131 (photo) and 0132 (central) + repos.
2. Photo service and routes; central My profile (guest, company) + contract for C.
3. Backfill CLI + possible-duplicates list + merge / keep apart (Super Admin API, contract for C).
4. Portal reads use the central profile; create and link keep it in step.
5. Tests (unit + `tests/db` on `hms_test`), Neon SQL 0131 / 0132 with guards + RUN-ORDER, BACKEND.md.

## Risks
- **Privacy across hotels (DPDP).** One shared profile means every linked hotel sees the guest's own latest details. Hotels never see each other's hotel-only data, and the duplicates list is Super Admin only.
- **Wrong merges.** Nothing merges without a person, and merges can be undone.
- **Hotel copy vs central.** Bills keep the name they were made with (they are historical documents). The front-desk copy can differ until the front-desk screens read central (a later step).

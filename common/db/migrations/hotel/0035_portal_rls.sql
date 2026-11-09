-- rollback: DROP POLICY IF EXISTS guest_requests_scope ON guest_requests; DROP POLICY IF EXISTS pms_charges_scope ON pms_charges; DROP POLICY IF EXISTS pms_reservations_scope ON pms_reservations; DROP POLICY IF EXISTS bill_master_advances_scope ON bill_master_advances; DROP POLICY IF EXISTS bill_master_bills_scope ON bill_master_bills; DROP POLICY IF EXISTS pms_stays_scope ON pms_stays; DROP POLICY IF EXISTS company_profiles_scope ON company_profiles; DROP POLICY IF EXISTS customers_scope ON customers; ALTER TABLE guest_requests DISABLE ROW LEVEL SECURITY; ALTER TABLE pms_charges DISABLE ROW LEVEL SECURITY; ALTER TABLE pms_reservations DISABLE ROW LEVEL SECURITY; ALTER TABLE bill_master_advances DISABLE ROW LEVEL SECURITY; ALTER TABLE bill_master_bills DISABLE ROW LEVEL SECURITY; ALTER TABLE pms_stays DISABLE ROW LEVEL SECURITY; ALTER TABLE company_profiles DISABLE ROW LEVEL SECURITY; ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
-- Row-level security as the SECOND fence for the portals (MJ's plan T8, 13 Oct 2026). The first fence is the service code: a guest's reads go
-- through their customer's mobile, a company's through its id. This makes the database refuse the rest even if a query forgot the filter.
--
-- How it is switched on: withHotel sets, per transaction and only for a guest or company account (the session's record scope),
--   hms.scope_kind = 'guest' | 'company'   and   hms.scope_id = the customer id | the company profile id
-- with set_config(..., true). A transaction without them (hotel staff, platform visits, the Pathik worker, the nightly backup) passes every
-- policy untouched: nothing changes for them. The hotel role is not the table owner (hms_owner is), so the policies apply to it.
--
-- What a GUEST may see: their own customer row; bills, advances and stays with no company whose mobile's last 10 digits are their customer's
-- (the same rule as repos/portal.ts mobileForms: 98250 41236, 91..., 0... all match); the stays of their bills, the reservations and the advances
-- of those stays, the charges and the guest requests of those stays. A COMPANY: its own profile; its bills, advances, stays and reservations
-- (company_id), the stays of its bills, their charges. Neither sees a company profile or a customer that is not theirs. Everything else in the
-- schema (rooms, menu, settings, logs) carries no policy.
--
-- current_setting(name, true) answers NULL when the setting was never set in the session and '' once a transaction-local value ended, so both read
-- as "no scope". A policy that subselects another protected table (pms_stays from pms_charges) is filtered by that table's own policy: the fence
-- holds from any direction. No policy references the table it is on through another policy (no cycle).

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_scope ON customers USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND id = nullif(current_setting('hms.scope_id', true), '')::uuid)
);

ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_profiles_scope ON company_profiles USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'company' AND id = nullif(current_setting('hms.scope_id', true), '')::uuid)
);

ALTER TABLE bill_master_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY bill_master_bills_scope ON bill_master_bills USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'company' AND company_id = nullif(current_setting('hms.scope_id', true), '')::uuid)
  OR (current_setting('hms.scope_kind', true) = 'guest' AND company_id IS NULL
      AND right(regexp_replace(coalesce(mobile_number, ''), '[^0-9]', '', 'g'), 10)
        = (SELECT right(regexp_replace(coalesce(c.mobile, ''), '[^0-9]', '', 'g'), 10) FROM customers c WHERE c.id = nullif(current_setting('hms.scope_id', true), '')::uuid))
);

ALTER TABLE pms_stays ENABLE ROW LEVEL SECURITY;
CREATE POLICY pms_stays_scope ON pms_stays USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'company' AND (company_id = nullif(current_setting('hms.scope_id', true), '')::uuid OR bill_id IN (SELECT b.id FROM bill_master_bills b)))
  OR (current_setting('hms.scope_kind', true) = 'guest' AND (
       (company_id IS NULL AND right(regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g'), 10)
          = (SELECT right(regexp_replace(coalesce(c.mobile, ''), '[^0-9]', '', 'g'), 10) FROM customers c WHERE c.id = nullif(current_setting('hms.scope_id', true), '')::uuid))
       OR bill_id IN (SELECT b.id FROM bill_master_bills b)))
);

ALTER TABLE bill_master_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY bill_master_advances_scope ON bill_master_advances USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'company' AND company_id = nullif(current_setting('hms.scope_id', true), '')::uuid)
  OR (current_setting('hms.scope_kind', true) = 'guest' AND company_id IS NULL AND (
       right(regexp_replace(coalesce(mobile_number, ''), '[^0-9]', '', 'g'), 10)
          = (SELECT right(regexp_replace(coalesce(c.mobile, ''), '[^0-9]', '', 'g'), 10) FROM customers c WHERE c.id = nullif(current_setting('hms.scope_id', true), '')::uuid)
       OR (reservation_id IS NOT NULL AND reservation_id IN (SELECT s.reservation_id FROM pms_stays s WHERE s.reservation_id IS NOT NULL))))
);

ALTER TABLE pms_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY pms_reservations_scope ON pms_reservations USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'company' AND company_id = nullif(current_setting('hms.scope_id', true), '')::uuid)
  OR (current_setting('hms.scope_kind', true) = 'guest' AND id IN (SELECT s.reservation_id FROM pms_stays s WHERE s.reservation_id IS NOT NULL))
);

ALTER TABLE pms_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY pms_charges_scope ON pms_charges USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR stay_id IN (SELECT s.id FROM pms_stays s)
);

ALTER TABLE guest_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY guest_requests_scope ON guest_requests USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR stay_id IN (SELECT s.id FROM pms_stays s)
);

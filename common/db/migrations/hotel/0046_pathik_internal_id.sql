-- rollback: ALTER TABLE pathik_sync DROP COLUMN IF EXISTS pathik_internal_id;
-- Pathik's own id of a guest (MJ, 18 Oct 2026: staff enter guests in Pathik by hand and press Mark as submitted). Pathik's check-out page is /dashboard/edit/<its own
-- id>; HMS never learns that id from a hand submit, so the Refresh read keeps it when Pathik's Pending Checkout list shows the serial of one of our check-in rows. The
-- Pathik form screen of the guest's check-out then opens that page directly (without it, the Pending Checkout list to search by the serial).
--   pathik_internal_id   digits only, as Pathik's edit links carry it; on the check-in row; null until a read found it
ALTER TABLE pathik_sync ADD COLUMN IF NOT EXISTS pathik_internal_id varchar(20) CHECK (pathik_internal_id IS NULL OR pathik_internal_id ~ '^[0-9]{1,20}$');

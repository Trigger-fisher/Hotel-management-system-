-- rollback: DROP TRIGGER IF EXISTS notification_targets_scoped_change ON notification_targets; DROP FUNCTION IF EXISTS refuse_scoped_target_change(); DROP TRIGGER IF EXISTS room_service_orders_scoped_change ON room_service_orders; DROP FUNCTION IF EXISTS refuse_scoped_order_change(); DROP POLICY IF EXISTS room_service_orders_select ON room_service_orders; DROP POLICY IF EXISTS room_service_orders_insert ON room_service_orders; DROP POLICY IF EXISTS room_service_orders_update ON room_service_orders; DROP POLICY IF EXISTS room_service_orders_delete ON room_service_orders; CREATE POLICY room_service_orders_scope ON room_service_orders USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL OR (current_setting('hms.scope_kind', true) = 'guest' AND stay_id IN (SELECT s.id FROM pms_stays s))); DROP POLICY IF EXISTS room_service_order_lines_select ON room_service_order_lines; DROP POLICY IF EXISTS room_service_order_lines_insert ON room_service_order_lines; DROP POLICY IF EXISTS room_service_order_lines_update ON room_service_order_lines; DROP POLICY IF EXISTS room_service_order_lines_delete ON room_service_order_lines; CREATE POLICY room_service_order_lines_scope ON room_service_order_lines USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL OR (current_setting('hms.scope_kind', true) = 'guest' AND order_id IN (SELECT o.id FROM room_service_orders o))); DROP POLICY IF EXISTS pms_charges_select ON pms_charges; DROP POLICY IF EXISTS pms_charges_insert ON pms_charges; DROP POLICY IF EXISTS pms_charges_update ON pms_charges; DROP POLICY IF EXISTS pms_charges_delete ON pms_charges; CREATE POLICY pms_charges_scope ON pms_charges USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL OR stay_id IN (SELECT s.id FROM pms_stays s)); DROP POLICY IF EXISTS guest_requests_select ON guest_requests; DROP POLICY IF EXISTS guest_requests_insert ON guest_requests; DROP POLICY IF EXISTS guest_requests_update ON guest_requests; DROP POLICY IF EXISTS guest_requests_delete ON guest_requests; CREATE POLICY guest_requests_scope ON guest_requests USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL OR stay_id IN (SELECT s.id FROM pms_stays s)); DROP POLICY IF EXISTS support_requests_select ON support_requests; DROP POLICY IF EXISTS support_requests_insert ON support_requests; DROP POLICY IF EXISTS support_requests_update ON support_requests; DROP POLICY IF EXISTS support_requests_delete ON support_requests; CREATE POLICY support_requests_scope ON support_requests USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL OR (current_setting('hms.scope_kind', true) = 'guest' AND customer_id = nullif(current_setting('hms.scope_id', true), '')::uuid));
-- Row-level security, ONE POLICY PER COMMAND for the portal tables that had one policy for every command (security review round 2, 18 Oct 2026: L1 and L2). Nothing changes for
-- an unscoped transaction (hotel staff, platform visits, workers, the backup): every policy below starts with "no scope set". For a guest or company account (hms.scope_kind,
-- 0035) a command with no policy is now refused, so each table allows only what the portals do:
--   room_service_orders       guest: read its own stays' orders, place one (INSERT), cancel one (UPDATE, to 'cancelled' by the guest, and only from 'placed'); never DELETE
--   room_service_order_lines  guest: read and write the lines of its own orders, once (INSERT); never change or delete one
--   pms_charges               guest and company: read the charges of their stays (as 0035); guest: add a charge to its own stay (an order) and remove only a charge of one of
--                             its own room-service orders (a cancel); never UPDATE
--   guest_requests            read only (the guest side of requests was removed, 2660167; the guest home still counts the open ones)
--   support_requests          guest: read its own only (the guest side of support was removed, 2660167)
-- A policy cannot compare the old row with the new one, so two triggers hold the rest for a scoped transaction (a second fence behind the service code):
--   * room_service_orders: a guest's UPDATE may change only the status fields (status, when, by whom, cancelled_by_kind, the reason), and only placed -> cancelled by the guest.
--   * notification_targets (L1, 0039): a company may only mark its own targets read; changing which notification or which company a row is (or its mail status) is refused.
-- A foreign key's own action (a removed charge's line set to NULL) is not subject to row security, as before. No new table, no grant.

DROP POLICY IF EXISTS room_service_orders_scope ON room_service_orders;
CREATE POLICY room_service_orders_select ON room_service_orders FOR SELECT USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND stay_id IN (SELECT s.id FROM pms_stays s))
);
CREATE POLICY room_service_orders_insert ON room_service_orders FOR INSERT WITH CHECK (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND stay_id IN (SELECT s.id FROM pms_stays s) AND status = 'placed')
);
CREATE POLICY room_service_orders_update ON room_service_orders FOR UPDATE
  USING (
    nullif(current_setting('hms.scope_kind', true), '') IS NULL
    OR (current_setting('hms.scope_kind', true) = 'guest' AND stay_id IN (SELECT s.id FROM pms_stays s))
  )
  WITH CHECK (
    nullif(current_setting('hms.scope_kind', true), '') IS NULL
    OR (current_setting('hms.scope_kind', true) = 'guest' AND stay_id IN (SELECT s.id FROM pms_stays s) AND status = 'cancelled' AND cancelled_by_kind = 'guest')
  );
CREATE POLICY room_service_orders_delete ON room_service_orders FOR DELETE USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL);

DROP POLICY IF EXISTS room_service_order_lines_scope ON room_service_order_lines;
CREATE POLICY room_service_order_lines_select ON room_service_order_lines FOR SELECT USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND order_id IN (SELECT o.id FROM room_service_orders o))
);
CREATE POLICY room_service_order_lines_insert ON room_service_order_lines FOR INSERT WITH CHECK (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND order_id IN (SELECT o.id FROM room_service_orders o))
);
CREATE POLICY room_service_order_lines_update ON room_service_order_lines FOR UPDATE USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL) WITH CHECK (nullif(current_setting('hms.scope_kind', true), '') IS NULL);
CREATE POLICY room_service_order_lines_delete ON room_service_order_lines FOR DELETE USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL);

DROP POLICY IF EXISTS pms_charges_scope ON pms_charges;
CREATE POLICY pms_charges_select ON pms_charges FOR SELECT USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR stay_id IN (SELECT s.id FROM pms_stays s)
);
CREATE POLICY pms_charges_insert ON pms_charges FOR INSERT WITH CHECK (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND stay_id IN (SELECT s.id FROM pms_stays s))
);
CREATE POLICY pms_charges_update ON pms_charges FOR UPDATE USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL) WITH CHECK (nullif(current_setting('hms.scope_kind', true), '') IS NULL);
CREATE POLICY pms_charges_delete ON pms_charges FOR DELETE USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND stay_id IN (SELECT s.id FROM pms_stays s)
      AND id IN (SELECT l.charge_id FROM room_service_order_lines l WHERE l.charge_id IS NOT NULL))
);

DROP POLICY IF EXISTS guest_requests_scope ON guest_requests;
CREATE POLICY guest_requests_select ON guest_requests FOR SELECT USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR stay_id IN (SELECT s.id FROM pms_stays s)
);
CREATE POLICY guest_requests_insert ON guest_requests FOR INSERT WITH CHECK (nullif(current_setting('hms.scope_kind', true), '') IS NULL);
CREATE POLICY guest_requests_update ON guest_requests FOR UPDATE USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL) WITH CHECK (nullif(current_setting('hms.scope_kind', true), '') IS NULL);
CREATE POLICY guest_requests_delete ON guest_requests FOR DELETE USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL);

DROP POLICY IF EXISTS support_requests_scope ON support_requests;
CREATE POLICY support_requests_select ON support_requests FOR SELECT USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND customer_id = nullif(current_setting('hms.scope_id', true), '')::uuid)
);
CREATE POLICY support_requests_insert ON support_requests FOR INSERT WITH CHECK (nullif(current_setting('hms.scope_kind', true), '') IS NULL);
CREATE POLICY support_requests_update ON support_requests FOR UPDATE USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL) WITH CHECK (nullif(current_setting('hms.scope_kind', true), '') IS NULL);
CREATE POLICY support_requests_delete ON support_requests FOR DELETE USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL);

-- a guest's change of an order: only the status fields, only placed -> cancelled by the guest (unscoped transactions: no limit)
CREATE FUNCTION refuse_scoped_order_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF nullif(current_setting('hms.scope_kind', true), '') IS NOT NULL AND (
       OLD.status IS DISTINCT FROM 'placed' OR NEW.status IS DISTINCT FROM 'cancelled' OR NEW.cancelled_by_kind IS DISTINCT FROM 'guest'
       OR (NEW.id, NEW.order_no, NEW.stay_id, NEW.scheduled_for, NEW.note, NEW.total_paise, NEW.placed_by, NEW.placed_at, NEW.created_at)
          IS DISTINCT FROM (OLD.id, OLD.order_no, OLD.stay_id, OLD.scheduled_for, OLD.note, OLD.total_paise, OLD.placed_by, OLD.placed_at, OLD.created_at)) THEN
    RAISE EXCEPTION 'a portal account may only cancel its own placed order' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER room_service_orders_scoped_change BEFORE UPDATE ON room_service_orders FOR EACH ROW EXECUTE FUNCTION refuse_scoped_order_change();

-- L1: a company's change of its notification targets: the read mark only (unscoped transactions: no limit)
CREATE FUNCTION refuse_scoped_target_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF nullif(current_setting('hms.scope_kind', true), '') IS NOT NULL
     AND (NEW.id, NEW.notification_id, NEW.company_id, NEW.email_status, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.notification_id, OLD.company_id, OLD.email_status, OLD.created_at) THEN
    RAISE EXCEPTION 'a portal account may only mark its own notifications read' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER notification_targets_scoped_change BEFORE UPDATE ON notification_targets FOR EACH ROW EXECUTE FUNCTION refuse_scoped_target_change();

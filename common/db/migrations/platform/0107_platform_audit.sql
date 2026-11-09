-- rollback: DROP INDEX IF EXISTS platform.audit_log_scope_at_idx; DROP INDEX IF EXISTS platform.audit_log_action_at_idx; DROP INDEX IF EXISTS platform.audit_log_at_idx; DROP INDEX IF EXISTS platform.audit_log_group_at_idx; DROP INDEX IF EXISTS platform.audit_log_visit_id_idx; ALTER TABLE platform.audit_log DROP CONSTRAINT IF EXISTS audit_log_inside_hotel_has_visit, DROP COLUMN IF EXISTS scope, DROP COLUMN IF EXISTS actor_name, DROP COLUMN IF EXISTS actor_role, DROP COLUMN IF EXISTS inside_hotel, DROP COLUMN IF EXISTS visit_id, DROP COLUMN IF EXISTS group_id, DROP COLUMN IF EXISTS target_label, DROP COLUMN IF EXISTS ip, DROP COLUMN IF EXISTS user_agent, DROP COLUMN IF EXISTS result;
-- Platform audit (BRIEF rule 7, RESEARCH MUST 6): the EXISTING platform.audit_log is extended rather than a second audit table made.
-- Why: it already is the platform's append-only trail (insert-only trigger even for the owner, hms_app INSERT + SELECT only, RESTRICT foreign
-- keys, indexes by hotel and actor), create-hotel and the sign-in/admin services already write it, and one trail means one place for the
-- Super Admin's audit log, its filters and its CSV export. Its existing columns already hold actor_user_id (actor id), hotel_id (target hotel),
-- action, entity + entity_id (target record), before/after, reason, trace_id and at (time). Added here:
--   scope        'platform' for Platform / Super Admin console actions (and the public onboarding form), 'hotel' for actions inside a hotel
--                dashboard (the default, so every existing writer keeps working). The Super Admin's audit list reads scope = 'platform' plus
--                everything done inside a hotel during a visit.
--   actor_name   the actor's display name AT THAT TIME ("System", or the invited person's name for the onboarding form, actor_user_id NULL)
--   actor_role   the actor's account role at that time (NULL for the system and for an invited person)
--   inside_hotel platform staff did it inside a hotel (Enter hotel ... Exit, both included); visit_id then names the visit (0106)
--   group_id     target group, when there is one
--   target_label what it was done to, as shown ("Nisha Rao", "Hotel Sunrise"), a snapshot
--   ip, user_agent, result ('success' or 'failed': a refused attempt is audited too)
-- ALTER TABLE ... ADD COLUMN with constant defaults rewrites no row, so the insert-only trigger is never involved.

ALTER TABLE platform.audit_log
  ADD COLUMN scope text NOT NULL DEFAULT 'hotel' CHECK (scope IN ('hotel', 'platform')),
  ADD COLUMN actor_name text CHECK (char_length(actor_name) BETWEEN 1 AND 120),
  ADD COLUMN actor_role text CHECK (actor_role IN ('super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user', 'employee_user', 'corporate_user', 'guest_user')),
  ADD COLUMN inside_hotel boolean NOT NULL DEFAULT false,
  ADD COLUMN target_label text CHECK (char_length(target_label) BETWEEN 1 AND 200),
  ADD COLUMN ip inet,
  ADD COLUMN user_agent text CHECK (char_length(user_agent) <= 400),
  ADD COLUMN result text NOT NULL DEFAULT 'success' CHECK (result IN ('success', 'failed'));

-- RESTRICT like the table's other keys: an insert-only row must never be rewritten by a cascade
ALTER TABLE platform.audit_log ADD COLUMN visit_id uuid REFERENCES platform.hotel_visits (id) ON DELETE RESTRICT;
CREATE INDEX audit_log_visit_id_idx ON platform.audit_log (visit_id);
ALTER TABLE platform.audit_log ADD COLUMN group_id uuid REFERENCES platform.hotel_groups (id) ON DELETE RESTRICT;
CREATE INDEX audit_log_group_at_idx ON platform.audit_log (group_id, at DESC);

ALTER TABLE platform.audit_log
  ADD CONSTRAINT audit_log_inside_hotel_has_visit CHECK (inside_hotel = (visit_id IS NOT NULL));

-- filters of the audit list and the CSV export: by hotel (audit_log_hotel_at_idx) and actor (audit_log_actor_at_idx) exist; by action, by time
CREATE INDEX audit_log_action_at_idx ON platform.audit_log (action, at DESC);
CREATE INDEX audit_log_at_idx ON platform.audit_log (at DESC);
CREATE INDEX audit_log_scope_at_idx ON platform.audit_log (scope, at DESC);

-- No new table, so no new grant: hms_app keeps INSERT + SELECT on platform.audit_log (0099_grants.sql), never UPDATE or DELETE.

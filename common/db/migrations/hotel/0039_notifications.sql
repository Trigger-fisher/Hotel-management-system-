-- rollback: DROP POLICY IF EXISTS notification_targets_select ON notification_targets; DROP POLICY IF EXISTS notification_targets_insert ON notification_targets; DROP POLICY IF EXISTS notification_targets_update ON notification_targets; DROP POLICY IF EXISTS notifications_select ON notifications; DROP POLICY IF EXISTS notifications_insert ON notifications; DROP POLICY IF EXISTS notifications_update ON notifications; DROP TABLE IF EXISTS notification_targets; DROP TABLE IF EXISTS notifications;
-- Notifications (MJ's plan, 18 Oct 2026): the hotel sends a short plain-text notice to one company, a few, or all of its companies; the company reads it in
-- the Company portal (sidebar, bell, unread badge). A sent notification is never edited; the hotel can WITHDRAW it (hidden from the companies, kept in the
-- history). `audience` is kept for the guest portal later (only 'company' is accepted today; widening the CHECK is a one-line migration). The targets are a
-- SNAPSHOT taken at send time: a company added later does not receive an old notice. `email_status` says what the optional "also email" did for that company:
-- queued (a mail was put in the outbox), skipped (no usable address, or the address unsubscribed), none (the tick was off).
-- Row-level security is the second fence, like 0035: a company account sees only its own target rows and the notifications that have such a row; a guest
-- account sees none yet; hotel staff, platform visits and workers (no hms.scope_kind) see everything. Nothing here depends on another new migration.
-- no-standard-columns: an HMS-only record with no Pallav source (no legacy import, no soft delete: withdrawing sets withdrawn_at, history stays)
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  audience text NOT NULL DEFAULT 'company' CHECK (audience IN ('company')),
  audience_kind text NOT NULL CHECK (audience_kind IN ('one', 'selected', 'all')),
  title varchar(120) NOT NULL,
  body varchar(2000) NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'important')),
  link_view varchar(60),
  link_id uuid,
  expires_at date,
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  also_email boolean NOT NULL DEFAULT false,
  target_count integer NOT NULL DEFAULT 0 CHECK (target_count >= 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_created_at_id_idx ON notifications (created_at DESC, id DESC);
CREATE TRIGGER notifications_touch_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- no-standard-columns: one row per company a notification went to, written once at send time; the company's read mark is the only later change; no soft delete, no import
CREATE TABLE notification_targets (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  notification_id uuid NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES company_profiles (id) ON DELETE CASCADE,
  read_at timestamptz,
  email_status text NOT NULL DEFAULT 'none' CHECK (email_status IN ('none', 'queued', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notification_targets_pair_key ON notification_targets (notification_id, company_id);
CREATE INDEX notification_targets_company_idx ON notification_targets (company_id, created_at DESC, id DESC);
CREATE INDEX notification_targets_unread_idx ON notification_targets (company_id) WHERE read_at IS NULL;
CREATE TRIGGER notification_targets_touch_updated_at BEFORE UPDATE ON notification_targets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Row-level security, one policy per command (a command with no policy is refused for a scoped account). A company may READ its own targets and the notifications that have one, and
-- MARK its own targets read (UPDATE); it can never give itself a notice (INSERT), withdraw or change a notification, or touch another company's row. Unscoped transactions (hotel staff,
-- platform visits, workers) are not restricted. A guest scope matches nothing here (no guest clause yet).
ALTER TABLE notification_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_targets_select ON notification_targets FOR SELECT USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'company' AND company_id = nullif(current_setting('hms.scope_id', true), '')::uuid)
);
CREATE POLICY notification_targets_insert ON notification_targets FOR INSERT WITH CHECK (nullif(current_setting('hms.scope_kind', true), '') IS NULL);
CREATE POLICY notification_targets_update ON notification_targets FOR UPDATE
  USING (
    nullif(current_setting('hms.scope_kind', true), '') IS NULL
    OR (current_setting('hms.scope_kind', true) = 'company' AND company_id = nullif(current_setting('hms.scope_id', true), '')::uuid)
  )
  WITH CHECK (
    nullif(current_setting('hms.scope_kind', true), '') IS NULL
    OR (current_setting('hms.scope_kind', true) = 'company' AND company_id = nullif(current_setting('hms.scope_id', true), '')::uuid)
  );

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_select ON notifications FOR SELECT USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'company' AND id IN (SELECT t.notification_id FROM notification_targets t))
);
CREATE POLICY notifications_insert ON notifications FOR INSERT WITH CHECK (nullif(current_setting('hms.scope_kind', true), '') IS NULL);
CREATE POLICY notifications_update ON notifications FOR UPDATE USING (nullif(current_setting('hms.scope_kind', true), '') IS NULL) WITH CHECK (nullif(current_setting('hms.scope_kind', true), '') IS NULL);

-- rollback: ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known, ADD CONSTRAINT outbox_kind_check CHECK (kind IN ('login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset')); (only while no row uses the four new kinds)
-- Platform mail (BRIEF-BACKEND-PLATFORM rule 8): the invitation to a hotel or group, "your form was received and waits for approval",
-- "your hotel is approved, sign in", "your form was turned down". They go through the same outbox as every other mail (the log driver in
-- development, SMTP later). The invitation is the only mail with no account behind it yet, so platform.outbox.user_id stays nullable (it
-- already is). The payload of the invitation holds the link; like a one-time code it exists only until the mail is sent.
ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_check;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'platform.outbox'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%''admin_reset''%') THEN
    RAISE EXCEPTION 'the old outbox kind check is still present under another name';
  END IF;
END $$;
ALTER TABLE platform.outbox
  ADD CONSTRAINT outbox_kind_known CHECK (kind IN (
    'login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset',
    'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected'
  ));

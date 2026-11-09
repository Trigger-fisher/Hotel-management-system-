-- rollback: ALTER TABLE platform.logins RENAME CONSTRAINT users_username_check TO logins_username_check; ALTER TABLE platform.logins RENAME CONSTRAINT users_blocked_pair TO logins_blocked_pair; ALTER TABLE platform.login_contacts DROP CONSTRAINT login_contacts_email_shape;
-- Follow-up of 0148: the rules keep the names they always had in error messages, and an email must still have one @ (the profile tables only check lower case and length).
ALTER TABLE platform.logins RENAME CONSTRAINT logins_username_check TO users_username_check;
ALTER TABLE platform.logins RENAME CONSTRAINT logins_blocked_pair TO users_blocked_pair;
DELETE FROM platform.login_contacts WHERE kind = 'email' AND NOT (value = lower(value) AND char_length(value) <= 254 AND value ~ '^[^@[:space:]]+@[^@[:space:]]+$');
ALTER TABLE platform.login_contacts ADD CONSTRAINT login_contacts_email_shape CHECK (kind <> 'email' OR (value = lower(value) AND char_length(value) <= 254 AND value ~ '^[^@[:space:]]+@[^@[:space:]]+$'));

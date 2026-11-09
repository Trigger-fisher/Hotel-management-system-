-- rollback: DROP TABLE IF EXISTS platform.pmail_addresses; (pmail_accounts is not brought back: the guard below proves it held no row; its columns are in 0178 if it is ever needed again)
-- Every staff login gets its own mailbox on the platform's Amazon SES domain (MJ, 3 Nov 2026: "In mailbox I am going to use the SES only, like we have in hotel. I want that for all users").
-- This REPLACES the connect-your-own-Gmail account of 0178: nothing is connected, no mailbox password is kept, no mail server of the person's is ever contacted. The ten pmail_ tables of 0178 stay
-- as they are (the list entries, the whole email of each message, contacts, notes, quick replies, positions and log), and so do the login fence (hms.pmail_login_id) and the forced row level
-- security on each of them. This file only swaps the account table for the address table:
--   - platform.pmail_addresses holds the one address of a login's mailbox (<username>@<the platform sending domain>), with the same row fence as every other pmail_ table;
--   - the old table is dropped only after a guard that RAISES if it holds any row (production has none: no one ever connected a mailbox).
-- The guard looks past the row fence on purpose (NO FORCE for this transaction's owner only; the DROP that follows removes the table anyway), so a row of ANY login is seen.
ALTER TABLE platform.pmail_accounts NO FORCE ROW LEVEL SECURITY;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.pmail_accounts) THEN
    RAISE EXCEPTION 'platform.pmail_accounts still holds a connected mailbox: it is not dropped. Remove the mailbox first.' USING ERRCODE = '23000';
  END IF;
END
$guard$;
DROP TABLE IF EXISTS platform.pmail_accounts;

-- hard-delete: none (a person's address is never deleted by a job; it goes only with the person's login)
CREATE TABLE platform.pmail_addresses (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL DEFAULT platform.pmail_login_id() UNIQUE REFERENCES platform.logins (id) ON DELETE CASCADE,
  -- lower case, one address on one domain, never shared: nothing secret is kept here
  address varchar(254) NOT NULL UNIQUE CHECK (address = lower(address) AND address ~ '^[a-z0-9][a-z0-9._-]{0,63}@[a-z0-9.-]+\.[a-z]{2,24}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER pmail_addresses_touch_updated_at BEFORE UPDATE ON platform.pmail_addresses FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER pmail_addresses_keep_login_id BEFORE UPDATE ON platform.pmail_addresses FOR EACH ROW EXECUTE FUNCTION platform.pmail_keep_login_id();

-- the same fence as the other nine: a login sees and changes only its own row, the owner too
ALTER TABLE platform.pmail_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.pmail_addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY pmail_addresses_own_login ON platform.pmail_addresses USING (login_id = platform.pmail_login_id()) WITH CHECK (login_id = platform.pmail_login_id());
GRANT SELECT, INSERT, UPDATE ON platform.pmail_addresses TO hms_app;

-- rollback: DROP POLICY IF EXISTS razorpay_records_scope ON razorpay_records; DROP TABLE IF EXISTS razorpay_records; DROP FUNCTION IF EXISTS razorpay_records_check_parent(); DROP FUNCTION IF EXISTS razorpay_records_link_guest();
-- The Razorpay payments module (MJ, 2 Nov 2026): ONE table, razorpay_records, for everything Razorpay does in a hotel. A row's `kind` says what it is:
--   payment   a payment (ref = pay_..., parent_ref = the order it paid);   event    a webhook call kept as it came (ref = Razorpay's event id; none for a rejected call);
--   order     an amount a guest or company was asked to pay (ref = order_...);   refund   a refund of all or part of a payment (ref = rfnd_..., none while it is only "requested");
--   dispute   a guest or company raising a problem with one payment (ref = its number, reason = dispute | refund_request | question).
-- A refund or a dispute points at its payment row (parent_id, a real foreign key, checked to be a payment of the same business). The columns are shared where the meaning is the same
-- (status, amount_paise, event, payload) so one list, one search and one report can read across kinds.
-- The two tables 0009 made (razorpay_payments, razorpay_events) are NOT touched: they stay as they were (the Pallav import still writes to them) and their rows are copied in below. The module
-- reads and writes razorpay_records only; the two old tables are dropped by a later migration once the import is retired and the copy is verified. Both are financial records: never hard-deleted.
-- Row-level security as 0035: a guest sees only rows linked to their customer, a company only rows linked to it; staff, visits and workers see all.

-- external-values: status, event, method and speed are Razorpay's own strings (plus our "requested" and "failed" for a refund and "open"/"answered"/"closed"/"withdrawn" for a dispute); they are not ours to restrict
CREATE TABLE razorpay_records (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  kind text NOT NULL CHECK (kind IN ('payment', 'event', 'order', 'refund', 'dispute')),
  business text NOT NULL CHECK (business IN ('hotel', 'food')),
  ref varchar(100),
  parent_ref varchar(100),
  parent_id uuid REFERENCES razorpay_records (id) ON DELETE RESTRICT,
  status varchar(30),
  event varchar(60),
  method varchar(30),
  amount_paise bigint NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  amount_refunded_paise bigint NOT NULL DEFAULT 0 CHECK (amount_refunded_paise >= 0),
  currency varchar(5) NOT NULL DEFAULT 'INR',
  fee_paise bigint CHECK (fee_paise >= 0),
  tax_paise bigint CHECK (tax_paise >= 0),
  email varchar(255),
  contact varchar(30),
  description varchar(255),
  error_code varchar(60),
  error_description varchar(255),
  signature_ok boolean,
  ip_address varchar(45),
  customer_id uuid REFERENCES customers (id) ON DELETE SET NULL,
  company_id uuid REFERENCES company_profiles (id) ON DELETE SET NULL,
  bill_ref varchar(60),
  url varchar(255),
  title varchar(120),
  message varchar(2000),
  reason varchar(60),
  note varchar(500),
  speed varchar(20),
  reply varchar(2000),
  replied_at timestamptz,
  replied_by uuid,
  replied_by_name varchar(150),
  notes jsonb,
  payload jsonb,
  occurred_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT razorpay_records_ref_needed CHECK (kind NOT IN ('payment', 'order', 'dispute') OR ref IS NOT NULL),
  CONSTRAINT razorpay_records_event_signature CHECK (kind <> 'event' OR signature_ok IS NOT NULL),
  CONSTRAINT razorpay_records_parent_needed CHECK (kind NOT IN ('refund', 'dispute') OR parent_id IS NOT NULL),
  CONSTRAINT razorpay_records_refund_amount CHECK (kind <> 'refund' OR amount_paise >= 100),
  CONSTRAINT razorpay_records_dispute_who CHECK (kind <> 'dispute' OR customer_id IS NOT NULL OR company_id IS NOT NULL),
  CONSTRAINT razorpay_records_dispute_text CHECK (kind <> 'dispute' OR (btrim(coalesce(title, '')) <> '' AND btrim(coalesce(message, '')) <> '')),
  CONSTRAINT razorpay_records_dispute_reason CHECK (kind <> 'dispute' OR reason IN ('dispute', 'refund_request', 'question')),
  CONSTRAINT razorpay_records_dispute_status CHECK (kind <> 'dispute' OR status IN ('open', 'answered', 'closed', 'withdrawn')),
  CONSTRAINT razorpay_records_answer_pair CHECK (kind <> 'dispute' OR status <> 'answered' OR (reply IS NOT NULL AND btrim(reply) <> ''))
);
CREATE UNIQUE INDEX razorpay_records_ref_key ON razorpay_records (kind, business, ref) WHERE ref IS NOT NULL;
CREATE UNIQUE INDEX razorpay_records_legacy_id_key ON razorpay_records (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX razorpay_records_kind_status_idx ON razorpay_records (kind, business, status);
CREATE INDEX razorpay_records_parent_idx ON razorpay_records (parent_id);
CREATE INDEX razorpay_records_parent_ref_idx ON razorpay_records (kind, parent_ref) WHERE parent_ref IS NOT NULL;
CREATE INDEX razorpay_records_customer_idx ON razorpay_records (customer_id, created_at DESC);
CREATE INDEX razorpay_records_company_idx ON razorpay_records (company_id, created_at DESC);
CREATE INDEX razorpay_records_occurred_idx ON razorpay_records (kind, occurred_at DESC);
CREATE TRIGGER razorpay_records_touch_updated_at BEFORE UPDATE ON razorpay_records FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- a refund or a dispute belongs to a PAYMENT of the same business (a foreign key alone would accept any row of the table)
-- (the table is named through TG_TABLE_SCHEMA: each hotel has its own schema and a connection's search_path is not always that schema)
CREATE FUNCTION razorpay_records_check_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.razorpay_records p WHERE p.id = $1 AND p.kind = ''payment'' AND p.business = $2)', TG_TABLE_SCHEMA) INTO ok USING NEW.parent_id, NEW.business;
    IF NOT ok THEN
      RAISE EXCEPTION 'razorpay_records.parent_id must be a payment of the same business' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER razorpay_records_parent_check BEFORE INSERT OR UPDATE OF parent_id ON razorpay_records FOR EACH ROW EXECUTE FUNCTION razorpay_records_check_parent();

ALTER TABLE razorpay_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY razorpay_records_scope ON razorpay_records USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND customer_id = nullif(current_setting('hms.scope_id', true), '')::uuid)
  OR (current_setting('hms.scope_kind', true) = 'company' AND company_id = nullif(current_setting('hms.scope_id', true), '')::uuid)
);

-- copy what 0009's two tables hold (a copy, nothing removed from them; an event keeps no legacy id, as the two old tables number their rows separately)
INSERT INTO razorpay_records (legacy_id, kind, business, ref, parent_ref, status, event, method, amount_paise, amount_refunded_paise, currency, fee_paise, tax_paise, email, contact, description,
                              error_code, error_description, notes, payload, occurred_at, created_at, updated_at)
SELECT legacy_id, 'payment', business, payment_id, order_id, status, last_event, method, amount_paise, amount_refunded_paise, currency, fee_paise, tax_paise, email, contact, description,
       error_code, error_description, notes, payload, paid_at, created_at, updated_at
FROM razorpay_payments;
INSERT INTO razorpay_records (kind, business, ref, event, signature_ok, payload, ip_address, occurred_at, created_at, updated_at)
SELECT 'event', business, event_id, event, signature_ok, payload, ip_address, received_at, created_at, updated_at
FROM razorpay_events;

-- a payment belongs to a guest when its phone number is the phone number of exactly ONE customer of the hotel (the last 10 digits, the same rule as the guest's bills in 0035). This is what lets
-- a guest see their own payments through the row-level security above. It is filled in by the database, so it holds for every way a payment arrives (webhook, check, import), and
-- a payment is never linked by guess: two customers with one number means no link.
CREATE FUNCTION razorpay_records_link_guest() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE found uuid[];
BEGIN
  IF NEW.kind = 'payment' AND NEW.customer_id IS NULL AND NEW.company_id IS NULL AND length(regexp_replace(coalesce(NEW.contact, ''), '[^0-9]', '', 'g')) >= 10 THEN
    EXECUTE format('SELECT array_agg(id) FROM %I.customers WHERE right(regexp_replace(coalesce(mobile, ''''), ''[^0-9]'', '''', ''g''), 10) = right(regexp_replace($1, ''[^0-9]'', '''', ''g''), 10)', TG_TABLE_SCHEMA) INTO found USING NEW.contact;
    IF array_length(found, 1) = 1 THEN NEW.customer_id := found[1]; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER razorpay_records_link_guest BEFORE INSERT OR UPDATE OF contact ON razorpay_records FOR EACH ROW EXECUTE FUNCTION razorpay_records_link_guest();

-- the payments copied above get their guest link now that the trigger exists (naming the column in the UPDATE fires it)
UPDATE razorpay_records SET contact = contact WHERE kind = 'payment' AND customer_id IS NULL AND contact IS NOT NULL;

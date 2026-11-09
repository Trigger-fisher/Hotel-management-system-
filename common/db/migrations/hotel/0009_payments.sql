-- rollback: DROP TABLE IF EXISTS razorpay_payments; DROP TABLE IF EXISTS razorpay_events;
-- Online payments (Razorpay). Written from Pallav's final table shapes (columns.md); deviations are listed in docs/DATABASE.md.

-- external-values: event and status are Razorpay's own strings; they are not ours to restrict
CREATE TABLE razorpay_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  business text NOT NULL CHECK (business IN ('hotel', 'food')),
  event_id varchar(100),
  event varchar(60),
  signature_ok boolean NOT NULL DEFAULT false,
  payload jsonb,
  ip_address varchar(45),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX razorpay_events_business_idx ON razorpay_events (business);
CREATE UNIQUE INDEX razorpay_events_event_id_key ON razorpay_events (event_id);
CREATE INDEX razorpay_events_event_idx ON razorpay_events (event);
CREATE UNIQUE INDEX razorpay_events_legacy_id_key ON razorpay_events (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER razorpay_events_touch_updated_at BEFORE UPDATE ON razorpay_events FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- external-values: event and status are Razorpay's own strings; they are not ours to restrict
CREATE TABLE razorpay_payments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  business text NOT NULL CHECK (business IN ('hotel', 'food')),
  payment_id varchar(40) NOT NULL,
  order_id varchar(40),
  status varchar(20),
  last_event varchar(60),
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
  notes jsonb,
  payload jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX razorpay_payments_business_idx ON razorpay_payments (business);
CREATE INDEX razorpay_payments_order_id_idx ON razorpay_payments (order_id);
CREATE INDEX razorpay_payments_status_idx ON razorpay_payments (status);
CREATE INDEX razorpay_payments_paid_at_idx ON razorpay_payments (paid_at);
CREATE UNIQUE INDEX razorpay_payments_legacy_id_key ON razorpay_payments (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX razorpay_payments_business_payment_id_key ON razorpay_payments (business, payment_id);
CREATE TRIGGER razorpay_payments_touch_updated_at BEFORE UPDATE ON razorpay_payments FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

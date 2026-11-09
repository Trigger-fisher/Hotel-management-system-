-- rollback: forward-only because the trigger only fills in a link; to go back to the phone-only rule, CREATE OR REPLACE razorpay_records_link_guest() as 0054 made it and recreate the trigger on (contact)
-- A payment can name who it is for (MJ, 2 Nov 2026). A payment link HMS makes carries notes hms_company, hms_customer and hms_bill (Razorpay copies them onto the payment), and the database
-- turns them into company_id, customer_id and bill_ref on the payment, so a company's own payments show on its Support page and a payment is tied to the bill it settles. A note is believed only
-- when it is the id of a company or customer that exists in this hotel. Without notes the phone-number rule of 0054 still applies (exactly one customer with that number).
CREATE OR REPLACE FUNCTION razorpay_records_link_guest() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE found uuid[]; named text; ok boolean;
BEGIN
  IF NEW.kind IN ('payment', 'order') AND NEW.notes IS NOT NULL AND jsonb_typeof(NEW.notes) = 'object' THEN
    named := NEW.notes ->> 'hms_company';
    IF NEW.company_id IS NULL AND named ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.company_profiles WHERE id = $1)', TG_TABLE_SCHEMA) INTO ok USING named::uuid;
      IF ok THEN NEW.company_id := named::uuid; END IF;
    END IF;
    named := NEW.notes ->> 'hms_customer';
    IF NEW.customer_id IS NULL AND named ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.customers WHERE id = $1)', TG_TABLE_SCHEMA) INTO ok USING named::uuid;
      IF ok THEN NEW.customer_id := named::uuid; END IF;
    END IF;
    IF NEW.bill_ref IS NULL AND length(coalesce(NEW.notes ->> 'hms_bill', '')) BETWEEN 1 AND 60 THEN NEW.bill_ref := NEW.notes ->> 'hms_bill'; END IF;
  END IF;
  IF NEW.kind = 'payment' AND NEW.customer_id IS NULL AND NEW.company_id IS NULL AND length(regexp_replace(coalesce(NEW.contact, ''), '[^0-9]', '', 'g')) >= 10 THEN
    EXECUTE format('SELECT array_agg(id) FROM %I.customers WHERE right(regexp_replace(coalesce(mobile, ''''), ''[^0-9]'', '''', ''g''), 10) = right(regexp_replace($1, ''[^0-9]'', '''', ''g''), 10)', TG_TABLE_SCHEMA) INTO found USING NEW.contact;
    IF array_length(found, 1) = 1 THEN NEW.customer_id := found[1]; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS razorpay_records_link_guest ON razorpay_records;
CREATE TRIGGER razorpay_records_link_guest BEFORE INSERT OR UPDATE OF contact, notes ON razorpay_records FOR EACH ROW EXECUTE FUNCTION razorpay_records_link_guest();
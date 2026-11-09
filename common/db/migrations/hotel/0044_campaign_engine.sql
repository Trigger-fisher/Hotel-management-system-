-- rollback: forward-only because a campaign that was paused, cancelled or half sent has no place in the two states of 0032 (draft, sent)
-- The campaign engine (MAIL-PROVIDERS-50K plan, 18 Oct 2026; session A's slice H2, built by claude-d3). Sending a campaign no longer queues every mail at once: it
-- keeps WHO it goes to (the audience read once, opted-out and suppressed addresses left out) and the mail worker's feeder moves the next recipients into the outbox
-- a little at a time, within what the hotel's mail service allows today, until all are queued and sent. Meanwhile the hotel can pause, resume or cancel it and sees
-- its progress. States: draft -> sending <-> paused -> sent (all queued and done) or cancelled (the rest is never sent).
--   sent_at       when sending began (every state but draft has it)
--   queued        how many recipients the feeder has moved into the outbox
--   left_out      how many addresses of the audience were left out because they unsubscribed or are on the platform's suppression list
--   finished_at   when the last mail was queued and none was waiting any more (sent), or when it was cancelled
ALTER TABLE mail_campaigns DROP CONSTRAINT IF EXISTS mail_campaigns_status_check;
ALTER TABLE mail_campaigns DROP CONSTRAINT IF EXISTS mail_campaigns_sent_pair;
ALTER TABLE mail_campaigns ADD CONSTRAINT mail_campaigns_status_check CHECK (status IN ('draft', 'sending', 'paused', 'sent', 'cancelled'));
ALTER TABLE mail_campaigns ADD CONSTRAINT mail_campaigns_sent_pair CHECK ((status = 'draft') = (sent_at IS NULL));
ALTER TABLE mail_campaigns ADD COLUMN IF NOT EXISTS queued integer NOT NULL DEFAULT 0 CHECK (queued >= 0);
ALTER TABLE mail_campaigns ADD COLUMN IF NOT EXISTS left_out integer NOT NULL DEFAULT 0 CHECK (left_out >= 0);
ALTER TABLE mail_campaigns ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE mail_campaigns ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE mail_campaigns ADD COLUMN IF NOT EXISTS cancelled_by uuid;
ALTER TABLE mail_campaigns ADD CONSTRAINT mail_campaigns_queued_max CHECK (queued <= recipients);
-- only a finished campaign has finished_at, and a cancelled one always has it (a campaign sent before this migration has none)
ALTER TABLE mail_campaigns ADD CONSTRAINT mail_campaigns_finished_state CHECK ((finished_at IS NULL OR status IN ('sent', 'cancelled')) AND (status <> 'cancelled' OR finished_at IS NOT NULL));
ALTER TABLE mail_campaigns ADD CONSTRAINT mail_campaigns_paused_pair CHECK ((status = 'paused') = (paused_at IS NOT NULL));

-- Each recipient: queued_at is set when the feeder moved it into the outbox; skipped says why it was not (it unsubscribed or was suppressed after the campaign began).
ALTER TABLE mail_campaign_recipients ADD COLUMN IF NOT EXISTS queued_at timestamptz;
ALTER TABLE mail_campaign_recipients ADD COLUMN IF NOT EXISTS skipped text CHECK (skipped IS NULL OR skipped IN ('opted_out', 'suppressed', 'cancelled'));
-- the feeder reads the next recipients of a campaign from this small index
CREATE INDEX IF NOT EXISTS mail_campaign_recipients_waiting_idx ON mail_campaign_recipients (campaign_id, id) WHERE queued_at IS NULL AND skipped IS NULL;

-- Campaigns sent before this migration went out whole: every recipient was queued at once (the old send).
UPDATE mail_campaign_recipients r SET queued_at = r.created_at FROM mail_campaigns c WHERE c.id = r.campaign_id AND c.status = 'sent' AND r.queued_at IS NULL;
UPDATE mail_campaigns SET queued = recipients WHERE status = 'sent' AND queued = 0;

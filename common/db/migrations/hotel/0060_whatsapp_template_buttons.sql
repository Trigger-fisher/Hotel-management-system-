-- rollback: ALTER TABLE wa_templates DROP COLUMN IF EXISTS buttons, DROP COLUMN IF EXISTS starter_key;
-- WhatsApp messages, buttons and ready-made wording (MJ, 5 Nov 2026): a message may carry up to three buttons (a link the same for every guest, such as directions or reviews, or a quick answer the guest taps),
-- and remembers the ready-made message it was started from (common/ui-shared/dashboards/whatsappStarters.ts) so a newer wording can be offered to the hotel later. Additive: existing rows get no buttons
-- and no starter; their text is never rewritten (Meta holds the text of a sent message).
ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS buttons jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(buttons) = 'array' AND jsonb_array_length(buttons) <= 3);
ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS starter_key varchar(60) CHECK (starter_key IS NULL OR starter_key ~ '^[a-z0-9_]+$');

-- rollback: ALTER TABLE wa_templates DROP CONSTRAINT wa_templates_language_check; ALTER TABLE wa_templates ADD CONSTRAINT wa_templates_language_check CHECK (language ~ '^[a-z]{2}(_[A-Z]{2})?$');
-- WhatsApp message languages (MJ, 4 Nov 2026): a hotel writes its messages in English, Hinglish (Hindi in English letters), Hindi or Gujarati. Meta has a code for three of them (en, hi, gu); Hinglish is kept here as
-- its own value, 'hinglish', and is sent to Meta as English (its name carries _hl so it cannot collide with the English message of the same words). Only the allowed values widen; nothing is rewritten.
ALTER TABLE wa_templates DROP CONSTRAINT IF EXISTS wa_templates_language_check;
ALTER TABLE wa_templates ADD CONSTRAINT wa_templates_language_check CHECK (language ~ '^[a-z]{2}(_[A-Z]{2})?$' OR language = 'hinglish');

-- rollback: ALTER TABLE platform.conv_conversations DROP COLUMN IF EXISTS starred, DROP COLUMN IF EXISTS labels, DROP COLUMN IF EXISTS snoozed_until, DROP COLUMN IF EXISTS trashed_at, DROP COLUMN IF EXISTS draft;
-- The same five columns as the hotels' conv_conversations (hotel 0052), so the one conversations repository reads both: starred, labels, snoozed until, in the Trash, and one draft.
-- The platform's own Email page does not use them yet; they stay at their defaults.
ALTER TABLE platform.conv_conversations
  ADD COLUMN starred boolean NOT NULL DEFAULT false,
  ADD COLUMN labels text[] NOT NULL DEFAULT '{}' CHECK (cardinality(labels) <= 10),
  ADD COLUMN snoozed_until timestamptz,
  ADD COLUMN trashed_at timestamptz,
  ADD COLUMN draft jsonb CHECK (draft IS NULL OR jsonb_typeof(draft) = 'object');

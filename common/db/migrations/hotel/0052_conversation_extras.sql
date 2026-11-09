-- rollback: ALTER TABLE conv_conversations DROP COLUMN IF EXISTS starred, DROP COLUMN IF EXISTS labels, DROP COLUMN IF EXISTS snoozed_until, DROP COLUMN IF EXISTS trashed_at, DROP COLUMN IF EXISTS draft;
-- The Email page built the way Gmail works (MJ, 1 Nov 2026) on the live server: a conversation can be starred, carry labels, be snoozed until a time (hidden from the Inbox until then),
-- be put in the Trash (hidden everywhere), and hold one draft written in Compose (to, cc, subject, text: the words of an email not sent yet, kept only until it is sent or thrown away).
ALTER TABLE conv_conversations
  ADD COLUMN starred boolean NOT NULL DEFAULT false,
  ADD COLUMN labels text[] NOT NULL DEFAULT '{}' CHECK (cardinality(labels) <= 10),
  ADD COLUMN snoozed_until timestamptz,
  ADD COLUMN trashed_at timestamptz,
  ADD COLUMN draft jsonb CHECK (draft IS NULL OR jsonb_typeof(draft) = 'object');

-- rollback: DROP TABLE IF EXISTS platform.invitation_links; DROP TABLE IF EXISTS platform.invitations;
-- Invitations (Platform console Invitations page and the public onboarding link). BRIEF rule 2, RESEARCH MUST 2.
--
-- Two tables, so that no list ever carries a token:
--   * platform.invitations: the invitation as the lists show it (type, hotel or group name, the person invited, who sent it, status,
--     opened / submitted / revoked times, resend count). It has NO token column at all.
--   * platform.invitation_links: one row per link ever emailed. The link's token is 256 random bits; only its keyed hash is stored:
--     token_hash = hex(HMAC-SHA256(HMS_HASH_KEY, "invite" | token)), computed by the app (src/server/crypto/hash.ts style), 64 lower-case hex.
--     The public endpoints look a link up by that hash (unique). Resend = revoke the live link (revoke_reason 'resent') and insert a new one,
--     in one transaction: the old rows stay as history. At most one live link per invitation (partial unique index).
-- Types: 'individual' and 'group' are sent by a Platform / Super Admin; 'member_hotel' only by that group's Group Hotel Admin (built later,
--   the column already allows it). The CHECKs bind the type to the sender's role and to the group.
-- Status (stored): pending (sent, maybe opened), accepted (the form was submitted), expired, revoked (cancelled). The contract's list words map:
--   sent = pending and opened_at NULL, opened = pending and opened_at set, submitted = accepted, cancelled = revoked, expired = expired OR a
--   pending one whose live link is past expires_at. Before it inserts or resends, the service marks the pending invitations whose live link has
--   passed expires_at as 'expired' (like sessions), because the "one active invitation" indexes below look at status only.
-- VALIDITY: ONE constant, INVITATION_VALID_HOURS = 168 (7 days) in ui-shared/dashboards/platform.ts; the service sets
--   expires_at = issued_at + INVITATION_VALID_HOURS on each link. The CHECK below is only a ceiling (30 days) so the constant can change without
--   a migration while no link can ever live for months.
-- One ACTIVE invitation per hotel / group: unique among pending invitations by (type, group, lower(name)), and one pending invitation per email.

CREATE TABLE platform.invitations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  type text NOT NULL CHECK (type IN ('individual', 'group', 'member_hotel')),
  -- the hotel's name, or the proposed GROUP name for type 'group'
  hotel_name text NOT NULL CHECK (char_length(btrim(hotel_name)) BETWEEN 1 AND 200),
  -- the person invited: the first Hotel Admin, or the future Group Hotel Admin
  contact_name text NOT NULL CHECK (char_length(btrim(contact_name)) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  -- member_hotel: the group it joins. group: the group its form created (set on submit). individual: always NULL.
  group_id uuid REFERENCES platform.hotel_groups (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  invited_by uuid NOT NULL REFERENCES platform.users (id) ON DELETE RESTRICT,
  -- the sender's account role when it was sent
  invited_by_role text NOT NULL CHECK (invited_by_role IN ('super_admin', 'platform_admin', 'group_hotel_admin')),
  resend_count smallint NOT NULL DEFAULT 0 CHECK (resend_count BETWEEN 0 AND 100),
  -- when the newest link went out (first send or last resend)
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  -- first time the public page read it
  opened_at timestamptz,
  submitted_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_member_hotel_has_group CHECK (type <> 'member_hotel' OR group_id IS NOT NULL),
  CONSTRAINT invitations_individual_no_group CHECK (type <> 'individual' OR group_id IS NULL),
  -- Platform / Super Admins never invite a hotel into a group; a Group Hotel Admin invites only member hotels (MJ, 10 Oct)
  CONSTRAINT invitations_type_matches_sender CHECK ((type = 'member_hotel') = (invited_by_role = 'group_hotel_admin')),
  CONSTRAINT invitations_accepted_pair CHECK ((status = 'accepted') = (submitted_at IS NOT NULL)),
  CONSTRAINT invitations_revoked_pair CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX invitations_group_id_idx ON platform.invitations (group_id);
CREATE INDEX invitations_invited_by_idx ON platform.invitations (invited_by);
CREATE INDEX invitations_revoked_by_idx ON platform.invitations (revoked_by);
CREATE INDEX invitations_status_created_idx ON platform.invitations (status, created_at DESC);
CREATE INDEX invitations_created_at_idx ON platform.invitations (created_at DESC);
-- one active invitation per hotel / group name (per group for member hotels)
CREATE UNIQUE INDEX invitations_one_pending_per_name_key ON platform.invitations (type, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(hotel_name)))
  WHERE status = 'pending';
-- and one per email address
CREATE UNIQUE INDEX invitations_one_pending_per_email_key ON platform.invitations (email) WHERE status = 'pending';
CREATE TRIGGER invitations_touch_updated_at BEFORE UPDATE ON platform.invitations
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- Every link ever sent for an invitation (history kept: the app has no DELETE). Single use: used_at is set by the submit that accepts it.
CREATE TABLE platform.invitation_links (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  invitation_id uuid NOT NULL REFERENCES platform.invitations (id) ON DELETE RESTRICT,
  -- keyed hash of the token (see the header); the token itself is only ever in the email
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- who sent or resent this link
  issued_by uuid NOT NULL REFERENCES platform.users (id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  -- issued_at + INVITATION_VALID_HOURS (168), set by the service
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IN ('resent', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitation_links_revoked_pair CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT invitation_links_used_or_revoked CHECK (used_at IS NULL OR revoked_at IS NULL),
  -- a ceiling, not the rule: the rule is INVITATION_VALID_HOURS (see the header)
  CONSTRAINT invitation_links_validity CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '720 hours')
);
CREATE UNIQUE INDEX invitation_links_token_hash_key ON platform.invitation_links (token_hash);
CREATE INDEX invitation_links_invitation_id_idx ON platform.invitation_links (invitation_id, issued_at DESC);
CREATE INDEX invitation_links_issued_by_idx ON platform.invitation_links (issued_by);
-- one live link per invitation: a resend revokes the old one first, in the same transaction
CREATE UNIQUE INDEX invitation_links_one_live_key ON platform.invitation_links (invitation_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE TRIGGER invitation_links_touch_updated_at BEFORE UPDATE ON platform.invitation_links
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- No DELETE for the app on either table: a cancelled or used invitation stays as history.
GRANT SELECT, INSERT, UPDATE ON platform.invitations TO hms_app;
GRANT SELECT, INSERT, UPDATE ON platform.invitation_links TO hms_app;

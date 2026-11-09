import "server-only";
import { createPerson } from "./personWrites";
// The PostgreSQL implementation of invitations and the onboarding form (repos/platformInvitations.ts). Platform schema only, as hms_app, inside the
// console's one platform transaction. Every table is platform.<name>; values only through $n parameters.
import type { SqlClient } from "../../../db/types";
import type { AccountRole } from "../../auth/session";
import type {
  InvitationRow, InviterRole, LinkRow, PlatformInvitationsRepo, PlatformOnboardingRepo, StoredInvitationStatus,
} from "../platformInvitations";
import { RepoError } from "../types";
import { asDate, asText, guard } from "./shared";

type Row = Record<string, unknown>;

const INVITATION_SELECT = `
  SELECT i.id, i.type, i.hotel_name, i.contact_name, i.email, i.group_id, g.name AS group_name, i.status, i.invited_by, u.display_name AS invited_by_name,
         i.invited_by_role, i.resend_count, i.created_at, i.last_sent_at, i.opened_at, i.submitted_at, i.revoked_at,
         (SELECT l.expires_at FROM platform.invitation_links l WHERE l.invitation_id = i.id ORDER BY l.issued_at DESC, l.id DESC LIMIT 1) AS expires_at,
         (SELECT os.hotel_id FROM platform.onboarding_submissions os WHERE os.invitation_id = i.id) AS hotel_id,
         (SELECT os.group_id FROM platform.onboarding_submissions os WHERE os.invitation_id = i.id) AS made_group_id
    FROM platform.invitations i
    JOIN platform.people u ON u.id = i.invited_by
    LEFT JOIN platform.hotel_groups g ON g.id = i.group_id AND g.deleted_at IS NULL`;

const invitationOf = (r: Row): InvitationRow => ({
  id: String(r.id),
  type: r.type as InvitationRow["type"],
  hotelName: String(r.hotel_name),
  contactName: String(r.contact_name),
  email: String(r.email),
  groupId: asText(r.group_id),
  groupName: asText(r.group_name),
  status: r.status as StoredInvitationStatus,
  invitedBy: String(r.invited_by),
  invitedByName: String(r.invited_by_name),
  invitedByRole: r.invited_by_role as InviterRole,
  resendCount: Number(r.resend_count),
  createdAt: asDate(r.created_at) as Date,
  lastSentAt: asDate(r.last_sent_at) as Date,
  openedAt: asDate(r.opened_at),
  submittedAt: asDate(r.submitted_at),
  revokedAt: asDate(r.revoked_at),
  expiresAt: asDate(r.expires_at) as Date,
  hotelId: asText(r.hotel_id),
  madeGroupId: asText(r.made_group_id),
});

const ZERO = "00000000-0000-0000-0000-000000000000";

export function pgInvitationsRepo(db: SqlClient): PlatformInvitationsRepo {
  const q = (text: string, params?: readonly unknown[]) => db.query(text, params);

  return {
    async list() {
      return (await q(`${INVITATION_SELECT} ORDER BY i.created_at DESC, i.id DESC`)).rows.map(invitationOf);
    },
    async get(id, options) {
      const r = await q(`${INVITATION_SELECT} WHERE i.id = $1::uuid${options?.forUpdate ? " FOR UPDATE OF i" : ""}`, [id]);
      return r.rows[0] ? invitationOf(r.rows[0]) : null;
    },
    async expireDue(now) {
      const r = await q(
        `WITH due AS (
           UPDATE platform.invitation_links l SET revoked_at = $1::timestamptz, revoke_reason = 'expired'
            WHERE l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at <= $1::timestamptz
              AND EXISTS (SELECT 1 FROM platform.invitations i WHERE i.id = l.invitation_id AND i.status = 'pending')
            RETURNING l.invitation_id
         )
         UPDATE platform.invitations i SET status = 'expired' FROM due WHERE i.id = due.invitation_id AND i.status = 'pending'`,
        [now.toISOString()],
      );
      return r.affectedRows;
    },
    async clashes(f) {
      const r = await q(
        `SELECT EXISTS (SELECT 1 FROM platform.invitations WHERE status = 'pending' AND email = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)) AS email,
                EXISTS (SELECT 1 FROM platform.invitations
                         WHERE status = 'pending' AND type = $3 AND COALESCE(group_id, $6::uuid) = COALESCE($4::uuid, $6::uuid)
                           AND lower(btrim(hotel_name)) = lower(btrim($5)) AND ($2::uuid IS NULL OR id <> $2::uuid)) AS name`,
        [f.email, f.exceptId, f.type, f.groupId, f.hotelName, ZERO],
      );
      return { email: r.rows[0]?.email === true, name: r.rows[0]?.name === true };
    },
    async create(f, tokenHash, expiresAt, now) {
      const r = await guard(
        q(
          `INSERT INTO platform.invitations (type, hotel_name, contact_name, email, group_id, invited_by, invited_by_role, last_sent_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
          [f.type, f.hotelName, f.contactName, f.email, f.groupId, f.invitedBy, f.invitedByRole, now.toISOString()],
        ),
      );
      const id = String(r.rows[0].id);
      await guard(q("INSERT INTO platform.invitation_links (invitation_id, token_hash, issued_by, issued_at, expires_at) VALUES ($1, $2, $3, $4, $5)", [id, tokenHash, f.invitedBy, now.toISOString(), expiresAt.toISOString()]));
      return id;
    },
    async reissue(id, tokenHash, expiresAt, by, now) {
      await q("UPDATE platform.invitation_links SET revoked_at = $2, revoke_reason = 'resent' WHERE invitation_id = $1 AND used_at IS NULL AND revoked_at IS NULL", [id, now.toISOString()]);
      await guard(q("INSERT INTO platform.invitation_links (invitation_id, token_hash, issued_by, issued_at, expires_at) VALUES ($1, $2, $3, $4, $5)", [id, tokenHash, by, now.toISOString(), expiresAt.toISOString()]));
      const r = await guard(q("UPDATE platform.invitations SET status = 'pending', resend_count = resend_count + 1, last_sent_at = $2 WHERE id = $1 AND status IN ('pending', 'expired')", [id, now.toISOString()]));
      if (r.affectedRows === 0) throw new RepoError("check", "invitation cannot be resent");
    },
    async revoke(id, by, now) {
      await q("UPDATE platform.invitation_links SET revoked_at = $2, revoke_reason = 'cancelled' WHERE invitation_id = $1 AND used_at IS NULL AND revoked_at IS NULL", [id, now.toISOString()]);
      const r = await guard(q("UPDATE platform.invitations SET status = 'revoked', revoked_at = $2, revoked_by = $3 WHERE id = $1 AND status IN ('pending', 'expired')", [id, now.toISOString(), by]));
      if (r.affectedRows === 0) throw new RepoError("check", "invitation cannot be cancelled");
    },
    async byTokenHash(hash) {
      const l = await q("SELECT id, invitation_id, expires_at, used_at, revoked_at, revoke_reason FROM platform.invitation_links WHERE token_hash = $1", [hash]);
      const x = l.rows[0];
      if (!x) return null;
      const inv = await q(`${INVITATION_SELECT} WHERE i.id = $1::uuid`, [String(x.invitation_id)]);
      if (!inv.rows[0]) return null;
      const link: LinkRow = {
        id: String(x.id), invitationId: String(x.invitation_id), expiresAt: asDate(x.expires_at) as Date, usedAt: asDate(x.used_at), revokedAt: asDate(x.revoked_at),
        revokeReason: (asText(x.revoke_reason) as LinkRow["revokeReason"]) ?? null,
      };
      return { invitation: invitationOf(inv.rows[0]), link };
    },
    async markOpened(id, now) {
      return (await q("UPDATE platform.invitations SET opened_at = $2 WHERE id = $1 AND opened_at IS NULL AND status = 'pending'", [id, now.toISOString()])).affectedRows > 0;
    },
  };
}

export function pgOnboardingRepo(db: SqlClient): PlatformOnboardingRepo {
  const q = (text: string, params?: readonly unknown[]) => db.query(text, params);

  const roleId = async (key: string): Promise<string> => {
    const r = await q("SELECT id FROM platform.roles WHERE hotel_id IS NULL AND key = $1", [key]);
    if (!r.rows[0]) throw new RepoError("check", "no such built-in role");
    return String(r.rows[0].id);
  };

  /** The pending first account: it has the password hash chosen on the form and CANNOT sign in until approved (status pending_approval). */
  const insertPendingAdmin = async (a: { username: string; email: string; mobile: string; displayName: string; passwordHash: string }, accountRole: AccountRole, role: string, at: Date): Promise<string> => {
    return guard(
      createPerson(q, { username: a.username, email: a.email, mobile: a.mobile, display_name: a.displayName, password_hash: a.passwordHash, role_id: role, account_role: accountRole, status: "pending_approval", must_change_password: false, code_required: false, created_at: at.toISOString() }),
    );
  };

  const accept = async (invitationId: string, linkId: string, at: Date, groupId: string | null): Promise<void> => {
    const r = await guard(q("UPDATE platform.invitations SET status = 'accepted', submitted_at = $2, group_id = COALESCE($3::uuid, group_id) WHERE id = $1 AND status = 'pending'", [invitationId, at.toISOString(), groupId]));
    if (r.affectedRows === 0) throw new RepoError("unique", "invitation already used");
    const l = await guard(q("UPDATE platform.invitation_links SET used_at = $2 WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL", [linkId, at.toISOString()]));
    if (l.affectedRows === 0) throw new RepoError("unique", "link already used");
  };

  return {
    async submitHotel(s) {
      const h = s.hotel;
      const hotel = await guard(
        q(
          `INSERT INTO platform.hotels (name, slug, status, provisioned_at, address, city, state, pin, gstin, phone, email, logo_name, submitted_at)
           VALUES ($1, $2, 'pending_approval', NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [h.name, h.slug, h.address, h.city, h.state, h.pin, h.gstin, h.phone, h.email, h.logoName, s.at.toISOString()],
        ),
      );
      const hotelId = String(hotel.rows[0].id);
      const role = await roleId("super_admin");
      const userId = await insertPendingAdmin(s.admin, "hotel_admin", role, s.at);
      await guard(q("INSERT INTO platform.user_hotels (user_id, hotel_id, role_id, is_default) VALUES ($1, $2, $3, true)", [userId, hotelId, role]));
      if (s.groupId) await guard(q("INSERT INTO platform.group_members (group_id, hotel_id, created_at) VALUES ($1, $2, $3)", [s.groupId, hotelId, s.at.toISOString()]));
      await guard(
        q(
          `INSERT INTO platform.onboarding_submissions (invitation_id, kind, hotel_id, admin_user_id, payload, submitted_ip, submitted_user_agent, submitted_at)
           VALUES ($1, 'hotel', $2, $3, $4::jsonb, $5::inet, $6, $7)`,
          [s.invitationId, hotelId, userId, JSON.stringify(s.payload), s.ip, s.userAgent, s.at.toISOString()],
        ),
      );
      await accept(s.invitationId, s.linkId, s.at, null);
      return { hotelId, userId };
    },
    async submitGroup(s) {
      const g = s.group;
      const userId = await insertPendingAdmin(s.admin, "group_hotel_admin", await roleId("viewer"), s.at);
      const group = await guard(
        q(
          `INSERT INTO platform.hotel_groups (name, slug, status, legal_name, gstin, address, city, state, pin, phone, email, submitted_at, admin_user_id, created_at)
           VALUES ($1, $2, 'pending_approval', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $11) RETURNING id`,
          [g.name, g.slug, g.legalName, g.gstin, g.address, g.city, g.state, g.pin, g.phone, g.email, s.at.toISOString(), userId],
        ),
      );
      const groupId = String(group.rows[0].id);
      await guard(
        q(
          `INSERT INTO platform.onboarding_submissions (invitation_id, kind, group_id, admin_user_id, payload, submitted_ip, submitted_user_agent, submitted_at)
           VALUES ($1, 'group', $2, $3, $4::jsonb, $5::inet, $6, $7)`,
          [s.invitationId, groupId, userId, JSON.stringify(s.payload), s.ip, s.userAgent, s.at.toISOString()],
        ),
      );
      await accept(s.invitationId, s.linkId, s.at, groupId);
      return { groupId, userId };
    },
    async decide(subject, status, by, reason, now) {
      const column = "hotelId" in subject ? "hotel_id" : "group_id";
      const id = "hotelId" in subject ? subject.hotelId : subject.groupId;
      const r = await guard(
        q(`UPDATE platform.onboarding_submissions SET status = $2, decided_by = $3, decided_at = $4, decision_reason = $5 WHERE ${column} = $1 AND status = 'pending'`, [id, status, by, now.toISOString(), reason]),
      );
      if (r.affectedRows === 0) throw new RepoError("check", "no pending submission");
    },
    async pendingAccounts(subject) {
      if ("hotelId" in subject) {
        const r = await q("SELECT u.id FROM platform.people u JOIN platform.user_hotels uh ON uh.user_id = u.id WHERE uh.hotel_id = $1 AND u.status = 'pending_approval' AND u.deleted_at IS NULL ORDER BY u.created_at, u.id", [subject.hotelId]);
        return r.rows.map((x) => String(x.id));
      }
      const r = await q("SELECT u.id FROM platform.hotel_groups g JOIN platform.people u ON u.id = g.admin_user_id WHERE g.id = $1 AND u.status = 'pending_approval' AND u.deleted_at IS NULL", [subject.groupId]);
      return r.rows.map((x) => String(x.id));
    },
  };
}

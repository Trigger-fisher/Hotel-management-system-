import "server-only";
// Invitations and the onboarding form (docs/BACKEND.md 14.4, migrations 0104 and 0105). Platform tables only. A token is never stored: only its keyed
// hash (platform.invitation_links.token_hash), and no row this repository returns carries the token or a hash. The PostgreSQL implementation is
// repos/postgres/platformInvitations.ts; the in-memory double (repos/memory/platformInvitations.ts) is the reference for every rule.

export type InvitationType = "individual" | "group" | "member_hotel";
/** Stored status; the contract's words are derived (sent = pending and not opened, opened = pending and opened, expired = a pending one past its expiry). */
export type StoredInvitationStatus = "pending" | "accepted" | "expired" | "revoked";
export type InviterRole = "super_admin" | "platform_admin" | "group_hotel_admin";

export interface InvitationRow {
  id: string;
  type: InvitationType;
  /** The hotel's name, or the proposed GROUP name for type 'group'. */
  hotelName: string;
  contactName: string;
  email: string;
  groupId: string | null;
  groupName: string | null;
  status: StoredInvitationStatus;
  invitedBy: string;
  invitedByName: string;
  invitedByRole: InviterRole;
  resendCount: number;
  createdAt: Date;
  lastSentAt: Date;
  openedAt: Date | null;
  submittedAt: Date | null;
  revokedAt: Date | null;
  /** When the newest link stops working. */
  expiresAt: Date;
  /** The hotel the submitted form made (hotel types), or the group it made ('group'). */
  hotelId: string | null;
  madeGroupId: string | null;
}

export interface LinkRow {
  id: string;
  invitationId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  /** Why it was revoked: 'resent' (a newer link replaced it), 'cancelled', 'expired'. */
  revokeReason: "resent" | "cancelled" | "expired" | null;
}

interface NewInvitation {
  type: InvitationType;
  hotelName: string;
  contactName: string;
  /** Lower case. */
  email: string;
  groupId: string | null;
  invitedBy: string;
  invitedByRole: InviterRole;
}

export interface PlatformInvitationsRepo {
  /** Every invitation, newest first. */
  list(): Promise<InvitationRow[]>;
  get(id: string, options?: { forUpdate?: boolean }): Promise<InvitationRow | null>;
  /** Pending invitations whose live link is past its expiry become 'expired' (the link is revoked 'expired'); returns how many. Called before any send or resend. */
  expireDue(now: Date): Promise<number>;
  /** Another PENDING invitation with this e-mail, or with the same name of the same kind (type + group); `exceptId` is the invitation being resent. */
  clashes(f: { type: InvitationType; groupId: string | null; hotelName: string; email: string; exceptId: string | null }): Promise<{ email: boolean; name: boolean }>;
  /** The invitation and its first link, in one go; returns the id. A duplicate pending e-mail or name is RepoError("unique"). */
  create(f: NewInvitation, tokenHash: string, expiresAt: Date, now: Date): Promise<string>;
  /** Resend: the live link is revoked ('resent'), a new one is issued, resend_count + 1. */
  reissue(id: string, tokenHash: string, expiresAt: Date, by: string, now: Date): Promise<void>;
  /** Cancel: the invitation is 'revoked' and its live link revoked ('cancelled'). */
  revoke(id: string, by: string, now: Date): Promise<void>;
  /** The public page's lookup, by the keyed hash of the token. */
  byTokenHash(hash: string): Promise<{ invitation: InvitationRow; link: LinkRow } | null>;
  /** The first time the public page reads it: opened_at. Returns true when this call set it. */
  markOpened(id: string, now: Date): Promise<boolean>;
}

/* ---------------------------------------------------------------- onboarding */

/** The account the form creates: a pending first user (it cannot sign in until approved). */
export interface PendingAdmin {
  username: string;
  email: string;
  /** "+91" and ten digits. */
  mobile: string;
  displayName: string;
  /** Argon2id, made by the service from the password on the form; the password itself never reaches a repository. */
  passwordHash: string;
}

interface HotelSubmission {
  invitationId: string;
  linkId: string;
  hotel: { name: string; slug: string; address: string; city: string; state: string; pin: string; gstin: string; phone: string; email: string; logoName: string | null };
  admin: PendingAdmin;
  /** The form as sent, both password fields removed: {hotel, admin, contactName}. */
  payload: Record<string, unknown>;
  /** member_hotel: the group it joins at submit. */
  groupId: string | null;
  ip: string | null;
  userAgent: string | null;
  at: Date;
}

interface GroupSubmission {
  invitationId: string;
  linkId: string;
  group: { name: string; slug: string; legalName: string; gstin: string; address: string; city: string | null; state: string | null; pin: string | null; phone: string; email: string };
  admin: PendingAdmin;
  payload: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  at: Date;
}

export interface PlatformOnboardingRepo {
  /** One unit: the pending hotel (no schema yet), its pending first Hotel Admin, the submission, the invitation accepted, the link used (and the group link for a member hotel). */
  submitHotel(s: HotelSubmission): Promise<{ hotelId: string; userId: string }>;
  /** One unit: the pending group, its pending Group Hotel Admin, the submission, the invitation accepted and pointing at the group, the link used. */
  submitGroup(s: GroupSubmission): Promise<{ groupId: string; userId: string }>;
  /** The submission's review decision (who, when, why); once only. */
  decide(subject: { hotelId: string } | { groupId: string }, status: "approved" | "rejected", by: string, reason: string | null, now: Date): Promise<void>;
  /** The pending accounts that belong to a hotel or a group (for approve / reject): ids. */
  pendingAccounts(subject: { hotelId: string } | { groupId: string }): Promise<string[]>;
}

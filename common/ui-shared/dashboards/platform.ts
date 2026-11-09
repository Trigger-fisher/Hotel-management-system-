// Platform console (Platform Admin, then Super Admin): hotels, groups and the Hotel Admins of every hotel.
// Plan: docs/plans/PLAN-PLATFORM-CONSOLE.md (pages 1 to 7). Menu: nav.ts kind 'platform'.
// Pure TypeScript, mock only, no money. Timestamps ISO UTC; the seed is written for 5 Oct 2026 and moved to the real today.
// A temporary password is NEVER returned: calls answer with TEMP_PASSWORD_NOTE (the real server emails it).
// Every write appends an activity entry (the audit trail); Enter hotel / Exit hotel are recorded too.
// MJ's model (10 Oct): hotels are individual or in a group; a hotel joins by an invitation link (INVITATION_VALID_HOURS) and a public
// onboarding form, then waits for approval; "delete" = archive (data kept, sign-in blocked, restorable); removing a hotel
// from a group only unlinks it. Isolation: nothing here returns a hotel's business data (bills, guests, payroll), only
// platform metadata (hotel facts, accounts, invitations, audit, sign-ins). An onboarding password is checked, never kept.

import type { ListQuery, Page } from './common';
import type { MailboxState } from './conversations';
import type { MailLimitsInfo, MailProviderId, MailSecurity, MailServerInfo } from './mailProviders';
import type { createPlatformApi } from './platform.mock';

/** "Today" of the mock: the real IST date when this file loads (the seed moves with it, see SEED_SHIFT_MS). */
export const PLATFORM_MOCK_TODAY = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** What every call that creates a password answers with, in place of the password itself. */
export const TEMP_PASSWORD_NOTE = 'Temporary password sent by email (dev log)';

/** Time zones offered for a new hotel (Asia/Kolkata first and the default). */
export const PLATFORM_TIME_ZONES = ['Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dubai', 'Asia/Colombo'] as const;
export const PLATFORM_DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/** Indian states and union territories with their GST state code (first two digits of a GSTIN). */
export const PLATFORM_STATES: readonly { name: string; gstCode: string }[] = [
  { name: 'Andaman and Nicobar Islands', gstCode: '35' },
  { name: 'Andhra Pradesh', gstCode: '37' },
  { name: 'Arunachal Pradesh', gstCode: '12' },
  { name: 'Assam', gstCode: '18' },
  { name: 'Bihar', gstCode: '10' },
  { name: 'Chandigarh', gstCode: '04' },
  { name: 'Chhattisgarh', gstCode: '22' },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', gstCode: '26' },
  { name: 'Delhi', gstCode: '07' },
  { name: 'Goa', gstCode: '30' },
  { name: 'Gujarat', gstCode: '24' },
  { name: 'Haryana', gstCode: '06' },
  { name: 'Himachal Pradesh', gstCode: '02' },
  { name: 'Jammu and Kashmir', gstCode: '01' },
  { name: 'Jharkhand', gstCode: '20' },
  { name: 'Karnataka', gstCode: '29' },
  { name: 'Kerala', gstCode: '32' },
  { name: 'Ladakh', gstCode: '38' },
  { name: 'Lakshadweep', gstCode: '31' },
  { name: 'Madhya Pradesh', gstCode: '23' },
  { name: 'Maharashtra', gstCode: '27' },
  { name: 'Manipur', gstCode: '14' },
  { name: 'Meghalaya', gstCode: '17' },
  { name: 'Mizoram', gstCode: '15' },
  { name: 'Nagaland', gstCode: '13' },
  { name: 'Odisha', gstCode: '21' },
  { name: 'Puducherry', gstCode: '34' },
  { name: 'Punjab', gstCode: '03' },
  { name: 'Rajasthan', gstCode: '08' },
  { name: 'Sikkim', gstCode: '11' },
  { name: 'Tamil Nadu', gstCode: '33' },
  { name: 'Telangana', gstCode: '36' },
  { name: 'Tripura', gstCode: '16' },
  { name: 'Uttar Pradesh', gstCode: '09' },
  { name: 'Uttarakhand', gstCode: '05' },
  { name: 'West Bengal', gstCode: '19' },
];

/** Hotel addresses that can never be used (they clash with the app's own paths). */
export const RESERVED_SLUGS: readonly string[] = ['platform', 'admin', 'api', 'www', 'app', 'login', 'hotel', 'hotels', 'group', 'groups'];

/** What sendInvitation answers with, in place of the link itself (the real server emails it). */
export const INVITE_LINK_NOTE = 'Invitation link sent by email (dev log)';
/** What approveHotel answers with: the first admin is told by email that the hotel is live. */
export const APPROVAL_EMAIL_NOTE = 'Approval email sent (dev log)';
/** An invitation link works for this many hours after it is sent (or resent). 168 = 7 days (MJ may change it). */
export const INVITATION_VALID_HOURS = 168;
/** The same as plain words for the copy: "7 days" (or "N hours" when not whole days). */
export const INVITATION_VALID_TEXT = INVITATION_VALID_HOURS % 24 === 0
  ? `${INVITATION_VALID_HOURS / 24} ${(INVITATION_VALID_HOURS as number) === 24 ? 'day' : 'days'}`
  : `${INVITATION_VALID_HOURS} hours`;
const VT = INVITATION_VALID_TEXT;
/** Mock base address of the public onboarding page. */
export const PLATFORM_INVITE_BASE_URL = 'https://hms.example.in';

/** The onboarding link for a token. DEV ONLY: show it in the dev note, never in the normal UI (the real link travels by email). */
export function inviteLink(token: string, base: string = PLATFORM_INVITE_BASE_URL): string {
  return `${base.replace(/\/+$/, '')}/?invite=${encodeURIComponent(token)}`;
}

/** Seed tokens for testing the public onboarding page (getInvitationByToken / submitOnboarding). */
export const MOCK_INVITE_TOKENS = {
  /** individual, sent, not opened yet, valid (Hotel Kanha Retreat): the hotel form opens and the invitation turns "opened". */
  open: 'inv-open-7Kq2M9xR',
  /** member_hotel into Sunrise Group (sent by Kavita Desai), opened once, still valid (Sunrise Inn Vadodara): hotel form. */
  opened: 'inv-opened-4Wc6N2yJ',
  /** Same as `opened` (the member_hotel token). */
  memberOpen: 'inv-opened-4Wc6N2yJ',
  /** group, sent, valid (Heritage Stays Group): the GROUP form opens. */
  groupOpen: 'inv-group-6Rv3K8pD',
  /** individual, older than INVITATION_VALID_HOURS: "This link has expired". */
  expired: 'inv-expired-3Hd8P1wZ',
  /** member_hotel used by Marine Drive Residency (waits for approval): "already submitted". */
  submitted: 'inv-used-5Tn4C6vB',
  /** group used by Coastal Residencies Group (waits for approval): "already submitted". */
  groupSubmitted: 'inv-group-used-2Bx9Q4mH',
  /** individual, cancelled by the Platform Admin. */
  cancelled: 'inv-cancel-9Lm2F7sA',
} as const;

/** The group the mock Group Hotel Admin (Kavita Desai, username groupadmin) runs: Sunrise Group. */
export const MOCK_GROUPADMIN_GROUP_ID = 'g-1';

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// ---------------------------------------------------------------- types

/**
 * active / suspended: as before. pending_approval: the hotel sent the onboarding form, a Platform Admin must approve it.
 * rejected: the form was turned down (reason kept). archived: "deleted" = archived, sign-in blocked, data kept, restorable.
 */
export type PlatformHotelStatus = 'active' | 'suspended' | 'pending_approval' | 'rejected' | 'archived';
/** Derived from group membership: in a group = 'group', otherwise 'individual'. */
export type PlatformHotelKind = 'individual' | 'group';
/** pending = first admin of a hotel that waits for approval (cannot sign in yet). */
export type PlatformAdminStatus = 'active' | 'disabled' | 'locked' | 'pending';

export interface PlatformHotel {
  id: string;
  name: string;
  /** Web address part, e.g. "hotel-sunrise". Unique, lower case. */
  slug: string;
  city: string;
  state: string;
  gstin: string;
  timeZone: string;
  status: PlatformHotelStatus;
  groupId: string | null;
  groupName: string | null;
  /** Hotel Admin accounts (any status). */
  adminCount: number;
  /** Of those, locked out. */
  lockedAdminCount: number;
  createdAt: string;
  suspendedAt: string | null;
  /** Reason typed when it was suspended. */
  suspendReason: string | null;
  /** 'group' when in a group (groupId set), else 'individual'. */
  kind: PlatformHotelKind;
  /** When the onboarding form was sent (hotels that joined by invitation), else null. */
  submittedAt: string | null;
  /** The invitation it joined by, or null (created directly). */
  invitationId: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  /** Archived only: true while the ARCHIVE_GRACE_DAYS grace period runs (Restore allowed). Absent = not archived / unknown. */
  canRestore?: boolean;
  /** Archived only: the status Restore returns to (the one it had when archived). */
  restoresTo?: PlatformHotelStatus;
}

export interface PlatformHotelAdmin {
  id: string;
  hotelId: string;
  hotelName: string;
  name: string;
  username: string;
  email: string;
  /** 10 digits. */
  mobile: string;
  status: PlatformAdminStatus;
  /** null = never signed in. */
  lastSignInAt: string | null;
  /** Set while locked (too many wrong passwords). */
  lockedAt: string | null;
  createdAt: string;
  /** Group Hotel Admin of this group (see PlatformGroup.groupAdmin). */
  groupAdminOf: { groupId: string; groupName: string } | null;
}

export interface PlatformGstDefaults {
  /** GST on room charges, percent. */
  roomsPercent: number;
  /** GST on food and other services, percent. */
  foodPercent: number;
}

/** The Settings tab of Hotel details (read only in the console). */
export interface PlatformHotelSettings {
  gstin: string;
  /** GST state code (first two digits of the GSTIN). */
  stateCode: string;
  state: string;
  city: string;
  timeZone: string;
  gstDefaults: PlatformGstDefaults;
  /** Month the accounting year starts (4 = April). */
  accountingYearStartMonth: number;
}

export type PlatformActivityAction =
  | 'hotel_created' | 'hotel_suspended' | 'hotel_reactivated'
  | 'hotel_entered' | 'hotel_exited' | 'hotel_visit_extended' | 'platform_admin_access_changed'
  | 'admin_created' | 'admin_password_reset' | 'admin_unlocked' | 'admin_disabled' | 'admin_enabled' | 'admin_locked'
  | 'group_created' | 'group_hotel_added' | 'group_hotel_removed' | 'group_admin_set' | 'group_admin_cleared'
  | 'hotel_submitted' | 'hotel_approved' | 'hotel_rejected' | 'hotel_archived' | 'hotel_restored'
  | 'group_submitted' | 'group_approved' | 'group_rejected'
  | 'invitation_sent' | 'invitation_resent' | 'invitation_opened' | 'invitation_cancelled'
  | 'user_disabled' | 'user_enabled' | 'user_password_reset' | 'user_unlocked'
  // Super Admin extras part 2 (A8): platform staff, health check, platform settings, export and permanent delete.
  | 'staff_created' | 'health_checked' | 'settings_updated' | 'hotel_exported' | 'hotel_deleted'
  // Announcements to the hotels (P4).
  | 'announcement_created' | 'announcement_ended'
  // The audit log's CSV export is itself an audit entry (real server).
  | 'audit_exported'
  // A write the server refused while platform staff were inside a hotel (read-only visit).
  | 'hotel_write_refused' | 'hotel_write_started' | 'hotel_write'
  // API access keys (Platform settings > API access, platform migration 0129): made, revoked, the full-access switch, and what a key did ("API token: <name>").
  | 'api_token_created' | 'api_token_revoked' | 'api_token_full_access' | 'api_token_write' | 'api_token_refused' | 'api_token_new_ip'
  | 'mail_suppressed' | 'mail_unsuppressed' | 'mail_hold' | 'mail_hold_released'
  // The one common guest / company profile (platform 0132): the Super Admin's decisions in Possible duplicates (profileReview.ts).
  | 'profile_merged' | 'profile_kept_apart' | 'profile_kept_apart_undone'
  // The hotel vault (platform 0168): the Super Admin's adds, changes, Shows and removals (vault.ts).
  | 'vault_item_added' | 'vault_item_changed' | 'vault_item_revealed' | 'vault_item_removed'
  // My vault (platform 0190): a Super Admin's own items; the row names the type and the item id, never the name or the secret.
  | 'personal_vault_item_added' | 'personal_vault_item_changed' | 'personal_vault_item_revealed' | 'personal_vault_item_removed'
  // A website demo request marked contacted, closed or new again (platform 0169).
  | 'demo_request_updated'
  // The Central tabs (MJ, 3 Nov 2026): a guest's or company's full mobile or email shown with Reveal (central.ts). Who, which profile, when; never the value.
  | 'central_revealed'
  // The Central tabs' writes (Super Admin): a login, guest profile, company profile or GST record made, changed, deleted (hidden) or restored. Field NAMES only, never a value.
  | 'central_created' | 'central_updated' | 'central_deleted' | 'central_restored';

export interface PlatformActivity {
  id: string;
  at: string;
  /** Who did it ("System" for automatic lockouts). */
  actorName: string;
  action: PlatformActivityAction;
  hotelId: string | null;
  hotelName: string | null;
  groupId: string | null;
  groupName: string | null;
  adminId: string | null;
  /** One plain sentence, ready to show. */
  text: string;
}

export interface PlatformHotelDetail {
  hotel: PlatformHotel;
  admins: PlatformHotelAdmin[];
  settings: PlatformHotelSettings;
  /** Newest first. */
  activity: PlatformActivity[];
  /** What the hotel typed in the onboarding form (hotels that joined by invitation), else null. Never a password. */
  onboarding: PlatformOnboardingSummary | null;
}

export interface PlatformOnboardingSummary {
  invitationId: string;
  contactName: string;
  address: string;
  city: string;
  state: string;
  pin: string;
  gstin: string;
  phone: string;
  email: string;
  logoName: string | null;
  submittedAt: string;
  adminName: string;
  adminUsername: string;
  adminEmail: string;
  adminMobile: string;
  // The optional "More about your hotel" answers (review L14); null = not given.
  legalName?: string | null;
  tradeName?: string | null;
  gstType?: 'regular' | 'composition' | null;
  roomCount?: number | null;
  /** "HH:mm" (24 h). */
  checkInTime?: string | null;
  checkOutTime?: string | null;
}

/** The optional "More about your hotel" answers as [label, value] rows, only those given (for the approval panel). */
export function onboardingMoreRows(o: PlatformOnboardingSummary): [string, string][] {
  const MF = platformCopy.onboardingMore.fields;
  const rows: [string, string | null | undefined][] = [
    [MF.legalName, o.legalName],
    [MF.tradeName, o.tradeName],
    [MF.gstType, o.gstType ? platformCopy.onboardingMore.gstTypes[o.gstType] : null],
    [MF.roomCount, o.roomCount ? String(o.roomCount) : null],
    [MF.checkInTime, o.checkInTime],
    [MF.checkOutTime, o.checkOutTime],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

/** pending_approval: a 'group' invitation's form was sent and waits for a Platform / Super Admin. */
export type PlatformGroupStatus = 'pending_approval' | 'active' | 'rejected';

export interface PlatformGroup {
  id: string;
  name: string;
  hotelIds: string[];
  hotelCount: number;
  /**
   * The Group Hotel Admin, or nobody yet. Either a group-level account (from a 'group' invitation, e.g. Kavita Desai of
   * Sunrise Group: adminId is her user id "u-…", hotelName '') or a Hotel Admin of a member hotel set with setGroupAdmin.
   */
  groupAdmin: { adminId: string; name: string; username: string; hotelName: string } | null;
  createdAt: string;
  status: PlatformGroupStatus;
  /** Group facts from the onboarding form (null for groups created in the console). */
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pin: string | null;
  phone: string | null;
  email: string | null;
  invitationId: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  /** The most hotels the group may have (waiting, active and suspended ones count); null = no limit. Set by the Super Admin or Platform Admin (setGroupMaxHotels). */
  maxHotels: number | null;
}

export interface PlatformGroupDetail {
  group: PlatformGroup;
  hotels: PlatformHotel[];
  /** Hotels in no group, for "Add hotel". */
  availableHotels: PlatformHotel[];
  /** Active Hotel Admins of the member hotels, for "Set group admin". */
  adminChoices: PlatformHotelAdmin[];
  /** Newest first. */
  activity: PlatformActivity[];
}

export type PlatformAttentionKind = 'locked_account' | 'no_admin' | 'suspended' | 'pending_approval' | 'pending_group';

export interface PlatformAttentionItem {
  /** Stable key for lists. */
  id: string;
  kind: PlatformAttentionKind;
  /** '' for kind 'pending_group' (see groupId). */
  hotelId: string;
  /** For kind 'pending_group': the group's name. */
  hotelName: string;
  /** Set for kind 'pending_group' (and for hotels in a group), else null. */
  groupId: string | null;
  groupName: string | null;
  adminId: string | null;
  adminName: string | null;
  /** One plain sentence, ready to show. */
  text: string;
  /** When it started (locked at, suspended at, hotel created). */
  since: string;
}

export interface PlatformOverview {
  /** The newest hotels invited by a group's primary admin (approved at once on their form, no Super Admin approval), each with its sentence "Created hotel X. Created by group G (group admin P)." (up to 5). */
  groupCreatedHotels: PlatformActivity[];
  tiles: {
    hotelsActive: number;
    hotelsSuspended: number;
    groups: number;
    /** Hotel Admin accounts, any status. */
    hotelAdmins: number;
    lockedAccounts: number;
    /** Hotels created in the current month, archived ones left out (the same hotels as the Hotels list's All tab for that month). */
    createdThisMonth: number;
    /** Hotels AND groups that sent the onboarding form and wait for approval. */
    pendingApproval: number;
    /** Of those, hotels (Hotels list, Pending review tab). */
    pendingHotels?: number;
    /** Of those, groups (Groups list). */
    pendingGroups?: number;
    /** Every group the Groups list shows (active, waiting, rejected). */
    groupsListed?: number;
    /** Of those, group invitations still waiting for their admin (sent, opened or expired link): the Groups list's "Waiting for its admin" tab. */
    groupsWaiting?: number;
    /** Of those, rejected groups. */
    groupsRejected?: number;
    /** Invitations sent or opened, not expired yet. */
    invitationsOpen: number;
  };
  /** Newest 5. */
  recentHotels: PlatformHotel[];
  needsAttention: PlatformAttentionItem[];
}

export interface PlatformHotelQuery extends Pick<ListQuery, 'search' | 'page' | 'pageSize'> {
  /** 'all' = every hotel EXCEPT archived ones (those only under 'archived'). */
  status?: 'all' | PlatformHotelStatus;
  /** Only member hotels of this group (the Group console passes its own group). */
  groupId?: string;
  kind?: 'all' | PlatformHotelKind;
  /** 'YYYY-MM': only hotels created in that month (the dashboard's "New this month" tile). */
  createdMonth?: string;
}

export interface PlatformAdminQuery extends Pick<ListQuery, 'search' | 'page' | 'pageSize'> {
  status?: 'all' | PlatformAdminStatus;
  hotelId?: string;
  /** Only admins of this group's member hotels (Group console). */
  groupId?: string;
  /** true: only admins of live hotels (active or suspended), as the dashboard's Hotel admins tile counts. Default (absent): every hotel. */
  liveOnly?: boolean;
  /** true: also admins of archived, rejected and waiting hotels, even with liveOnly ("Include archived hotels"). */
  includeArchived?: boolean;
}

/** counts.all leaves out archived hotels (see counts.archived). kindCounts follow the same status filter as the rows. */
export type PlatformHotelPage = Page<PlatformHotel> & {
  counts: { all: number; active: number; suspended: number; pending_approval: number; rejected: number; archived: number };
  kindCounts: { all: number; individual: number; group: number };
};
export type PlatformAdminPage = Page<PlatformHotelAdmin> & { counts: { all: number; active: number; disabled: number; locked: number; pending: number } };

export interface PlatformAdminInput {
  name: string;
  username: string;
  email: string;
  mobile: string;
}

export interface PlatformAdminCreated {
  admin: PlatformHotelAdmin;
  tempPasswordNote: string;
}

export interface PlatformPasswordReset {
  admin: PlatformHotelAdmin;
  /** Toast sentence, e.g. "A temporary password was sent to nisha@hotelsunrise.in." */
  message: string;
  tempPasswordNote: string;
}

export interface PlatformGroupInput {
  name: string;
  /** Hotels to add at once (each must be in no group). */
  hotelIds?: string[];
}

export interface PlatformEnterResult {
  ok: true;
  hotel: { id: string; name: string; slug: string; status: PlatformHotelStatus };
  /** Real server only (the mock leaves them out): the audit row of the visit, the visit id, when the 60-minute visit ends (ISO) and that hotel routes are read-only during it. */
  auditId?: string;
  visitId?: string;
  expiresAt?: string;
  /** false only for a FULL visit (see `access`): the hotel's screens then save, within the visit's deny list. */
  readOnly?: boolean;
  /**
   * What the visit allows (platform 0135), fixed for the whole visit: 'view' = read only (group admins always; platform admins the Super Admin gave view);
   * 'full' = the hotel's screens work as for its Super Admin, EXCEPT payments, saved secrets, backups and exports, salary records and letters, deleting the hotel,
   * and (Super Admin) the hotel's own owner account and its role / (platform admin) every account and role. A refused write answers 403 FORBIDDEN with the reason.
   * Absent = 'view'. The banner shows it ("Viewing" / "Full access") with the time left and "Extend 60 minutes" (extendHotelVisit).
   */
  access?: PlatformVisitAccess;
}

export type PlatformVisitAccess = 'view' | 'full';

/**
 * What a platform admin may do when entering hotels (platform 0135), set by the Super Admin on the Platform staff page.
 * level 'none' = may not enter hotels; 'view' (the default) = read only; 'full' = full visits. allHotels false = only `hotelIds`.
 */
export interface PlatformAdminHotelAccess {
  userId: string;
  level: 'none' | PlatformVisitAccess;
  allHotels: boolean;
  /** Used only when allHotels is false. */
  hotelIds: string[];
  /** The Super Admin's note, null when none. */
  reason: string | null;
  /** Who changed it last and when; null for an account never changed (the default: view, all hotels). */
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface PlatformAdminHotelAccessInput {
  level: 'none' | PlatformVisitAccess;
  allHotels: boolean;
  /** Required (at least one) when allHotels is false; every id an existing hotel. */
  hotelIds?: string[];
  /** 5 to 500 characters (VALIDATION_FAILED field reason): written into the audit row. */
  reason: string;
}

/** Answer of approveGroup / rejectGroup. */
export interface PlatformGroupChange {
  group: PlatformGroup;
  message: string;
  note: string | null;
}

/** Answer of approveHotel / rejectHotel / archiveHotel / restoreHotel. */
export interface PlatformHotelChange {
  hotel: PlatformHotel;
  /** Toast sentence. */
  message: string;
  /** Extra line (e.g. APPROVAL_EMAIL_NOTE, or "Nobody can sign in"), or null. */
  note: string | null;
}

// ---- invitations

/** 'expired' is derived: sent or opened, and older than INVITATION_VALID_HOURS. */
export type PlatformInvitationStatus = 'sent' | 'opened' | 'submitted' | 'expired' | 'cancelled';
/** Who may invite: Platform / Super Admin ('individual' and 'group'), Group Hotel Admin ('member_hotel' into its own group only). */
export type PlatformInviterRole = 'super_admin' | 'platform_admin' | 'group_admin';
/**
 * individual: one hotel, sent by Platform / Super Admin. group: a new group and its future Group Hotel Admin, sent by
 * Platform / Super Admin. member_hotel: a hotel into a group, sent ONLY by that group's admin. Platform / Super Admin never
 * invite a hotel into a group. Every submitted form (all three types) is approved by a Platform / Super Admin.
 */
export type PlatformInvitationType = 'individual' | 'group' | 'member_hotel';

export interface PlatformInvitation {
  id: string;
  // No link token here (review M5): lists never carry it. Dev-only: PlatformInvitationSent.devToken and listDevLinks().
  /** The hotel's name (individual, member_hotel) or the proposed GROUP name (group). */
  hotelName: string;
  /** The person invited (becomes the first Hotel Admin, or the Group Hotel Admin for 'group'). */
  contactName: string;
  email: string;
  /** member_hotel: the group it joins. group: null until approved, then the new group's id. individual: null. */
  groupId: string | null;
  groupName: string | null;
  type: PlatformInvitationType;
  status: PlatformInvitationStatus;
  createdAt: string;
  /** createdAt (or the last resend) + INVITATION_VALID_HOURS. */
  expiresAt: string;
  openedAt: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  /** Name of who sent it (same as invitedByName). */
  sentBy: string;
  invitedByName: string;
  invitedByRole: PlatformInviterRole;
  resendCount: number;
  /** The hotel created by the onboarding form (hotel types, after submit), else null. */
  hotelId: string | null;
}

export interface PlatformInvitationQuery extends Pick<ListQuery, 'search' | 'page' | 'pageSize'> {
  /** 'pending' = sent or opened (shown as "Pending"; A3 Invitations screen). */
  status?: 'all' | 'pending' | PlatformInvitationStatus;
  /** Only invitations into this group (Group console). */
  groupId?: string;
  type?: 'all' | PlatformInvitationType;
}

export type PlatformInvitationPage = Page<PlatformInvitation> & { counts: Record<'all' | 'pending' | PlatformInvitationStatus, number> };

/**
 * VALIDATION_FAILED fields: hotelName, contactName, email, groupId.
 * type defaults to 'member_hotel' for a group_admin actor, else 'individual'. A wrong type for the actor answers CONFLICT.
 */
export interface PlatformInvitationInput {
  type?: PlatformInvitationType;
  /** Hotel name, or the proposed group name for type 'group'. */
  hotelName: string;
  contactName: string;
  email: string;
  /** Platform / Super Admin: must be empty (field error). Group admin: its own group is used; another group answers CONFLICT. */
  groupId?: string | null;
}

export interface PlatformInvitationSent {
  invitation: PlatformInvitation;
  /** Always INVITE_LINK_NOTE. */
  linkNote: string;
  /** MOCK / DEV ONLY: the new link's token, for the dev note (inviteLink). The real server never sends it (the link goes by email). */
  devToken?: string;
}

/** MOCK / DEV ONLY (listDevLinks): the link token of each open invitation, for the "Copy link (dev)" / "Open form here (dev)" buttons. */
export interface PlatformInvitationDevLink {
  id: string;
  token: string;
}

/** Public onboarding page (no sign-in). */
export interface PlatformPublicInvitation {
  /** Which form to show: 'group' = group form (kind 'group'), otherwise the hotel form (kind 'hotel'). */
  type: PlatformInvitationType;
  /** hotelName = the proposed group name for type 'group'; groupName = the group a member_hotel joins. */
  invitation: { hotelName: string; contactName: string; email: string; groupName: string | null };
  status: PlatformInvitationStatus;
  expiresAt: string;
}

/** details.serverCode of a refused token: NOT_FOUND (code NOT_FOUND) or EXPIRED / ALREADY_SUBMITTED / CANCELLED (code CONFLICT). */
export type PlatformInviteProblem = 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_SUBMITTED' | 'CANCELLED';

export interface PlatformOnboardingHotelInput {
  name: string;
  address: string;
  city: string;
  state: string;
  /** 6 digits. */
  pin: string;
  gstin: string;
  phone: string;
  email: string;
  /** File name of the chosen logo (png, jpg, svg, webp), or null. */
  logoName: string | null;
  // Optional "More about your hotel" (A3): never required and never refused; can also be filled in later inside the hotel.
  legalName?: string;
  tradeName?: string;
  /** '' = not said. */
  gstType?: 'regular' | 'composition' | '';
  roomCount?: number | null;
  /** "HH:mm" (24 h). */
  checkInTime?: string;
  checkOutTime?: string;
}

export interface PlatformOnboardingAdminInput {
  name: string;
  username: string;
  email: string;
  mobile: string;
  /** 8 to 128 characters with an uppercase letter, a lowercase letter, a number and a special character (server rule). Checked, never stored or returned. */
  password: string;
  passwordConfirm: string;
}

export interface PlatformOnboardingGroupInput {
  /** Group name as people know it. */
  name: string;
  /** Registered company name. */
  legalName: string;
  gstin: string;
  address: string;
  city?: string;
  /** When given, the GSTIN must match it. */
  state?: string;
  pin?: string;
  phone: string;
  email: string;
}

/** Hotel form (invitation types individual and member_hotel). VALIDATION_FAILED fields: "hotel.name|address|city|state|pin|gstin|phone|email|logoName", "admin.*". */
export interface PlatformOnboardingHotelForm {
  kind: 'hotel';
  hotel: PlatformOnboardingHotelInput;
  admin: PlatformOnboardingAdminInput;
}

/** Group form (invitation type group). VALIDATION_FAILED fields: "group.name|legalName|gstin|address|city|state|pin|phone|email", "admin.*". */
export interface PlatformOnboardingGroupForm {
  kind: 'group';
  group: PlatformOnboardingGroupInput;
  admin: PlatformOnboardingAdminInput;
}

/** admin.* keys: name, username, email, mobile, password, passwordConfirm. */
export type PlatformOnboardingForm = PlatformOnboardingHotelForm | PlatformOnboardingGroupForm;

export interface PlatformOnboardingResult {
  kind: 'hotel' | 'group';
  /** Hotel forms: the new hotel (status pending_approval). Group forms: null. */
  hotel: { id: string; name: string; city: string; state: string; groupName: string | null; status: PlatformHotelStatus } | null;
  /** Group forms: the new group (status pending_approval). Hotel forms: null. */
  group: { id: string; name: string; status: PlatformGroupStatus } | null;
  /** "Waiting for approval". */
  message: string;
}

// ---- users (every level; Super Admin)

export type PlatformUserLevel = 'super_admin' | 'platform_admin' | 'group_admin' | 'hotel_admin' | 'hotel_user';
export type PlatformUserStatus = 'active' | 'disabled' | 'locked' | 'pending';

export interface PlatformUser {
  /** Hotel Admins (and the Group Hotel Admin) keep their admin id ("a-…"), so it matches listHotelAdmins. */
  id: string;
  name: string;
  username: string;
  email: string;
  mobile: string;
  level: PlatformUserLevel;
  hotelId: string | null;
  hotelName: string | null;
  groupId: string | null;
  groupName: string | null;
  status: PlatformUserStatus;
  lastSignInAt: string | null;
  lockedAt: string | null;
  createdAt: string;
}

export interface PlatformUserQuery extends Pick<ListQuery, 'search' | 'page' | 'pageSize'> {
  level?: 'all' | PlatformUserLevel;
  status?: 'all' | PlatformUserStatus;
  hotelId?: string;
  groupId?: string;
}

/** counts.levels follow the status filter; counts.statuses follow the level filter (both follow search / hotel / group). */
export type PlatformUserPage = Page<PlatformUser> & {
  counts: { levels: Record<'all' | PlatformUserLevel, number>; statuses: Record<'all' | PlatformUserStatus, number> };
};

export interface PlatformUserReset {
  user: PlatformUser;
  message: string;
  tempPasswordNote: string;
}

// ---- audit log and sign-in history (Super Admin)

export interface PlatformAuditEntry {
  id: string;
  at: string;
  actorName: string;
  action: PlatformActivityAction;
  /** platformCopy.audit.actions[action]. */
  actionLabel: string;
  /** What it was done to (admin, user, invitation's hotel, hotel or group name). */
  target: string;
  hotelId: string | null;
  hotelName: string | null;
  groupId: string | null;
  groupName: string | null;
  text: string;
  /** The actor's level (RESEARCH MUST 6); null for "System" and for an invited person filling a form. */
  actorRole: PlatformUserLevel | null;
  /** Platform staff did it while inside the hotel (between Enter hotel and leaving it, both included). */
  insideHotel: boolean;
  /** 'failed' = the API refused it (the refusal is audited too). */
  result: PlatformAuditResult;
  /** The reason given (suspend, reject, archive) or why it was refused; null when none. */
  reason: string | null;
  /** '' for System. */
  ip: string;
  /** Browser and device, e.g. "Chrome on Windows"; '' for System. */
  browser: string;
}

export type PlatformAuditResult = 'success' | 'failed';

export interface PlatformAuditQuery extends Pick<ListQuery, 'search' | 'from' | 'to' | 'page' | 'pageSize'> {
  action?: 'all' | PlatformActivityAction;
  hotelId?: string;
  /** Exact actor name (from PlatformAuditPage.actors). */
  actor?: string;
}

/** actors: every actor name in the log, for the filter. from / to are IST dates (YYYY-MM-DD, inclusive). */
export type PlatformAuditPage = Page<PlatformAuditEntry> & { actors: string[] };

export type PlatformSignInResult = 'success' | 'failed' | 'locked';

export interface PlatformSignIn {
  id: string;
  at: string;
  username: string;
  /** null when the username matches nobody. */
  name: string | null;
  level: PlatformUserLevel | null;
  hotelName: string | null;
  result: PlatformSignInResult;
  /** Why it failed (plain sentence), null on success. */
  reason: string | null;
  ip: string;
  device: string;
}

export interface PlatformSignInQuery extends Pick<ListQuery, 'search' | 'page' | 'pageSize'> {
  result?: 'all' | PlatformSignInResult;
}

export type PlatformSignInPage = Page<PlatformSignIn> & { counts: Record<'all' | PlatformSignInResult, number> };

/** setActor: who is signed in. role defaults to 'platform_admin'; a group_admin's groupId defaults to MOCK_GROUPADMIN_GROUP_ID. */
export interface PlatformActor {
  name: string;
  role?: PlatformInviterRole;
  groupId?: string | null;
}

// ---------------------------------------------------------------- helpers

/** Web address from a hotel name: "Hotel Sunrise" -> "hotel-sunrise". */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function gstCodeOfState(state: string): string | null {
  return PLATFORM_STATES.find((s) => s.name.toLowerCase() === state.trim().toLowerCase())?.gstCode ?? null;
}

/** The state a GSTIN belongs to, from its first two digits ("24..." -> "Gujarat"), or null. */
export function stateOfGstin(gstin: string): string | null {
  const code = gstin.trim().slice(0, 2);
  return PLATFORM_STATES.find((s) => s.gstCode === code)?.name ?? null;
}

/** The GSTIN's shape (15 characters, a known state code); the same check the mock server makes. */
export function gstinShapeOk(gstin: string): boolean {
  const g = gstin.trim().toUpperCase();
  return GSTIN_RE.test(g) && stateOfGstin(g) !== null;
}

export function blankAdmin(): PlatformAdminInput {
  return { name: '', username: '', email: '', mobile: '' };
}

export function blankInvitation(): PlatformInvitationInput {
  return { hotelName: '', contactName: '', email: '', groupId: null };
}

/** Empty hotel form (invitation types individual and member_hotel). */
export function blankOnboarding(): PlatformOnboardingHotelForm {
  return {
    kind: 'hotel',
    hotel: { name: '', address: '', city: '', state: '', pin: '', gstin: '', phone: '', email: '', logoName: null },
    admin: { name: '', username: '', email: '', mobile: '', password: '', passwordConfirm: '' },
  };
}

/** Empty group form (invitation type group). */
export function blankGroupOnboarding(): PlatformOnboardingGroupForm {
  return {
    kind: 'group',
    group: { name: '', legalName: '', gstin: '', address: '', city: '', state: '', pin: '', phone: '', email: '' },
    admin: { name: '', username: '', email: '', mobile: '', password: '', passwordConfirm: '' },
  };
}

/** Password rule of the onboarding form = the server rule (MASTER 4.2): 8 to 128 characters with an uppercase letter, a lowercase letter, a number and a special character. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const passwordChecks = (pw: string) => ({
  length: pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX,
  upper: /[A-Z]/.test(pw),
  lower: /[a-z]/.test(pw),
  number: /\d/.test(pw),
  special: /[^A-Za-z0-9]/.test(pw),
});
export function passwordProblem(pw: string): string | null {
  if (!pw) return platformCopy.errors.required.password;
  const c = passwordChecks(pw);
  if (!c.length || !c.upper || !c.lower || !c.number || !c.special) return platformCopy.errors.passwordRule;
  return null;
}

/** 10-digit Indian mobile from what was typed ("+91 98240 12345" -> "9824012345"), or null. */
export function normaliseMobile(raw: string): string | null {
  let d = raw.replace(/\D+/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

// ---------------------------------------------------------------- copy

export const platformCopy = {
  status: {
    hotel: { active: 'Active', suspended: 'Suspended', pending_approval: 'Pending review', rejected: 'Rejected', archived: 'Archived' } as Record<PlatformHotelStatus, string>,
    admin: { active: 'Active', disabled: 'Disabled', locked: 'Locked', pending: 'Waiting for approval' } as Record<PlatformAdminStatus, string>,
    kind: { individual: 'Individual', group: 'Group hotel' } as Record<PlatformHotelKind, string>,
    invitation: { sent: 'Sent', opened: 'Opened', submitted: 'Submitted', expired: 'Expired', cancelled: 'Cancelled' } as Record<PlatformInvitationStatus, string>,
    invitationType: { individual: 'Individual hotel', group: 'Group (admin)', member_hotel: 'Hotel into group' } as Record<PlatformInvitationType, string>,
    group: { pending_approval: 'Pending review', active: 'Active', rejected: 'Rejected' } as Record<PlatformGroupStatus, string>,
    inviterRole: { super_admin: 'Super Admin', platform_admin: 'Platform Admin', group_admin: 'Group Hotel Admin' } as Record<PlatformInviterRole, string>,
    user: { active: 'Active', disabled: 'Disabled', locked: 'Locked', pending: 'Waiting for approval' } as Record<PlatformUserStatus, string>,
    level: { super_admin: 'Super Admin', platform_admin: 'Platform Admin', group_admin: 'Group Hotel Admin', hotel_admin: 'Hotel Admin', hotel_user: 'Hotel User' } as Record<PlatformUserLevel, string>,
    signIn: { success: 'Signed in', failed: 'Failed', locked: 'Locked out' } as Record<PlatformSignInResult, string>,
  },
  overview: {
    subtitle: 'All hotels on the platform at a glance.',
    tiles: {
      hotelsActive: 'Active hotels',
      hotelsSuspended: 'Suspended',
      groups: 'Groups',
      hotelAdmins: 'Hotel admins',
      lockedAccounts: 'Locked accounts',
      createdThisMonth: 'New this month',
      pendingApproval: 'Pending review',
      invitationsOpen: 'Open invitations',
    },
    tileHints: {
      hotelsActive: 'Open for business',
      hotelsSuspended: 'Nobody can sign in',
      groups: 'Hotels run together',
      hotelAdmins: 'Across all hotels',
      lockedAccounts: 'Too many wrong passwords',
      createdThisMonth: 'Hotels created',
      pendingApproval: 'Onboarding forms to review',
      invitationsOpen: 'Sent or opened, not used yet',
    },
    recentTitle: 'Recent hotels',
    recentEmpty: 'No hotels yet. Create the first one.',
    viewAll: 'View all',
    attentionTitle: 'Needs attention',
    attentionEmpty: 'All clear. Nothing needs your attention.',
    attentionAction: { locked_account: 'Unlock', no_admin: 'Add admin', suspended: 'Open', pending_approval: 'Review', pending_group: 'Review' } as Record<PlatformAttentionKind, string>,
    inviteHotel: 'Invite hotel',
    newHotel: 'New hotel',
    /** Recent hotels row: "Rajkot · Sunrise Hospitality Group". */
    recentDetail: (city: string, group: string) => `${city} · ${group}`,
    createdOn: (date: string) => `Created ${date}`,
  },
  attention: {
    locked: (admin: string, hotel: string) => `${admin} (${hotel}) is locked out after too many wrong passwords.`,
    noAdmin: (hotel: string) => `${hotel} has no Hotel Admin yet.`,
    suspended: (hotel: string) => `${hotel} is suspended.`,
    pendingApproval: (hotel: string) => `${hotel} sent its onboarding form and waits for approval.`,
    pendingGroup: (group: string, admin: string) => `${group} (group admin ${admin}) sent its onboarding form and waits for approval.`,
  },
  hotels: {
    subtitle: 'Every hotel on the platform.',
    searchPlaceholder: 'Search name, address, city, GSTIN',
    newHotel: 'New hotel',
    tabs: { all: 'All', active: 'Active', suspended: 'Suspended', pending_approval: 'Pending review', rejected: 'Rejected', archived: 'Archived' },
    columns: { name: 'Hotel', slug: 'Web address', city: 'City', group: 'Group', status: 'Status', admins: 'Admins', created: 'Created', actions: 'Actions' },
    kindColumn: 'Type',
    kindTabs: { all: 'All types', individual: 'Individual', group: 'Group hotels' },
    kindTabsLabel: 'Hotel type',
    inviteHotel: 'Invite hotel',
    allNote: 'All leaves out archived hotels. Open the Archived tab to see them.',
    noGroup: 'No group',
    enter: 'Enter hotel',
    details: 'Details',
    empty: { title: 'No hotels yet', body: 'Create the first hotel and its Hotel Admin.' },
    noMatch: { title: 'No hotels match your search', body: 'Try part of the name, the address, the city or the GSTIN.' },
    searchLabel: 'Search hotels',
    snoColumn: 'S.No.',
    tabsLabel: 'Hotel status',
    clearFilters: 'Clear filters',
    lockedCount: (n: number) => `${n} locked`,
    enterTitle: (hotel: string) => `Enter ${hotel}`,
    detailsTitle: (hotel: string) => `Details of ${hotel}`,
  },
  newHotel: {
    steps: ['Hotel', 'First Hotel Admin', 'Review'],
    stepHints: [
      'The hotel and where it is.',
      'The person who runs this hotel. A temporary password is sent to this email.',
      'Check the details, then create the hotel.',
    ],
    fields: {
      name: 'Hotel name',
      slug: 'Web address',
      city: 'City',
      state: 'State',
      gstin: 'GSTIN',
      timeZone: 'Time zone',
      adminName: 'Full name',
      username: 'Username',
      email: 'Email',
      mobile: 'Mobile',
    },
    hints: {
      slug: 'Made from the name. Small letters, numbers and dashes only.',
      gstin: '15 characters, like 24ABCDE1234F1Z5.',
      username: 'Small letters, numbers, dot or underscore. Used to sign in.',
      mobile: '10 digits.',
    },
    slugChecking: 'Checking…',
    slugFree: 'This address is free.',
    slugTry: (s: string) => `Try ${s}`,
    next: 'Next',
    back: 'Back',
    create: 'Create hotel',
    creating: 'Creating…',
    reviewHotel: 'Hotel',
    reviewAdmin: 'First Hotel Admin',
    edit: 'Edit',
    successTitle: 'Hotel created',
    successBody: (hotel: string, email: string) => `${hotel} is ready. A temporary password was sent to ${email}.`,
    devLogNote: 'In this test version the email is shown in the dev log.',
    enterHotel: 'Enter hotel',
    backToHotels: 'Back to hotels',
    failedTitle: 'The hotel was not created',
    failedBody: 'Something went wrong while creating the hotel. Nothing was saved. Please try again.',
    // Written for the New hotel wizard (removed 18 Oct 2026: hotels are only invited); some keys are still reused by the admin forms.
    subtitle: 'Create a hotel and its first Hotel Admin in three steps.',
    cancel: 'Cancel',
    tryAgain: 'Try again',
    nothingSaved: 'Nothing was saved.',
    chooseState: 'Choose the state…',
    gstinStateHint: (code: string, state: string) => `A GSTIN in ${state} starts with ${code}.`,
    tempPasswordTitle: 'Temporary password',
    offline: 'You are offline. Connect to the internet to create the hotel.',
    /** The mobile box takes Indian numbers only (the server checks 10 digits starting 6 to 9). */
    phoneCountry: { iso: 'IN', name: 'India', dial: '91', min: 10, max: 10, lead: '[6-9]', sample: '98765 43210', pattern: '^[6-9]\\d{9}$', message: 'Enter a 10-digit mobile number.' },
  },
  hotel: {
    tabs: { overview: 'Overview', admins: 'Admins', settings: 'Settings', integrations: 'Integrations', vault: 'Vault', activity: 'Activity' },
    enter: 'Enter hotel',
    suspend: 'Suspend',
    reactivate: 'Reactivate',
    addAdmin: 'Add another admin',
    resetPassword: 'Reset password',
    unlock: 'Unlock',
    disable: 'Disable',
    enable: 'Enable',
    fields: { name: 'Hotel', slug: 'Web address', city: 'City', state: 'State', gstin: 'GSTIN', timeZone: 'Time zone', group: 'Group', status: 'Status', created: 'Created', suspendedOn: 'Suspended on', reason: 'Reason' },
    settings: { gstin: 'GSTIN', stateCode: 'GST state code', state: 'State', city: 'City', timeZone: 'Time zone', gstRooms: 'GST on rooms', gstFood: 'GST on food and services', yearStart: 'Accounting year starts', percent: (n: number) => `${n}%`, april: 'April' },
    adminColumns: { name: 'Name', username: 'Username', email: 'Email', mobile: 'Mobile', status: 'Status', lastSignIn: 'Last sign-in', actions: 'Actions' },
    neverSignedIn: 'Never signed in',
    noAdmins: { title: 'No Hotel Admin yet', body: 'Add a Hotel Admin so somebody can sign in and run this hotel.' },
    noActivity: 'Nothing recorded yet.',
    suspendTitle: (hotel: string) => `Suspend ${hotel}?`,
    suspendBody: 'Nobody at this hotel can sign in while it is suspended. Its data is kept. You can reactivate it at any time.',
    suspendReason: 'Reason (optional)',
    reactivateTitle: (hotel: string) => `Reactivate ${hotel}?`,
    reactivateBody: 'Its users can sign in again straight away.',
    suspended: (hotel: string) => `${hotel} is suspended.`,
    reactivated: (hotel: string) => `${hotel} is active again.`,
    resetTitle: (admin: string) => `Reset the password of ${admin}?`,
    resetBody: 'A new temporary password is emailed to them. Their old password stops working.',
    unlockTitle: (admin: string) => `Unlock ${admin}?`,
    unlockBody: 'They can try to sign in again straight away.',
    unlocked: (admin: string) => `${admin} is unlocked.`,
    disableTitle: (admin: string) => `Disable ${admin}?`,
    disableBody: 'They cannot sign in until the account is enabled again.',
    disabled: (admin: string) => `${admin} is disabled.`,
    enabled: (admin: string) => `${admin} is enabled.`,
    adminAdded: (admin: string, email: string) => `${admin} added. A temporary password was sent to ${email}.`,
    addAdminTitle: 'Add hotel admin',
    addAdminSave: 'Add admin',
    suspendedBanner: 'This hotel is suspended. Nobody can sign in.',
    // Hotel details screen (page 4): the rest of its text.
    back: 'Back',
    crumbHotels: 'Hotels',
    backToHotels: 'Back to hotels',
    notFound: { title: 'Hotel not found', body: 'This hotel does not exist or was removed. Go back to the list of hotels.' },
    loadErrorTitle: 'This hotel could not be loaded',
    offlineTitle: 'You are offline',
    tryAgain: 'Try again',
    staleNote: 'The details below may be out of date.',
    tabsLabel: 'Hotel details sections',
    noGroup: 'No group',
    suspendedReason: (reason: string) => `Reason: ${reason}`,
    suspendedSince: (when: string) => `Suspended on ${when}.`,
    factsTitle: 'Key facts',
    factsHint: 'Where the hotel is and how it is set up on the platform.',
    counts: { admins: 'Hotel admins', active: 'Active', locked: 'Locked', disabled: 'Disabled' },
    countHints: { admins: 'Any status', active: 'Can sign in', locked: 'Too many wrong passwords', disabled: 'Cannot sign in', noneLocked: 'Nobody locked out', activity: (n: number) => `${n} recorded ${n === 1 ? 'action' : 'actions'}` },
    groupAdminOf: (group: string) => `Group admin of ${group}`,
    lockedSince: (when: string) => `Locked since ${when}`,
    rowAction: (action: string, admin: string) => `${action}: ${admin}`,
    settingsPlace: 'Place and time',
    settingsPlaceHint: 'Read only. The hotel changes these in its own Settings.',
    settingsTax: 'GST and accounts',
    settingsTaxHint: 'Used on every bill of this hotel.',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as readonly string[],
    activityColumns: { when: 'When', who: 'Who', what: 'What' },
    noActivityHint: 'Every change to this hotel, and every Enter hotel, is written here.',
    activityErrorTitle: 'The activity could not be loaded',
    cancel: 'Cancel',
    saving: 'Saving…',
    suspendConfirm: 'Suspend hotel',
    reasonPlaceholder: 'For example: the owner asked to pause during renovation',
    reasonHint: 'Kept in the activity log.',
    resetConfirm: 'Send new password',
    /** The server's sentence ("A temporary password was sent to …") and the dev-log note; never the password. */
    resetDone: (message: string, note: string) => `${message} ${note}`,
    enableTitle: (admin: string) => `Enable ${admin}?`,
    enableBody: 'They can sign in again with their current password.',
    addAdminHint: 'A temporary password is sent to this email. It is never shown here.',
  },
  groups: {
    subtitle: 'Hotels that are run together.',
    newGroup: 'Invite group',
    columns: { name: 'Group', hotels: 'Hotels', groupAdmin: 'Group admin', created: 'Created', actions: 'Actions' },
    noGroupAdmin: 'Not set',
    details: 'Details',
    empty: { title: 'No groups yet', body: 'Invite a group: its future Group Hotel Admin onboards the group and then invites the group’s hotels.' },
    /** A group invitation whose admin has not sent the onboarding form yet. */
    waitingOnboard: 'Waiting for its admin to onboard',
    /** A group whose admin sent the onboarding form; a Platform / Super Admin approves it. */
    waitingApproval: 'Onboarding form sent, waiting for approval',
    invitePill: { waiting: 'Invited', expired: 'Link expired' },
    statusColumn: 'Status',
    inviteGroup: 'Invite a group',
    inviteGroupHint: 'The future Group Hotel Admin fills in the group and their own account. After approval, they invite the group’s hotels.',
  },
  group: {
    hotelsTitle: 'Member hotels',
    addHotel: 'Link existing hotel',
    removeHotel: 'Unlink',
    noHotels: 'No hotels in this group yet.',
    noAvailable: 'Every hotel is already in a group.',
    groupAdminTitle: 'Group Hotel Admin',
    groupAdminHint: 'One Hotel Admin of a member hotel who can see every hotel of the group.',
    setGroupAdmin: 'Set group admin',
    changeGroupAdmin: 'Change',
    clearGroupAdmin: 'Remove group admin',
    noChoices: 'Add a hotel with an active Hotel Admin first.',
    removeTitle: (hotel: string, group: string) => `Unlink ${hotel} from ${group}?`,
    removeBody: 'This only unlinks the hotel from the group. Nothing is deleted: the hotel and all its data stay, and it becomes an individual hotel. Its admin stops being the group admin if they were.',
    added: (hotel: string, group: string) => `${hotel} linked to ${group}.`,
    removed: (hotel: string, group: string) => `${hotel} unlinked from ${group}. Nothing was deleted.`,
    unlinkHint: 'Unlink only takes the hotel out of the group. To close a hotel, archive it.',
    adminSet: (admin: string, group: string) => `${admin} is now the group admin of ${group}.`,
    adminCleared: (group: string) => `${group} has no group admin now.`,
    activityTitle: 'Activity',
  },
  admins: {
    subtitle: 'The hotel admins of every hotel.',
    searchPlaceholder: 'Search name, username, email, mobile, hotel',
    newAdmin: 'Add hotel admin',
    tabs: { all: 'All', active: 'Active', disabled: 'Disabled', locked: 'Locked', pending: 'Waiting for approval' },
    allHotels: 'All hotels',
    hotelField: 'Hotel',
    columns: { name: 'Name', hotel: 'Hotel', username: 'Username', status: 'Status', lastSignIn: 'Last sign-in', actions: 'Actions' },
    empty: { title: 'No Hotel Admins yet', body: 'Hotel Admins are created with a new hotel, or here.' },
    noMatch: { title: 'No Hotel Admins match', body: 'Try part of the name, the username, the email or the hotel.' },
    scopeNote: 'Platform Admins are managed by the Super Admin.',
  },
  enter: {
    banner: (hotel: string) => `You are inside ${hotel}.`,
    exit: 'Exit',
    entering: 'Opening the hotel…',
  },
  activity: {
    hotelCreated: (hotel: string) => (/^hotel\b/i.test(hotel) ? `Created ${hotel}.` : `Created hotel ${hotel}.`),
    hotelSuspended: (hotel: string, reason: string | null) => `Suspended ${hotel}${reason ? `: ${reason}` : '.'}`,
    hotelReactivated: (hotel: string) => `Reactivated ${hotel}.`,
    /** reason: what the person typed in the Enter hotel window (A2); older entries have none. */
    hotelEntered: (hotel: string, reason?: string | null) => (reason ? `Entered ${hotel} (read-only, 60 minutes). Reason: ${reason}` : `Entered ${hotel}.`),
    hotelExited: (hotel: string) => `Left ${hotel}.`,
    /** "Extend 60 minutes" inside a visit (platform 0135): the old visit ends and a new one of the same access starts. */
    hotelVisitExtended: (hotel: string) => `Stayed in ${hotel} for 60 more minutes.`,
    /** The Super Admin changed what a platform admin may do when entering hotels (platform 0135). */
    platformAdminAccessChanged: (admin: string) => `Changed the hotel access of ${admin}.`,
    adminCreated: (admin: string, hotel: string) => `Created Hotel Admin ${admin} for ${hotel}.`,
    adminPasswordReset: (admin: string) => `Reset the password of ${admin}. A temporary password was emailed.`,
    adminUnlocked: (admin: string) => `Unlocked ${admin}.`,
    adminDisabled: (admin: string) => `Disabled ${admin}.`,
    adminEnabled: (admin: string) => `Enabled ${admin}.`,
    adminLocked: (admin: string) => `${admin} was locked out after 5 wrong passwords.`,
    groupCreated: (group: string) => `Created group ${group}.`,
    groupHotelAdded: (hotel: string, group: string) => `Added ${hotel} to ${group}.`,
    groupHotelRemoved: (hotel: string, group: string) => `Unlinked ${hotel} from ${group}.`,
    groupAdminSet: (admin: string, group: string) => `Made ${admin} the group admin of ${group}.`,
    groupAdminCleared: (group: string) => `Removed the group admin of ${group}.`,
    hotelSubmitted: (hotel: string) => `Sent the onboarding form of ${hotel}. It waits for approval.`,
    hotelApproved: (hotel: string) => `Approved ${hotel}. It is live now.`,
    hotelRejected: (hotel: string, reason: string | null) => `Rejected ${hotel}${reason ? `: ${reason}` : '.'}`,
    hotelArchived: (hotel: string, reason: string | null) => `Archived ${hotel}${reason ? `: ${reason}` : '.'} Sign-in is blocked; the data is kept.`,
    hotelRestored: (hotel: string) => `Restored ${hotel} from the archive.`,
    groupSubmitted: (group: string) => `Sent the onboarding form of the group ${group}. It waits for approval.`,
    groupApproved: (group: string) => `Approved the group ${group}. Its group admin can sign in now.`,
    groupRejected: (group: string, reason: string | null) => `Rejected the group ${group}${reason ? `: ${reason}` : '.'}`,
    invitationSent: (hotel: string, email: string) => `Sent an invitation to ${hotel} (${email}).`,
    invitationResent: (hotel: string, email: string) => `Sent the invitation to ${hotel} again (${email}).`,
    invitationOpened: (hotel: string) => `Opened the invitation link of ${hotel}.`,
    invitationCancelled: (hotel: string) => `Cancelled the invitation to ${hotel}.`,
    userDisabled: (user: string) => `Disabled ${user}.`,
    userEnabled: (user: string) => `Enabled ${user}.`,
    userPasswordReset: (user: string) => `Reset the password of ${user}. A temporary password was emailed.`,
    userUnlocked: (user: string) => `Unlocked ${user}.`,
  },
  // ---- MJ's model (10 Oct): invitations, public onboarding, approval, archive, users, audit, sign-ins.
  invitations: {
    title: 'Invitations',
    subtitle: `Hotels invited to join. A link works for ${VT} and only once.`,
    inviteHotel: 'Invite hotel',
    searchPlaceholder: 'Search hotel, contact, email, group',
    searchLabel: 'Search invitations',
    tabs: { all: 'All', sent: 'Sent', opened: 'Opened', submitted: 'Submitted', expired: 'Expired', cancelled: 'Cancelled' } as Record<'all' | PlatformInvitationStatus, string>,
    tabsLabel: 'Invitation status',
    typeTabs: { all: 'All', individual: 'Individual hotels', group: 'Groups (admin)', member_hotel: 'Hotels into group' } as Record<'all' | PlatformInvitationType, string>,
    groupSubtitle: (group: string) => `Hotels invited into ${group}. A link works for ${VT} and only once.`,
    approvalNote: 'Every sent form is approved by a Platform Admin or the Super Admin before it goes live.',
    typeTabsLabel: 'Invitation type',
    columns: { hotel: 'Hotel', contact: 'Contact', email: 'Email', group: 'Group', type: 'Type', status: 'Status', invitedBy: 'Invited by', sent: 'Sent', expires: 'Link valid until', actions: 'Actions' },
    /** The narrower table (fits 1280px): the link's end date sits under "Sent". */
    fit: { validUntil: (when: string) => `Link valid until ${when}` },
    snoColumn: 'S.No.',
    noGroup: 'Individual',
    resend: 'Resend',
    cancel: 'Cancel invitation',
    openHotel: 'Open hotel',
    resendCount: (n: number) => `Resent ${n} ${n === 1 ? 'time' : 'times'}`,
    invitedBy: (name: string, role: string) => `${name} (${role})`,
    empty: { title: 'No invitations yet', body: 'Invite a hotel: it gets a link to fill its onboarding form.' },
    noMatch: { title: 'No invitations match', body: 'Try part of the hotel name, the contact, the email or the group.' },
    clearFilters: 'Clear filters',
    resendTitle: (hotel: string) => `Send the invitation to ${hotel} again?`,
    resendBody: `The same link is emailed again and works for another ${VT}.`,
    resent: (hotel: string, email: string) => `Invitation sent again to ${email} (${hotel}).`,
    cancelTitle: (hotel: string) => `Cancel the invitation to ${hotel}?`,
    cancelBody: 'The link stops working straight away. You can invite the hotel again later.',
    cancelConfirm: 'Cancel invitation',
    keep: 'Keep it',
    cancelled: (hotel: string) => `The invitation to ${hotel} is cancelled.`,
    expiredHint: `The link has expired. Resend it to give the hotel another ${VT}.`,
    submittedHint: 'The hotel sent its form. Review it on the hotel page.',
  },
  centralPage: {
    subSuper: 'What the platform keeps once for every hotel. You can add, change and delete here.',
    areasLabel: 'What to show',
    areas: { logins: 'Logins', profiles: 'Profiles', gst: 'GST', duplicates: 'Possible duplicates' },
    readTitle: 'Read only',
    superTitle: 'Changes here reach every hotel',
    superNote: 'Every add, change, delete and Reveal is written to the audit log. Nothing here is exported.',
    lookupsTitle: 'An audit trail',
    deletedTotal: (n: number) => `${n} deleted ${n === 1 ? 'record' : 'records'}`,
    openRecord: 'Open record',
    fullRecordNote: 'The full record opens in a window.',
    hotelCount: (n: number) => `${n} ${n === 1 ? 'hotel' : 'hotels'}`,
    dueAgain: (when: string) => `Due again ${when}`,
    timesUsed: (n: number) => `${n} ${n === 1 ? 'time' : 'times'}`,
    deletedPill: 'Deleted',
    mergedPill: 'Merged',
    loginPill: 'Has login',
    noLoginPill: 'No login',
    closedPill: 'Closed',
    lockedPill: 'Locked',
    card: { login: 'Login', kind: 'Kind', hotels: 'Hotels', noHotel: 'No hotel', lastSignIn: 'Last sign-in', name: 'Name', mobile: 'Mobile and email', contact: 'Main contact', created: 'Created', gstin: 'GSTIN', legalName: 'Legal name', fetched: 'Fetched', used: 'Used', when: 'When', hotel: 'Hotel', took: 'Took' },
  },
  archivedPage: {
    ruleTitle: 'Export before anything else',
    card: { hotel: 'Hotel', archived: 'Archived', reason: 'Why', exported: 'Data exported', next: 'What can be done', restoreYes: 'Yes, while the grace period lasts.', open: 'Open hotel', more: 'More', moreLabel: (name: string) => `More for ${name}` },
  },
  healthPage: {
    hotel: 'Hotel',
    problem: 'What needs attention',
    none: 'Nothing',
    more: (n: number) => `and ${n} more`,
    problems: 'What needs attention',
    checks: 'Checks',
    storage: 'Space used',
    bills: 'Bills this month',
    open: 'Open hotel',
  },
  auditPage: {
    appendTitle: 'Nothing here can be changed or deleted',
    entry: 'Entry',
    details: 'Details',
    at: 'Exact time',
  },
  signInsPage: {
    signIn: 'Sign-in',
    when: 'When',
    person: 'Person',
    where: 'Works at',
    reason: 'Why',
    noReason: 'Signed in',
    from: 'Signed in from',
    device: 'Device',
    ip: 'Network address',
    at: 'Exact time',
    unlock: 'Unlock in All users',
  },
  usersPage: {
    rulesTitle: 'Who can be changed here',
    more: 'More',
    moreLabel: (name: string) => `More for ${name}`,
    card: { person: 'Person', where: 'Works at', status: 'Status', lastSignIn: 'Last sign-in', account: 'Account', level: 'Level', username: 'Username', email: 'Email', mobile: 'Mobile', created: 'Added', platform: 'The platform' },
  },
  mailAddresses: {
    action: 'Email addresses',
    title: (name: string) => `Email addresses: ${name}`,
    intro: 'Every address shows in this person’s Email page and can be sent from. The first one comes with the login and stays.',
    auto: 'Comes with the login',
    extra: 'Extra address',
    addedBy: (by: string, when: string) => `Given by ${by}, ${when}`,
    remove: 'Remove',
    removeLabel: (a: string) => `Remove ${a}`,
    removed: (a: string) => `${a} removed.`,
    undo: 'Undo',
    giveTitle: 'Give another address',
    giveHint: 'Pick one. Each is made for this person and checked to be free.',
    taken: 'Taken',
    give: 'Give this address',
    given: (a: string) => `${a} given.`,
    none: 'No free address to suggest. Remove one first or ask the platform owner for another pattern.',
    close: 'Close',
  },
  staffPage: {
    superTitle: 'Super Admins are not listed here',
    twoStepTitle: 'Each person picks their own sign-in code',
    more: 'More',
    moreLabel: (name: string) => `More for ${name}`,
    card: { admin: 'Platform Admin', email: 'Email and mobile', status: 'Status', lastSignIn: 'Last sign-in', account: 'Account', role: 'Role', username: 'Username', mobile: 'Mobile', created: 'Added' },
  },
  hotelMailPage: {
    subOut: 'Pause or resume the mail of any group or hotel, see who sits under whom, and set up Google for each. Amazon SES is set up in its own admin panel.',
    subIn: 'Where guests’ replies to a hotel’s address come in.',
    viewsLabel: 'Hotel and group mail',
    views: { out: 'Mail going out', in: 'Replies coming in' },
    figures: { hotels: 'Hotels', running: 'Mail running', paused: 'Mail paused', own: 'Own accounts' },
    figureNotes: {
      hotels: (groups: number) => `In ${groups} ${groups === 1 ? 'group' : 'groups'} and on their own`,
      running: 'Sending as normal',
      paused: 'Queued mail waits until resumed',
      nonePaused: 'Nothing is paused',
      own: 'Groups and hotels with their own login',
    },
    filtersLabel: 'Show',
    filters: { all: 'All', running: 'Running', paused: 'Paused', own: 'Has own account' },
    inbound: {
      title: 'Receiving replies (Amazon SES)',
      hint: 'Copy this address into the SNS topic the SES receipt rule publishes to.',
      addressLabel: 'Receiving address',
      copy: 'Copy',
      copied: 'Copied',
      noAddress: 'The server cannot make this address yet: it needs HMS_HASH_KEY and HMS_PUBLIC_URL.',
      noTopic: 'The server does not know the SNS topic yet. Set HMS_INBOUND_SNS_TOPIC_ARN on the server to the topic’s ARN (arn:aws:sns:…); until then this address answers "not found" and no mail is taken in.',
      stepsTitle: 'How a reply reaches the hotel',
      steps: [
        'A guest replies to a hotel’s address; the mail reaches Amazon SES.',
        'SES passes it to an SNS topic, and the topic posts it to the address here (a subscription with the protocol HTTPS; HMS confirms it by itself).',
        'HMS puts the reply in the Email inbox of the hotel it was sent to.',
      ],
    },
  },
  announcementsPage: {
    tabsLabel: 'Announcements',
    tabs: { now: 'On now and coming', over: 'Ended' },
    noneNow: 'Nothing is showing to the hotels',
    noneNowText: 'Publish an announcement when every hotel should know something.',
    noneOver: 'Nothing has ended yet',
    card: { notice: 'Announcement', important: 'Important', audience: 'Who sees it', shows: 'Shows', reads: 'Read by', message: 'The message', about: 'Published', published: 'Published', by: 'By', importance: 'Importance' },
    form: {
      what: 'What to say',
      who: 'Who sees it',
      how: 'How long',
      adminsHint: 'The admins of every hotel.',
      everyoneHint: 'Every person who signs in to a hotel.',
      importantHint: 'Marked important on the hotels’ dashboards.',
    },
  },
  duplicatesPage: {
    kindLabel: 'Kind of profile',
    ruleTitle: 'Only merge the same person or company',
    hiddenNote: 'Marked not the same in this visit.',
    searchGuest: 'Search name, mobile or email',
    searchCompany: 'Search name, GSTIN or email',
    searchLabel: 'Search possible duplicates',
    count: (n: number) => (n === 1 ? '1 possible duplicate' : `${n} possible duplicates`),
    noMatch: 'No match',
    noMatchText: 'No possible duplicates match this search.',
    noneGuests: 'No guests share a mobile or email right now.',
    noneCompanies: 'No companies share a GSTIN or email right now.',
    loadMore: (n: number) => `Load more (${n} left)`,
    aProfile: 'a profile',
    apartDone: 'Marked as not the same.',
    undoDone: 'The pair shows again.',
    apartTitle: 'Not the same?',
    apartBody: 'These will stop showing as possible duplicates. Nothing is changed in any hotel. You can show them again from the line at the top.',
    profiles: (n: number) => `${n} profiles`,
    markedApart: (a: string, b: string) => `${a} and ${b} are marked not the same.`,
    keepNote: (name: string) => `${name} stays; the others are merged into it.`,
    hasSignIn: 'Has sign-in',
    mobile: 'Mobile',
    email: 'Email',
    gstin: 'GSTIN',
    city: 'City',
    created: 'Created',
    appearsIn: 'Appears in',
    noHotel: 'No hotel yet',
    staying: 'This one stays',
    reasonShort: 'Write why these are the same (at least 3 characters).',
    keeping: 'Keeping',
    mergingIn: 'Merging in',
    reason: 'Reason',
    sureTitle: (n: number, keep: string) => `Merge ${n === 1 ? 'this profile' : `these ${n} profiles`} into ${keep}?`,
    noUndo: 'This cannot be undone from here.',
  },
  demoPage: {
    tabsLabel: 'Show',
    all: 'All',
    noneYet: 'No requests yet',
    summary: (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`,
    moved: (hotel: string, status: string) => `${hotel}: ${status.toLowerCase()}.`,
    invite: 'Invite this hotel',
    invited: (hotel: string) => `${hotel} is invited. The request is marked as contacted.`,
    card: { hotel: 'Hotel', contact: 'Contact', received: 'Received', handled: 'Handled by', nobody: 'Nobody yet', message: 'Their message', noMessage: 'No message.', reach: 'How to reach them', name: 'Name', email: 'Email', phone: 'Phone', city: 'City', writeEmail: 'Email' },
  },
  invitationsPage: {
    typeTabs: { all: 'All', individual: 'Hotels', group: 'Groups', member_hotel: 'Hotels joining a group' } as Record<'all' | PlatformInvitationType, string>,
    groupsWaiting: (n: number) => `${n} ${n === 1 ? 'group sent its form and waits' : 'groups sent their forms and wait'} for approval`,
    openGroups: 'Open groups',
    hotelDetails: 'The hotel',
    groupDetails: 'The group',
    validUntil: (when: string) => `Valid until ${when}`,
    expiredOn: (when: string) => `Expired ${when}`,
    card: { invited: 'Invited', contact: 'Contact', sent: 'Sent', link: 'Link', about: 'The invitation', type: 'Type', group: 'Group', email: 'Email', history: 'What happened', by: 'Sent by', resent: 'Resent', opened: 'Opened', accepted: 'Form sent', revoked: 'Revoked', expired: 'Link expired', validUntil: 'Link valid until' },
  },
  invite: {
    title: 'Invite hotel',
    subtitle: 'The hotel gets an email with a link to its onboarding form.',
    fields: { hotelName: 'Hotel name', contactName: 'Contact person', email: 'Email', group: 'Group', type: 'What to invite', groupName: 'Group name' },
    types: {
      individual: { label: 'Individual hotel', hint: 'One hotel on its own. Its contact person becomes its first Hotel Admin.' },
      group: { label: 'Group (admin)', hint: 'A new group of hotels. The contact person fills in the group and becomes its Group Hotel Admin, who then invites the group’s hotels.' },
      member_hotel: { label: 'Hotel into group', hint: 'A hotel that joins your group. Its contact person becomes its first Hotel Admin.' },
    } as Record<PlatformInvitationType, { label: string; hint: string }>,
    titleGroup: 'Invite a group',
    titleMember: (group: string) => `Invite a hotel into ${group}`,
    hints: {
      contactName: 'The person who fills the form and becomes the first Hotel Admin.',
      contactNameGroup: 'The person who fills the form and becomes the Group Hotel Admin.',
      email: `The link is sent here. It works for ${VT}, once.`,
      group: 'Leave empty for an individual hotel.',
      groupFixed: (group: string) => `The hotel joins ${group}.`,
      platformNoGroup: 'Hotels join a group only through that group’s admin.',
    },
    noGroup: 'No group (individual hotel)',
    send: 'Send invitation',
    sending: 'Sending…',
    cancel: 'Cancel',
    sentTitle: 'Invitation sent',
    sentBody: (hotel: string, email: string) => `An invitation for ${hotel} was sent to ${email}. The link works for ${VT}.`,
    devLinkLabel: 'Link (dev log only)',
    devLinkNote: 'In this test version the email is shown in the dev log. The real link is never shown on screen.',
    sendAnother: 'Invite another hotel',
    /** Platform / Super Admin form (a hotel OR a group). */
    subtitleAny: 'The person gets an email with a link to the onboarding form.',
    sendAnotherAny: 'Invite another',
    backToInvitations: 'Back to invitations',
    offline: 'You are offline. Connect to the internet to send the invitation.',
  },
  onboarding: {
    title: 'Join the platform',
    welcome: (contact: string, hotel: string) => `Welcome, ${contact}. Tell us about ${hotel} and set up your admin account.`,
    joiningGroup: (group: string) => `Your hotel joins ${group}.`,
    /** A hotel invited by its group is approved at once (MJ, 18 Oct 2026): the answer of the form says it is ready. */
    readyTitle: 'Your hotel is ready. Sign in with the username and password you chose.',
    linkValidUntil: (when: string) => `This link works until ${when}.`,
    steps: ['Hotel', 'Your admin account', 'Review'],
    hotelSection: 'Hotel',
    adminSection: 'Your admin account',
    fields: {
      name: 'Hotel name', address: 'Address', city: 'City', state: 'State', pin: 'PIN code', gstin: 'GSTIN', phone: 'Hotel phone', email: 'Hotel email', logo: 'Logo (optional)',
      adminName: 'Your full name', username: 'Username', adminEmail: 'Your email', mobile: 'Your mobile', password: 'Password', passwordConfirm: 'Type the password again',
    },
    hints: {
      pin: '6 digits.',
      gstin: '15 characters, like 27ABCDE1234F1Z5. It must match the state.',
      phone: 'Landline with STD code, or a mobile.',
      logo: 'PNG, JPG, SVG or WebP.',
      username: 'Small letters, numbers, dot or underscore. You sign in with it.',
      password: '8 to 128 characters with an uppercase letter, a lowercase letter, a number and a special character.',
    },
    chooseState: 'Choose the state…',
    chooseLogo: 'Choose a file',
    removeLogo: 'Remove',
    next: 'Next',
    back: 'Back',
    submit: 'Send for approval',
    submitting: 'Sending…',
    waitingTitle: 'Waiting for approval',
    waitingBody: (hotel: string) => `Thank you. ${hotel} is waiting for approval. We email you as soon as it is approved; then you can sign in with your username and password.`,
    loading: 'Opening your invitation…',
    notFound: { title: 'This link does not work', body: 'The invitation link is not valid. Check that you opened the whole link from the email, or ask for a new invitation.' },
    expired: { title: 'This link has expired', body: `Invitation links work for ${VT}. Ask the person who invited you to send it again.` },
    used: { title: 'This form was already sent', body: 'The onboarding form for this invitation was already sent and is waiting for approval. You can close this page.' },
    cancelled: { title: 'This invitation was cancelled', body: 'The invitation is no longer valid. Ask the person who invited you for a new one.' },
    offline: 'You are offline. Connect to the internet to send the form.',
    passwordNote: 'Your password is never shown or emailed to anyone.',
    onlyAdminNote: 'You are the hotel’s first and only user. Rooms, rates and staff are added later, inside the hotel.',
    approvalByNote: 'A Platform Admin checks the form and approves it.',
    draftKept: 'What you type is kept in this browser, except the password. You can close the page and finish later from the same link.',
    draftBack: 'Welcome back. Your answers from last time are filled in.',
    mismatch: 'This form does not match the invitation. Reload the page from the email link.',
    // Group variant (invitation type 'group').
    group: {
      title: 'Set up your group',
      welcome: (contact: string, group: string) => `Welcome, ${contact}. Tell us about ${group} and set up your Group Hotel Admin account.`,
      steps: ['Group', 'Your admin account', 'Review'],
      groupSection: 'Group',
      fields: { name: 'Group name', legalName: 'Registered company name', gstin: 'GSTIN', address: 'Office address', city: 'City (optional)', state: 'State (optional)', pin: 'PIN code (optional)', phone: 'Office phone', email: 'Office email' },
      hints: {
        legalName: 'As on the GST registration.',
        gstin: '15 characters. If you choose a state, the GSTIN must match it.',
      },
      submit: 'Send for approval',
      waitingBody: (group: string) => `Thank you. ${group} is waiting for approval. We email you as soon as it is approved; then you can sign in and invite your group’s hotels.`,
      nextNote: 'After approval you invite the hotels of your group yourself.',
    },
    hotelVariantTitle: 'Hotel form',
    groupVariantTitle: 'Group form',
  },
  // ---- A3 (Invitations screen, Invite form): what the screens show beyond `invitations` / `invite` above.
  inviteFlow: {
    inviteButton: 'Invite',
    /** Status as people read it: sent / opened = Pending, submitted = Accepted, cancelled = Revoked. */
    shown: { sent: 'Pending', opened: 'Pending', submitted: 'Accepted', expired: 'Expired', cancelled: 'Revoked' } as Record<PlatformInvitationStatus, string>,
    tabs: { all: 'All', pending: 'Pending', submitted: 'Accepted', expired: 'Expired', cancelled: 'Revoked' } as Record<'all' | 'pending' | 'submitted' | 'expired' | 'cancelled', string>,
    nameColumn: 'Hotel or group',
    typeFilter: 'Type',
    allTypes: 'All types',
    notOpened: 'Not opened yet',
    openedOn: (when: string) => `Opened ${when}`,
    acceptedOn: (when: string) => `Form sent ${when}`,
    revokedOn: (when: string) => `Revoked ${when}`,
    joinsGroup: (group: string) => `Joins ${group}`,
    resend: 'Resend',
    resendTitle: (name: string) => `Send a new link to ${name}?`,
    resendBody: `The old link stops working at once. A new link is emailed and works for ${VT}.`,
    resendConfirm: 'Send new link',
    resent: (name: string, email: string) => `A new link was sent to ${email} (${name}). The old link no longer works.`,
    revoke: 'Revoke',
    revokeTitle: (name: string) => `Revoke the invitation to ${name}?`,
    revokeBody: 'The link stops working at once. You can invite them again later.',
    revokeConfirm: 'Revoke',
    revoked: (name: string) => `The invitation to ${name} is revoked. Its link no longer works.`,
    keep: 'Keep it',
    rowAction: (action: string, name: string) => `${action}: ${name}`,
    // Dev only (mock): the link is never shown in the real app; it travels by email.
    devCopy: 'Copy link (dev)',
    devCopied: 'Link copied (dev only).',
    devCopyFailed: 'Could not copy the link. It is shown in the dev panel instead.',
    devOpenHere: 'Open form here (dev)',
    devPanelTitle: 'Test links for the onboarding page (mock only)',
    devPanelNote: 'Each link opens the public onboarding page in one state. A link of an invitation sent just now works only with "Open form here (dev)": the test data lives in this tab.',
    devTokens: {
      open: 'Individual hotel, not opened yet',
      opened: 'Hotel into a group, opened',
      groupOpen: 'Group (admin), open',
      expired: 'Expired link',
      submitted: 'Already used (hotel)',
      groupSubmitted: 'Already used (group)',
      cancelled: 'Revoked link',
      invalid: 'Link that does not exist',
    },
    devOpen: 'Open',
    devLastLink: 'Last link sent (dev only)',
    // Invite form
    formTitle: 'Invite',
    chooseType: 'What do you want to invite?',
    typeRequired: 'Choose what to invite.',
    typeFirst: 'Choose what to invite first, then fill in the details.',
    /** Shown in "Link valid until" once the link is used or revoked (no expiry any more). */
    noExpiry: '-',
    /** A sent GROUP form waiting for approval: its row opens a small review window (Approve / Reject). */
    reviewGroup: 'Review group',
    reviewGroupMissing: 'This group is no longer waiting for approval. Reload the list.',
    groupWaiting: 'Pending review',
    next: 'Next',
    back: 'Back',
    close: 'Close',
    sentNote: 'The person gets an email with the link. When they send the form, it waits for approval on the Hotels or Groups page.',
  },
  // ---- A3 public onboarding page: extras to `onboarding` above.
  onboardingMore: {
    more: 'More about your hotel (optional)',
    moreHint: 'You can also fill these in later, inside the hotel.',
    fields: {
      legalName: 'Legal name',
      tradeName: 'Trade name',
      gstType: 'GST type',
      roomCount: 'Number of rooms',
      checkInTime: 'Check-in time',
      checkOutTime: 'Check-out time',
    },
    gstTypes: { '': 'Not sure yet', regular: 'Regular', composition: 'Composition' } as Record<'' | 'regular' | 'composition', string>,
    stateFromGstin: (state: string) => `State taken from the GSTIN: ${state}.`,
    stepPill: (n: number, total: number, name: string) => `Step ${n} of ${total} · ${name}`,
    reviewTitle: 'Check and send',
    reviewLead: 'Check the details. You can go back and change them.',
    edit: 'Edit',
    noLogo: 'No logo',
    notGiven: 'Not given',
    passwordHidden: 'Set (hidden)',
    pwRules: { length: '8 to 128 characters', upper: 'An uppercase letter', lower: 'A lowercase letter', number: 'A number', special: 'A special character' },
    pwMatch: 'Both passwords match',
    ruleMet: 'Done',
    ruleNotMet: 'Not yet',
    askAdmin: 'Ask your admin for a new link.',
    linkProblemPill: 'Invitation link',
    fixErrors: 'Some details need a fix. They are marked below.',
    tryAgain: 'Try again',
    loadFailed: 'The invitation could not be opened. Check your internet connection and try again.',
    submitFailed: 'The form could not be sent. Nothing was saved. Please try again.',
    /** 429 on the public routes (30 opens or 10 sends a minute from one address). */
    rateLimited: 'Too many tries from this address. Please wait a minute, then try again.',
    waitingPill: 'Sent',
    closeDev: 'Close (dev)',
  },
  approval: {
    pendingBanner: 'This hotel sent its onboarding form and waits for approval. Nobody can sign in yet.',
    rejectedBanner: 'This hotel was rejected. Nobody can sign in.',
    approve: 'Approve',
    reject: 'Reject',
    approveTitle: (hotel: string) => `Approve ${hotel}?`,
    approveBody: 'The hotel goes live and its first Hotel Admin can sign in with the password they chose.',
    approveConfirm: 'Approve hotel',
    approved: (hotel: string, email: string) => `${hotel} is live. ${email} was told by email.`,
    rejectTitle: (hotel: string) => `Reject ${hotel}?`,
    rejectBody: 'Nobody can sign in. The hotel is told the reason by email. It can be invited again later.',
    rejectReason: 'Reason',
    rejectReasonPlaceholder: 'For example: the GSTIN does not belong to this hotel',
    rejectConfirm: 'Reject hotel',
    rejected: (hotel: string) => `${hotel} was rejected.`,
    submittedOn: (when: string) => `Form sent on ${when}`,
    formTitle: 'Onboarding form',
    formHint: 'What the hotel typed. The password is never stored here.',
    contact: 'Contact person',
    logo: 'Logo',
    noLogo: 'No logo',
    /** The first admin's facts as the console shows them (the public form's labels say "Your ..."). */
    adminFields: { name: 'Admin name', username: 'Username', email: 'Admin email', mobile: 'Admin mobile' },
    rejectedReason: (reason: string) => `Reason: ${reason}`,
    memberHotelNote: (group: string) => `Invited into ${group} by its group admin. Approved here, by a Platform Admin.`,
    // Groups waiting for approval (invitation type 'group').
    groupPendingBanner: 'This group sent its onboarding form and waits for approval. Its admin cannot sign in yet.',
    groupRejectedBanner: 'This group was rejected. Its admin cannot sign in.',
    approveGroupTitle: (group: string) => `Approve ${group}?`,
    approveGroupBody: 'The group becomes active and its Group Hotel Admin can sign in and invite the group’s hotels.',
    approveGroupConfirm: 'Approve group',
    groupApproved: (group: string, email: string) => `${group} is active. ${email} was told by email.`,
    rejectGroupTitle: (group: string) => `Reject ${group}?`,
    rejectGroupBody: 'The group is not created and its admin cannot sign in. The reason is emailed to them.',
    rejectGroupConfirm: 'Reject group',
    groupRejected: (group: string) => `${group} was rejected.`,
    groupFormTitle: 'Group onboarding form',
    groupFields: { legalName: 'Registered company name', gstin: 'GSTIN', address: 'Office address', city: 'City', state: 'State', pin: 'PIN code', phone: 'Office phone', email: 'Office email', admin: 'Group Hotel Admin' },
  },
  archive: {
    archive: 'Archive',
    restore: 'Restore',
    archivedBanner: 'This hotel is archived. Nobody can sign in. Its data is kept.',
    archiveTitle: (hotel: string) => `Archive ${hotel}?`,
    archiveBody: 'Nobody at this hotel can sign in. Nothing is deleted: its data is kept and you can restore it within 90 days.',
    archiveReason: 'Reason (optional)',
    archiveConfirm: 'Archive hotel',
    archived: (hotel: string) => `${hotel} is archived.`,
    signInBlocked: 'Sign-in is blocked. The data is kept.',
    restoreTitle: (hotel: string) => `Restore ${hotel}?`,
    restoreBody: 'The hotel is active again and its users can sign in.',
    /** Restore goes back to the status the hotel had when it was archived (review H1). */
    restoreBodyTo: (status: PlatformHotelStatus) =>
      status === 'suspended'
        ? 'The hotel goes back to Suspended, with its suspend reason. Reactivate it afterwards to let its users sign in.'
        : status === 'rejected'
          ? 'The hotel goes back to Rejected. It does not become active: nobody can sign in.'
          : 'The hotel is active again and its users can sign in.',
    restoreConfirm: 'Restore hotel',
    restored: (hotel: string) => `${hotel} is active again.`,
    restoredTo: (hotel: string, status: string) => `${hotel} is restored. Status: ${status}.`,
    restoreOver: 'The 90-day restore period is over. The hotel stays archived.',
    archivedOn: (when: string) => `Archived on ${when}.`,
    noDelete: 'Hotels are never deleted. Archive keeps every record.',
  },
  users: {
    title: 'All users',
    subtitle: 'Every account on the platform, at every level.',
    searchPlaceholder: 'Search name, username, email, mobile, hotel',
    searchLabel: 'Search users',
    levelTabs: { all: 'All levels', super_admin: 'Super Admins', platform_admin: 'Platform Admins', group_admin: 'Group Admins', hotel_admin: 'Hotel Admins', hotel_user: 'Hotel Users' } as Record<'all' | PlatformUserLevel, string>,
    statusTabs: { all: 'All', active: 'Active', disabled: 'Disabled', locked: 'Locked', pending: 'Waiting' } as Record<'all' | PlatformUserStatus, string>,
    levelTabsLabel: 'Level',
    statusTabsLabel: 'Account status',
    columns: { name: 'Name', level: 'Level', hotel: 'Hotel', group: 'Group', username: 'Username', status: 'Status', lastSignIn: 'Last sign-in', actions: 'Actions' },
    snoColumn: 'S.No.',
    platformWide: 'Whole platform',
    neverSignedIn: 'Never signed in',
    empty: { title: 'No users', body: 'Nobody matches these filters.' },
    noMatch: { title: 'No users match', body: 'Try part of the name, the username, the email or the hotel.' },
    clearFilters: 'Clear filters',
    disable: 'Disable', enable: 'Enable', unlock: 'Unlock', resetPassword: 'Reset password',
    disableTitle: (user: string) => `Disable ${user}?`,
    disableBody: 'They cannot sign in until the account is enabled again.',
    enableTitle: (user: string) => `Enable ${user}?`,
    enableBody: 'They can sign in again with their current password.',
    unlockTitle: (user: string) => `Unlock ${user}?`,
    unlockBody: 'They can try to sign in again straight away.',
    resetTitle: (user: string) => `Reset the password of ${user}?`,
    resetBody: 'A new temporary password is emailed to them. Their old password stops working.',
    disabled: (user: string) => `${user} is disabled.`,
    enabled: (user: string) => `${user} is enabled.`,
    unlocked: (user: string) => `${user} is unlocked.`,
    resetSent: (email: string) => `A temporary password was sent to ${email}.`,
    // A7 screen (platform.users)
    emailColumn: 'Email',
    hotelOrGroupColumn: 'Hotel / group',
    /** The narrower table (fits 1280px): level pill with the hotel or group under it. */
    levelHotelColumn: 'Level and hotel',
    statusFilter: 'Status',
    anyStatus: 'Any status',
    statusFilterHead: 'Account status',
    resetConfirm: 'Send new password',
    cancel: 'Cancel',
    rowAction: (action: string, user: string) => `${action}: ${user}`,
    lockedSince: (when: string) => `Locked since ${when}`,
    resetDone: (message: string, note: string) => `${message} ${note}.`,
    rules: 'Every change here is written to the audit log. The last active Super Admin cannot be disabled. A password is never shown: a temporary one is emailed.',
    summary: (shown: number, total: number) => (shown === total ? `${total} ${total === 1 ? 'account' : 'accounts'}` : `${shown} of ${total} accounts`),
  },
  audit: {
    title: 'Audit log',
    subtitle: 'Every platform action: who, what, which hotel, when.',
    searchPlaceholder: 'Search who, what, hotel',
    searchLabel: 'Search the audit log',
    columns: { when: 'When', who: 'Who', action: 'Action', target: 'On', hotel: 'Hotel', what: 'What happened' },
    filters: { action: 'Action', allActions: 'All actions', actor: 'Who', allActors: 'Everybody', hotel: 'Hotel', allHotels: 'All hotels', from: 'From', to: 'To' },
    archivedHotel: (name: string) => `${name} (archived)`,
    empty: { title: 'Nothing recorded', body: 'Nothing matches these filters.' },
    clearFilters: 'Clear filters',
    actions: {
      hotel_created: 'Hotel created', hotel_suspended: 'Hotel suspended', hotel_reactivated: 'Hotel reactivated', hotel_entered: 'Entered hotel', hotel_exited: 'Left hotel', hotel_visit_extended: 'Visit extended', platform_admin_access_changed: 'Hotel access changed',
      admin_created: 'Admin created', admin_password_reset: 'Password reset', admin_unlocked: 'Account unlocked', admin_disabled: 'Account disabled', admin_enabled: 'Account enabled', admin_locked: 'Account locked',
      group_created: 'Group created', group_hotel_added: 'Hotel added to group', group_hotel_removed: 'Hotel unlinked from group', group_admin_set: 'Group admin set', group_admin_cleared: 'Group admin removed',
      hotel_submitted: 'Onboarding form sent', hotel_approved: 'Hotel approved', hotel_rejected: 'Hotel rejected', hotel_archived: 'Hotel archived', hotel_restored: 'Hotel restored',
      group_submitted: 'Group form sent', group_approved: 'Group approved', group_rejected: 'Group rejected',
      invitation_sent: 'Invitation sent', invitation_resent: 'Invitation resent', invitation_opened: 'Invitation opened', invitation_cancelled: 'Invitation cancelled',
      user_disabled: 'User disabled', user_enabled: 'User enabled', user_password_reset: 'User password reset', user_unlocked: 'User unlocked',
      staff_created: 'Platform admin created', health_checked: 'Health check run', settings_updated: 'Platform settings changed', hotel_exported: 'Hotel data exported', hotel_deleted: 'Hotel deleted permanently',
      audit_exported: 'Audit log exported',
      announcement_created: 'Announcement published', announcement_ended: 'Announcement ended',
      hotel_write_refused: 'Change refused during a visit', hotel_write_started: 'Change started during a visit', hotel_write: 'Change made during a visit',
      api_token_created: 'API key created', api_token_revoked: 'API key revoked', api_token_full_access: 'Full access keys switched',
      api_token_write: 'Change made with an API key', api_token_refused: 'API key call refused', api_token_new_ip: 'API key used from a new address',
      mail_suppressed: 'Address suppressed', mail_unsuppressed: 'Suppression lifted', mail_hold: 'Campaign mail held', mail_hold_released: 'Campaign mail released',
      profile_merged: 'Profiles merged', profile_kept_apart: 'Profiles marked not the same', profile_kept_apart_undone: 'Profiles shown again as possible duplicates',
      vault_item_added: 'Added to the vault', vault_item_changed: 'Vault item changed', vault_item_revealed: 'Vault secret shown', vault_item_removed: 'Removed from the vault',
      personal_vault_item_added: 'Added to My vault', personal_vault_item_changed: 'My vault item changed', personal_vault_item_revealed: 'My vault secret shown', personal_vault_item_removed: 'Removed from My vault',
      demo_request_updated: 'Demo request updated',
      central_revealed: 'Full contact shown', central_created: 'Central record created', central_updated: 'Central record changed', central_deleted: 'Central record deleted', central_restored: 'Central record restored',
    } as Record<PlatformActivityAction, string>,
    // A7 screen (platform.audit)
    moreColumns: { result: 'Result', reason: 'Reason', ip: 'IP address', browser: 'Browser', role: 'Role', insideHotel: 'Inside hotel' },
    results: { success: 'Done', failed: 'Refused' } as Record<PlatformAuditResult, string>,
    systemActor: 'Automatic',
    outsideActor: 'Invited person',
    insideHotelFlag: 'Platform staff inside hotel',
    insideHotelTitle: 'Done by platform staff while inside the hotel (Enter hotel)',
    noHotel: 'Platform',
    noReason: '-',
    yes: 'Yes',
    no: 'No',
    appendOnly: 'Entries cannot be edited or deleted. Kept for at least 1 year.',
    exportCsv: 'Export CSV',
    exporting: 'Preparing…',
    exported: (n: number, file: string) => `${n} ${n === 1 ? 'entry' : 'entries'} saved to ${file}.`,
    nothingToExport: 'Nothing to export: no entry matches these filters.',
    summary: (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`,
    noMatch: { title: 'Nothing matches', body: 'Try a wider date range, another action or person, or clear the filters.' },
  },
  signIns: {
    title: 'Sign-in history',
    subtitle: 'Successful and failed sign-ins across the platform.',
    searchPlaceholder: 'Search user or hotel',
    searchLabel: 'Search sign-ins',
    tabs: { all: 'All', success: 'Signed in', failed: 'Failed', locked: 'Locked out' } as Record<'all' | PlatformSignInResult, string>,
    tabsLabel: 'Result',
    columns: { when: 'When', user: 'User', level: 'Level', hotel: 'Hotel', result: 'Result', reason: 'Reason', ip: 'IP address', device: 'Device' },
    /** The narrower table (fits 1280px): level pill with the hotel under it. */
    levelHotelColumn: 'Level and hotel',
    unknownUser: 'Unknown username',
    empty: { title: 'No sign-ins', body: 'Nothing matches these filters.' },
    clearFilters: 'Clear filters',
    reasons: {
      wrongPassword: 'Wrong password.',
      wrongCode: 'Wrong emailed code.',
      unknownUser: 'No account with this username.',
      locked: 'Locked after 5 wrong passwords.',
      disabled: 'The account is disabled.',
      hotelSuspended: 'The hotel is suspended.',
      hotelArchived: 'The hotel is archived.',
      hotelRejected: 'The hotel was rejected.',
      pendingApproval: 'The account is waiting for approval.',
    },
    // A7 screen (platform.signins)
    noMatch: { title: 'No sign-in matches', body: 'Try part of the username, the name, the hotel or the IP address.' },
    noHotel: 'Platform',
    noReason: '-',
    summary: (n: number) => `${n} ${n === 1 ? 'sign-in' : 'sign-ins'}`,
  },
  // A7: the Super Admin's own pages (users, audit, sign-ins) for anybody else.
  superOnly: {
    title: 'Super Admin only',
    body: 'Only a Super Admin can open this page. Ask a Super Admin if you need something from it.',
  },
  errors: {
    required: {
      name: 'Enter the hotel name.',
      slug: 'Enter a web address.',
      city: 'Enter the city.',
      state: 'Choose the state.',
      gstin: 'Enter the GSTIN.',
      timeZone: 'Choose the time zone.',
      adminName: 'Enter the full name.',
      username: 'Enter a username.',
      email: 'Enter an email address.',
      mobile: 'Enter a mobile number.',
      groupName: 'Enter the group name.',
      hotelName: 'Enter the hotel name.',
      contactName: 'Enter the contact person.',
      address: 'Enter the address.',
      pin: 'Enter the PIN code.',
      phone: 'Enter the hotel phone number.',
      hotelEmail: 'Enter the hotel email.',
      password: 'Enter a password.',
      passwordConfirm: 'Type the password again.',
      reason: 'Enter the reason.',
    },
    nameLong: 'Keep the name to 100 characters.',
    slugFormat: 'Use small letters, numbers and dashes only, 3 to 40 characters.',
    slugTaken: 'Another hotel already uses this address.',
    slugReserved: 'This address is kept for the app itself. Choose another.',
    gstinFormat: 'Enter a valid 15-character GSTIN, like 24ABCDE1234F1Z5.',
    gstinState: (code: string, state: string) => `A GSTIN in ${state} starts with ${code}.`,
    stateUnknown: 'Choose a state from the list.',
    timeZoneUnknown: 'Choose a time zone from the list.',
    usernameFormat: 'Use 3 to 30 small letters, numbers, dot or underscore, starting with a letter or number.',
    usernameTaken: 'This username is already in use.',
    emailFormat: 'Enter a valid email address, like name@hotel.in.',
    emailTaken: 'Another account already uses this email.',
    mobileFormat: 'Enter a 10-digit mobile number.',
    mobileTaken: 'Another account already uses this mobile number.',
    groupNameTaken: 'A group with this name already exists.',
    hotelInGroup: (hotel: string, group: string) => `${hotel} is already in ${group}.`,
    hotelNotInGroup: 'This hotel is not in this group.',
    hotelUnknown: 'One of the chosen hotels no longer exists. Refresh and try again.',
    adminNotInGroup: 'Choose an active Hotel Admin of a hotel in this group.',
    alreadySuspended: 'This hotel is already suspended.',
    alreadyActive: 'This hotel is already active.',
    notLocked: 'This account is not locked.',
    alreadyDisabled: 'This account is already disabled.',
    notDisabled: 'This account is not disabled.',
    disabledNoReset: 'Enable this account first, then reset its password.',
    hotelNotLive: 'This hotel is not live (archived, rejected or waiting for approval), so its accounts cannot be changed.',
    groupAdminNoApproval: 'Only a Platform Admin or the Super Admin can approve or reject.',
    createFailed: 'Something went wrong while creating the hotel. Nothing was saved. Please try again.',
    // Invitations, onboarding, approval, archive, users.
    inviteDuplicate: 'An open invitation was already sent to this email. Resend it from the list, or cancel it first.',
    inviteDuplicateHotel: 'An open invitation already exists for a hotel with this name. Resend it from the list, or cancel it first.',
    inviteDuplicateGroup: 'An open invitation already exists for a group with this name. Resend it from the list, or cancel it first.',
    groupApprovePlatformOnly: 'Only a Platform Admin or the Super Admin can approve or reject a group.',
    resendDuplicate: 'Another open invitation already exists for this email or name. Cancel that one first, then resend this one.',
    groupUnknown: 'This group no longer exists. Refresh and try again.',
    inviteOwnGroupOnly: 'A Group Hotel Admin can invite hotels only into their own group.',
    inviteNoGroupForPlatform: 'A Platform Admin does not invite a hotel into a group. The group’s admin does that.',
    inviteMemberGroupAdminOnly: 'Only a group’s own Group Hotel Admin can invite a hotel into the group.',
    inviteGroupAdminMemberOnly: 'A Group Hotel Admin can only invite hotels into their own group.',
    groupNotActive: 'This group is not active yet (waiting for approval or rejected).',
    hotelNotJoinable: 'Only an active or suspended hotel can join a group.',
    formMismatch: 'This form does not match the invitation. Reload the page from the email link.',
    notPendingGroup: 'Only a group that waits for approval can be approved or rejected.',
    legalNameRequired: 'Enter the registered company name.',
    inviteNotFound: 'This invitation link is not valid. Check that you opened the whole link from the email, or ask for a new invitation.',
    inviteExpired: `This invitation link has expired. Invitation links work for ${VT}; ask for it to be sent again.`,
    inviteUsed: 'The onboarding form for this invitation was already sent. It is waiting for approval.',
    inviteCancelled: 'This invitation was cancelled. Ask for a new one.',
    resendNotAllowed: 'This invitation was already used or cancelled, so it cannot be sent again.',
    cancelNotAllowed: 'This invitation was already used or cancelled.',
    pinFormat: 'Enter the 6-digit PIN code.',
    phoneFormat: 'Enter a phone number with 10 to 12 digits, with the STD code for a landline.',
    logoType: 'Choose a PNG, JPG, SVG or WebP file.',
    passwordRule: 'Use 8 to 128 characters with an uppercase letter, a lowercase letter, a number and a special character.',
    passwordMismatch: 'The two passwords are not the same.',
    reasonLong: 'Keep the reason to 500 characters.',
    reasonShort: 'Write at least 5 characters.',
    notPending: 'Only a hotel that waits for approval can be approved or rejected.',
    alreadyArchived: 'This hotel is already archived.',
    archivePending: 'This hotel waits for approval. Approve or reject it first.',
    notArchived: 'This hotel is not archived.',
    notSuspended: 'Only a suspended hotel can be reactivated.',
    suspendNotActive: 'Only an active hotel can be suspended.',
    enterNotLive: 'This hotel is not live (waiting for approval, rejected or archived), so it cannot be entered.',
    accountPending: 'This account waits for its hotel to be approved.',
    lastSuperAdmin: 'This is the only active Super Admin. Make another Super Admin first.',
  },
  // Groups, Group details and Hotel admins screens (Frontend 1, pages 5 and 6): the rest of their text.
  groupsList: {
    searchPlaceholder: 'Search group, hotel or group admin',
    searchLabel: 'Search groups',
    snoColumn: 'S.No.',
    noMatch: { title: 'No groups match your search', body: 'Try part of the group name, a hotel or the group admin.' },
    clearSearch: 'Clear search',
    hotelCount: (n: number) => `${n} ${n === 1 ? 'hotel' : 'hotels'}`,
    detailsTitle: (group: string) => `Details of ${group}`,
    noHotelsYet: '0 hotels',
    invitedAdmin: 'Invited, not onboarded yet',
    cancel: 'Cancel',
    saving: 'Saving…',
    /** Status tabs (aria label) and the "waiting" tab: invited, the admin has not sent the onboarding form yet. */
    tabsLabel: 'Group status',
    waitingAdmin: 'Waiting for its admin',
    onTheWay: (n: number) => `${n} group ${n === 1 ? 'invitation is' : 'invitations are'} waiting for the admin`,
    onTheWayNote: 'A group joins this list once its admin sends the onboarding form.',
    openInvitations: 'Open invitations',
    card: { group: 'Group', hotels: 'Hotels', admin: 'Group admin', created: 'Created', status: 'Status', adminHotel: 'Admin’s hotel', aboutGroup: 'About the group', aboutAdmin: 'Group admin' },
  },
  groupDetail: {
    back: 'Back',
    crumbGroups: 'Groups',
    backToGroups: 'Back to groups',
    notFound: { title: 'Group not found', body: 'This group does not exist or was removed. Go back to the list of groups.' },
    loadErrorTitle: 'This group could not be loaded',
    offlineTitle: 'You are offline',
    tryAgain: 'Try again',
    staleNote: 'The details below may be out of date.',
    sub: (hotels: string, created: string) => `${hotels} · Created ${created}`,
    openHotel: 'Open',
    noHotelsHint: 'Hotels join a group when its Group Hotel Admin invites them. You can also link an existing hotel that is in no group.',
    noHotelsWaiting: 'The Group Hotel Admin invites the group’s hotels after the group is approved.',
    waitingNote: (contact: string) => `Waiting for ${contact} to onboard the group.`,
    waitingHint: 'The invited person fills in the group and their own account; after approval they become its Group Hotel Admin.',
    pendingNote: (contact: string) => (contact ? `${contact} sent the group’s onboarding form. It is waiting for approval.` : 'The group’s onboarding form was sent. It is waiting for approval.'),
    inviteSub: (sent: string) => `Invitation sent ${sent} · 0 hotels`,
    invitationStatus: (status: string) => `Invitation: ${status}`,
    validUntil: (when: string) => `Link valid until ${when}`,
    expiredOn: (when: string) => `Link expired ${when}`,
    toInvitations: 'Open invitations',
    inviteNotFound: { title: 'Invitation not found', body: 'This group invitation does not exist or was revoked. Go back to the list of groups.' },
    removeConfirm: 'Unlink hotel',
    addHotelTitle: (group: string) => `Link an existing hotel to ${group}`,
    addHotelHint: 'Only hotels that are in no group are listed.',
    hotelField: 'Hotel',
    chooseHotel: 'Choose a hotel…',
    chooseHotelError: 'Choose a hotel.',
    adminTitle: (group: string) => `Group admin of ${group}`,
    adminField: 'Hotel Admin',
    chooseAdmin: 'Choose a Hotel Admin…',
    chooseAdminError: 'Choose a Hotel Admin.',
    adminOption: (admin: string, hotel: string) => `${admin} (${hotel})`,
    adminFrom: (hotel: string) => `Hotel Admin of ${hotel}`,
    noGroupAdmin: 'Nobody is the group admin yet.',
    saveAdmin: 'Save',
    clearAdminTitle: (group: string) => `Remove the group admin of ${group}?`,
    clearAdminBody: 'They stay a Hotel Admin of their own hotel. They only stop seeing the other hotels of the group.',
    activityHint: 'Every change to this group is written here.',
    cancel: 'Cancel',
    saving: 'Saving…',
  },
  groupPage: {
    figures: { hotels: 'Member hotels', active: 'Active', admins: 'Hotel Admins', places: 'Places left' },
    figureNotes: { hotels: 'In this group now', active: 'Open for business', admins: 'Across the member hotels', places: 'Before the limit', noLimit: 'No limit set' },
    adminCard: 'Group Hotel Admin',
    adminName: 'Name',
    adminUsername: 'Username',
    adminHotel: 'Comes from',
    groupAccount: 'A group account (no hotel of its own)',
    aboutTitle: 'About the group',
    aboutHint: 'As the group admin typed it in the onboarding form.',
    about: { legalName: 'Legal name', gstin: 'GSTIN', address: 'Address', place: 'City and state', pin: 'PIN', phone: 'Phone', email: 'Email', submitted: 'Form sent', approved: 'Approved', created: 'Created' },
    hotelsHead: 'Member hotels',
    hotel: 'Hotel',
    webAddress: 'Web address',
    admins: 'Hotel Admins',
    created: 'Created',
    adminCount: (n: number) => `${n} ${n === 1 ? 'admin' : 'admins'}`,
    noAdmin: 'No admin yet',
    aboutHotel: 'About the hotel',
    gstin: 'GSTIN',
    timeZone: 'Time zone',
    place: 'City and state',
    openHotel: 'Open hotel',
    activityHead: 'Activity',
    inviteCard: 'The invitation',
    inviteContact: 'Sent to',
    inviteEmail: 'Email',
    inviteStatus: 'Status',
    inviteSent: 'Sent',
    inviteValid: 'Link valid until',
    inviteExpired: 'Link expired',
    nextCard: 'What happens next',
    next: [
      'The invited person opens the link and fills in the group and their own account.',
      'You or another platform admin approve the group.',
      'They become its Group Hotel Admin and invite the group’s hotels.',
    ],
  },
  adminsPage: {
    card: { admin: 'Hotel Admin', hotel: 'Hotel', status: 'Status', lastSignIn: 'Last sign-in', account: 'Account', username: 'Username', email: 'Email', mobile: 'Mobile', created: 'Added', theHotel: 'The hotel', groupAdmin: 'Group admin of', hotelStatus: 'Hotel status' },
    more: 'More',
    moreLabel: (name: string) => `More for ${name}`,
    openHotel: 'Open hotel',
    scopeTitle: 'Only Hotel Admins are listed here',
    scopeSuper: 'Platform Admins have their own page, Platform admins.',
    openTeam: 'Open Platform admins',
    lockedLine: (n: number) => `${n} ${n === 1 ? 'account is' : 'accounts are'} locked after too many wrong passwords`,
    lockedNote: 'Unlock the account once you know it is really them.',
    showLocked: 'Show locked',
  },
  adminsList: {
    searchLabel: 'Search Hotel Admins',
    tabsLabel: 'Account status',
    snoColumn: 'S.No.',
    clearFilters: 'Clear filters',
    hotelFilter: 'Hotel',
    createHint: 'A temporary password is sent to this email. It is never shown here.',
    createSave: 'Create admin',
    chooseHotel: 'Choose the hotel…',
    hotelRequired: 'Choose the hotel.',
    hotelSuspended: 'Hotel suspended',
    /** Check box: off = admins of live hotels only (the dashboard tile's count); on = admins of archived, rejected and waiting hotels too. */
    includeArchived: 'Include archived hotels',
    summary: (n: number, withArchived: boolean) => `${n} ${n === 1 ? 'Hotel Admin' : 'Hotel Admins'} ${withArchived ? 'of every hotel' : 'of live hotels'}`,
  },
  // A2 (Frontend 2): Dashboard, Hotels list and Hotel details on MJ's model (lifecycle, kind, approval, archive, audited Enter hotel).
  hotelConsole: {
    /** Lifecycle labels (research MUST 3). invited / onboarding are invitations (link sent / link opened), the rest are hotels. */
    lifecycle: { invited: 'Invited', onboarding: 'Onboarding', pending_approval: 'Pending review', active: 'Active', suspended: 'Suspended', archived: 'Archived', rejected: 'Rejected' },
    kind: { individual: 'Individual', group: 'Group' } as Record<PlatformHotelKind, string>,
    dashboard: {
      subtitle: 'Every hotel on the platform at a glance. Archived hotels are not counted.',
      inviteHotel: 'Invite hotel',
      sections: { status: 'Hotels by status', mix: 'Hotel mix and health', people: 'Accounts and invitations' },
      tiles: {
        active: 'Active hotels', suspended: 'Suspended', pending: 'Pending review', createdThisMonth: 'New this month',
        inGroup: 'Hotels in a group', individual: 'Individual hotels', stuck: 'Stuck in setup', inactive: 'Inactive 30 days',
        groups: 'Groups', hotelAdmins: 'Hotel admins', locked: 'Locked accounts', invitations: 'Invitations pending',
      },
      hints: {
        active: 'Open for business', suspended: 'Nobody can sign in', pending: 'Hotels to review', createdThisMonth: 'Hotels created',
        inGroup: 'Run with a Group Hotel Admin', individual: 'Standalone hotels', stuck: 'Live, no admin signed in yet', inactive: 'No sign-in or change',
        groups: 'Active groups', hotelAdmins: 'Across all hotels', locked: 'Too many wrong passwords', noneLocked: 'Nobody locked out',
      },
      /** Groups tile chip: every listed group in one of its parts, so the parts add up to the tile (active, to review, waiting for its admin, rejected); zero parts are left out.
       *  Short words joined by " · " so the chip fits one line of a 1280px tile. */
      groupsMix: (active: number, review: number, waitingAdmin = 0, rejected = 0) =>
        [`${active} active`, review > 0 ? `${review} to review` : '', waitingAdmin > 0 ? `${waitingAdmin} waiting` : '', rejected > 0 ? `${rejected} rejected` : '']
          .filter(Boolean)
          .join(' · '),
      /** Hotels in live hotels only (archived and rejected hotels' admins are not counted). */
      hotelAdminsHint: 'Of live hotels',
      expired: (n: number) => `${n} expired`,
      noneExpired: 'None expired',
      partialError: 'Some figures could not be loaded, so they show a dash.',
      notAvailable: '–',
      /** The console's Today page (MJ, 5 Nov 2026: the hotel Home's pattern for the Super Admin and the Platform Admin). */
      home: {
        line: (date: string) => `Platform console · ${date}`,
        summary: (hotels: number, groups: number, admins: number) => `${hotels} live ${hotels === 1 ? 'hotel' : 'hotels'} · ${groups} ${groups === 1 ? 'group' : 'groups'} · ${admins} hotel ${admins === 1 ? 'admin' : 'admins'}`,
        jobsLabel: 'What waits for you',
        jobs: {
          hotels: { label: 'Hotels to review', note: 'Onboarding forms sent in', none: 'No form waiting' },
          groups: { label: 'Groups to review', note: 'Group forms sent in', none: 'No group waiting' },
          invites: { label: 'Invitations waiting', note: (expired: number) => (expired > 0 ? `${expired} expired, send again` : 'Sent, not used yet') },
          locked: { label: 'Locked accounts', note: 'Too many wrong passwords', none: 'Nobody locked out' },
        },
        attention: 'Needs attention',
        recent: 'Recent hotels',
        figures: { active: 'Active hotels', created: 'New this month', suspended: 'Suspended', stuck: 'Stuck in setup', inactive: 'Inactive 30 days', admins: 'Hotel admins' },
        figureNotes: { active: 'Open for business', created: 'Hotels created', suspended: 'Nobody can sign in', stuck: 'No admin signed in yet', inactive: 'No sign-in or change', admins: 'Of live hotels' },
        open: 'Open',
      },
    },
    list: {
      subtitle: 'Every hotel on the platform: individual hotels and hotels in a group.',
      columns: { name: 'Hotel', group: 'Group', type: 'Type', status: 'Status', created: 'Created', lastActivity: 'Last activity', adminEmail: 'Hotel Admin email', users: 'Users', actions: 'Actions', sent: 'Invited on', email: 'Email' },
      /** The narrower table (fits 1280px): secondary facts sit as sub-lines under the main one. */
      fit: {
        groupType: 'Type and group',
        admin: 'Users and admin',
        slugLine: (slug: string, gstin: string) => [slug, gstin].filter(Boolean).join(' · '),
        lastActivity: (when: string) => `Last activity ${when}`,
        noActivity: 'No activity yet',
        users: (n: number) => `${n} ${n === 1 ? 'user' : 'users'}`,
      },
      individual: 'Individual',
      typeFilter: 'Type',
      allTypes: 'All types',
      groupFilter: 'Group',
      allGroups: 'All groups',
      review: 'Review',
      reviewTitle: (hotel: string) => `Review the onboarding form of ${hotel}`,
      noActivity: 'None yet',
      noAdmin: 'No admin yet',
      enterOnlyActive: 'Only an active hotel can be entered.',
      archivedHidden: 'Archived hotels are hidden. Open the Archived tab to see them.',
      /** The filter bar's summary on a status tab (Reset sits next to it, as in Pallav's filter bar). */
      shown: (n: number) => `${n} ${n === 1 ? 'hotel' : 'hotels'}`,
      createdIn: (month: string) => `Only hotels created in ${month}. Clear filters to see every hotel.`,
      openInvitations: 'Open invitations',
      onTheWay: (n: number) => `${n} ${n === 1 ? 'invitation is' : 'invitations are'} on the way`,
      onTheWayNote: 'A hotel joins this list once its owner sends the onboarding form.',
      card: {
        hotel: 'Hotel',
        type: 'Type',
        admin: 'Hotel admin',
        activity: 'Last activity',
        createdOn: (when: string) => `Created ${when}`,
        aboutHotel: 'About the hotel',
        webAddress: 'Web address',
        gstin: 'GSTIN',
        place: 'City and state',
        created: 'Created',
        aboutAdmin: 'Hotel admin and users',
        email: 'Admin email',
        users: 'Users',
        locked: 'Locked accounts',
        aboutGroup: 'Type and group',
        group: 'Group',
        notGiven: 'Not given',
      },
      factsError: 'Last activity, admin email and user counts could not be loaded.',
      searchPlaceholder: 'Search hotel, city, GSTIN, group',
    },
    enter: {
      title: (hotel: string) => `Enter ${hotel}`,
      body: 'Opens for 60 minutes: view only, or with full access if the Super Admin gave you that. Every action is logged.',
      reason: 'Reason',
      reasonPlaceholder: 'For example: the hotel asked for help with a bill',
      reasonHint: 'At least 5 characters. Kept in the activity log with your name.',
      reasonShort: 'Write at least 5 characters.',
      confirm: 'Enter hotel',
      cancel: 'Cancel',
      notActive: 'Only an active hotel can be entered.',
    },
    details: {
      reviewTitle: 'Approve / Reject',
      reviewHint: 'Read the form the hotel sent, then approve it or reject it with a reason. Nothing here can be edited.',
      hotelSection: 'Hotel',
      adminSection: 'First Hotel Admin',
      rejectReasonHint: 'Required. The hotel is told this reason by email.',
      rejectedOn: (when: string) => `Rejected on ${when}.`,
      archiveExport: 'Export data (CSV)',
      exportMock: 'Test version: the real app downloads every record of this hotel as CSV files here.',
      archiveExportHint: 'Before you archive, download the hotel’s data.',
      archiveBlocked: 'Sign-in is blocked for every user of this hotel. The data is kept and the hotel can be restored.',
      historyTitle: 'Status history',
      historyHint: 'Who changed the status, why and when.',
      noHistory: 'The status has not changed since the hotel was created.',
      historyColumns: { when: 'When', who: 'Who', what: 'What and why' },
      pendingAdminHint: 'Can sign in after approval',
      enterNotActive: 'Enter hotel works only for an active hotel.',
      more: 'More',
      moreLabel: (hotel: string) => `More actions for ${hotel}`,
      typeTitle: 'Type and group',
      statusTitle: 'Status',
      since: 'Since',
      byWhom: (who: string) => `by ${who}`,
      admin: { username: 'Username', email: 'Email', mobile: 'Mobile', status: 'Status', lastSignIn: 'Last sign-in', account: 'Account' },
      kind: 'Type',
      submitted: 'Form sent',
    },
  },
  // A8 (Frontend 1): Super Admin extras part 2. Platform admins, Platform health, Platform settings, Archived hotels.
  superOnlyPage: { title: 'Only the Super Admin sees this page', body: 'Ask the Super Admin if you need something changed here.' },
  hotelMail: {
    title: 'Hotel and group mail',
    subtitle: 'Give a hotel or a group its own Amazon SES and Google login. A hotel\'s mail tries itself first, then its group, then the platform.',
    pick: 'Hotel',
    pickPlaceholder: 'Choose a hotel or a group',
    searchPlaceholder: 'Search a hotel or group',
    noHotels: 'No hotels to show.',
    states: { both: 'Own SES and Google', ses: 'Own SES', gmail: 'Own Google', none: 'Platform mail' },
    groupStates: { both: 'SES and Google', ses: 'SES only', gmail: 'Google only', none: 'Not set' },
    kinds: { all: 'All', hotel: 'Hotels', group: 'Groups' },
    filters: { all: 'Everything', notSet: 'Using the platform', own: 'Has its own' },
    columns: { name: 'Name', kind: 'Type', mail: 'Mail goes out through', accounts: 'Own accounts', sendsAs: 'Sends as' },
    autoAddress: 'Made by itself from the name and the From address saved in Platform settings > Email. Change that address and every one follows.',
    noDomain: 'Save a From address on your own domain (not Gmail) in Platform settings > Email to get these.',
    kindWord: { hotel: 'Hotel', group: 'Group' },
    inGroup: (n: number) => (n === 1 ? '1 hotel' : `${n} hotels`),
    summary: (hotels: number, groups: number, own: number) => `${hotels} ${hotels === 1 ? 'hotel' : 'hotels'}, ${groups} ${groups === 1 ? 'group' : 'groups'}; ${own} with their own mail`,
    empty: 'Nothing matches.',
    open: 'Set up',
    back: 'Back to the list',
    orderHotel: 'Hotel > its group > platform',
    orderGroup: 'Group > platform',
    howTitle: 'How this hotel\'s mail is sent',
    how: [
      'The hotel\'s own Amazon SES. If it has no SES, its own Google.',
      'If that fails: the platform\'s Amazon SES.',
      'If that fails too: the platform\'s Google backup.',
    ],
    ses: {
      title: 'Amazon SES',
      about: 'The hotel\'s SES SMTP login (SES console > SMTP settings). The From address must be verified in that SES account.',
      region: 'Region',
      user: 'SMTP user name',
      password: 'SMTP password',
      from: 'From address',
    },
    gmail: {
      title: 'Google (Gmail)',
      about: 'A Google address with 2-step verification and an app password (Google Account > Security > App passwords).',
      user: 'Google address',
      password: 'App password',
    },
    identity: { title: 'Sender', fromName: 'Sender name', fromNameHint: 'Leave empty to use the hotel\'s name.', replyTo: 'Reply-to address', replyToHint: 'Leave empty to send replies to the From address.' },
    passwordSaved: 'Saved. Leave empty to keep it.',
    passwordUnreadable: 'The saved password cannot be opened on this server. Type it again.',
    notSet: 'Not set',
    remove: 'Remove',
    removeAsk: (what: string, hotel: string) => `Remove the ${what} login of ${hotel}? Its mail then goes the next way in the list.`,
    save: 'Save',
    saving: 'Saving…',
    saved: (hotel: string) => `Mail saved for ${hotel}.`,
    removed: (what: string, hotel: string) => `The ${what} login of ${hotel} was removed.`,
    test: { title: 'Send a test mail', to: 'Send to', send: 'Send test', sending: 'Sending…', ok: 'Test mail sent.', last: 'Last test' },
    keyMissing: 'This server has no mail key, so a password cannot be saved. Ask your developer to set SMTP_SECRET_KEY.',
    errors: {
      hotelUnknown: 'That hotel was not found.',
      groupUnknown: 'That group was not found.',
      pauseReason: 'Choose or write a reason (3 to 200 characters).',
      alreadyPaused: 'Its mail is already paused.',
      notPaused: 'Its mail is not paused.',
      groupSesNotSet: 'This group has no Amazon SES login saved yet.',
      groupGmailNotSet: 'This group has no Google login saved yet.',
      sesRegion: 'Use an SES region such as ap-south-1.',
      sesUser: 'Enter the SMTP user name.',
      sesPassword: 'Enter the SMTP password (up to 500 characters).',
      sesPasswordRequired: 'Type the SMTP password: this login has none saved yet.',
      sesFrom: 'Enter the From address, for example bookings@hotel.com.',
      gmailUser: 'Enter a full Google address.',
      gmailPassword: 'Enter the app password.',
      gmailPasswordRequired: 'Type the app password: this login has none saved yet.',
      fromName: 'The sender name can be up to 100 characters.',
      replyTo: 'Enter one reply-to address or leave it empty.',
      to: 'Enter the address to send the test to.',
      sesNotSet: 'This hotel has no Amazon SES login saved yet.',
      gmailNotSet: 'This hotel has no Google login saved yet.',
    },
  },
  announcements: {
    subtitle: 'A message every hotel admin, or everyone in every hotel, sees on their dashboard until they dismiss it: maintenance tonight, a new feature, a change in the rules.',
    newOne: 'New announcement',
    title: 'Title',
    body: 'Message',
    audience: 'Who sees it',
    audiences: { admins: 'Hotel admins only', everyone: 'Everyone in every hotel' } as Record<'admins' | 'everyone', string>,
    endsOn: 'Last day shown',
    endsOnHint: 'Leave empty to show it until you end it.',
    importance: 'How it shows',
    importances: { normal: 'Normal: opens at the top for a few seconds', important: 'Important: stays open until the person presses Accept' } as Record<'normal' | 'important', string>,
    publish: 'Publish',
    publishing: 'Publishing…',
    published: (title: string) => `"${title}" is published.`,
    end: 'End now',
    endAsk: (title: string) => `End "${title}" now? It disappears from every dashboard at once.`,
    ended: (title: string) => `"${title}" has ended.`,
    columns: { title: 'Announcement', audience: 'Audience', shows: 'Shows', state: 'State', reads: 'Dismissed by', actions: 'Actions' },
    states: { live: 'Live', scheduled: 'Scheduled', over: 'Over' } as Record<'live' | 'scheduled' | 'over', string>,
    shows: (from: string, to: string | null) => (to ? `${from} to ${to}` : `From ${from} until ended`),
    people: (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`,
    empty: { title: 'No announcements yet', body: 'Publish one and every hotel admin sees it on their dashboard the next time they open EasyHotelSolutions.' },
    errors: { titleRequired: 'Give the announcement a title.', titleLong: 'Keep the title under 120 characters.', bodyRequired: 'Write the message.', bodyLong: 'Keep the message under 2,000 characters.', endsOnPast: 'The last day must be today or later.', over: 'This announcement is already over.' },
    logCreated: (title: string) => `Published the announcement "${title}".`,
    logEnded: (title: string) => `Ended the announcement "${title}".`,
  },
  platformStaff: {
    subtitle: 'The people who run the platform. Only the Super Admin manages them.',
    searchPlaceholder: 'Search name, username, email, mobile',
    searchLabel: 'Search platform admins',
    newStaff: 'Add platform admin',
    tabs: { all: 'All', active: 'Active', locked: 'Locked', disabled: 'Disabled' } as Record<'all' | 'active' | 'locked' | 'disabled', string>,
    tabsLabel: 'Account status',
    columns: { name: 'Name', role: 'Role', username: 'Username', status: 'Status', lastSignIn: 'Last sign-in', created: 'Created', actions: 'Actions' },
    snoColumn: 'S.No.',
    you: 'You',
    neverSignedIn: 'Never signed in',
    lockedSince: (when: string) => `Locked since ${when}`,
    empty: { title: 'No Platform Admins yet', body: 'Create the first Platform Admin to help run the platform.' },
    noMatch: { title: 'No Platform Admins match', body: 'Try part of the name, the username, the email or the mobile.' },
    clearFilters: 'Clear filters',
    superNote: 'Super Admins are added by the platform owner only.',
    superCount: (n: number) => `${n} Super ${n === 1 ? 'Admin' : 'Admins'} on the platform.`,
    rulesNote: 'A Platform Admin cannot raise their own rights or change platform roles.',
    twoStepNote: 'Each person chooses in My Profile whether an emailed 6-digit code is asked after the password.',
    form: {
      title: 'Add platform admin',
      hint: 'A temporary password is sent to this email. It is never shown here.',
      role: 'Role',
      roleValue: 'Platform Admin',
      roleHint: 'New platform staff are always Platform Admins. Only the platform owner adds a Super Admin.',
      save: 'Add platform admin',
      saving: 'Saving…',
      cancel: 'Cancel',
    },
    created: (name: string, email: string) => `${name} added. A temporary password was sent to ${email}.`,
    /** "Hotel access" (platform 0135): what a Platform Admin may do when entering hotels. Only the Super Admin sets it. */
    hotelAccess: {
      action: 'Hotel access',
      title: (name: string) => `Hotel access: ${name}`,
      hint: 'What this Platform Admin may do when they enter a hotel. A visit already under way keeps its access; the next one uses what you save here.',
      levelLabel: 'When entering a hotel',
      levels: { none: 'May not enter hotels', view: 'View only', full: 'Full access' } as Record<'none' | 'view' | 'full', string>,
      levelHints: {
        none: 'The Enter hotel button is refused for this person.',
        view: 'Sees every screen of the hotel and can change nothing. This is the default.',
        full: 'Works as the hotel\'s Super Admin, except payments, saved passwords and keys, backups and exports, salary records and letters, and every account and role. Each change is written to the audit log.',
      } as Record<'none' | 'view' | 'full', string>,
      fullNote: 'Changing a hotel’s records during a visit is kept for the Super Admin. A Platform Admin views only.',
      hotelsLabel: 'Which hotels',
      allHotels: 'All hotels',
      chosenHotels: 'Only the hotels I choose',
      chooseHotels: (n: number) => (n === 0 ? 'No hotel chosen yet' : `${n} ${n === 1 ? 'hotel' : 'hotels'} chosen`),
      searchHotels: 'Search hotels',
      reasonLabel: 'Reason',
      reasonHint: '5 to 500 characters. It is written to the audit log.',
      save: 'Save hotel access',
      saving: 'Saving…',
      cancel: 'Cancel',
      saved: (name: string) => `Hotel access of ${name} saved.`,
      neverChanged: 'Never changed: view only, all hotels.',
      lastChanged: (by: string, when: string) => `Last changed by ${by}, ${when}.`,
      loadFailed: 'The current access could not be loaded.',
    },
    rowAction: (action: string, name: string) => `${action}: ${name}`,
    logCreated: (name: string) => `Created Platform Admin ${name}. A temporary password was emailed.`,
  },
  platformHealth: {
    subtitle: 'Each live hotel: database changes, database, mail and the last backup.',
    checkNow: 'Check now',
    checking: 'Checking…',
    checkedAt: (when: string) => `Last checked ${when}`,
    checked: 'Health check done.',
    tilesLabel: 'Health of the hotels',
    tiles: { healthy: 'Hotels healthy', attention: 'Need attention', noBackup: 'Without backup', pending: 'Database changes waiting' },
    tileHints: { healthy: 'Everything works', attention: 'Something to look at', noBackup: 'No backup taken yet', pending: (latest: number) => `Latest change is no. ${latest}` },
    tabs: { all: 'All hotels', attention: 'Needs attention' } as Record<'all' | 'attention', string>,
    tabsLabel: 'Show',
    columns: { hotel: 'Hotel', migrations: 'Database changes', database: 'Database', mail: 'Mail', backup: 'Last backup', activity: 'Last activity', status: 'Status' },
    bills: { none: 'No bills this month', count: (n: number) => `${n} ${n === 1 ? 'bill' : 'bills'} this month` },
    storage: (size: string) => `${size} of data`,
    migrations: (applied: number, pending: number) => (pending > 0 ? `${applied} applied, ${pending} pending` : `${applied} applied`),
    database: { ok: 'OK', slow: 'Slow', down: 'Down' } as Record<'ok' | 'slow' | 'down', string>,
    mail: { ok: 'OK', failing: 'Failing' } as Record<'ok' | 'failing', string>,
    status: { healthy: 'Healthy', attention: 'Needs attention', down: 'Down' } as Record<'healthy' | 'attention' | 'down', string>,
    ms: (n: number) => `${n} ms`,
    noBackup: 'No backup yet',
    suspended: 'Hotel suspended',
    problems: {
      pending: (n: number) => `${n} database ${n === 1 ? 'change is' : 'changes are'} waiting to be applied.`,
      unknownMigrations: (n: number) => `The database has ${n} ${n === 1 ? 'change' : 'changes'} this server does not know (applied by a newer version, or a file was removed).`,
      slow: 'The database answers slowly.',
      down: 'The database does not answer.',
      mail: 'Emails from this hotel are not being sent.',
      noBackup: 'No backup has been taken yet.',
      oldBackup: 'The last backup is more than 2 days old.',
      quiet: (days: number) => `Nobody from this hotel has used EasyHotelSolutions for ${days} days.`,
      neverUsed: 'Nobody from this hotel has used EasyHotelSolutions yet.',
    },
    lastActivity: 'Last activity',
    never: 'Never',
    empty: { title: 'No live hotels', body: 'Health is checked for active and suspended hotels.' },
    allClear: { title: 'All clear', body: 'No hotel needs attention right now.' },
    note: 'Test version: the figures are sample data. The real check reads each hotel’s database, mail and backups.',
    logChecked: (summary: string) => `Ran the platform health check${summary ? `: ${summary}` : '.'}`,
    summary: (healthy: number, attention: number) => `${healthy} healthy, ${attention} need attention.`,
  },
  platformSettings: {
    subtitle: 'Defaults for new hotels and the sender of platform emails.',
    sections: { hotels: 'New hotels', mail: 'Email service', security: 'Sign-in security' } as Record<'hotels' | 'mail' | 'security', string>,
    sectionsLabel: 'Settings sections',
    about: {
      hotels: 'What every new hotel starts with. A hotel can change these later in its own Settings.',
      mail: 'Who platform emails (invitations, passwords, codes) come from.',
      security: 'Rules for platform accounts that nobody can switch off.',
    } as Record<'hotels' | 'mail' | 'security', string>,
    fields: {
      roles: 'Permission roles to create',
      gst: 'Default GST %',
      timeZone: 'Time zone',
      inviteHours: 'Invitation link valid for',
      fromName: 'Sender name',
      fromEmail: 'From email',
      sendingDomain: 'Sending domain',
    },
    smtp: {
      title: 'Mail',
      about: 'Platform emails (sign-in codes, invitations, password resets) are sent through the mail service chosen here. Leave the login empty to use the server\'s own mail setup.',
      user: 'Login',
      password: 'Password / key',
      replyTo: 'Reply-to (optional)',
      hints: {
        user: 'The login of the mail service (for Gmail, the Gmail address). Empty = use the server\'s own mail setup.',
        passwordSet: 'A password is saved. Leave this empty to keep it.',
        passwordNone: 'No password saved yet.',
        passwordUnreadable: 'The saved password cannot be opened on this server, so platform mail is sent through the server\'s own mail setup. Type the password again and save.',
        passwordKeyMissing: 'This server has no secret key, so a password cannot be saved here.',
        replyTo: 'Replies to platform emails go here.',
        otherServer: (host: string) => `An older mail server (${host}) is still saved and keeps sending.`,
      },
      clearPassword: 'Remove the saved password',
      sendingFrom: {
        settings: (address: string) => `Sending from: this system's settings (${address})`,
        server: 'Sending from: the server\'s own settings',
      },
      howTo: {
        title: 'How to set up the mail service',
        steps: [
          'Choose the mail service in the list. The steps for that service are shown under it.',
          'Paste its login and password (or key), and the platform From email if it asks for one.',
          'Save, then press Send test email.',
        ],
      },
      test: {
        title: 'Send a test email',
        to: 'Send the test to',
        toHint: 'Save your changes first: the test uses the saved settings.',
        send: 'Send test email',
        sending: 'Sending…',
        last: (when: string) => `Last test: ${when}`,
        never: 'Not tested yet.',
        ok: 'Sent',
      },
      /** Decision 66 (A5): the read-only line about reading this mailbox in Conversations. */
      reading: {
        line: (state: string) => `Reading this mailbox: ${state}`,
        on: 'On',
        off: 'Off',
        notAvailable: 'Off (reading needs Gmail or your own mail server)',
        needsUpdate: 'Off (needs the latest database update)',
        open: 'Conversations > Settings',
      },
      errors: {
        user: 'Enter a valid login (for Gmail, a Gmail address like name@gmail.com).',
        password: 'The password is too long.',
        passwordRequired: 'Enter the password or key of this mail service.',
        keyMissing: 'A password cannot be saved: this server has no secret key.',
        replyTo: 'Enter a valid email address.',
        to: 'Enter the email address to send the test to.',
        notSet: 'Choose the mail service, enter its login and password, save, then send a test.',
        backupUser: 'Enter the Google address that sends the backup mail, like name@gmail.com.',
        backupNotSet: 'Enter the backup Google address and its app password, save, then send a test.',
        failoverMinutes: 'Enter a whole number of minutes from 1 to 1440.',
      },
    },
    hints: {
      roles: 'Ticked roles are created in every new hotel. Super Admin is always created.',
      gst: 'On room charges. Allowed: 0, 5, 12, 18 or 28.',
      inviteHours: 'Set for the pilot. Ask the platform owner to change it.',
      fromName: 'Shown as the sender, for example EasyHotelSolutions.',
      fromEmail: 'The address emails come from.',
      sendingDomain: 'Hotels that use the platform\'s mail send from <hotel>@this domain, for example mail.easyhotelsolutions.in. The domain must be verified with the mail service (DNS records).',
    },
    alwaysCreated: 'Always created',
    hours: (n: number) => `${n} hours${n % 24 === 0 ? ` (${n / 24} ${n === 24 ? 'day' : 'days'})` : ''}`,
    twoStep: {
      label: '2-step sign-in required for platform roles',
      hint: 'The emailed 6-digit code after the password is each person\'s own choice, in My Profile. It is off until they switch it on.',
      locked: 'Locked',
    },
    save: (section: string) => `Save ${section}`,
    saving: 'Saving…',
    saved: (section: string) => `${section} saved.`,
    lastChanged: (who: string, when: string) => `Last changed by ${who} on ${when}.`,
    neverChanged: 'Not changed since the platform started.',
    logUpdated: (what: string) => `Changed the platform settings${what ? `: ${what}` : '.'}`,
    changed: { roles: 'roles for new hotels', gst: 'default GST', timeZone: 'time zone', mail: 'mail sender', smtp: 'mail server', backup: 'mail backup and failover' },
  },
  archivedHotels: {
    subtitle: 'Archived hotels keep their data for 90 days. After that the Super Admin can delete them for good.',
    searchPlaceholder: 'Search hotel, address, city, reason',
    searchLabel: 'Search archived hotels',
    columns: { hotel: 'Hotel', archived: 'Archived on', by: 'By', reason: 'Reason', grace: 'Grace period', exportCol: 'Export', actions: 'Actions' },
    snoColumn: 'S.No.',
    noReason: 'No reason given',
    daysLeft: (n: number, of: number) => `${n} ${n === 1 ? 'day' : 'days'} left of ${of}`,
    graceOver: 'Grace period over',
    eligible: 'Can be deleted for good',
    notExported: 'Not exported yet',
    exportedOn: (when: string) => `Exported ${when}`,
    exportData: 'Export data',
    restore: 'Restore',
    deleteForever: 'Delete permanently',
    restoreOnlyInGrace: 'Restore works only inside the 90-day grace period.',
    deleteInGrace: (n: number) => `Can be deleted after the grace period (${n} ${n === 1 ? 'day' : 'days'} left).`,
    deleteNeedsExport: 'Export the data first.',
    empty: { title: 'No archived hotels', body: 'A hotel that is archived shows here, with its data kept for 90 days.' },
    noMatch: { title: 'No archived hotels match', body: 'Try part of the hotel name, its address, the city or the reason.' },
    clearSearch: 'Clear search',
    exportTitle: (hotel: string) => `Export the data of ${hotel}?`,
    exportBody: 'Every record of this hotel is packed into one file. Keep it safe before anything is deleted.',
    exportConfirm: 'Export data',
    exportDone: 'Export prepared',
    exportFile: (file: string) => `File: ${file}`,
    restoreTitle: (hotel: string) => `Restore ${hotel}?`,
    restoreBody: 'The hotel is active again and its users can sign in.',
    restoreConfirm: 'Restore hotel',
    deleteTitle: (hotel: string) => `Delete ${hotel} for good?`,
    deleteBody: 'This removes the hotel and every account of it. It cannot be undone. Bills and payment records stay in the legal archive as the law requires.',
    deleteStep1: 'Yes, continue',
    deleteTypeTitle: (hotel: string) => `Type the address of ${hotel}`,
    deleteTypeLabel: (slug: string) => `Type ${slug} to confirm`,
    deleteTypeHint: 'This is the last step. The hotel is deleted as soon as you press Delete.',
    deleteConfirm: 'Delete permanently',
    deleteSlugMismatch: 'The address does not match. Type it exactly as shown.',
    deleted: (hotel: string) => `${hotel} was deleted for good.`,
    exportFirstNote: 'Export is offered before archiving (on Hotel details) and again here before a permanent delete.',
    cancel: 'Cancel',
    logExported: (hotel: string, file: string) => `Exported the data of ${hotel}${file ? ` (${file})` : ''}.`,
    logDeleted: (hotel: string) => `Deleted ${hotel} for good after its grace period and an export.`,
    exportMockNote: 'Test version: no file is made. The real server emails a download link.',
  },
  a8Errors: {
    superOnly: 'Only the Super Admin can do this.',
    notStaff: 'This account is not a Platform Admin.',
    gstRate: 'Enter a GST rate of 0, 5, 12, 18 or 28.',
    fromNameRequired: 'Enter the sender name.',
    rolesUnknown: 'One of the chosen roles does not exist. Refresh and try again.',
    restoreGraceOver: 'The 90-day grace period is over, so this hotel cannot be restored.',
    deleteInGrace: (n: number) => `This hotel is still in its grace period (${n} ${n === 1 ? 'day' : 'days'} left).`,
    deleteNeedsExport: 'Export the hotel’s data before deleting it.',
    deleteNotArchived: 'Only an archived hotel can be deleted permanently.',
  },
  /** Platform Dashboard footer, Super Admin, mock mode only (test version). */
  demoReset: {
    button: 'Reset demo data',
    title: 'Reset the demo data?',
    message:
      'Every hotel, group, invitation, account and log entry made in this browser tab is removed, and the console goes back to its starting test data. Onboarded admins can no longer sign in.',
    confirm: 'Reset demo data',
    done: 'Demo data reset. The console shows its starting test data again.',
    note: 'Test version: changes are kept in this browser tab only.',
  },
} as const;

// ---------------------------------------------------------------- seed

export interface HotelRec {
  id: string;
  name: string;
  slug: string;
  city: string;
  state: string;
  gstin: string;
  timeZone: string;
  status: PlatformHotelStatus;
  createdAt: string;
  suspendedAt: string | null;
  suspendReason: string | null;
  gstDefaults: PlatformGstDefaults;
  submittedAt?: string | null;
  invitationId?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectReason?: string | null;
  archivedAt?: string | null;
  archiveReason?: string | null;
  /** The status the hotel had when it was archived; Restore returns to it (a seed hotel archived without it was active). */
  statusBeforeArchive?: PlatformHotelStatus | null;
  /** The onboarding form (no password). */
  onboarding?: PlatformOnboardingSummary | null;
}

export interface AdminRec {
  id: string;
  hotelId: string;
  name: string;
  username: string;
  email: string;
  mobile: string;
  status: PlatformAdminStatus;
  lastSignInAt: string | null;
  lockedAt: string | null;
  createdAt: string;
}

export interface GroupRec {
  id: string;
  name: string;
  hotelIds: string[];
  /** A Hotel Admin (AdminRec id) set as group admin. */
  groupAdminId: string | null;
  /** The most hotels the group may have; absent or null = no limit. */
  maxHotels?: number | null;
  createdAt: string;
  /** A group-level account (UserRec id) as group admin; wins over groupAdminId. */
  groupAdminUserId?: string | null;
  status?: PlatformGroupStatus;
  legalName?: string | null;
  gstin?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pin?: string | null;
  phone?: string | null;
  email?: string | null;
  invitationId?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectReason?: string | null;
}

/** Accounts that are not Hotel Admin records: Super / Platform Admins, Group Hotel Admins (group level), Hotel Users. */
export interface UserRec {
  id: string;
  name: string;
  username: string;
  email: string;
  mobile: string;
  level: Exclude<PlatformUserLevel, 'hotel_admin'>;
  hotelId: string | null;
  groupId: string | null;
  status: PlatformUserStatus;
  lastSignInAt: string | null;
  lockedAt: string | null;
  createdAt: string;
}

export interface InvRec {
  id: string;
  token: string;
  type: PlatformInvitationType;
  hotelName: string;
  contactName: string;
  email: string;
  /** member_hotel: the group; group: the new group once approved. */
  groupId: string | null;
  /** group type: the pending group made by the form (internal until approved). */
  madeGroupId: string | null;
  /** Stored status; 'expired' is derived from expiresAt. */
  status: Exclude<PlatformInvitationStatus, 'expired'>;
  createdAt: string;
  expiresAt: string;
  openedAt: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  invitedByName: string;
  invitedByRole: PlatformInviterRole;
  resendCount: number;
  hotelId: string | null;
}

// ---------------------------------------------------------------- API

export type PlatformApi = ReturnType<typeof createPlatformApi>;

/**
 * Optional mock-only hooks, so the web app can mirror onboarding admins into the auth mock (sign-in after approval).
 * Pure callbacks: this file never imports auth. The password reaches onAdminSubmitted only; it is never stored, returned or logged here.
 */
export interface PlatformMockHooks {
  /** After the onboarding form passes validation, before the hotel / group is made. hotelId is '' for kind 'group' (groupId is set). */
  onAdminSubmitted?(info: {
    hotelId: string; hotelName: string; kind: 'hotel' | 'group'; groupId?: string;
    admin: { name: string; username: string; email: string; mobile: string; password: string };
  }): { ok: true } | { ok: false; reason: 'username_taken' } | void;
  /** A hotel (or group, hotelId '') was approved, or an archived hotel was restored to active. */
  onApproved?(info: { hotelId: string; username: string; kind: 'hotel' | 'group' }): void;
  /** A waiting hotel or group was rejected (hotelId '' for a group). */
  onRejected?(info: { hotelId: string; username: string }): void;
  /** A hotel was archived: once per admin of that hotel. */
  onArchived?(info: { hotelId: string; username: string }): void;
  /**
   * Sign-in access of a whole hotel changed (suspend, reactivate, archive, restore): once per successful call, never on a refusal.
   * reason: the suspend / archive reason (after a restore to suspended, the remembered suspend reason). Not called by approval
   * (onApproved) nor by a restore back to rejected (its admins stay disabled). Nothing auth-related is kept in the snapshot.
   */
  onAccessChanged?(info: { hotelId: string; state: 'active' | 'suspended' | 'archived'; reason?: string }): void;
}

/** Bump when the snapshot's shape changes: a saved snapshot of another version is ignored (the store starts from the seed). */
export const PLATFORM_SNAPSHOT_VERSION = 1;

/**
 * The whole mutable mock store (mock only, see PlatformKeep). Every time is an absolute ISO string already on the real clock, so a
 * restored snapshot is never shifted or pulled back again. No password is ever in it (the onboarding password only reaches the hook).
 * Not kept: the signed-in actor (set again by setActor at every sign-in).
 */
export interface PlatformSnapshot {
  v: typeof PLATFORM_SNAPSHOT_VERSION;
  hotels: HotelRec[];
  admins: AdminRec[];
  groups: GroupRec[];
  users: UserRec[];
  invitations: InvRec[];
  activity: PlatformActivity[];
  refused: PlatformActivity[];
  targets: [string, string][];
  auditReasons: [string, string][];
  signIns: PlatformSignIn[];
  health: [string, A8HealthSeed][];
  healthCheckedAt: string;
  settings: A8SettingsRec;
  exportsOf: [string, { at: string; fileName: string }][];
  /** The id counter (nextId). */
  seq: number;
  /** The monotonic write clock (tick): the last write's time in ms. */
  nowMs: number;
}

/**
 * Optional place the mock store saves itself after every change and reads back when it is made (the web app passes this tab's
 * sessionStorage, mock mode only). `load` may hand back anything: a snapshot of another version or a wrong shape is ignored.
 */
export interface PlatformKeep {
  load(): PlatformSnapshot | null;
  save(snapshot: PlatformSnapshot): void;
  clear(): void;
}

// ---------------------------------------------------------------- A8: Super Admin extras part 2 (types, constants, seed)
// Platform admins (staff), Platform health, Platform settings, Archived hotels. Plan: docs/plans/PLAN-PLATFORM-CONSOLE.md (A8).

/** Days an archived hotel keeps its data (and can be restored); after that the Super Admin may delete it for good, once exported. */
export const ARCHIVE_GRACE_DAYS = 90;
/** GST rates a default may use. */
export const PLATFORM_GST_RATES = [0, 5, 12, 18, 28] as const;

export type PlatformStaffStatus = 'active' | 'disabled' | 'locked';

/** A Platform Admin account (platform staff). The role is always platform_admin: Super Admins are added by the platform owner only. */
export interface PlatformStaff {
  id: string;
  name: string;
  username: string;
  email: string;
  mobile: string;
  role: 'platform_admin';
  status: PlatformStaffStatus;
  lastSignInAt: string | null;
  lockedAt: string | null;
  createdAt: string;
  /** The signed-in person (by name; mock). */
  isYou: boolean;
}

export interface PlatformStaffQuery extends Pick<ListQuery, 'search' | 'page' | 'pageSize'> {
  status?: 'all' | PlatformStaffStatus;
}

export type PlatformStaffPage = Page<PlatformStaff> & {
  counts: Record<'all' | PlatformStaffStatus, number>;
  /** Active Super Admins (shown in the note; never listed or changed here). */
  superAdminCount: number;
};

export interface PlatformStaffCreated {
  staff: PlatformStaff;
  tempPasswordNote: string;
}

export interface PlatformStaffReset {
  staff: PlatformStaff;
  message: string;
  tempPasswordNote: string;
}

export type PlatformDbState = 'ok' | 'slow' | 'down';
export type PlatformMailState = 'ok' | 'failing';
export type PlatformHealthStatus = 'healthy' | 'attention' | 'down';

export interface PlatformHealthRow {
  hotelId: string;
  hotelName: string;
  slug: string;
  city: string;
  hotelStatus: PlatformHotelStatus;
  migrationsApplied: number;
  migrationsPending: number;
  database: PlatformDbState;
  /** Answer time of the database check; null when down. */
  databaseMs: number | null;
  mail: PlatformMailState;
  /** null = no backup yet. */
  lastBackupAt: string | null;
  /** When someone of the hotel last did something (ISO); null = never. */
  lastActivityAt?: string | null;
  /** Bills this month (P1): how many guest bills the hotel made this calendar month and their total; null or absent = not read. */
  bills?: { count: number; billedPaise: number } | null;
  /** Storage (P1): what the hotel's own tables take on disk, in bytes (tables, indexes and TOAST); null or absent = not measured. */
  storageBytes?: number | null;
  status: PlatformHealthStatus;
  /** Plain sentences, empty when healthy. */
  problems: string[];
}

export interface PlatformHealth {
  checkedAt: string;
  /** Number of the newest database change (migration). */
  latestMigration: number;
  rows: PlatformHealthRow[];
  tiles: { healthy: number; attention: number; noBackup: number; pendingMigrations: number };
}

export interface PlatformRoleDefault {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  /** Always created (Super Admin), the tick cannot be removed. */
  locked: boolean;
}

export interface PlatformSettings {
  newHotelRoles: PlatformRoleDefault[];
  defaultGstPercent: number;
  defaultTimeZone: string;
  /** INVITATION_VALID_HOURS; read only. */
  invitationValidHours: number;
  mailFromName: string;
  mailFromEmail: string;
  /** Whole hours (1 to 72) the files of an email stay in the bucket after the email went; the clean-up removes them after that. */
  mailFilesKeepHours: number;
  /**
   * The domain the platform's own sending identity lives on, e.g. mail.easyhotelsolutions.in ('' = not set). A hotel that uses the platform's mail (email.mode = 'platform') sends from
   * <hotel slug>@<this domain> with its own name as the sender name and its address as the reply-to. The DNS records and the check come with the identity step.
   */
  mailSendingDomain: string;
  /** The platform mail server the Super Admin set up (Platform settings > Mail). The password is never in it: only `passwordSet`. */
  smtp: PlatformSmtpSettings;
  /** Always true: 2-step sign-in is required for platform roles (research MUST 7). */
  twoStepForPlatformRoles: true;
  updatedAt: string | null;
  updatedBy: string | null;
  /**
   * Decision 66 (A5): whether this mailbox is read in Conversations, shown read-only under Mail ("Reading this mailbox: On/Off"). It is switched in Console > Conversations >
   * Settings. null = not available yet (before platform migration 0139); missing on an older server.
   */
  mailboxReading?: { reading: boolean; state: MailboxState['state'] } | null;
}

/**
 * The platform's mail service (Platform settings > Mail; MAIL-PROVIDERS-50K, 18 Oct 2026): Amazon SES (recommended), Brevo, Gmail or another SMTP server. The server of SES, Brevo and Gmail is
 * fixed by the program; the form asks for the login, the password / key, the sender name (`mailFromName`), the From email (every service but Gmail) and an optional reply-to. The password is
 * never in the answer: only `passwordSet` and when it was saved (`lastChangedAt`).
 */
export interface PlatformSmtpSettings {
  /** The login of the saved mail service (for Gmail, the Gmail address and the From address). Empty = not set up: platform mail then goes through the server's own mail configuration. */
  user: string;
  passwordSet: boolean;
  /** When the password was last saved (ISO time): the form shows "Saved on <date>". The password itself, or any part of it, is never sent; null = none saved. */
  lastChangedAt: string | null;
  /** false only when the server has no key at all (no HMS_HASH_KEY: a development machine without a database): a password cannot be saved. */
  canStorePassword: boolean;
  /** A password is saved but cannot be opened (the key it was sealed with is not the one in use): platform mail is sent through the server's own mail setup until the password is typed again. */
  passwordUnreadable: boolean;
  /** An address replies go to; empty = none. */
  replyTo: string;
  /** Always null now: an older server shows as its own provider. */
  otherServer: string | null;
  /**
   * The status line: where platform mail goes out from NOW. settings = the mail service saved in this system (address = its login, provider = the service); server = the server's own SMTP_*
   * settings (used only while nothing is saved here; address = null). Once a service is saved the server's values are never used.
   */
  sendingFrom: { source: 'settings' | 'server'; address: string | null; provider: MailProviderId | null };
  /** The last "Send test email": when, whether it worked and the exact result. null = never tested. */
  lastTest: PlatformSmtpTestResult | null;
  /** The mail service in use (MAIL-PROVIDERS-50K, 18 Oct 2026): gmail, brevo, ses or smtp. null = none saved (the server's own mail setup sends). `user` is its login. */
  provider: MailProviderId | null;
  /** The server the saved provider uses (fixed for Gmail and Brevo; the region for SES; typed for another SMTP server). null = none saved. */
  server: MailServerInfo | null;
  /** The daily limit the Super Admin typed for platform mail; null = the service's own. */
  dailyLimit: number | null;
  /** What the provider allows now (after the daily limit); null = none saved. */
  limits: MailLimitsInfo | null;
  /** The backup mail service: a Google (Gmail or Workspace) address with an app password. Platform mail goes through it when the main service (Amazon SES) fails. */
  backup: PlatformBackupSettings;
  /** When and how platform mail moves from the main service to the backup and back. */
  failover: PlatformFailoverSettings;
}

/** The backup service. The app password is never in the answer: only `passwordSet` and when it was saved. */
export interface PlatformBackupSettings {
  /** The Google address that sends, and is the From address (Google sends as the account itself). Empty = no backup. */
  user: string;
  passwordSet: boolean;
  lastChangedAt: string | null;
  passwordUnreadable: boolean;
  /** What Google allows a day (500, or 2,000 for a Workspace address); null = no backup set up. */
  limits: MailLimitsInfo | null;
  lastTest: PlatformSmtpTestResult | null;
}

export type PlatformMailRoute = 'primary' | 'backup';

export interface PlatformFailoverEvent {
  at: string;
  from: PlatformMailRoute;
  to: PlatformMailRoute;
  /** A fixed sentence (never the mail server's own words). */
  reason: string;
}

export interface PlatformFailoverSettings {
  /** Switch to the backup on its own when the main service fails. Off = a failed mail simply waits and is retried through the main service. */
  enabled: boolean;
  /** After this many minutes on the backup the main service is tried again (1 to 1440). */
  returnMinutes: number;
  /** Where platform mail goes out from right now. */
  active: PlatformMailRoute;
  /** Since when `active` has been so (ISO time); null = never switched. */
  since: string | null;
  /** The last switches, newest first (at most 10). */
  events: PlatformFailoverEvent[];
}

export interface PlatformSmtpTestResult {
  at: string;
  ok: boolean;
  /** The exact result: "Sent" or the mail server's own refusal (never the password). */
  message: string;
  /** Plain help for the usual failures of the chosen service (a wrong login or key, the SES sandbox, an unreachable server); only on a failure. */
  hint?: string;
}

/** The mail part of the settings. Only the given fields are saved; `password` undefined keeps the saved one, `clearPassword` removes it (a login without its password is refused); an empty `user` switches the service off. */
export interface PlatformSmtpInput {
  /** The mail service. Left out = the one saved (Gmail when none). Changing it needs the new service's password. gmail/brevo/ses: the server is fixed; ses takes `region`; smtp takes host, port, security. */
  provider?: MailProviderId;
  host?: string;
  port?: number;
  security?: MailSecurity;
  region?: string;
  /** null or 0 = the service's own limit. */
  dailyLimit?: number | null;
  user?: string;
  replyTo?: string;
  password?: string;
  clearPassword?: boolean;
  /** The backup service (a Google address and its app password). An empty `user` switches the backup off. */
  backup?: { user?: string; password?: string; clearPassword?: boolean };
  failover?: { enabled?: boolean; returnMinutes?: number };
}
/** Only the given parts are saved. roleKeys: the ticked roles (Super Admin is always kept). */
export interface PlatformSettingsInput {
  roleKeys?: string[];
  defaultGstPercent?: number;
  defaultTimeZone?: string;
  mailFromName?: string;
  mailFromEmail?: string;
  /** 1 to 72. */
  mailFilesKeepHours?: number;
  /** '' clears it. */
  mailSendingDomain?: string;
  smtp?: PlatformSmtpInput;
}

/** Mails sent by the platform and by each hotel in one month (Platform > Mail usage), and the Super Admin's daily cap per hotel. Counted by the mail worker per UTC day. */
export interface PlatformMailUsage {
  /** YYYY-MM. */
  month: string;
  /** Days in that month. */
  days: number;
  /** Mails the platform itself sent (codes, resets, invitations ...) that month. */
  platformSent: number;
  /** All mails that month: the platform's and every hotel's. */
  totalSent: number;
  /** Every listed hotel, most mails first; a hotel with no mail has 0. */
  hotels: PlatformMailUsageHotel[];
}
export interface PlatformMailUsageHotel {
  hotelId: string;
  name: string;
  slug: string;
  sentThisMonth: number;
  sentToday: number;
  /** The most mails a day the Super Admin allows this hotel; null = no cap (the hotel's mail service limits apply). 0 stops its campaigns. */
  dailyCap: number | null;
}
/** The Super Admin's daily cap for one hotel: a whole number of mails a day, or null to remove it. It lowers the figure of the hotel's mail service and never raises it. */
export interface PlatformMailCapInput {
  dailyCap: number | null;
}

/** An announcement to the hotels (P4): what the Super Admin wrote, who it is for, and when it shows. */
export interface PlatformAnnouncement {
  id: string;
  title: string;
  body: string;
  /** admins: every Hotel Admin; everyone: every person in every hotel. */
  audience: 'admins' | 'everyone';
  /** Opens the top notch until the person presses Accept. */
  important: boolean;
  startsAt: string;
  /** When it stops showing by itself; null = until ended. */
  endsAt: string | null;
  /** Set when the Super Admin ended it early. */
  endedAt: string | null;
  /** live (showing now), scheduled (starts later), over (ended or past its end). */
  state: 'live' | 'scheduled' | 'over';
  createdBy: string | null;
  createdAt: string;
  /** How many people dismissed it. */
  reads: number;
}
export interface PlatformAnnouncementInput {
  title: string;
  body: string;
  audience: 'admins' | 'everyone';
  important?: boolean;
  /** YYYY-MM-DD (IST), the last day it shows; empty = until ended. */
  endsOn?: string | null;
}

/** One hotel in the Hotel mail list: which of its own mail accounts are set up. Hotels with neither send through the platform's mail. */
/** A pause of a hotel's or group's mail (Super Admin): who, when, why, and whether it covers the hotels of a group ('all') or only the group's own accounts ('one'). */
export interface PlatformMailPause {
  at: string;
  by: string;
  reason: string;
  scope: 'all' | 'one';
}
/** Pause (paused true) or resume (false) the mail of one hotel or group. `scope` only counts for a group. */
export interface PlatformMailPauseInput {
  paused: boolean;
  reason?: string;
  scope?: 'all' | 'one';
}
export const MAIL_PAUSE_REASONS: readonly string[] = ['Unpaid invoice', 'Complaints above the limit', 'Account under review', 'Asked by the owner', 'Other'];

export interface PlatformHotelMailSummary {
  hotelId: string;
  name: string;
  city: string | null;
  status: string;
  ses: boolean;
  gmail: boolean;
  /** Null while its own mail runs. A hotel can also be stopped by its group (the screen works that out from the groups). */
  pause?: PlatformMailPause | null;
  /** The address its mail goes out as on the platform's domain (name@domain, made by itself from the hotel's slug and the Super Admin's From address); null while there is no such domain. */
  address?: string | null;
}
/** A hotel's own mail accounts as the screen shows them: never a password, only whether one is saved. */
export interface PlatformHotelMail {
  hotelId: string;
  hotelName: string;
  ses: { region: string; user: string; from: string; passwordSet: boolean; passwordUnreadable: boolean; lastTest: PlatformSmtpTestResult | null };
  gmail: { user: string; passwordSet: boolean; passwordUnreadable: boolean; lastTest: PlatformSmtpTestResult | null };
  /** The sender name the hotel's mail shows (empty = the hotel's name) and where replies go (empty = the From address). */
  fromName: string;
  replyTo: string;
  /** False when the server has no mail key: no password can be saved. */
  canStorePassword: boolean;
  /** Its automatic address through Amazon SES (name@domain); a saved SES email address replaces it. null = the From address has no own domain. */
  address?: string | null;
  pause?: PlatformMailPause | null;
}
/** One group in the mail list: which of its own mail accounts are set up. Its hotels use them when a hotel has none of its own. */
export interface PlatformGroupMailSummary {
  groupId: string;
  name: string;
  /** How many hotels belong to it. */
  hotels: number;
  /** Which hotels (the hierarchy of the Hotel and group mail page). */
  hotelIds?: string[];
  status: string;
  ses: boolean;
  gmail: boolean;
  pause?: PlatformMailPause | null;
  /** The group's address on the platform's domain, made by itself (see the hotel's). */
  address?: string | null;
}
/** A group's own mail accounts as the screen shows them (the same facts as a hotel's). */
export interface PlatformGroupMail extends Omit<PlatformHotelMail, 'hotelId' | 'hotelName'> {
  groupId: string;
  groupName: string;
}
/** A save: a part left out stays as it is; `clear` removes that account. A password left out keeps the saved one. */
export interface PlatformHotelMailInput {
  ses?: { region?: string; user?: string; password?: string; from?: string; clear?: boolean };
  gmail?: { user?: string; password?: string; clear?: boolean };
  fromName?: string;
  replyTo?: string;
}

/** Where Amazon SES receiving hands received mail to HMS: the address for the SNS subscription (null while the server cannot make it) and whether the server knows its SNS topic. */
export interface PlatformInboundMail {
  address: string | null;
  topicSet: boolean;
}
export interface PlatformArchivedHotel {
  id: string;
  name: string;
  slug: string;
  city: string;
  state: string;
  groupName: string | null;
  archivedAt: string;
  /** Who archived it (from the audit log). */
  archivedBy: string;
  reason: string | null;
  graceDays: number;
  /** Whole days left of the grace period; 0 = over. */
  daysLeft: number;
  graceEndsAt: string;
  /** Inside the grace period. */
  canRestore: boolean;
  /** Grace period over AND exported (the Super Admin must still type the address). */
  canDelete: boolean;
  exportedAt: string | null;
  exportFileName: string | null;
  adminCount: number;
}

export interface PlatformHotelExport {
  hotelId: string;
  /** Mock file name, e.g. "gir-forest-lodge-export-2026-10-05.zip". */
  fileName: string;
  exportedAt: string;
  message: string;
  note: string;
}

export interface PlatformHotelDeleted {
  hotelId: string;
  name: string;
  message: string;
}

export interface A8HealthSeed {
  hotelId: string;
  migrationsApplied: number;
  migrationsPending: number;
  database: PlatformDbState;
  databaseMs: number;
  mail: PlatformMailState;
  lastBackupAt: string | null;
}

export interface A8SettingsRec {
  roleKeys: string[];
  defaultGstPercent: number;
  defaultTimeZone: string;
  mailFromName: string;
  mailFromEmail: string;
  mailSendingDomain: string;
  mailFilesKeepHours: number;
  smtp: { provider: MailProviderId; host: string; port: number; security: MailSecurity; region: string; dailyLimit: number | null; user: string; passwordSet: boolean; replyTo: string; otherHost: string; lastTest: PlatformSmtpTestResult | null };
  backup: { user: string; passwordSet: boolean; lastTest: PlatformSmtpTestResult | null };
  failover: PlatformFailoverSettings;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Guided set-up (MJ, 5 Nov 2026): the Set-up centre's words and the shared checklist and wizard words (setupParts.tsx). */
export const setupCopy = {
  state: { not_set_up: 'Not set up', working: 'Working', attention: 'Needs attention', done: 'Done', todo: 'To do', checking: 'Checking…' },
  back: 'Back',
  next: 'Next step',
  finish: 'Finish',
  close: 'Back to the list',
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  stepsLabel: 'Steps',
  whereTitle: 'Where to find it',
  later: 'Saved. You can close this and continue later.',
  saveContinue: 'Save and continue',
  continue: 'Continue',
  check: {
    sesUser: 'An SES SMTP user name starts with AKIA and has 20 capital letters and numbers.',
    sesPassword: 'This looks too short. Copy the whole SMTP password.',
    email: 'Type a whole email address, like mail@yourdomain.in.',
    appPassword: 'An app password is 16 letters.',
    savedWithNext: 'This is saved with the next step.',
    longNumber: 'It is a long number, 15 digits or so.',
    token: 'This looks too short for a token. Copy the whole token.',
    phone: 'Type the number with the country code, like 919825012345.',
    hours: (max: number) => `Type a number of hours from 1 to ${max}.`,
    name: 'Give the key a name, like the program that will use it.',
    reason: (min: number) => `Write at least ${min} letters.`,
    ips: 'Type addresses like 203.0.113.7, one per line.',
    rate: (min: number, max: number) => `Type a number from ${min} to ${max}.`,
    dkim: 'A DKIM name is 32 small letters and numbers: the part before ._domainkey.',
  },
  simulated: 'Demo: this test is simulated. Nothing was sent to an outside service.',
  lastTest: (when: string, ok: boolean) => `Last test ${when}: ${ok ? 'it worked.' : 'it did not work.'}`,
  advanced: 'Advanced',
  copy: 'Copy',
  copied: 'Copied.',
  copyFailed: 'Copying is blocked in this browser. Select the text and copy it.',
  title: 'Set-up centre',
  sub: 'The services the whole platform uses, and every hotel’s state. A hotel is set up on its own page. Only the Super Admin sees this page.',
  platformWide: 'For the whole platform',
  perHotel: 'Hotels',
  perHotelNote: 'Open a hotel to set up its payments, mail, WhatsApp and keys on its Integrations tab.',
  hotel: 'Hotel',
  noHotels: 'No hotels yet. Invite a hotel first; its set-up shows here.',
  hotelOverall: {
    nothing: 'Nothing set up yet.',
    allWorking: 'Every service is working.',
    needs: (n: number) => `${n} ${n === 1 ? 'service needs' : 'services need'} attention.`,
    some: (n: number) => `${n} ${n === 1 ? 'service is' : 'services are'} not set up yet.`,
  },
  /** The Integrations tab of a hotel's page (MJ, 5 Nov 2026: "all the setup 3rd party will be done from there"). */
  hotelTab: {
    tab: 'Integrations',
    intro: 'Every outside service of this hotel, its state and the next step. Only the Super Admin sees this tab.',
    label: (hotel: string) => `Integrations of ${hotel}`,
  },
  open: 'Open',
  setUp: 'Set up',
  fix: 'Fix it',
  allWorking: (n: number) => `All ${n} services are working.`,
  needWork: (n: number) => `${n} ${n === 1 ? 'service needs' : 'services need'} your attention.`,
  services: {
    mail: { title: 'Email', text: 'Amazon SES sends every mail; a Google address takes over when SES fails. Senders, files, replies and each hotel’s mail.' },
    whatsapp: { title: 'WhatsApp numbers', text: 'The platform’s and the hotels’ WhatsApp numbers, and the rules for what may be sent.' },
    api: { title: 'API access', text: 'Keys that let another program read or change a hotel’s data.' },
    backups: { title: 'Backups and photo storage', text: 'Where photos and files are kept, and the WhatsApp backup.' },
    payments: { title: 'Online payments', text: 'Guests and companies pay online through Razorpay. Hotel and restaurant are set up apart.' },
    hotelMail: { title: 'Hotel mail', text: 'This hotel’s own Google login and pausing its mail.' },
    hotelWhatsapp: { title: 'WhatsApp number', text: 'Which WhatsApp number this hotel sends from.' },
    website: { title: 'Website Google keys', text: 'The map on the hotel’s website and its Google reviews.' },
    hotelBackup: { title: 'Nightly backup', text: 'A copy of this hotel’s data in Google Drive every night.' },
    hotelApi: { title: 'API access', text: 'Keys that let another program reach this hotel’s data.' },
    idPhotos: { title: 'ID pictures', text: 'How the guests’ ID pictures are stored.' },
  },
  reasons: {
    mailNotTested: 'Saved but never tested. Send a test email.',
    mailFailed: 'The last test email failed.',
    mailOnBackup: 'Mail goes out through the Google backup because Amazon SES failed.',
    mailUnreadable: 'The saved password cannot be opened on this server. Type it again.',
    noBackupMail: 'No Google backup address yet.',
    waNone: 'No number connected yet.',
    waToken: (name: string) => `${name} needs a new token.`,
    waBlocked: (name: string) => `${name} is blocked by WhatsApp.`,
    waPaused: (name: string) => `${name} is paused.`,
    keysMissing: 'No keys saved yet.',
    webhookMissing: 'Keys saved, but no test payment has reached the app yet.',
    payOff: 'Working, but not switched on for guests and companies.',
    lastPayment: (when: string) => `Last payment received ${when}.`,
    backupNever: 'Connected, but no backup has run yet.',
    backupFailed: 'The last backup failed.',
    backupLast: (when: string) => `Last backup ${when}.`,
    hotelWaNone: 'This hotel has no WhatsApp number yet.',
    hotelWaOn: (name: string) => `Sends from ${name}.`,
    websiteNone: 'No Google keys saved.',
    readFailed: 'The state could not be read. Press Fix it to check.',
    apiNone: 'No key for this hotel. Needed only when another program must reach its data.',
    apiKeys: (n: number) => `${n} working ${n === 1 ? 'key reaches' : 'keys reach'} this hotel.`,
    mailPlatform: 'Sends through the platform’s mail.',
    mailOwn: (address: string) => `Sends as ${address}.`,
    idSharp: 'A sharp copy under 500 KB.',
    idExact: 'An exact copy is kept (bigger files).',
  },
  idPhotos: {
    title: (hotel: string) => `ID pictures: ${hotel}`,
    steps: { copy: { title: 'How they are stored', hints: ['Off: a sharp copy, 150 KB or a little more and never above 500 KB. Every name and number still reads the same.', 'On: every pixel of the picture is kept. A file can be larger than 500 KB.'] } },
    exact: 'ID pictures: keep an exact copy (bigger files)',
    exactHint: 'Applies to ID pictures taken from now on.',
  },
  hotelMail: {
    title: (hotel: string) => `Hotel mail: ${hotel}`,
    steps: { account: { title: 'Mail account', hints: ['Leave it empty to send through the platform’s mail. Most hotels need nothing here.', 'Give the hotel its own Google login only when it must send from its own Gmail: Google Account > Security > App passwords.', 'Press Send test to check it.'] } },
  },
  groupMail: {
    title: (group: string) => `Group mail: ${group}`,
    section: 'Integrations',
    row: 'Group mail',
    note: 'The group’s own mail account. Its hotels use it when they have none of their own. Only the Super Admin sees this.',
  },
  hotelWhatsapp: {
    title: (hotel: string) => `WhatsApp: ${hotel}`,
    steps: {
      number: { title: 'Number', hints: ['A hotel sends from the shared number until it has its own.', 'To give it its own number, connect the number below with the kind Hotel and pick this hotel.'] },
      rules: { title: 'Rules', hints: ['What this hotel may send and when. A switch left empty follows the number’s rules.'] },
    },
  },
  mail: {
    title: 'Email set-up',
    steps: {
      service: { title: 'SES region', hints: ['In the AWS console open Amazon SES.', 'The region shows at the top right of the console. Mumbai is ap-south-1.'] },
      sesUser: { title: 'SMTP user name', hints: ['In Amazon SES open SMTP settings > Create SMTP credentials.', 'Copy the SMTP user name. It starts with AKIA and is not your AWS login.'] },
      sesPassword: { title: 'SMTP password', hints: ['Copy the SMTP password shown with the user name. AWS shows it only once.'] },
      from: { title: 'From address', hints: ['Every mail is sent from this address.', 'Verify the address, or its domain, in Amazon SES > Identities first.'] },
      backupUser: { title: 'Backup address', hints: ['The Google address that sends mail when Amazon SES fails.', 'Switch on 2-Step Verification in that Google account.'] },
      backupPassword: { title: 'App password', hints: ['Google Account > Security > App passwords. Make one and copy the 16 letters. Spaces do not matter.'] },
      test: { title: 'Test', hints: ['Send a test email through each service to your own address.'] },
      senders: { title: 'Sending domain', hints: ['In Amazon SES open Identities and the domain: copy the three DKIM names.', 'Add the records below at the company where your domain is registered (its DNS page).', 'Press Check. It can take up to an hour before the records are seen.'] },
      verified: { title: 'Verified in SES', hints: ['In Amazon SES open Identities. Switch this on once the domain shows Verified.'] },
      files: { title: 'Email files', hints: ['Choose how long the files of a sent email stay before they are removed.'] },
      replies: { title: 'Replies coming in', hints: ['In Amazon SES, add a receiving rule that sends mail for your domain to the address shown.'] },
      reading: { title: 'Reading the platform mailbox', hints: ['Switch reading on to see the platform mailbox under Email.', 'Press Test to check reading and sending.'] },
      safety: { title: 'Bounce reports', hints: ['In Amazon SNS make a topic for SES bounces and complaints and add an HTTPS subscription with the address below.', 'In Brevo open Transactional > Settings > Webhook and paste its address.'] },
      holds: { title: 'Held hotels', hints: ['A hotel whose campaign mail bounces too often is held. Release it with a reason once it is fixed.'] },
      blocked: { title: 'Blocked addresses', hints: ['Addresses that bounced or complained get no campaign mail. Lift one only when the owner asks.'] },
      hotels: { title: 'Each hotel and group', hints: ['Pause or resume a hotel’s or a group’s mail.', 'Give a hotel its own Google login only when it must send from its own Gmail.'] },
    },
  },
  whatsapp: {
    title: 'WhatsApp set-up',
    notConnected: 'The platform’s own WhatsApp number is not connected yet. Connect it in the first step, Numbers.',
    steps: {
      numbers: { title: 'Numbers', hints: ['In Meta’s WhatsApp Manager open Account tools > Phone numbers.', 'Copy the Phone number ID and the WhatsApp Business Account ID shown there.', 'Make a permanent access token: Business settings > System users > Generate token.', 'Press Connect a number below and paste them. The app checks the token, subscribes and registers the number by itself.'] },
      templates: { title: 'Approved messages', hints: ['Messages that start a conversation must be approved by WhatsApp first. Their state shows here.'] },
      rules: { title: 'Rules and the stop switch', hints: ['Set how many messages a number may send and when. The stop switch halts every WhatsApp message at once.'] },
    },
  },
  api: {
    title: 'API access',
    makeKey: 'Make a key',
    makeIt: 'Make the key',
    testKey: 'Test the key',
    pasteKey: 'The key',
    pasteHint: 'Paste the key the program uses. It is checked and not kept.',
    steps: {
      keys: { title: 'Keys', hints: ['Make one key for each program, so one can be revoked without stopping the others.'] },
      full: { title: 'Full access', hints: ['Only for a short repair job. Most programs need a read key.'] },
      name: { title: 'Name', hints: ['Name the key after the program that will use it.'] },
      level: { title: 'What it may do', hints: [] as string[] },
      reach: { title: 'What it reaches', hints: [] as string[] },
      expiry: { title: 'How long it works', hints: ['A short time is safer. Make a new key when it runs out.'] },
      ips: { title: 'Allowed addresses', hints: ['Ask the program’s owner for the internet address it calls from.'] },
      why: { title: 'Why', hints: ['Kept in the audit trail with the key.'] },
      rate: { title: 'Calls a minute', hints: [] as string[] },
      testMode: { title: 'Test mode', hints: [] as string[] },
      make: { title: 'Make the key', hints: ['The key is shown once. Copy it straight away.'] },
      test: { title: 'Test', hints: ['Checks that the key works and what it reaches.'] },
    },
  },
  backups: {
    title: 'Backups and photo storage',
    steps: {
      storage: { title: 'Photo storage', hints: ['Photos, ID pictures and files are kept in the storage given to the server.', 'Press Test: the app writes a small file, reads it back and removes it.'] },
      whatsapp: { title: 'WhatsApp backup', hints: ['Every chat is copied each night. Verify opens the backups and checks them without changing anything.'] },
    },
    storageTest: 'Test photo storage',
    run: 'Run backup now',
    verify: 'Verify backups',
  },
  payments: {
    title: (hotel: string) => `Online payments: ${hotel}`,
    business: { hotel: 'Hotel (rooms and stays)', food: 'Restaurant and room service' },
    businessHint: 'Each business has its own Razorpay account. Set up one, then the other.',
    mode: { test: 'Test', live: 'Live' },
    modeHint: { test: 'No real money moves. Start here.', live: 'Real payments from guests and companies.' },
    keyId: 'Key ID',
    keySecret: 'Key secret',
    keyIdWrong: (mode: string) => `A ${mode} Key ID starts with rzp_${mode}_ followed by letters and numbers.`,
    secretRequired: 'Paste the Key secret.',
    webhookUrl: 'Webhook address',
    webhookSecret: 'Webhook secret',
    makeSecret: 'Make the webhook secret',
    secretOnce: 'Copy it now. It is shown only this once.',
    secretSaved: (when: string) => `A webhook secret was made on ${when}.`,
    test: 'Check the keys',
    testHint: 'Checks the keys with Razorpay in test mode. Nobody is charged.',
    on: 'Guests and companies can pay online',
    onHint: 'Switch on when the test worked.',
    save: 'Save and continue',
    saved: 'Saved.',
    steps: {
      business: { title: 'Which business', hints: [] as string[] },
      mode: { title: 'Test or live', hints: ['Use Test first. Switch to Live when the test payment worked.'] },
      keys: { title: 'Keys', hints: ['Open the Razorpay Dashboard.', 'Go to Account and settings > API keys.', 'Generate a key, then copy the Key ID and the Key secret here.'] },
      webhook: { title: 'Webhook', hints: ['In the Razorpay Dashboard open Account and settings > Webhooks > Add new webhook.', 'Paste the address and the secret below. Tick payment.captured and payment.failed.'] },
      test: { title: 'Test', hints: [] as string[] },
      on: { title: 'Switch on', hints: [] as string[] },
    },
  },
  hotelBackup: {
    title: (hotel: string) => `Nightly backup: ${hotel}`,
    clientId: 'Google client ID',
    clientSecret: 'Google client secret',
    keepDays: 'Keep backups for (days)',
    keepHint: 'Older backups are removed by themselves. 30 days is usual.',
    clientIdWrong: 'A Google client ID ends with .apps.googleusercontent.com.',
    keepWrong: 'Type a number of days from 1 to 365.',
    test: 'Test the backup',
    run: 'Run backup now',
    save: 'Save and continue',
    steps: {
      drive: { title: 'Google Drive', hints: ['Open the Google Cloud console and make a project for the backups.', 'APIs and services > Enable APIs > switch on Google Drive API.', 'Credentials > Create credentials > OAuth client ID (Web application). Copy the client ID and the client secret.'] },
      keep: { title: 'How long to keep', hints: [] as string[] },
      test: { title: 'Test and run', hints: ['Test writes a small file to Google Drive and reads it back.'] },
    },
  },
  website: {
    title: (hotel: string) => `Website Google keys: ${hotel}`,
    mapsKey: 'Google Maps key',
    mapsHint: 'Shows the map on the website.',
    gbpClientId: 'Google reviews: client ID',
    gbpClientSecret: 'Google reviews: client secret',
    mapsWrong: 'A Google Maps key starts with AIza.',
    save: 'Save',
    steps: {
      maps: { title: 'Map', hints: ['Google Cloud console > APIs and services > Credentials > Create credentials > API key.', 'Restrict the key to the Maps JavaScript API and to the hotel’s website address.'] },
      reviews: { title: 'Google reviews', hints: ['Google Cloud console > Credentials > OAuth client ID (Web application).', 'Copy the client ID and the client secret here.'] },
    },
  },
  testWorked: 'It works.',
  testFailed: 'It did not work.',
};
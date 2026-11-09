// The in-memory mock of platform.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import type { MockClock, DashResult, Page, DashError, DashErrorCode } from './common';
import { mailProviderCopy, type MailLimitsInfo, type MailProviderId, type MailSecurity } from './mailProviders';
import type { PlatformAdminHotelAccess, PlatformAdminHotelAccessInput, PlatformMailCapInput, PlatformMailUsage, PlatformMailUsageHotel, PlatformVisitAccess } from './platform';
import type { MailDnsRecord, MailSenderIdentity, MailSenderIdentityInput } from './mailProviders';
import { MAIL_FILES_KEEP_HOURS_DEFAULT, mailFilesKeepHoursProblem, validMailFilesKeepHours } from './mailFiles';
import type { PlatformGroupMail,PlatformGroupMailSummary, PlatformHotelMail, PlatformHotelMailInput, PlatformHotelMailSummary, PlatformInboundMail, PlatformMailPause, PlatformMailPauseInput } from './platform';
import { mockCall, mockError, ok } from './common';
import { APPROVAL_EMAIL_NOTE, ARCHIVE_GRACE_DAYS, GSTIN_RE, INVITATION_VALID_HOURS, INVITE_LINK_NOTE, MOCK_GROUPADMIN_GROUP_ID, PLATFORM_DEFAULT_TIME_ZONE, PLATFORM_GST_RATES, PLATFORM_MOCK_TODAY, PLATFORM_SNAPSHOT_VERSION, PLATFORM_STATES, PLATFORM_TIME_ZONES, RESERVED_SLUGS, TEMP_PASSWORD_NOTE, gstCodeOfState, normaliseMobile, passwordProblem, platformCopy, slugFromName, type A8HealthSeed, type A8SettingsRec, type AdminRec, type GroupRec, type HotelRec, type InvRec, type PlatformActivity, type PlatformActivityAction, type PlatformActor, type PlatformAdminCreated, type PlatformAdminInput, type PlatformAdminPage, type PlatformAdminQuery, type PlatformAnnouncement, type PlatformAnnouncementInput, type PlatformArchivedHotel, type PlatformAttentionItem, type PlatformAuditEntry, type PlatformAuditPage, type PlatformAuditQuery, type PlatformEnterResult, type PlatformGroup, type PlatformGroupChange, type PlatformGroupDetail, type PlatformGroupInput, type PlatformGroupStatus, type PlatformGstDefaults, type PlatformHealth, type PlatformHealthRow, type PlatformHotel, type PlatformHotelAdmin, type PlatformHotelChange, type PlatformHotelDeleted, type PlatformHotelDetail, type PlatformHotelExport, type PlatformHotelPage, type PlatformHotelQuery, type PlatformHotelStatus, type PlatformInvitation, type PlatformInvitationDevLink, type PlatformInvitationInput, type PlatformInvitationPage, type PlatformInvitationQuery, type PlatformInvitationSent, type PlatformInvitationStatus, type PlatformInvitationType, type PlatformInviteProblem, type PlatformInviterRole, type PlatformKeep, type PlatformMockHooks, type PlatformOnboardingAdminInput, type PlatformOnboardingForm, type PlatformOnboardingGroupInput, type PlatformOnboardingHotelInput, type PlatformOnboardingResult, type PlatformOverview, type PlatformPasswordReset, type PlatformPublicInvitation, type PlatformRoleDefault, type PlatformSettings, type PlatformSettingsInput, type PlatformFailoverSettings, type PlatformSmtpTestResult, type PlatformSignIn, type PlatformSignInPage, type PlatformSignInQuery, type PlatformSignInResult, type PlatformSnapshot, type PlatformStaff, type PlatformStaffCreated, type PlatformStaffPage, type PlatformStaffQuery, type PlatformStaffReset, type PlatformStaffStatus, type PlatformUser, type PlatformUserLevel, type PlatformUserPage, type PlatformUserQuery, type PlatformUserReset, type PlatformUserStatus, type UserRec } from './platform';

/** sessionStorage key of the saved demo store (web-app groups/platform/api.ts, this tab only). The version in the key follows PLATFORM_SNAPSHOT_VERSION. */
export const PLATFORM_KEEP_KEY = `hms-mock-platform-v${PLATFORM_SNAPSHOT_VERSION}`;

// ---------------------------------------------------------------- constants

/** The seed is written as if today were this IST day (its "now" is 06:00 UTC = 11:30 IST that day). */
const SEED_TODAY = '2026-10-05';
/** Whole days from SEED_TODAY to the real today: every seed timestamp moves by this (as billing.ts shiftSeed), so server and client agree. */
const SEED_SHIFT_MS = Math.round((Date.parse(PLATFORM_MOCK_TODAY) - Date.parse(SEED_TODAY)) / 86_400_000) * 86_400_000;
const PIN_RE = /^[1-9]\d{5}$/;
const LOGO_RE = /\.(png|jpe?g|svg|webp)$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,29}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const GST5: PlatformGstDefaults = { roomsPercent: 5, foodPercent: 5 };

const seedHotels: HotelRec[] = [
  { id: 'h-1', name: 'Hotel Sunrise', slug: 'hotel-sunrise', city: 'Rajkot', state: 'Gujarat', gstin: '24ABCDE1234F1Z5', timeZone: 'Asia/Kolkata', status: 'active', createdAt: '2026-03-12T05:30:00.000Z', suspendedAt: null, suspendReason: null, gstDefaults: GST5 },
  { id: 'h-2', name: 'Sunrise Residency', slug: 'sunrise-residency', city: 'Ahmedabad', state: 'Gujarat', gstin: '24AAKFS4821M1Z2', timeZone: 'Asia/Kolkata', status: 'active', createdAt: '2026-06-20T07:10:00.000Z', suspendedAt: null, suspendReason: null, gstDefaults: GST5 },
  { id: 'h-3', name: 'Somnath Sagar Inn', slug: 'somnath-sagar-inn', city: 'Veraval', state: 'Gujarat', gstin: '24AAMFS6603R1ZK', timeZone: 'Asia/Kolkata', status: 'active', createdAt: '2026-10-02T09:45:00.000Z', suspendedAt: null, suspendReason: null, gstDefaults: GST5 },
  { id: 'h-4', name: 'Lakeview Palace', slug: 'lakeview-palace', city: 'Udaipur', state: 'Rajasthan', gstin: '08AAGCL7310K1Z8', timeZone: 'Asia/Kolkata', status: 'suspended', createdAt: '2026-05-08T06:20:00.000Z', suspendedAt: '2026-09-30T11:15:00.000Z', suspendReason: 'Owner asked to pause while the hotel is renovated.', gstDefaults: { roomsPercent: 12, foodPercent: 5 } },
  { id: 'h-5', name: 'Harbour Court', slug: 'harbour-court', city: 'Kochi', state: 'Kerala', gstin: '32AAFCH2290P1ZQ', timeZone: 'Asia/Kolkata', status: 'active', createdAt: '2026-10-04T10:05:00.000Z', suspendedAt: null, suspendReason: null, gstDefaults: GST5 },
  // Joined Sunrise Group by Kavita Desai's invitation; waits for a Platform Admin's approval.
  {
    id: 'h-6', name: 'Marine Drive Residency', slug: 'marine-drive-residency', city: 'Mumbai', state: 'Maharashtra', gstin: '27AAJCM5512Q1ZD', timeZone: 'Asia/Kolkata',
    status: 'pending_approval', createdAt: '2026-10-02T05:00:00.000Z', suspendedAt: null, suspendReason: null, gstDefaults: GST5,
    submittedAt: '2026-10-02T05:00:00.000Z', invitationId: 'inv-3',
    onboarding: {
      invitationId: 'inv-3', contactName: 'Farhan Merchant', address: 'Plot 14, Marine Drive, Churchgate', city: 'Mumbai', state: 'Maharashtra', pin: '400020',
      gstin: '27AAJCM5512Q1ZD', phone: '02222812345', email: 'stay@marinedriveresidency.in', logoName: 'marine-drive-logo.png', submittedAt: '2026-10-02T05:00:00.000Z',
      adminName: 'Farhan Merchant', adminUsername: 'farhan.merchant', adminEmail: 'farhan@marinedriveresidency.in', adminMobile: '9820345678',
    },
  },
  // "Deleted" = archived: sign-in blocked, data kept, can be restored.
  {
    id: 'h-7', name: 'Gir Forest Lodge', slug: 'gir-forest-lodge', city: 'Sasan Gir', state: 'Gujarat', gstin: '24AAHFG3307N1ZT', timeZone: 'Asia/Kolkata',
    status: 'archived', createdAt: '2026-02-10T06:00:00.000Z', suspendedAt: null, suspendReason: null, gstDefaults: GST5,
    archivedAt: '2026-09-20T09:30:00.000Z', archiveReason: 'Closed by the owner; data kept for the accounts.',
  },
  // Brand new and empty: its first and only user is its Hotel Admin (rohit.naik); no rooms, rates or staff yet.
  { id: 'h-8', name: 'Blue Lagoon Residency', slug: 'blue-lagoon', city: 'Panaji', state: 'Goa', gstin: '30AABFB6612K1Z3', timeZone: 'Asia/Kolkata', status: 'active', createdAt: '2026-10-03T06:00:00.000Z', suspendedAt: null, suspendReason: null, gstDefaults: GST5 },
  // Demo login `pooja.shah` (alias `newhotel` in the auth mock, id 'h-new'): brand new, setup not finished, one Hotel Admin (Pooja Shah).
  { id: 'h-9', name: 'Hotel Pearl, Surat', slug: 'hotel-pearl', city: 'Surat', state: 'Gujarat', gstin: '24AABFP4410R1Z8', timeZone: 'Asia/Kolkata', status: 'active', createdAt: '2026-10-04T09:30:00.000Z', suspendedAt: null, suspendReason: null, gstDefaults: GST5 },
];

const seedAdmins: AdminRec[] = [
  { id: 'a-1', hotelId: 'h-1', name: 'Rakesh Patel', username: 'rakesh.patel', email: 'rakesh.patel@hotelsunrise.in', mobile: '9824012345', status: 'active', lastSignInAt: '2026-10-05T04:12:00.000Z', lockedAt: null, createdAt: '2026-03-12T05:30:00.000Z' },
  { id: 'a-2', hotelId: 'h-1', name: 'Nisha Mehta', username: 'nisha.mehta', email: 'nisha@hotelsunrise.in', mobile: '9898123456', status: 'locked', lastSignInAt: '2026-09-28T13:05:00.000Z', lockedAt: '2026-10-04T16:40:00.000Z', createdAt: '2026-04-02T06:00:00.000Z' },
  { id: 'a-3', hotelId: 'h-1', name: 'Kiran Joshi', username: 'kiran.joshi', email: 'kiran.joshi@hotelsunrise.in', mobile: '9727456120', status: 'disabled', lastSignInAt: '2026-07-14T08:22:00.000Z', lockedAt: null, createdAt: '2026-04-02T06:10:00.000Z' },
  { id: 'a-4', hotelId: 'h-2', name: 'Hardik Shah', username: 'hardik.shah', email: 'hardik@sunriseresidency.in', mobile: '9909234567', status: 'active', lastSignInAt: '2026-10-04T13:40:00.000Z', lockedAt: null, createdAt: '2026-06-20T07:10:00.000Z' },
  { id: 'a-5', hotelId: 'h-2', name: 'Pooja Trivedi', username: 'pooja.trivedi', email: 'pooja.trivedi@sunriseresidency.in', mobile: '9879345678', status: 'active', lastSignInAt: '2026-10-01T05:55:00.000Z', lockedAt: null, createdAt: '2026-07-01T09:00:00.000Z' },
  { id: 'a-6', hotelId: 'h-3', name: 'Bhavesh Dave', username: 'bhavesh.dave', email: 'bhavesh@somnathsagarinn.in', mobile: '9925456789', status: 'locked', lastSignInAt: null, lockedAt: '2026-10-03T03:20:00.000Z', createdAt: '2026-10-02T09:45:00.000Z' },
  { id: 'a-7', hotelId: 'h-4', name: 'Vikram Singh Rathore', username: 'vikram.rathore', email: 'vikram@lakeviewpalace.in', mobile: '9829567890', status: 'active', lastSignInAt: '2026-09-12T12:30:00.000Z', lockedAt: null, createdAt: '2026-05-08T06:20:00.000Z' },
  { id: 'a-8', hotelId: 'h-4', name: 'Meera Sharma', username: 'meera.sharma', email: 'meera.sharma@lakeviewpalace.in', mobile: '9414678901', status: 'locked', lastSignInAt: '2026-09-10T07:15:00.000Z', lockedAt: '2026-09-29T15:02:00.000Z', createdAt: '2026-05-20T10:00:00.000Z' },
  { id: 'a-9', hotelId: 'h-6', name: 'Farhan Merchant', username: 'farhan.merchant', email: 'farhan@marinedriveresidency.in', mobile: '9820345678', status: 'pending', lastSignInAt: null, lockedAt: null, createdAt: '2026-10-02T05:00:00.000Z' },
  { id: 'a-10', hotelId: 'h-7', name: 'Dilip Vaghela', username: 'dilip.vaghela', email: 'dilip@girforestlodge.in', mobile: '9898765012', status: 'active', lastSignInAt: '2026-09-18T06:40:00.000Z', lockedAt: null, createdAt: '2026-02-10T06:00:00.000Z' },
  { id: 'a-11', hotelId: 'h-8', name: 'Rohit Naik', username: 'rohit.naik', email: 'rohit.naik@bluelagoonresidency.in', mobile: '9822134567', status: 'active', lastSignInAt: '2026-10-03T07:15:00.000Z', lockedAt: null, createdAt: '2026-10-03T06:00:00.000Z' },
  { id: 'a-12', hotelId: 'h-9', name: 'Pooja Shah', username: 'pooja.shah',email: 'pooja.shah@hotelpearlsurat.in', mobile: '9825066771', status: 'active', lastSignInAt: '2026-10-05T01:40:00.000Z', lockedAt: null, createdAt: '2026-10-04T09:30:00.000Z' },
];

const seedGroups: GroupRec[] = [
  // Started by a 'group' invitation; Kavita Desai (u-group, username groupadmin) is its Group Hotel Admin.
  { id: 'g-1', name: 'Sunrise Group', hotelIds: ['h-2', 'h-5', 'h-6'], groupAdminId: null, groupAdminUserId: 'u-group', createdAt: '2026-06-20T07:30:00.000Z', status: 'active',
    legalName: 'Sunrise Hospitality Private Limited', gstin: '24AAKCS9021L1Z4', address: 'Sunrise House, C G Road, Navrangpura', city: 'Ahmedabad', state: 'Gujarat', pin: '380009',
    phone: '07926401234', email: 'office@sunrisegroup.in', approvedAt: '2026-06-20T07:30:00.000Z' },
  { id: 'g-2', name: 'Saurashtra Stays', hotelIds: [], groupAdminId: null, createdAt: '2026-10-02T10:00:00.000Z', status: 'active' },
  // Sent its group form (inv-4); waits for approval with its admin (gu-2, pending).
  { id: 'g-3', name: 'Coastal Residencies Group', hotelIds: [], groupAdminId: null, groupAdminUserId: 'gu-2', createdAt: '2026-10-03T08:30:00.000Z', status: 'pending_approval',
    legalName: 'Coastal Residencies Private Limited', gstin: '30AAICC4471H1Z6', address: 'Rua de Ourem, Fontainhas', city: 'Panaji', state: 'Goa', pin: '403001',
    phone: '08322223344', email: 'office@coastalresidencies.in', invitationId: 'inv-4', submittedAt: '2026-10-03T08:30:00.000Z' },
];

const NEHA = 'Neha Kapoor';
/** The Super Admin's name (the person, user u-superadmin); 'Super Admin' itself is only the level label. */
const SUPER = 'Rajiv Malhotra';
const KAVITA = 'Kavita Desai';

const seedUsers: UserRec[] = [
  { id: 'u-superadmin', name: SUPER, username: 'superadmin', email: 'superadmin@hms.example.in', mobile: '9811000001', level: 'super_admin', hotelId: null, groupId: null, status: 'active', lastSignInAt: '2026-10-05T03:30:00.000Z', lockedAt: null, createdAt: '2026-01-05T05:00:00.000Z' },
  { id: 'u-platform', name: NEHA, username: 'platform', email: 'neha.kapoor@hms.example.in', mobile: '9811000002', level: 'platform_admin', hotelId: null, groupId: null, status: 'active', lastSignInAt: '2026-10-05T04:05:00.000Z', lockedAt: null, createdAt: '2026-01-05T05:10:00.000Z' },
  { id: 'u-platform2', name: 'Arjun Menon', username: 'arjun.menon', email: 'arjun.menon@hms.example.in', mobile: '9811000003', level: 'platform_admin', hotelId: null, groupId: null, status: 'active', lastSignInAt: '2026-10-01T09:20:00.000Z', lockedAt: null, createdAt: '2026-03-01T05:00:00.000Z' },
  { id: 'u-group', name: KAVITA, username: 'groupadmin', email: 'kavita.desai@sunrisegroup.in', mobile: '9824598765', level: 'group_admin', hotelId: null, groupId: 'g-1', status: 'active', lastSignInAt: '2026-10-05T03:50:00.000Z', lockedAt: null, createdAt: '2026-06-20T07:30:00.000Z' },
  { id: 'gu-2', name: 'Anita Fernandes', username: 'anita.fernandes', email: 'anita@coastalresidencies.in', mobile: '9822456123', level: 'group_admin', hotelId: null, groupId: 'g-3', status: 'pending', lastSignInAt: null, lockedAt: null, createdAt: '2026-10-03T08:30:00.000Z' },
  { id: 'hu-1', name: 'Mahesh Gohil', username: 'mahesh.gohil', email: 'mahesh@hotelsunrise.in', mobile: '9825011223', level: 'hotel_user', hotelId: 'h-1', groupId: null, status: 'active', lastSignInAt: '2026-10-05T02:45:00.000Z', lockedAt: null, createdAt: '2026-03-15T06:00:00.000Z' },
  { id: 'hu-2', name: 'Sejal Parekh', username: 'sejal.parekh', email: 'sejal@hotelsunrise.in', mobile: '9825022334', level: 'hotel_user', hotelId: 'h-1', groupId: null, status: 'active', lastSignInAt: '2026-10-04T15:10:00.000Z', lockedAt: null, createdAt: '2026-03-15T06:05:00.000Z' },
  { id: 'hu-3', name: 'Imran Shaikh', username: 'imran.shaikh', email: 'imran@hotelsunrise.in', mobile: '9825033445', level: 'hotel_user', hotelId: 'h-1', groupId: null, status: 'locked', lastSignInAt: '2026-10-02T14:00:00.000Z', lockedAt: '2026-10-04T18:20:00.000Z', createdAt: '2026-04-10T06:00:00.000Z' },
  { id: 'hu-4', name: 'Ritu Agarwal', username: 'ritu.agarwal', email: 'ritu@sunriseresidency.in', mobile: '9879044556', level: 'hotel_user', hotelId: 'h-2', groupId: null, status: 'active', lastSignInAt: '2026-10-05T03:15:00.000Z', lockedAt: null, createdAt: '2026-06-25T06:00:00.000Z' },
  { id: 'hu-5', name: 'Nilesh Rana', username: 'nilesh.rana', email: 'nilesh@sunriseresidency.in', mobile: '9879055667', level: 'hotel_user', hotelId: 'h-2', groupId: null, status: 'disabled', lastSignInAt: '2026-08-30T11:00:00.000Z', lockedAt: null, createdAt: '2026-06-25T06:10:00.000Z' },
  { id: 'hu-6', name: 'Komal Solanki', username: 'komal.solanki', email: 'komal@somnathsagarinn.in', mobile: '9925066778', level: 'hotel_user', hotelId: 'h-3', groupId: null, status: 'active', lastSignInAt: '2026-10-04T08:30:00.000Z', lockedAt: null, createdAt: '2026-10-02T10:30:00.000Z' },
  { id: 'hu-7', name: 'Prakash Meena', username: 'prakash.meena', email: 'prakash@lakeviewpalace.in', mobile: '9829077889', level: 'hotel_user', hotelId: 'h-4', groupId: null, status: 'active', lastSignInAt: '2026-09-28T09:00:00.000Z', lockedAt: null, createdAt: '2026-05-12T06:00:00.000Z' },
  { id: 'hu-8', name: 'Anju Thomas', username: 'anju.thomas', email: 'anju@harbourcourt.in', mobile: '9847088990', level: 'hotel_user', hotelId: 'h-5', groupId: null, status: 'active', lastSignInAt: '2026-10-05T04:40:00.000Z', lockedAt: null, createdAt: '2026-10-04T11:00:00.000Z' },
  { id: 'hu-9', name: 'Joseph Kurian', username: 'joseph.kurian', email: 'joseph@harbourcourt.in', mobile: '9847099001', level: 'hotel_user', hotelId: 'h-5', groupId: null, status: 'active', lastSignInAt: null, lockedAt: null, createdAt: '2026-10-04T11:05:00.000Z' },
];

/** member_hotel / group / individual invitations in every state (seed now = 5 Oct 2026 06:00 UTC, moved to the real today; links work INVITATION_VALID_HOURS). */
const exp = (createdAt: string) => new Date(Date.parse(createdAt) + INVITATION_VALID_HOURS * 3_600_000).toISOString();
const seedInvitations: InvRec[] = [
  { id: 'inv-1', token: 'inv-open-7Kq2M9xR', type: 'individual', hotelName: 'Hotel Kanha Retreat', contactName: 'Sanjay Tiwari', email: 'sanjay@kanharetreat.in', groupId: null, madeGroupId: null, status: 'sent', createdAt: '2026-10-04T09:00:00.000Z', expiresAt: exp('2026-10-04T09:00:00.000Z'), openedAt: null, submittedAt: null, cancelledAt: null, invitedByName: NEHA, invitedByRole: 'platform_admin', resendCount: 0, hotelId: null },
  { id: 'inv-2', token: 'inv-opened-4Wc6N2yJ', type: 'member_hotel', hotelName: 'Sunrise Inn Vadodara', contactName: 'Jignesh Parmar', email: 'jignesh@sunriseinn.in', groupId: 'g-1', madeGroupId: null, status: 'opened', createdAt: '2026-10-03T12:00:00.000Z', expiresAt: exp('2026-10-03T12:00:00.000Z'), openedAt: '2026-10-04T07:00:00.000Z', submittedAt: null, cancelledAt: null, invitedByName: KAVITA, invitedByRole: 'group_admin', resendCount: 0, hotelId: null },
  { id: 'inv-3', token: 'inv-used-5Tn4C6vB', type: 'member_hotel', hotelName: 'Marine Drive Residency', contactName: 'Farhan Merchant', email: 'farhan@marinedriveresidency.in', groupId: 'g-1', madeGroupId: null, status: 'submitted', createdAt: '2026-10-01T06:00:00.000Z', expiresAt: exp('2026-10-01T06:00:00.000Z'), openedAt: '2026-10-01T09:00:00.000Z', submittedAt: '2026-10-02T05:00:00.000Z', cancelledAt: null, invitedByName: KAVITA, invitedByRole: 'group_admin', resendCount: 0, hotelId: 'h-6' },
  { id: 'inv-4', token: 'inv-group-used-2Bx9Q4mH', type: 'group', hotelName: 'Coastal Residencies Group', contactName: 'Anita Fernandes', email: 'anita@coastalresidencies.in', groupId: null, madeGroupId: 'g-3', status: 'submitted', createdAt: '2026-10-02T07:00:00.000Z', expiresAt: exp('2026-10-02T07:00:00.000Z'), openedAt: '2026-10-02T11:00:00.000Z', submittedAt: '2026-10-03T08:30:00.000Z', cancelledAt: null, invitedByName: SUPER, invitedByRole: 'super_admin', resendCount: 0, hotelId: null },
  { id: 'inv-5', token: 'inv-expired-3Hd8P1wZ', type: 'individual', hotelName: 'Hotel Narmada View', contactName: 'Pankaj Desai', email: 'pankaj@narmadaview.in', groupId: null, madeGroupId: null, status: 'sent', createdAt: '2026-09-25T10:00:00.000Z', expiresAt: exp('2026-09-25T10:00:00.000Z'), openedAt: null, submittedAt: null, cancelledAt: null, invitedByName: NEHA, invitedByRole: 'platform_admin', resendCount: 1, hotelId: null },
  { id: 'inv-6', token: 'inv-cancel-9Lm2F7sA', type: 'individual', hotelName: 'Royal Heritage Haveli', contactName: 'Mahendra Singh', email: 'mahendra@royalheritagehaveli.in', groupId: null, madeGroupId: null, status: 'cancelled', createdAt: '2026-10-02T08:00:00.000Z', expiresAt: exp('2026-10-02T08:00:00.000Z'), openedAt: null, submittedAt: null, cancelledAt: '2026-10-03T10:00:00.000Z', invitedByName: NEHA, invitedByRole: 'platform_admin', resendCount: 0, hotelId: null },
  { id: 'inv-7', token: 'inv-group-6Rv3K8pD', type: 'group', hotelName: 'Heritage Stays Group', contactName: 'Rajendra Chauhan', email: 'rajendra@heritagestays.in', groupId: null, madeGroupId: null, status: 'sent', createdAt: '2026-10-05T04:00:00.000Z', expiresAt: exp('2026-10-05T04:00:00.000Z'), openedAt: null, submittedAt: null, cancelledAt: null, invitedByName: SUPER, invitedByRole: 'super_admin', resendCount: 0, hotelId: null },
];

/** [at, username, result, reason key or null, ip, device] (about 30 rows, newest last). */
type SeedSignIn = [string, string, PlatformSignInResult, keyof typeof platformCopy.signIns.reasons | null, string, string];
const CH = 'Chrome on Windows';
const AN = 'Android app';
const SA = 'Safari on iPhone';
const seedSignIns: SeedSignIn[] = [
  ['2026-09-28T09:00:00.000Z', 'prakash.meena', 'success', null, '49.36.112.18', CH],
  ['2026-09-29T14:58:00.000Z', 'meera.sharma', 'failed', 'wrongPassword', '106.51.73.204', AN],
  ['2026-09-29T15:00:00.000Z', 'meera.sharma', 'failed', 'wrongPassword', '106.51.73.204', AN],
  ['2026-09-29T15:02:00.000Z', 'meera.sharma', 'locked', 'locked', '106.51.73.204', AN],
  ['2026-09-30T12:10:00.000Z', 'vikram.rathore', 'failed', 'hotelSuspended', '49.36.112.18', CH],
  ['2026-10-01T05:55:00.000Z', 'pooja.trivedi', 'success', null, '103.21.58.90', CH],
  ['2026-10-01T09:20:00.000Z', 'arjun.menon', 'success', null, '122.170.4.11', CH],
  ['2026-10-02T14:00:00.000Z', 'imran.shaikh', 'success', null, '157.32.10.77', AN],
  ['2026-10-03T03:18:00.000Z', 'bhavesh.dave', 'failed', 'wrongPassword', '117.99.40.12', AN],
  ['2026-10-03T03:20:00.000Z', 'bhavesh.dave', 'locked', 'locked', '117.99.40.12', AN],
  ['2026-10-03T07:15:00.000Z', 'rohit.naik', 'success', null, '182.68.20.5', CH],
  ['2026-10-03T11:40:00.000Z', 'manager1', 'failed', 'unknownUser', '45.112.33.9', CH],
  ['2026-10-04T07:58:00.000Z', 'nilesh.rana', 'failed', 'disabled', '103.21.58.91', AN],
  ['2026-10-04T08:30:00.000Z', 'komal.solanki', 'success', null, '117.99.41.3', AN],
  ['2026-10-04T13:40:00.000Z', 'hardik.shah', 'success', null, '103.21.58.90', CH],
  ['2026-10-04T15:10:00.000Z', 'sejal.parekh', 'success', null, '157.32.10.80', SA],
  ['2026-10-04T16:36:00.000Z', 'nisha.mehta', 'failed', 'wrongPassword', '157.32.10.81', SA],
  ['2026-10-04T16:38:00.000Z', 'nisha.mehta', 'failed', 'wrongPassword', '157.32.10.81', SA],
  ['2026-10-04T16:40:00.000Z', 'nisha.mehta', 'locked', 'locked', '157.32.10.81', SA],
  ['2026-10-04T18:18:00.000Z', 'imran.shaikh', 'failed', 'wrongPassword', '157.32.10.77', AN],
  ['2026-10-04T18:20:00.000Z', 'imran.shaikh', 'locked', 'locked', '157.32.10.77', AN],
  ['2026-10-05T02:45:00.000Z', 'mahesh.gohil', 'success', null, '157.32.10.76', CH],
  ['2026-10-05T03:10:00.000Z', 'ritu.agarwal', 'failed', 'wrongCode', '103.21.58.92', AN],
  ['2026-10-05T03:15:00.000Z', 'ritu.agarwal', 'success', null, '103.21.58.92', AN],
  ['2026-10-05T03:30:00.000Z', 'superadmin', 'success', null, '122.170.4.10', CH],
  ['2026-10-05T03:50:00.000Z', 'groupadmin', 'success', null, '103.21.58.95', CH],
  ['2026-10-05T04:05:00.000Z', 'platform', 'success', null, '122.170.4.12', CH],
  ['2026-10-05T04:12:00.000Z', 'rakesh.patel', 'success', null, '157.32.10.75', CH],
  ['2026-10-05T04:30:00.000Z', 'dilip.vaghela', 'failed', 'hotelArchived', '117.99.42.8', AN],
  ['2026-10-05T04:34:00.000Z', 'farhan.merchant', 'failed', 'pendingApproval', '49.36.112.31', CH],
  ['2026-10-05T04:36:00.000Z', 'meena.rao', 'failed', 'hotelRejected', '103.21.58.140', CH],
  ['2026-10-05T04:40:00.000Z', 'anju.thomas', 'success', null, '106.51.80.14', SA],
];

/** [at, actor, action, hotelId, groupId, adminId, extra?] — text is built from platformCopy.activity. */
type SeedAct = [string, string, PlatformActivityAction, string | null, string | null, string | null, { inv?: string; user?: string; reason?: string }?];
// The seeded Platform Admin is a person (login `platform`), so the audit log's Who names her, not the role (the role has its own column).
const PA = NEHA;
const seedActivity: SeedAct[] = [
  ['2026-03-12T05:30:00.000Z', PA, 'hotel_created', 'h-1', null, null],
  ['2026-03-12T05:30:00.000Z', PA, 'admin_created', 'h-1', null, 'a-1'],
  ['2026-04-02T06:00:00.000Z', PA, 'admin_created', 'h-1', null, 'a-2'],
  ['2026-04-02T06:10:00.000Z', PA, 'admin_created', 'h-1', null, 'a-3'],
  ['2026-05-08T06:20:00.000Z', PA, 'hotel_created', 'h-4', null, null],
  ['2026-05-08T06:20:00.000Z', PA, 'admin_created', 'h-4', null, 'a-7'],
  ['2026-05-20T10:00:00.000Z', PA, 'admin_created', 'h-4', null, 'a-8'],
  ['2026-06-20T07:10:00.000Z', PA, 'hotel_created', 'h-2', null, null],
  ['2026-06-20T07:10:00.000Z', PA, 'admin_created', 'h-2', null, 'a-4'],
  ['2026-06-20T07:30:00.000Z', SUPER, 'group_approved', null, 'g-1', null],
  ['2026-06-20T07:32:00.000Z', PA, 'group_hotel_added', 'h-2', 'g-1', null],
  ['2026-07-01T09:00:00.000Z', PA, 'admin_created', 'h-2', null, 'a-5'],
  ['2026-07-15T06:45:00.000Z', PA, 'admin_disabled', 'h-1', null, 'a-3'],
  ['2026-08-30T11:30:00.000Z', KAVITA, 'user_disabled', 'h-2', 'g-1', null, { user: 'hu-5' }],
  ['2026-09-18T10:20:00.000Z', PA, 'hotel_entered', 'h-1', null, null],
  ['2026-09-18T10:48:00.000Z', PA, 'hotel_exited', 'h-1', null, null],
  ['2026-09-20T09:30:00.000Z', SUPER, 'hotel_archived', 'h-7', null, null, { reason: 'Closed by the owner; data kept for the accounts.' }],
  ['2026-09-25T10:00:00.000Z', NEHA, 'invitation_sent', null, null, null, { inv: 'inv-5' }],
  ['2026-09-29T15:02:00.000Z', 'System', 'admin_locked', 'h-4', null, 'a-8'],
  ['2026-09-30T11:15:00.000Z', PA, 'hotel_suspended', 'h-4', null, null],
  ['2026-10-01T06:00:00.000Z', KAVITA, 'invitation_sent', null, 'g-1', null, { inv: 'inv-3' }],
  ['2026-10-01T09:00:00.000Z', 'Farhan Merchant', 'invitation_opened', null, 'g-1', null, { inv: 'inv-3' }],
  ['2026-10-02T05:00:00.000Z', 'Farhan Merchant', 'hotel_submitted', 'h-6', 'g-1', null],
  ['2026-10-02T07:00:00.000Z', SUPER, 'invitation_sent', null, null, null, { inv: 'inv-4' }],
  ['2026-10-02T08:00:00.000Z', NEHA, 'invitation_sent', null, null, null, { inv: 'inv-6' }],
  ['2026-10-02T09:45:00.000Z', PA, 'hotel_created', 'h-3', null, null],
  ['2026-10-02T09:45:00.000Z', PA, 'admin_created', 'h-3', null, 'a-6'],
  ['2026-10-02T10:00:00.000Z', PA, 'group_created', null, 'g-2', null],
  ['2026-10-02T11:00:00.000Z', 'Anita Fernandes', 'invitation_opened', null, null, null, { inv: 'inv-4' }],
  ['2026-10-03T03:20:00.000Z', 'System', 'admin_locked', 'h-3', null, 'a-6'],
  ['2026-10-03T06:00:00.000Z', NEHA, 'hotel_created', 'h-8', null, null],
  ['2026-10-03T06:00:00.000Z', NEHA, 'admin_created', 'h-8', null, 'a-11'],
  ['2026-10-03T08:30:00.000Z', 'Anita Fernandes', 'group_submitted', null, 'g-3', null],
  ['2026-10-03T10:00:00.000Z', NEHA, 'invitation_cancelled', null, null, null, { inv: 'inv-6' }],
  ['2026-10-03T12:00:00.000Z', KAVITA, 'invitation_sent', null, 'g-1', null, { inv: 'inv-2' }],
  ['2026-10-04T07:00:00.000Z', 'Jignesh Parmar', 'invitation_opened', null, 'g-1', null, { inv: 'inv-2' }],
  ['2026-10-04T09:00:00.000Z', NEHA, 'invitation_sent', null, null, null, { inv: 'inv-1' }],
  ['2026-10-04T10:05:00.000Z', PA, 'hotel_created', 'h-5', null, null],
  ['2026-10-04T10:06:00.000Z', PA, 'group_hotel_added', 'h-5', 'g-1', null],
  ['2026-10-04T16:40:00.000Z', 'System', 'admin_locked', 'h-1', null, 'a-2'],
  ['2026-10-04T18:20:00.000Z', 'System', 'admin_locked', 'h-1', null, null, { user: 'hu-3' }],
  ['2026-10-05T04:00:00.000Z', SUPER, 'invitation_sent', null, null, null, { inv: 'inv-7' }],
  ['2026-10-05T05:10:00.000Z', PA, 'hotel_entered', 'h-2', null, null],
  ['2026-10-05T05:32:00.000Z', PA, 'hotel_exited', 'h-2', null, null],
];

const HOUR_MS = 3_600_000;
/** Hotels that are live on the platform (can be entered, joined to a group, counted as "created"). */
const LIVE_STATUSES: readonly PlatformHotelStatus[] = ['active', 'suspended'];
const LEVEL_ORDER: readonly PlatformUserLevel[] = ['super_admin', 'platform_admin', 'group_admin', 'hotel_admin', 'hotel_user'];

/** UTC ISO -> IST calendar date (YYYY-MM-DD). */
const istDate = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);

const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Deep copy of a seed value (record, tuple, list) with f applied to every ISO timestamp string; key = the field name (undefined in a tuple). */
function mapIso<T>(x: T, f: (iso: string, key: string | undefined) => string, key?: string): T {
  if (typeof x === 'string') return (ISO_AT.test(x) ? f(x, key) : x) as T;
  if (Array.isArray(x)) return x.map((v) => mapIso(v, f)) as T;
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) out[k] = mapIso(v, f, k);
    return out as T;
  }
  return x;
}

/** Mock token (the real server makes a long random one and keeps only its hash). */
function newToken(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 24; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return `inv-${s}`;
}

/** Answer for a refused invitation token: details.serverCode says which (PlatformInviteProblem). */
function refuseToken(code: DashErrorCode, serverCode: PlatformInviteProblem, message: string): { ok: false; error: DashError } {
  const e = mockError(code, undefined, { message });
  e.error.details = { ...(e.error.details ?? {}), serverCode };
  return e;
}

const isArr = (x: unknown): x is unknown[] => Array.isArray(x);
const isPairs = (x: unknown) => isArr(x) && x.every((p) => isArr(p) && p.length === 2 && typeof p[0] === 'string');
const hasIds = (x: unknown) => isArr(x) && x.every((r) => !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string');

/** The snapshot when it has this version and the expected shape, else null. */
function asPlatformSnapshot(x: unknown): PlatformSnapshot | null {
  if (!x || typeof x !== 'object') return null;
  const s = x as Partial<Record<keyof PlatformSnapshot, unknown>>;
  const st = s.settings as Partial<A8SettingsRec> | undefined;
  const okShape =
    s.v === PLATFORM_SNAPSHOT_VERSION &&
    hasIds(s.hotels) && hasIds(s.admins) && hasIds(s.groups) && hasIds(s.users) && hasIds(s.invitations) &&
    hasIds(s.activity) && hasIds(s.refused) && hasIds(s.signIns) &&
    isPairs(s.targets) && isPairs(s.auditReasons) && isPairs(s.health) && isPairs(s.exportsOf) &&
    typeof s.healthCheckedAt === 'string' && ISO_AT.test(s.healthCheckedAt) &&
    !!st && typeof st === 'object' && isArr(st.roleKeys) &&
    typeof s.seq === 'number' && Number.isFinite(s.seq) && typeof s.nowMs === 'number' && Number.isFinite(s.nowMs);
  return okShape ? (x as PlatformSnapshot) : null;
}

/** Deep copy of plain JSON data. */
const jsonCopy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Platform settings > Mail's read-only "Reading this mailbox" line (decision 66), following the Conversations mock's dev switch `window.__convMailbox` (read at call time). */
function mockMailboxReading(): NonNullable<PlatformSettings['mailboxReading']> {
  const m = (globalThis as { __convMailbox?: unknown }).__convMailbox;
  if (m === 'off') return { reading: false, state: 'off' };
  if (m === 'not_available' || m === 'needs_update') return { reading: false, state: 'not_available' };
  return { reading: true, state: m === 'error' ? 'error' : 'ok' };
}

export function createPlatformApi(clock: MockClock & PlatformMockHooks = {}, keep?: PlatformKeep) {
  // ---- the seed on the real clock: every seed time moves by SEED_SHIFT_MS (whole days). Times of the seed's "today" that are
  // still ahead of the real now (early in the day) are pulled back between the last earlier seed time and now, keeping their
  // order and keeping equal times equal (as billing.ts clampSeedTimes). Invitation expiry stays createdAt + INVITATION_VALID_HOURS.
  const startMs = Date.now();
  const seedSources: unknown[] = [seedHotels, seedAdmins, seedGroups, seedUsers, seedInvitations, seedSignIns, seedActivity, A8_SEED_STAFF, A8_SEED_HOTELS, A8_SEED_ADMINS, A8_SEED_ACTIVITY, A8_SEED_HEALTH, A8_HEALTH_CHECKED_AT];
  const ahead = new Set<number>();
  let lastPast = startMs - HOUR_MS;
  mapIso(seedSources, (iso, key) => {
    const t = Date.parse(iso) + SEED_SHIFT_MS;
    if (key !== 'expiresAt') {
      if (t > startMs) ahead.add(t);
      else lastPast = Math.max(lastPast, t);
    }
    return iso;
  });
  const aheadSorted = [...ahead].sort((x, y) => x - y);
  const step = (startMs - lastPast) / (aheadSorted.length + 1);
  const pulled = new Map(aheadSorted.map((t, i) => [t, Math.floor((lastPast + (i + 1) * step) / 1000) * 1000]));
  /** A seed value on the real clock (deep copy). */
  const seedTime = <T>(x: T): T =>
    mapIso(x, (iso) => {
      const t = Date.parse(iso) + SEED_SHIFT_MS;
      return new Date(pulled.get(t) ?? t).toISOString();
    });

  const mailCaps = new Map<string, number>();
/** Mock sender identities by scope ('platform' or a hotel id): the DKIM names, the SES confirmation and whether the (pretend) DNS check has run. */
const mockIdentities = new Map<string, { tokens: string[]; sesConfirmed: boolean; checked: string | null; fromAddress: string | null; domain: string }>();
function mockIdentityView(scope: string, domain: string, hotelName: string | null): MailSenderIdentity {
  const rec = mockIdentities.get(scope) ?? { tokens: [], sesConfirmed: false, checked: null, fromAddress: null, domain };
  const dkimReady = rec.tokens.length === 3;
  const records: MailDnsRecord[] = [
    ...rec.tokens.map((t, i) => ({ id: ('dkim' + (i + 1)) as MailDnsRecord['id'], type: 'CNAME' as const, name: t + '._domainkey.' + domain, value: t + '.dkim.amazonses.com', required: true, purpose: 'Proves the mail really comes from this domain (DKIM). Required.', state: rec.checked ? ('ok' as const) : ('unchecked' as const) })),
    { id: 'spf', type: 'TXT', name: domain, value: 'v=spf1 include:amazonses.com ~all', required: false, purpose: 'Says Amazon SES may send for this domain (SPF).', state: rec.checked ? 'missing' : 'unchecked' },
    { id: 'dmarc', type: 'TXT', name: '_dmarc.' + domain, value: 'v=DMARC1; p=none; rua=mailto:postmaster@' + domain, required: false, purpose: 'Tells receivers what to do with mail that fails the checks (DMARC).', state: rec.checked ? 'missing' : 'unchecked' },
  ];
  const verified = dkimReady && rec.checked !== null && rec.sesConfirmed;
  return { scope, hotelName, domain, fromAddress: rec.fromAddress, status: verified ? 'verified' : 'pending', dkimReady, sesConfirmed: rec.sesConfirmed, records, checkedAt: rec.checked, nextStep: verified ? 'Verified.' : !dkimReady ? 'Waiting for the platform to add ' + domain + ' in Amazon SES.' : !rec.checked ? 'Add these records, then press Check DNS.' : 'The DNS records are right. Waiting for the platform to confirm ' + domain + ' in Amazon SES.' };
}
const hotels: HotelRec[] = seedHotels.map((h) => seedTime({ ...h, onboarding: h.onboarding ?? null }));
  const admins: AdminRec[] = seedAdmins.map((a) => seedTime(a));
  const groups: GroupRec[] = seedGroups.map((g) => seedTime(g));
  const users: UserRec[] = seedUsers.map((u) => seedTime(u));
  const invitations: InvRec[] = seedInvitations.map((i) => {
    const r = seedTime(i);
    r.expiresAt = exp(r.createdAt);
    return r;
  });
  const activity: PlatformActivity[] = [];
  /** The audit log's "On" column, per activity id. */
  const targets = new Map<string, string>();
  /** A7 audit log: the reason given (or why it was refused) per entry id, and the refused attempts (audited, kept out of listActivity). */
  const auditReasons = new Map<string, string>();
  const refused: PlatformActivity[] = [];
  let actor: { name: string; role: PlatformInviterRole; groupId: string | null } = { name: PA, role: 'platform_admin', groupId: null };
  let seq = 100;
  const nextId = (p: string) => `${p}-${++seq}`;
  /** The last write's time: never before the seed, always after the previous write (so new entries sort after older ones). */
  let nowMs = startMs;
  /** The mock's "now" for a write: the real time (at least 1 ms after the previous write). */
  const tick = () => {
    nowMs = Math.max(Date.now(), nowMs + 1);
    return new Date(nowMs).toISOString();
  };
  /** The real now, read-only (expiry, grace periods). */
  const clockMs = () => Math.max(Date.now(), nowMs);
  const nowIso = () => new Date(clockMs()).toISOString();
  // Every call saves the store (to `keep`) when it changed anything, refused attempts in the audit log included.
  const call = <T>(fn: () => DashResult<T>) =>
    mockCall(() => {
      const r = fn();
      persist();
      return r;
    }, clock);
  const A = platformCopy.activity;
  const E = platformCopy.errors;
  const C = platformCopy;

  const hotelOf = (id: string | null) => (id ? hotels.find((h) => h.id === id) : undefined);
  const adminOf = (id: string | null) => (id ? admins.find((a) => a.id === id) : undefined);
  const groupOf = (id: string | null) => (id ? groups.find((g) => g.id === id) : undefined);
  const userOf = (id: string | null) => (id ? users.find((u) => u.id === id) : undefined);
  const invOf = (id: string | null) => (id ? invitations.find((i) => i.id === id) : undefined);
  const groupOfHotel = (hotelId: string) => groups.find((g) => g.hotelIds.includes(hotelId));
  const groupStatus = (g: GroupRec): PlatformGroupStatus => g.status ?? 'active';
  const isLive = (h: HotelRec) => LIVE_STATUSES.includes(h.status);

  interface Ctx { h?: HotelRec; g?: GroupRec; a?: AdminRec; u?: UserRec; inv?: InvRec; reason: string | null }
  function textOf(action: PlatformActivityAction, x: Ctx): string {
    const hn = x.h?.name ?? '';
    const gn = x.g?.name ?? '';
    const an = x.a?.name ?? x.u?.name ?? '';
    const iname = x.inv?.hotelName ?? '';
    const iemail = x.inv?.email ?? '';
    switch (action) {
      case 'hotel_created': return x.reason ? `${A.hotelCreated(hn)} ${x.reason}.` : A.hotelCreated(hn);
      case 'hotel_suspended': return A.hotelSuspended(hn, x.reason ?? x.h?.suspendReason ?? null);
      case 'hotel_reactivated': return A.hotelReactivated(hn);
      case 'hotel_entered': return A.hotelEntered(hn, x.reason);
      case 'hotel_exited': return A.hotelExited(hn);
      case 'hotel_visit_extended': return A.hotelVisitExtended(hn);
      case 'platform_admin_access_changed': return A.platformAdminAccessChanged(an);
      case 'admin_created': return A.adminCreated(an, hn);
      case 'admin_password_reset': return A.adminPasswordReset(an);
      case 'admin_unlocked': return A.adminUnlocked(an);
      case 'admin_disabled': return A.adminDisabled(an);
      case 'admin_enabled': return A.adminEnabled(an);
      case 'admin_locked': return A.adminLocked(an);
      case 'group_created': return A.groupCreated(gn);
      case 'group_hotel_added': return A.groupHotelAdded(hn, gn);
      case 'group_hotel_removed': return A.groupHotelRemoved(hn, gn);
      case 'group_admin_set': return A.groupAdminSet(an, gn);
      case 'group_admin_cleared': return A.groupAdminCleared(gn);
      case 'hotel_submitted': return A.hotelSubmitted(hn);
      case 'hotel_approved': return A.hotelApproved(hn);
      case 'hotel_rejected': return A.hotelRejected(hn, x.reason ?? x.h?.rejectReason ?? null);
      case 'hotel_archived': return A.hotelArchived(hn, x.reason ?? x.h?.archiveReason ?? null);
      case 'hotel_restored': return A.hotelRestored(hn);
      case 'group_submitted': return A.groupSubmitted(gn);
      case 'group_approved': return A.groupApproved(gn);
      case 'group_rejected': return A.groupRejected(gn, x.reason ?? x.g?.rejectReason ?? null);
      case 'invitation_sent': return A.invitationSent(iname, iemail);
      case 'invitation_resent': return A.invitationResent(iname, iemail);
      case 'invitation_opened': return A.invitationOpened(iname);
      case 'invitation_cancelled': return A.invitationCancelled(iname);
      case 'user_disabled': return A.userDisabled(an);
      case 'user_enabled': return A.userEnabled(an);
      case 'user_password_reset': return A.userPasswordReset(an);
      case 'user_unlocked': return A.userUnlocked(an);
      // A8: the extra text (file name, what changed, the check's summary) travels in `reason`.
      case 'staff_created': return C.platformStaff.logCreated(an);
      case 'health_checked': return C.platformHealth.logChecked(x.reason ?? '');
      case 'settings_updated': return C.platformSettings.logUpdated(x.reason ?? '');
      case 'announcement_created': return C.announcements.logCreated(x.reason ?? '');
      case 'announcement_ended': return C.announcements.logEnded(x.reason ?? '');
      case 'hotel_exported': return C.archivedHotels.logExported(hn, x.reason ?? '');
      case 'hotel_deleted': return C.archivedHotels.logDeleted(hn);
      case 'audit_exported': return x.reason ? `Exported the audit log (${x.reason}).` : 'Exported the audit log.';
      case 'hotel_write_started': return `A change was started in ${hn} during a full-access visit.`;
      case 'hotel_write': return `A change was made in ${hn} during a full-access visit.`;
      case 'hotel_write_refused': return `A change was blocked while viewing ${hn} as platform staff.`;
      // API access keys: the mock never makes these rows (keys exist only on the real server); a plain sentence keeps the list complete
      case 'api_token_created': return `Made an API key${x.reason ? ` (${x.reason})` : ''}.`;
      case 'api_token_revoked': return 'Revoked an API key.';
      case 'api_token_full_access': return `Full access keys switched${x.reason ? `: ${x.reason}` : ''}.`;
      case 'api_token_write': return `Change made with an API key${x.reason ? ` (${x.reason})` : ''}.`;
      case 'api_token_refused': return `API key call refused${x.reason ? `: ${x.reason}` : ''}`;
      case 'api_token_new_ip': return x.reason ?? 'API key used from a new address.';
      // deliverability (platform 0130): real-server rows only, a plain sentence keeps the list complete
      case 'mail_suppressed': return `Suppressed an address${x.reason ? ` (${x.reason})` : ''}.`;
      case 'mail_unsuppressed': return 'Lifted a suppression.';
      case 'mail_hold': return `Held campaign mail of ${hn}${x.reason ? `: ${x.reason}` : ''}.`;
      case 'mail_hold_released': return `Released campaign mail of ${hn}${x.reason ? `: ${x.reason}` : ''}.`;
      // the one common profile (platform 0132): real-server rows only, a plain sentence keeps the list complete
      case 'profile_merged': return `Merged duplicate profiles${x.reason ? `: ${x.reason}` : ''}.`;
      case 'profile_kept_apart': return 'Marked two profiles as not the same.';
      case 'profile_kept_apart_undone': return 'Showed two profiles again as possible duplicates.';
      // the hotel vault (platform 0168): real-server rows only
      case 'vault_item_added': return `Added ${x.reason ?? 'an item'} to the vault of ${hn}.`;
      case 'vault_item_changed': return `Changed ${x.reason ?? 'an item'} in the vault of ${hn}.`;
      case 'vault_item_revealed': return `Showed the secret of ${x.reason ?? 'an item'} in the vault of ${hn}.`;
      case 'vault_item_removed': return `Removed ${x.reason ?? 'an item'} from the vault of ${hn}.`;
      case 'personal_vault_item_added': return `Added ${x.reason ?? 'an item'} to their own vault.`;
      case 'personal_vault_item_changed': return `Changed ${x.reason ?? 'an item'} in their own vault.`;
      case 'personal_vault_item_revealed': return `Showed the secret of ${x.reason ?? 'an item'} in their own vault.`;
      case 'personal_vault_item_removed': return `Removed ${x.reason ?? 'an item'} from their own vault.`;
      case 'demo_request_updated': return `Marked a demo request as ${x.reason ?? 'changed'}.`;
      case 'central_revealed': return 'Showed a full mobile or email in the Central tabs.';
      case 'central_created': return 'Created a record in the Central tabs.';
      case 'central_updated': return 'Changed a record in the Central tabs.';
      case 'central_deleted': return 'Deleted a record in the Central tabs.';
      case 'central_restored': return 'Restored a record in the Central tabs.';
    }
  }

  function log(
    action: PlatformActivityAction,
    ids: { hotelId?: string | null; groupId?: string | null; adminId?: string | null; userId?: string | null; invId?: string | null },
    opts: { at?: string; actorName?: string; reason?: string | null; refused?: boolean } = {},
  ): void {
    const h = hotelOf(ids.hotelId ?? null);
    const g = groupOf(ids.groupId ?? null);
    const a = adminOf(ids.adminId ?? null);
    const u = userOf(ids.userId ?? null);
    const inv = invOf(ids.invId ?? null);
    const id = opts.refused ? `ref-${refused.length + 1}` : `act-${activity.length + 1}`;
    (opts.refused ? refused : activity).push({
      id,
      at: opts.at ?? tick(),
      actorName: opts.actorName ?? actor.name,
      action,
      hotelId: h?.id ?? null,
      hotelName: h?.name ?? null,
      groupId: g?.id ?? null,
      groupName: g?.name ?? null,
      adminId: a?.id ?? null,
      text: textOf(action, { h, g, a, u, inv, reason: opts.reason ?? null }),
    });
    targets.set(id, u?.name ?? a?.name ?? inv?.hotelName ?? h?.name ?? g?.name ?? '');
    const why =
      opts.reason ??
      (action === 'hotel_suspended' ? h?.suspendReason : action === 'hotel_rejected' ? h?.rejectReason : action === 'hotel_archived' ? h?.archiveReason : action === 'group_rejected' ? g?.rejectReason : null) ??
      null;
    if (why) auditReasons.set(id, why);
  }
  // The seed's own history (texts use the seed records, so the names are right).
  for (const [at, who, action, hotelId, groupId, adminId, extra] of seedTime(seedActivity)) {
    log(action, { hotelId, groupId, adminId, userId: extra?.user ?? null, invId: extra?.inv ?? null }, { at, actorName: who, reason: extra?.reason ?? null });
  }
  // A7: two refused attempts, so the audit log shows a failed row.
  log('user_disabled', { userId: 'u-superadmin' }, { at: seedTime('2026-10-01T08:15:00.000Z'), actorName: SUPER, reason: E.lastSuperAdmin, refused: true });
  log('admin_password_reset', { hotelId: 'h-1', adminId: 'a-3' }, { at: seedTime('2026-10-02T06:30:00.000Z'), actorName: 'Arjun Menon', reason: E.disabledNoReset, refused: true });
  log('hotel_write_refused', { hotelId: 'h-2' }, { at: seedTime('2026-10-03T10:20:00.000Z'), actorName: 'Neha Kapoor', reason: 'The visit is read-only: a bill could not be changed.', refused: true });

  const newestFirst = (list: PlatformActivity[]) => [...list].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : y.id.localeCompare(x.id, 'en', { numeric: true })));

  // ---- views
  /** Inside the archive grace period (same rule as graceLeft below; a declaration so the views can use it at any time). */
  function inGrace(archivedAt: string): boolean {
    return ARCHIVE_GRACE_DAYS - Math.floor((clockMs() - Date.parse(archivedAt)) / 86_400_000) > 0;
  }
  function hotelView(h: HotelRec): PlatformHotel {
    const g = groupOfHotel(h.id);
    const own = admins.filter((a) => a.hotelId === h.id);
    return {
      id: h.id, name: h.name, slug: h.slug, city: h.city, state: h.state, gstin: h.gstin, timeZone: h.timeZone, status: h.status,
      groupId: g?.id ?? null, groupName: g?.name ?? null,
      adminCount: own.length, lockedAdminCount: own.filter((a) => a.status === 'locked').length,
      createdAt: h.createdAt, suspendedAt: h.suspendedAt, suspendReason: h.suspendReason,
      kind: g ? 'group' : 'individual',
      submittedAt: h.submittedAt ?? null, invitationId: h.invitationId ?? null, approvedAt: h.approvedAt ?? null,
      rejectedAt: h.rejectedAt ?? null, rejectReason: h.rejectReason ?? null, archivedAt: h.archivedAt ?? null, archiveReason: h.archiveReason ?? null,
      ...(h.status === 'archived'
        ? { canRestore: inGrace(h.archivedAt ?? h.createdAt), restoresTo: h.statusBeforeArchive === 'suspended' || h.statusBeforeArchive === 'rejected' ? h.statusBeforeArchive : ('active' as const) }
        : {}),
    };
  }
  function adminView(a: AdminRec): PlatformHotelAdmin {
    const g = groups.find((x) => x.groupAdminId === a.id && !x.groupAdminUserId);
    return {
      id: a.id, hotelId: a.hotelId, hotelName: hotelOf(a.hotelId)?.name ?? '', name: a.name, username: a.username, email: a.email, mobile: a.mobile,
      status: a.status, lastSignInAt: a.lastSignInAt, lockedAt: a.lockedAt, createdAt: a.createdAt,
      groupAdminOf: g ? { groupId: g.id, groupName: g.name } : null,
    };
  }
  function groupAdminOf(g: GroupRec): PlatformGroup['groupAdmin'] {
    const u = userOf(g.groupAdminUserId ?? null);
    if (u) return { adminId: u.id, name: u.name, username: u.username, hotelName: '' };
    const a = adminOf(g.groupAdminId);
    return a ? { adminId: a.id, name: a.name, username: a.username, hotelName: hotelOf(a.hotelId)?.name ?? '' } : null;
  }
  function groupView(g: GroupRec): PlatformGroup {
    return {
      id: g.id, name: g.name, hotelIds: [...g.hotelIds], hotelCount: g.hotelIds.length,
      groupAdmin: groupAdminOf(g),
      createdAt: g.createdAt,
      status: groupStatus(g),
      legalName: g.legalName ?? null, gstin: g.gstin ?? null, address: g.address ?? null, city: g.city ?? null, state: g.state ?? null, pin: g.pin ?? null,
      phone: g.phone ?? null, email: g.email ?? null, invitationId: g.invitationId ?? null, submittedAt: g.submittedAt ?? null,
      approvedAt: g.approvedAt ?? null, rejectedAt: g.rejectedAt ?? null, rejectReason: g.rejectReason ?? null,
      maxHotels: g.maxHotels ?? null,
    };
  }
  const invStatus = (r: InvRec): PlatformInvitationStatus =>
    (r.status === 'sent' || r.status === 'opened') && r.expiresAt <= nowIso() ? 'expired' : r.status;
  /**
   * Review M4: the one duplicate rule of sendInvitation AND resendInvitation. Field errors when ANOTHER open (sent / opened, not
   * expired) invitation has the same email, or the same name of the same kind (a group name among 'group' invitations, a hotel name
   * among 'individual' / 'member_hotel' ones). `exceptId` = the invitation being resent.
   */
  function openInvitationClash(type: PlatformInvitationType, name: string, email: string, exceptId: string | null): Record<string, string> {
    const f: Record<string, string> = {};
    const isGroup = type === 'group';
    const n = name.trim().toLowerCase();
    const e = email.trim().toLowerCase();
    for (const r of invitations) {
      if (r.id === exceptId) continue;
      const st = invStatus(r);
      if (st !== 'sent' && st !== 'opened') continue;
      if (e && r.email.toLowerCase() === e) f.email = E.inviteDuplicate;
      if (n && (r.type === 'group') === isGroup && r.hotelName.trim().toLowerCase() === n) f.hotelName = isGroup ? E.inviteDuplicateGroup : E.inviteDuplicateHotel;
    }
    return f;
  }
  /** The group an invitation points at: member_hotel = its group; group = the new group, only once approved. */
  function invGroup(r: InvRec): GroupRec | undefined {
    if (r.type === 'group') {
      const g = groupOf(r.madeGroupId ?? r.groupId);
      return g && groupStatus(g) === 'active' ? g : undefined;
    }
    return groupOf(r.groupId);
  }
  function invView(r: InvRec): PlatformInvitation {
    const g = invGroup(r);
    return {
      id: r.id, hotelName: r.hotelName, contactName: r.contactName, email: r.email,
      groupId: g?.id ?? null, groupName: g?.name ?? null, type: r.type, status: invStatus(r),
      createdAt: r.createdAt, expiresAt: r.expiresAt, openedAt: r.openedAt, submittedAt: r.submittedAt, cancelledAt: r.cancelledAt,
      sentBy: r.invitedByName, invitedByName: r.invitedByName, invitedByRole: r.invitedByRole, resendCount: r.resendCount, hotelId: r.hotelId,
    };
  }
  function userViewOfRec(u: UserRec): PlatformUser {
    const h = hotelOf(u.hotelId);
    const g = groupOf(u.groupId) ?? (h ? groupOfHotel(h.id) : undefined);
    return {
      id: u.id, name: u.name, username: u.username, email: u.email, mobile: u.mobile, level: u.level,
      hotelId: h?.id ?? null, hotelName: h?.name ?? null, groupId: g?.id ?? null, groupName: g?.name ?? null,
      status: u.status, lastSignInAt: u.lastSignInAt, lockedAt: u.lockedAt, createdAt: u.createdAt,
    };
  }
  function userViewOfAdmin(a: AdminRec): PlatformUser {
    const h = hotelOf(a.hotelId);
    const g = groupOfHotel(a.hotelId);
    return {
      id: a.id, name: a.name, username: a.username, email: a.email, mobile: a.mobile, level: 'hotel_admin',
      hotelId: a.hotelId, hotelName: h?.name ?? null, groupId: g?.id ?? null, groupName: g?.name ?? null,
      status: a.status, lastSignInAt: a.lastSignInAt, lockedAt: a.lockedAt, createdAt: a.createdAt,
    };
  }
  const allUsers = (): PlatformUser[] => [...users.map(userViewOfRec), ...admins.map(userViewOfAdmin)];

  const byName = <T extends { name: string }>(x: T, y: T) => x.name.localeCompare(y.name, 'en');
  const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
  const allWords = (hay: string, s: string) => words(s).every((w) => hay.includes(w));
  function paged<T>(all: T[], q: { page?: number; pageSize?: number }): Page<T> {
    const pageSize = Math.max(1, q.pageSize ?? 20);
    const page = Math.max(1, q.page ?? 1);
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
  }

  // ---- validation
  function slugProblem(slug: string): string | null {
    if (!slug) return E.required.slug;
    if (slug.length < 3 || slug.length > 40 || !SLUG_RE.test(slug)) return E.slugFormat;
    if (RESERVED_SLUGS.includes(slug)) return E.slugReserved;
    if (hotels.some((h) => h.slug === slug)) return E.slugTaken;
    return null;
  }
  function freeSlug(base: string): string | null {
    const root = (SLUG_RE.test(base) ? base : slugFromName(base)).slice(0, 36) || 'hotel';
    for (let i = 2; i < 100; i++) {
      const s = `${root}-${i}`;
      if (!slugProblem(s)) return s;
    }
    return null;
  }
  /** A free web address for a hotel that joined by invitation (the form has no address field). */
  function slugFor(name: string): string {
    const base = slugFromName(name);
    if (!slugProblem(base)) return base;
    return freeSlug(base || 'hotel') ?? nextId('hotel');
  }
  const usernameTaken = (u: string) =>
    admins.some((a) => a.username === u) || users.some((x) => x.username === u) || ['platform', 'superadmin', 'mihir', 'group'].includes(u);
  const emailTaken = (e: string) => admins.some((a) => a.email.toLowerCase() === e) || users.some((x) => x.email.toLowerCase() === e);
  /** m: a 10-digit mobile (normaliseMobile). A mobile number belongs to one account. */
  const mobileTaken = (m: string) => admins.some((a) => normaliseMobile(a.mobile) === m) || users.some((x) => normaliseMobile(x.mobile) === m);
  const phoneOk = (raw: string) => {
    const d = raw.replace(/\D+/g, '');
    return d.length >= 10 && d.length <= 12;
  };

  function checkAdmin(a: PlatformAdminInput, prefix: string, f: Record<string, string>): void {
    const name = a.name.trim();
    if (!name) f[`${prefix}name`] = E.required.adminName;
    else if (name.length > 100) f[`${prefix}name`] = E.nameLong;
    const u = a.username.trim().toLowerCase();
    if (!u) f[`${prefix}username`] = E.required.username;
    else if (!USERNAME_RE.test(u)) f[`${prefix}username`] = E.usernameFormat;
    else if (usernameTaken(u)) f[`${prefix}username`] = E.usernameTaken;
    const e = a.email.trim().toLowerCase();
    if (!e) f[`${prefix}email`] = E.required.email;
    else if (!EMAIL_RE.test(e)) f[`${prefix}email`] = E.emailFormat;
    else if (emailTaken(e)) f[`${prefix}email`] = E.emailTaken;
    if (!a.mobile.trim()) f[`${prefix}mobile`] = E.required.mobile;
    else {
      const m = normaliseMobile(a.mobile);
      if (!m) f[`${prefix}mobile`] = E.mobileFormat;
      else if (mobileTaken(m)) f[`${prefix}mobile`] = E.mobileTaken;
    }
  }
  /** Onboarding admin: the usual checks plus the password rule. The password is only checked, never kept. */
  function checkOnboardingAdmin(a: PlatformOnboardingAdminInput, f: Record<string, string>): void {
    checkAdmin({ name: a.name ?? '', username: a.username ?? '', email: a.email ?? '', mobile: a.mobile ?? '' }, 'admin.', f);
    const pw = passwordProblem(a.password ?? '');
    if (pw) f['admin.password'] = pw;
    if (!a.passwordConfirm) f['admin.passwordConfirm'] = E.required.passwordConfirm;
    else if (a.passwordConfirm !== a.password) f['admin.passwordConfirm'] = E.passwordMismatch;
  }
  function checkGstin(raw: string, state: string, key: string, stateKey: string, f: Record<string, string>, stateRequired: boolean): void {
    const st = state.trim();
    const code = st ? gstCodeOfState(st) : null;
    if (!st && stateRequired) f[stateKey] = E.required.state;
    else if (st && !code) f[stateKey] = E.stateUnknown;
    const gstin = raw.trim().toUpperCase();
    if (!gstin) f[key] = E.required.gstin;
    else if (!GSTIN_RE.test(gstin) || !PLATFORM_STATES.some((s) => s.gstCode === gstin.slice(0, 2))) f[key] = E.gstinFormat;
    else if (code && gstin.slice(0, 2) !== code) f[key] = E.gstinState(code, st);
  }
  function checkOnboardingHotel(h: PlatformOnboardingHotelInput, f: Record<string, string>): void {
    const name = (h.name ?? '').trim();
    if (!name) f['hotel.name'] = E.required.hotelName;
    else if (name.length > 100) f['hotel.name'] = E.nameLong;
    if (!(h.address ?? '').trim()) f['hotel.address'] = E.required.address;
    if (!(h.city ?? '').trim()) f['hotel.city'] = E.required.city;
    checkGstin(h.gstin ?? '', h.state ?? '', 'hotel.gstin', 'hotel.state', f, true);
    const pin = (h.pin ?? '').trim();
    if (!pin) f['hotel.pin'] = E.required.pin;
    else if (!PIN_RE.test(pin)) f['hotel.pin'] = E.pinFormat;
    if (!(h.phone ?? '').trim()) f['hotel.phone'] = E.required.phone;
    else if (!phoneOk(h.phone)) f['hotel.phone'] = E.phoneFormat;
    const e = (h.email ?? '').trim().toLowerCase();
    if (!e) f['hotel.email'] = E.required.hotelEmail;
    else if (!EMAIL_RE.test(e)) f['hotel.email'] = E.emailFormat;
    if (h.logoName && !LOGO_RE.test(h.logoName)) f['hotel.logoName'] = E.logoType;
  }
  function checkOnboardingGroup(g: PlatformOnboardingGroupInput, f: Record<string, string>): void {
    const name = (g.name ?? '').trim();
    if (!name) f['group.name'] = E.required.groupName;
    else if (name.length > 100) f['group.name'] = E.nameLong;
    else if (groups.some((x) => x.name.toLowerCase() === name.toLowerCase() && groupStatus(x) !== 'rejected')) f['group.name'] = E.groupNameTaken;
    if (!(g.legalName ?? '').trim()) f['group.legalName'] = E.legalNameRequired;
    checkGstin(g.gstin ?? '', g.state ?? '', 'group.gstin', 'group.state', f, false);
    if (!(g.address ?? '').trim()) f['group.address'] = E.required.address;
    const pin = (g.pin ?? '').trim();
    if (pin && !PIN_RE.test(pin)) f['group.pin'] = E.pinFormat;
    if (!(g.phone ?? '').trim()) f['group.phone'] = E.required.phone;
    else if (!phoneOk(g.phone)) f['group.phone'] = E.phoneFormat;
    const e = (g.email ?? '').trim().toLowerCase();
    if (!e) f['group.email'] = E.required.email;
    else if (!EMAIL_RE.test(e)) f['group.email'] = E.emailFormat;
  }
  function newAdmin(hotelId: string, a: PlatformAdminInput, at: string): AdminRec {
    return {
      id: nextId('a'), hotelId, name: a.name.trim(), username: a.username.trim().toLowerCase(), email: a.email.trim().toLowerCase(),
      mobile: normaliseMobile(a.mobile) ?? a.mobile.trim(), status: 'active', lastSignInAt: null, lockedAt: null, createdAt: at,
    };
  }
  /** null when the token can be used, else the refusal. */
  function tokenRefusal(r: InvRec | undefined): { ok: false; error: DashError } | null {
    if (!r) return refuseToken('NOT_FOUND', 'NOT_FOUND', E.inviteNotFound);
    const s = invStatus(r);
    if (s === 'cancelled') return refuseToken('CONFLICT', 'CANCELLED', E.inviteCancelled);
    if (s === 'submitted') return refuseToken('CONFLICT', 'ALREADY_SUBMITTED', E.inviteUsed);
    if (s === 'expired') return refuseToken('CONFLICT', 'EXPIRED', E.inviteExpired);
    return null;
  }
  /** A group admin may only touch invitations of its own group. */
  const notMine = (r: InvRec) => actor.role === 'group_admin' && r.groupId !== actor.groupId;
  /** Group-admin scoping (review M7): a group admin reaches only member hotels of its own group; anything else answers NOT_FOUND. */
  const isGroupAdmin = () => actor.role === 'group_admin';
  const outOfScope = (hotelId: string) => isGroupAdmin() && groupOfHotel(hotelId)?.id !== actor.groupId;
  /** The group a list is narrowed to: always the actor's own group for a group admin, else what the caller asked for. */
  const scopeGroup = (asked?: string) => (isGroupAdmin() ? actor.groupId ?? '-' : asked);
  /** Admin writes (reset, unlock, disable, enable) are refused for a hotel that is not live (archived, rejected, waiting) (review M9). */
  const hotelNotLive = (hotelId: string) => {
    const h = hotelOf(hotelId);
    return !h || !isLive(h);
  };

  // ---- needs attention
  function attention(): PlatformAttentionItem[] {
    const out: PlatformAttentionItem[] = [];
    const gOf = (hotelId: string) => groupOfHotel(hotelId);
    for (const a of admins) {
      // Only admins of live hotels (an archived or rejected hotel's locked admin needs nothing; review L11).
      if (a.status !== 'locked' || hotelNotLive(a.hotelId)) continue;
      const h = hotelOf(a.hotelId);
      const g = gOf(a.hotelId);
      out.push({ id: `locked-${a.id}`, kind: 'locked_account', hotelId: a.hotelId, hotelName: h?.name ?? '', groupId: g?.id ?? null, groupName: g?.name ?? null, adminId: a.id, adminName: a.name, text: platformCopy.attention.locked(a.name, h?.name ?? ''), since: a.lockedAt ?? a.createdAt });
    }
    for (const h of hotels) {
      const g = gOf(h.id);
      const base = { hotelId: h.id, hotelName: h.name, groupId: g?.id ?? null, groupName: g?.name ?? null, adminId: null, adminName: null };
      if (isLive(h) && !admins.some((a) => a.hotelId === h.id)) {
        out.push({ ...base, id: `noadmin-${h.id}`, kind: 'no_admin', text: platformCopy.attention.noAdmin(h.name), since: h.createdAt });
      }
      if (h.status === 'suspended') {
        out.push({ ...base, id: `suspended-${h.id}`, kind: 'suspended', text: platformCopy.attention.suspended(h.name), since: h.suspendedAt ?? h.createdAt });
      }
      if (h.status === 'pending_approval') {
        const first = admins.find((a) => a.hotelId === h.id);
        out.push({ ...base, id: `pending-${h.id}`, kind: 'pending_approval', adminId: first?.id ?? null, adminName: first?.name ?? null, text: platformCopy.attention.pendingApproval(h.name), since: h.submittedAt ?? h.createdAt });
      }
    }
    for (const g of groups) {
      if (groupStatus(g) !== 'pending_approval') continue;
      const ga = groupAdminOf(g);
      out.push({ id: `pendinggroup-${g.id}`, kind: 'pending_group', hotelId: '', hotelName: g.name, groupId: g.id, groupName: g.name, adminId: ga?.adminId ?? null, adminName: ga?.name ?? null, text: platformCopy.attention.pendingGroup(g.name, ga?.name ?? ''), since: g.submittedAt ?? g.createdAt });
    }
    return out.sort((x, y) => (x.since < y.since ? 1 : x.since > y.since ? -1 : 0));
  }

  function groupDetail(g: GroupRec): PlatformGroupDetail {
    return {
      group: groupView(g),
      hotels: g.hotelIds.map((id) => hotelOf(id)).filter((h): h is HotelRec => !!h).map(hotelView).sort(byName),
      availableHotels: hotels.filter((h) => isLive(h) && !groupOfHotel(h.id)).map(hotelView).sort(byName),
      adminChoices: admins.filter((a) => g.hotelIds.includes(a.hotelId) && a.status === 'active').map(adminView).sort(byName),
      activity: newestFirst(activity.filter((x) => x.groupId === g.id)),
    };
  }

  /** Shared by unlock / disable / enable / reset: finds the admin or answers NOT_FOUND. */
  function withAdmin<T>(adminId: string, fn: (a: AdminRec) => DashResult<T>): DashResult<T> {
    const a = adminOf(adminId);
    // A group admin never reaches an admin of a hotel outside its group (review M7).
    return a && !outOfScope(a.hotelId) ? fn(a) : mockError('NOT_FOUND');
  }

  /** A user of any level: a UserRec, or a Hotel Admin record (same id as in listHotelAdmins). */
  type AnyUser = { kind: 'user'; rec: UserRec } | { kind: 'admin'; rec: AdminRec };
  function anyUserOf(id: string): AnyUser | undefined {
    const u = userOf(id);
    if (u) return { kind: 'user', rec: u };
    const a = adminOf(id);
    return a ? { kind: 'admin', rec: a } : undefined;
  }
  const viewOfAny = (x: AnyUser) => (x.kind === 'user' ? userViewOfRec(x.rec) : userViewOfAdmin(x.rec));
  function logUser(action: PlatformActivityAction, x: AnyUser, opts: { reason?: string; refused?: boolean } = {}): void {
    if (x.kind === 'admin') log(action, { hotelId: x.rec.hotelId, groupId: groupOfHotel(x.rec.hotelId)?.id ?? null, adminId: x.rec.id }, opts);
    else log(action, { hotelId: x.rec.hotelId, groupId: x.rec.groupId ?? (x.rec.hotelId ? groupOfHotel(x.rec.hotelId)?.id ?? null : null), userId: x.rec.id }, opts);
  }

  // ---- sign-in history (built once from the seed)
  const signIns: PlatformSignIn[] = (() => {
    const everyone = allUsers();
    return seedTime(seedSignIns)
      .map(([at, username, result, reasonKey, ip, device], i): PlatformSignIn => {
        const p = everyone.find((x) => x.username === username);
        return {
          id: `si-${i + 1}`, at, username, name: p?.name ?? null, level: p?.level ?? null,
          // A Group Hotel Admin has no hotel of its own: name the group, not "Platform".
          hotelName: p?.hotelName ?? p?.groupName ?? null,
          result, reason: reasonKey ? platformCopy.signIns.reasons[reasonKey] : null, ip, device,
        };
      })
      .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  })();

  // ---- A8: platform staff, health, settings, archive (seed at the end of the file)
  for (const u of A8_SEED_STAFF) users.push(seedTime(u));
  for (const h of A8_SEED_HOTELS) hotels.push(seedTime({ ...h, onboarding: null }));
  for (const a of A8_SEED_ADMINS) admins.push(seedTime(a));
  for (const [at, who, action, hotelId, userId, reason] of seedTime(A8_SEED_ACTIVITY)) log(action, { hotelId, userId }, { at, actorName: who, reason });
  const health = new Map<string, A8HealthSeed>(A8_SEED_HEALTH.map((x) => [x.hotelId, seedTime(x)]));
  let healthCheckedAt: string = seedTime(A8_HEALTH_CHECKED_AT);
  /** The connection of a mail service as the server fixes it (the real rules live in web-app/src/server/mail/provider.ts). */
function mockConnection(provider: MailProviderId, sm: { host?: string; port?: number; security?: MailSecurity; region?: string }): { host: string; port: number; security: MailSecurity; region: string } {
  if (provider === 'gmail') return { host: 'smtp.gmail.com', port: 587, security: 'starttls', region: '' };
  if (provider === 'brevo') return { host: 'smtp-relay.brevo.com', port: 587, security: 'starttls', region: '' };
  if (provider === 'ses') {
    const region = sm.region ?? 'ap-south-1';
    return { host: `email-smtp.${region}.amazonaws.com`, port: 587, security: 'starttls', region };
  }
  return { host: (sm.host ?? '').trim(), port: sm.port ?? 587, security: sm.security ?? 'starttls', region: '' };
}
const MOCK_LIMITS: Record<MailProviderId, MailLimitsInfo> = { gmail: { perSecond: 1, perDay: 500 }, brevo: { perSecond: 5, perDay: 300 }, ses: { perSecond: 14, perDay: 0 }, smtp: { perSecond: 5, perDay: 0 }, domain: { perSecond: 14, perDay: 0 } };
function mockLimits(provider: MailProviderId, dailyLimit: number | null): MailLimitsInfo {
  const base = MOCK_LIMITS[provider];
  return { perSecond: base.perSecond, perDay: dailyLimit && dailyLimit > 0 ? (base.perDay > 0 ? Math.min(base.perDay, dailyLimit) : dailyLimit) : base.perDay };
}
const settings: A8SettingsRec = { ...A8_SEED_SETTINGS, roleKeys: [...A8_SEED_SETTINGS.roleKeys], smtp: { ...A8_SEED_SETTINGS.smtp }, backup: { ...A8_SEED_SETTINGS.backup }, failover: { ...A8_SEED_SETTINGS.failover, events: [...A8_SEED_SETTINGS.failover.events] } };
  const exportsOf = new Map<string, { at: string; fileName: string }>();

  // ---- keep (mock only): the store as one JSON-safe snapshot, saved after every change, read back once here.
  function snapshot(): PlatformSnapshot {
    return {
      v: PLATFORM_SNAPSHOT_VERSION,
      hotels, admins, groups, users, invitations, activity, refused,
      targets: [...targets], auditReasons: [...auditReasons], signIns, health: [...health], healthCheckedAt,
      settings, exportsOf: [...exportsOf], seq, nowMs,
    };
  }
  /** Puts a snapshot (a fresh copy: the caller's object is never kept) into the live store, in place. Never shifts its times. */
  function applySnapshot(src: PlatformSnapshot): void {
    const s = jsonCopy(src);
    hotels.splice(0, hotels.length, ...s.hotels);
    admins.splice(0, admins.length, ...s.admins);
    groups.splice(0, groups.length, ...s.groups);
    users.splice(0, users.length, ...s.users);
    invitations.splice(0, invitations.length, ...s.invitations);
    activity.splice(0, activity.length, ...s.activity);
    refused.splice(0, refused.length, ...s.refused);
    signIns.splice(0, signIns.length, ...s.signIns);
    targets.clear();
    for (const [k, v] of s.targets) targets.set(k, v);
    auditReasons.clear();
    for (const [k, v] of s.auditReasons) auditReasons.set(k, v);
    health.clear();
    for (const [k, v] of s.health) health.set(k, v);
    exportsOf.clear();
    for (const [k, v] of s.exportsOf) exportsOf.set(k, v);
    healthCheckedAt = s.healthCheckedAt;
    Object.assign(settings, s.settings, { roleKeys: [...s.settings.roleKeys] });
    seq = s.seq;
    // The write clock never runs backwards: a later real date simply continues from now.
    nowMs = Math.max(Date.now(), s.nowMs);
  }
  /** The seed as made at page load (already on the real clock), for resetToSeed. */
  const seedSnapshot = jsonCopy(snapshot());
  let lastSaved = JSON.stringify(seedSnapshot);
  if (keep) {
    let saved: PlatformSnapshot | null = null;
    try {
      saved = asPlatformSnapshot(keep.load());
    } catch {
      saved = null;
    }
    if (saved) {
      try {
        applySnapshot(saved);
        lastSaved = JSON.stringify(snapshot());
      } catch {
        applySnapshot(seedSnapshot); // a snapshot that looked right but did not fit: the seed again
      }
    }
  }
  /** Saves the store when it differs from the last save (reads change nothing, so they write nothing). */
  function persist(): void {
    if (!keep) return;
    try {
      const snap = snapshot();
      const json = JSON.stringify(snap);
      if (json === lastSaved) return;
      lastSaved = json;
      keep.save(snap);
    } catch {
      // storage full or blocked: the store still works for this page
    }
  }

  const isSuper = () => actor.role === 'super_admin';
  /** Refused writes by a non Super Admin are kept in the audit log as failed rows. */
  const refuseNotSuper = (action: PlatformActivityAction, ids: { hotelId?: string | null; userId?: string | null }) => {
    log(action, ids, { reason: C.a8Errors.superOnly, refused: true });
    return mockError('FORBIDDEN', undefined, { message: C.a8Errors.superOnly });
  };
  /**
   * Review M6: only the Super Admin may disable, enable, unlock or reset a Super Admin or Platform Admin account. Anyone else is
   * refused (FORBIDDEN) and the attempt is kept in the audit log as a failed row. null = allowed.
   */
  function refuseStaffTarget(action: PlatformActivityAction, x: AnyUser): { ok: false; error: DashError } | null {
    if (isSuper() || x.kind !== 'user' || (x.rec.level !== 'super_admin' && x.rec.level !== 'platform_admin')) return null;
    logUser(action, x, { reason: C.a8Errors.superOnly, refused: true });
    return mockError('FORBIDDEN', undefined, { message: C.a8Errors.superOnly });
  }
  const staffOf = (id: string) => users.find((u) => u.id === id && u.level === 'platform_admin');
  const staffView = (u: UserRec): PlatformStaff => ({
    id: u.id, name: u.name, username: u.username, email: u.email, mobile: u.mobile, role: 'platform_admin',
    status: u.status === 'pending' ? 'active' : u.status, lastSignInAt: u.lastSignInAt, lockedAt: u.lockedAt, createdAt: u.createdAt, isYou: u.name === actor.name,
  });
  // What a platform admin may do when entering hotels (platform 0135); an account never set has the default: view, all hotels.
  const hotelAccessOf = new Map<string, PlatformAdminHotelAccess>();
  const accessRow = (u: UserRec): PlatformAdminHotelAccess => hotelAccessOf.get(u.id) ?? { userId: u.id, level: 'view', allHotels: true, hotelIds: [], reason: null, updatedBy: null, updatedAt: null };
  /** The access a visit of the signed-in person to this hotel gets, or null when entering is not allowed: a Super Admin full, a group admin view, a platform admin as the Super Admin set it. */
  function visitAccessFor(hotelId: string): PlatformVisitAccess | null {
    if (isGroupAdmin()) return 'view';
    if (isSuper()) return 'full';
    const me = users.find((u) => u.level === 'platform_admin' && u.name === actor.name);
    const a = me ? accessRow(me) : null;
    if (!a) return 'view';
    if (a.level === 'none' || (!a.allHotels && !a.hotelIds.includes(hotelId))) return null;
    return a.level;
  }
  /** Same keys as the real server: the audit row, the visit, when the 60-minute visit ends, and what it allows. */
  function enterAnswer(h: HotelRec, access: PlatformVisitAccess): PlatformEnterResult {
    const at = clockMs();
    return {
      ok: true as const,
      hotel: { id: h.id, name: h.name, slug: h.slug, status: h.status },
      auditId: `au-${at}`,
      visitId: `visit-${at}`,
      expiresAt: new Date(at + 60 * 60_000).toISOString(),
      readOnly: access !== 'full',
      access,
    };
  }
  const DAY_MS = 86_400_000;
  /** Whole days left of the archive grace period (0 = over). */
  const graceLeft = (archivedAt: string) => Math.max(0, ARCHIVE_GRACE_DAYS - Math.floor((clockMs() - Date.parse(archivedAt)) / DAY_MS));
  function archivedView(h: HotelRec): PlatformArchivedHotel {
    const archivedAt = h.archivedAt ?? h.createdAt;
    const by = newestFirst(activity.filter((x) => x.hotelId === h.id && x.action === 'hotel_archived'))[0]?.actorName ?? SUPER;
    const left = graceLeft(archivedAt);
    const ex = exportsOf.get(h.id) ?? null;
    return {
      id: h.id, name: h.name, slug: h.slug, city: h.city, state: h.state, groupName: groupOfHotel(h.id)?.name ?? null,
      archivedAt, archivedBy: by, reason: h.archiveReason ?? null, graceDays: ARCHIVE_GRACE_DAYS, daysLeft: left,
      graceEndsAt: new Date(Date.parse(archivedAt) + ARCHIVE_GRACE_DAYS * DAY_MS).toISOString(),
      canRestore: left > 0, canDelete: left === 0 && !!ex, exportedAt: ex?.at ?? null, exportFileName: ex?.fileName ?? null,
      adminCount: admins.filter((a) => a.hotelId === h.id).length,
    };
  }
  function healthView(): PlatformHealth {
    const P = C.platformHealth.problems;
    const rows = hotels
      .filter(isLive)
      .map((h): PlatformHealthRow => {
        const s = health.get(h.id) ?? { hotelId: h.id, migrationsApplied: A8_LATEST_MIGRATION, migrationsPending: 0, database: 'ok' as const, databaseMs: 40, mail: 'ok' as const, lastBackupAt: null };
        const problems: string[] = [];
        if (s.database === 'down') problems.push(P.down);
        if (s.database === 'slow') problems.push(P.slow);
        if (s.migrationsPending > 0) problems.push(P.pending(s.migrationsPending));
        if (s.mail === 'failing') problems.push(P.mail);
        if (!s.lastBackupAt) problems.push(P.noBackup);
        else if (Date.parse(healthCheckedAt) - Date.parse(s.lastBackupAt) > 2 * DAY_MS) problems.push(P.oldBackup);
        // bills this month (P1): a steady demo figure per live hotel, none for the brand-new ones
        const seq = Number(h.id.replace(/\D/g, '')) || 1;
        const bills = h.id === 'h-3' ? { count: 0, billedPaise: 0 } : { count: 18 + seq * 7, billedPaise: (18 + seq * 7) * 684000 };
        // storage (P1): what the hotel's tables take on disk, a steady demo figure
        const storageBytes = 26_214_400 + seq * 9_437_184;
        return {
          hotelId: h.id, hotelName: h.name, slug: h.slug, city: h.city, hotelStatus: h.status,
          migrationsApplied: s.migrationsApplied, migrationsPending: s.migrationsPending, database: s.database, databaseMs: s.database === 'down' ? null : s.databaseMs,
          mail: s.mail, lastBackupAt: s.lastBackupAt, lastActivityAt: h.approvedAt ?? h.createdAt, bills, storageBytes, status: s.database === 'down' ? 'down' : problems.length ? 'attention' : 'healthy', problems,
        };
      })
      .sort((a, b) => (a.hotelName < b.hotelName ? -1 : a.hotelName > b.hotelName ? 1 : 0));
    return {
      checkedAt: healthCheckedAt,
      latestMigration: A8_LATEST_MIGRATION,
      rows,
      tiles: {
        healthy: rows.filter((r) => r.status === 'healthy').length,
        attention: rows.filter((r) => r.status !== 'healthy').length,
        noBackup: rows.filter((r) => !r.lastBackupAt).length,
        pendingMigrations: rows.filter((r) => r.migrationsPending > 0).length,
      },
    };
  }
  /** Where mail goes out from in the demo. `window.__mailFailover = 'backup'` shows the page as it looks after Amazon SES failed (two sample switches). */
  function mockFailover(): PlatformFailoverSettings {
    const f = { ...settings.failover, events: settings.failover.events.map((e) => ({ ...e })) };
    if ((globalThis as { __mailFailover?: string }).__mailFailover !== 'backup') return f;
    const t = (mins: number): string => new Date(Date.now() - mins * 60_000).toISOString();
    return {
      ...f,
      active: 'backup',
      since: t(6),
      events: [
        { at: t(6), from: 'primary', to: 'backup', reason: 'The main service did not accept the login.' },
        { at: t(190), from: 'backup', to: 'primary', reason: `The main service is tried again after ${f.returnMinutes} minutes.` },
        { at: t(205), from: 'primary', to: 'backup', reason: 'The main service could not be reached.' },
      ],
    };
  }
  function settingsView(): PlatformSettings {
    return {
      newHotelRoles: A8_HOTEL_ROLES.map((r) => ({ ...r, enabled: r.locked || settings.roleKeys.includes(r.key) })),
      defaultGstPercent: settings.defaultGstPercent, defaultTimeZone: settings.defaultTimeZone, invitationValidHours: INVITATION_VALID_HOURS,
      mailFromName: settings.mailFromName, mailFromEmail: settings.mailFromEmail, mailSendingDomain: settings.mailSendingDomain, mailFilesKeepHours: settings.mailFilesKeepHours, twoStepForPlatformRoles: true,
      smtp: { user: settings.smtp.user, passwordSet: settings.smtp.passwordSet, lastChangedAt: settings.smtp.passwordSet ? (settings.updatedAt ?? new Date(0).toISOString()) : null, canStorePassword: true, passwordUnreadable: false, replyTo: settings.smtp.replyTo, otherServer: settings.smtp.otherHost || null, sendingFrom: settings.smtp.user ? { source: 'settings', address: settings.smtp.user, provider: settings.smtp.provider } : { source: 'server', address: null, provider: null }, lastTest: settings.smtp.lastTest, provider: settings.smtp.user ? settings.smtp.provider : null, server: settings.smtp.user ? { host: settings.smtp.host, port: settings.smtp.port, security: settings.smtp.security, region: settings.smtp.region } : null, dailyLimit: settings.smtp.dailyLimit, limits: settings.smtp.user ? mockLimits(settings.smtp.provider, settings.smtp.dailyLimit) : null, backup: { user: settings.backup.user, passwordSet: settings.backup.passwordSet, lastChangedAt: settings.backup.passwordSet ? (settings.updatedAt ?? new Date(0).toISOString()) : null, passwordUnreadable: false, limits: settings.backup.user && settings.backup.passwordSet ? mockLimits('gmail', null) : null, lastTest: settings.backup.lastTest }, failover: mockFailover() },
      updatedAt: settings.updatedAt, updatedBy: settings.updatedBy,
      // Decision 66: the platform mailbox is read in Conversations in the demo (Console > Conversations > Settings switches it); `window.__convMailbox = 'off'` shows it off.
      mailboxReading: mockMailboxReading(),
    };
  }

  // P4: announcements (not kept in the tab store: a page reload starts from this seed)
  // A hotel's own mail accounts (Platform > Hotel mail): kept per hotel in memory; a password is only remembered as "saved".
  interface MockHotelMail { sesRegion: string; sesUser: string; sesFrom: string; sesPass: boolean; gmailUser: string; gmailPass: boolean; fromName: string; replyTo: string; sesTest: PlatformSmtpTestResult | null; gmailTest: PlatformSmtpTestResult | null; pause?: PlatformMailPause | null }
  const hotelMails = new Map<string, MockHotelMail>();
  const hotelMailOf = (hotelId: string): MockHotelMail => hotelMails.get(hotelId) ?? { sesRegion: 'ap-south-1', sesUser: '', sesFrom: '', sesPass: false, gmailUser: '', gmailPass: false, fromName: '', replyTo: '', sesTest: null, gmailTest: null };
  const hotelMailView = (hotelId: string): PlatformHotelMail => {
    const m = hotelMailOf(hotelId);
    return { hotelId, hotelName: hotels.find((h) => h.id === hotelId)?.name ?? '', ses: { region: m.sesRegion, user: m.sesUser, from: m.sesFrom, passwordSet: m.sesPass, passwordUnreadable: false, lastTest: m.sesTest }, gmail: { user: m.gmailUser, passwordSet: m.gmailPass, passwordUnreadable: false, lastTest: m.gmailTest }, fromName: m.fromName, replyTo: m.replyTo, canStorePassword: true, pause: m.pause ?? null };
  };
  // A group's own mail accounts: the same facts as a hotel's, kept per group.
  const groupMails = new Map<string, MockHotelMail>();
  const groupMailOf = (groupId: string): MockHotelMail => groupMails.get(groupId) ?? { sesRegion: 'ap-south-1', sesUser: '', sesFrom: '', sesPass: false, gmailUser: '', gmailPass: false, fromName: '', replyTo: '', sesTest: null, gmailTest: null };
  const groupMailView = (groupId: string): PlatformGroupMail => {
    const m = groupMailOf(groupId);
    return { groupId, groupName: groups.find((g) => g.id === groupId)?.name ?? '', ses: { region: m.sesRegion, user: m.sesUser, from: m.sesFrom, passwordSet: m.sesPass, passwordUnreadable: false, lastTest: m.sesTest }, gmail: { user: m.gmailUser, passwordSet: m.gmailPass, passwordUnreadable: false, lastTest: m.gmailTest }, fromName: m.fromName, replyTo: m.replyTo, canStorePassword: true, pause: m.pause ?? null };
  };
  const announcements: Omit<PlatformAnnouncement, 'state'>[] = [
    { id: 'ann-1', title: 'Maintenance on Sunday night', body: 'EasyHotelSolutions will be unavailable on Sunday from 1:00 to 1:30 am IST for a database upgrade. Nothing you have to do; bills and check-ins made before will be there after.', audience: 'admins', important: true, startsAt: new Date(startMs - 86_400_000).toISOString(), endsAt: null, endedAt: null, createdBy: 'Sonal Super', createdAt: new Date(startMs - 86_400_000).toISOString(), reads: 3 },
  ];
  const announcementView = (a: Omit<PlatformAnnouncement, 'state'>): PlatformAnnouncement => {
    const now = nowIso();
    const state: PlatformAnnouncement['state'] = a.endedAt || (a.endsAt && a.endsAt <= now) ? 'over' : a.startsAt > now ? 'scheduled' : 'live';
    return { ...a, state };
  };

  return {
    /** Who is signed in; their name goes on every activity entry. role defaults to platform_admin; a group_admin gets its group. */
    setActor(a: PlatformActor): void {
      const role: PlatformInviterRole = a.role ?? 'platform_admin';
      actor = { name: a.name || PA, role, groupId: role === 'group_admin' ? a.groupId ?? MOCK_GROUPADMIN_GROUP_ID : null };
    },

    /** Mock only (demo reset): forgets the saved snapshot and puts the store back to the seed as made at page load. The actor stays. */
    resetToSeed(): void {
      try {
        keep?.clear();
      } catch {
        // blocked storage: nothing was saved anyway
      }
      applySnapshot(seedSnapshot);
      lastSaved = JSON.stringify(snapshot());
    },

    // ------------------------------------------------ overview
    getOverview(): Promise<DashResult<PlatformOverview>> {
      return call(() => {
        const month = PLATFORM_MOCK_TODAY.slice(0, 7);
        return ok({
          tiles: {
            hotelsActive: hotels.filter((h) => h.status === 'active').length,
            hotelsSuspended: hotels.filter((h) => h.status === 'suspended').length,
            groups: groups.filter((g) => groupStatus(g) === 'active').length,
            // Same rows as the Groups list: every group plus group invitations still waiting for their admin (sent, opened, expired).
            groupsListed: groups.length + invitations.filter((r) => r.type === 'group' && ['sent', 'opened', 'expired'].includes(invStatus(r))).length,
            groupsWaiting: invitations.filter((r) => r.type === 'group' && ['sent', 'opened', 'expired'].includes(invStatus(r))).length,
            groupsRejected: groups.filter((g) => groupStatus(g) === 'rejected').length,
            // Admins of live hotels only, waiting accounts left out (review L11).
            hotelAdmins: admins.filter((a) => !hotelNotLive(a.hotelId) && a.status !== 'pending').length,
            lockedAccounts: admins.filter((a) => a.status === 'locked' && !hotelNotLive(a.hotelId)).length,
            createdThisMonth: hotels.filter((h) => h.status !== 'archived' && h.createdAt.slice(0, 7) === month).length,
            pendingApproval: hotels.filter((h) => h.status === 'pending_approval').length + groups.filter((g) => groupStatus(g) === 'pending_approval').length,
            pendingHotels: hotels.filter((h) => h.status === 'pending_approval').length,
            pendingGroups: groups.filter((g) => groupStatus(g) === 'pending_approval').length,
            invitationsOpen: invitations.filter((r) => { const s = invStatus(r); return s === 'sent' || s === 'opened'; }).length,
          },
          recentHotels: hotels.filter((h) => h.status !== 'archived').sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1)).slice(0, 5).map(hotelView),
          needsAttention: attention(),
        groupCreatedHotels: newestFirst(activity.filter((x) => x.action === 'hotel_created' && x.text.includes('Created by group'))).slice(0, 5),
        });
      });
    },

    // ------------------------------------------------ hotels
    /** status 'all' leaves out archived hotels. groupId / kind narrow the list (the Group console passes its group). */
    listHotels(q: PlatformHotelQuery = {}): Promise<DashResult<PlatformHotelPage>> {
      return call(() => {
        const s = (q.search ?? '').trim().toLowerCase();
        const kindOk = (h: HotelRec) => !q.kind || q.kind === 'all' || (groupOfHotel(h.id) ? 'group' : 'individual') === q.kind;
        const groupId = scopeGroup(q.groupId);
        const base = hotels
          .filter((h) => !groupId || groupOfHotel(h.id)?.id === groupId)
          .filter((h) => !q.createdMonth || h.createdAt.slice(0, 7) === q.createdMonth)
          .filter((h) => !s || allWords(`${h.name} ${h.slug} ${h.city} ${h.state} ${h.gstin} ${groupOfHotel(h.id)?.name ?? ''}`.toLowerCase(), s));
        const forCounts = base.filter(kindOk);
        const n = (st: PlatformHotelStatus) => forCounts.filter((h) => h.status === st).length;
        const counts = {
          all: forCounts.filter((h) => h.status !== 'archived').length,
          active: n('active'),
          suspended: n('suspended'),
          pending_approval: n('pending_approval'),
          rejected: n('rejected'),
          archived: n('archived'),
        };
        const status = q.status ?? 'all';
        const byStatus = base.filter((h) => (status === 'all' ? h.status !== 'archived' : h.status === status));
        const kindCounts = {
          all: byStatus.length,
          individual: byStatus.filter((h) => !groupOfHotel(h.id)).length,
          group: byStatus.filter((h) => !!groupOfHotel(h.id)).length,
        };
        const rows = byStatus.filter(kindOk).map(hotelView).sort(byName);
        return ok({ ...paged(rows, q), counts, kindCounts });
      });
    },

    getHotel(id: string): Promise<DashResult<PlatformHotelDetail>> {
      return call(() => {
        const h = hotelOf(id);
        if (!h || outOfScope(h.id)) return mockError('NOT_FOUND');
        return ok({
          hotel: hotelView(h),
          admins: admins.filter((a) => a.hotelId === h.id).map(adminView).sort(byName),
          settings: {
            gstin: h.gstin, stateCode: gstCodeOfState(h.state) ?? h.gstin.slice(0, 2), state: h.state, city: h.city, timeZone: h.timeZone,
            gstDefaults: { ...h.gstDefaults }, accountingYearStartMonth: 4,
          },
          activity: newestFirst(activity.filter((x) => x.hotelId === h.id)),
          onboarding: h.onboarding ? { ...h.onboarding } : null,
        });
      });
    },

    /** Only an active hotel. */
    suspendHotel(id: string, reason?: string): Promise<DashResult<PlatformHotel>> {
      return call(() => {
        const h = hotelOf(id);
        if (!h || outOfScope(h.id)) return mockError('NOT_FOUND');
        if (h.status === 'suspended') return mockError('CONFLICT', undefined, { message: E.alreadySuspended });
        if (h.status !== 'active') return mockError('CONFLICT', undefined, { message: E.suspendNotActive });
        const why = reason?.trim() || null;
        h.status = 'suspended';
        h.suspendedAt = tick();
        h.suspendReason = why;
        log('hotel_suspended', { hotelId: h.id }, { reason: why });
        clock.onAccessChanged?.({ hotelId: h.id, state: 'suspended', reason: why ?? undefined });
        return ok(hotelView(h));
      });
    },

    /** Only a suspended hotel (an archived one uses restoreHotel). */
    reactivateHotel(id: string): Promise<DashResult<PlatformHotel>> {
      return call(() => {
        const h = hotelOf(id);
        if (!h || outOfScope(h.id)) return mockError('NOT_FOUND');
        if (h.status === 'active') return mockError('CONFLICT', undefined, { message: E.alreadyActive });
        if (h.status !== 'suspended') return mockError('CONFLICT', undefined, { message: E.notSuspended });
        h.status = 'active';
        h.suspendedAt = null;
        h.suspendReason = null;
        log('hotel_reactivated', { hotelId: h.id });
        clock.onAccessChanged?.({ hotelId: h.id, state: 'active' });
        return ok(hotelView(h));
      });
    },

    /**
     * Audited: call before opening the hotel's dashboard. Only a live hotel (active or suspended). reason (optional, A2): what the
     * person typed in the Enter hotel window; it is written into the activity text (max 500 characters: VALIDATION_FAILED field reason).
     */
    enterHotel(hotelId: string, reason: string): Promise<DashResult<PlatformEnterResult>> {
      return call(() => {
        const h = hotelOf(hotelId);
        if (!h || outOfScope(h.id)) return mockError('NOT_FOUND');
        const why = (reason ?? '').trim();
        if (why.length < 5) return mockError('VALIDATION_FAILED', { reason: E.reasonShort });
        if (why.length > 500) return mockError('VALIDATION_FAILED', { reason: E.reasonLong });
        if (!isLive(h)) return mockError('CONFLICT', undefined, { message: E.enterNotLive });
        const access = visitAccessFor(h.id);
        if (access === null) return mockError('FORBIDDEN', undefined, { message: 'You may not enter hotels. Ask the Super Admin for hotel access.' });
        log('hotel_entered', { hotelId: h.id }, { reason: why });
        return ok(enterAnswer(h, access));
      });
    },

    /** "Extend 60 minutes" on the banner: the visit ends as extended and a new 60-minute one starts; the access is decided again. */
    extendHotelVisit(hotelId: string): Promise<DashResult<PlatformEnterResult>> {
      return call(() => {
        const h = hotelOf(hotelId);
        if (!h || outOfScope(h.id)) return mockError('NOT_FOUND');
        if (!isLive(h)) return mockError('CONFLICT', undefined, { message: E.enterNotLive });
        const access = visitAccessFor(h.id);
        if (access === null) return mockError('FORBIDDEN', undefined, { message: 'You may not enter hotels. Ask the Super Admin for hotel access.' });
        log('hotel_visit_extended', { hotelId: h.id });
        return ok(enterAnswer(h, access));
      });
    },

    /** Audited: call when the person presses Exit on the "You are inside" banner. */
    exitHotel(hotelId: string): Promise<DashResult<PlatformEnterResult>> {
      return call(() => {
        const h = hotelOf(hotelId);
        if (!h) return mockError('NOT_FOUND');
        log('hotel_exited', { hotelId: h.id });
        return ok({ ok: true as const, hotel: { id: h.id, name: h.name, slug: h.slug, status: h.status } });
      });
    },

    // ------------------------------------------------ approval and archive
    /** pending_approval -> active; its waiting admin becomes active. Else CONFLICT. */
    approveHotel(id: string): Promise<DashResult<PlatformHotelChange>> {
      return call(() => {
        const h = hotelOf(id);
        if (!h || outOfScope(h.id)) return mockError('NOT_FOUND');
        if (isGroupAdmin()) return mockError('FORBIDDEN', undefined, { message: E.groupAdminNoApproval });
        if (h.status !== 'pending_approval') return mockError('CONFLICT', undefined, { message: E.notPending });
        const at = tick();
        h.status = 'active';
        h.approvedAt = at;
        const own = admins.filter((a) => a.hotelId === h.id && a.status === 'pending');
        for (const a of own) a.status = 'active';
        for (const a of own) clock.onApproved?.({ hotelId: h.id, username: a.username, kind: 'hotel' });
        log('hotel_approved', { hotelId: h.id, groupId: groupOfHotel(h.id)?.id ?? null });
        const email = own[0]?.email ?? h.onboarding?.adminEmail ?? '';
        return ok({ hotel: hotelView(h), message: C.approval.approved(h.name, email), note: APPROVAL_EMAIL_NOTE });
      });
    },

    /** pending_approval -> rejected (reason required, VALIDATION_FAILED field: reason); its admin is disabled; unlinked from its group. */
    rejectHotel(id: string, reason: string): Promise<DashResult<PlatformHotelChange>> {
      return call(() => {
        const h = hotelOf(id);
        if (!h || outOfScope(h.id)) return mockError('NOT_FOUND');
        if (isGroupAdmin()) return mockError('FORBIDDEN', undefined, { message: E.groupAdminNoApproval });
        if (h.status !== 'pending_approval') return mockError('CONFLICT', undefined, { message: E.notPending });
        const why = (reason ?? '').trim();
        if (!why) return mockError('VALIDATION_FAILED', { reason: E.required.reason });
        if (why.length > 500) return mockError('VALIDATION_FAILED', { reason: E.reasonLong });
        h.status = 'rejected';
        h.rejectedAt = tick();
        h.rejectReason = why;
        for (const a of admins) {
          if (a.hotelId !== h.id || a.status !== 'pending') continue;
          a.status = 'disabled';
          clock.onRejected?.({ hotelId: h.id, username: a.username });
        }
        log('hotel_rejected', { hotelId: h.id, groupId: groupOfHotel(h.id)?.id ?? null }, { reason: why });
        const g = groupOfHotel(h.id);
        if (g) {
          g.hotelIds = g.hotelIds.filter((x) => x !== h.id);
          log('group_hotel_removed', { groupId: g.id, hotelId: h.id });
        }
        return ok({ hotel: hotelView(h), message: C.approval.rejected(h.name), note: null });
      });
    },

    /** "Delete" = archive: sign-in blocked, data kept, can be restored. Not for a hotel waiting for approval. There is no delete. */
    archiveHotel(id: string, reason?: string): Promise<DashResult<PlatformHotelChange>> {
      return call(() => {
        const h = hotelOf(id);
        if (!h || outOfScope(h.id)) return mockError('NOT_FOUND');
        if (h.status === 'archived') return mockError('CONFLICT', undefined, { message: E.alreadyArchived });
        if (h.status === 'pending_approval') return mockError('CONFLICT', undefined, { message: E.archivePending });
        const why = reason?.trim() || null;
        if (why && why.length > 500) return mockError('VALIDATION_FAILED', { reason: E.reasonLong });
        // Review H1: remember the status (and keep the suspend / reject reason) so Restore returns exactly there, never straight to active.
        h.statusBeforeArchive = h.status;
        h.status = 'archived';
        h.archivedAt = tick();
        h.archiveReason = why;
        for (const a of admins) if (a.hotelId === h.id) clock.onArchived?.({ hotelId: h.id, username: a.username });
        log('hotel_archived', { hotelId: h.id, groupId: groupOfHotel(h.id)?.id ?? null }, { reason: why });
        clock.onAccessChanged?.({ hotelId: h.id, state: 'archived', reason: why ?? undefined });
        const g = groupOfHotel(h.id);
        if (g && !g.groupAdminUserId && adminOf(g.groupAdminId)?.hotelId === h.id) {
          g.groupAdminId = null;
          log('group_admin_cleared', { groupId: g.id, hotelId: h.id });
        }
        return ok({ hotel: hotelView(h), message: C.archive.archived(h.name), note: C.archive.signInBlocked });
      });
    },

    /**
     * archived -> the status it had before (active, suspended with its reason, or rejected), only inside the ARCHIVE_GRACE_DAYS
     * grace period (A8; CONFLICT after it). A rejected hotel never becomes active this way (review H1).
     */
    restoreHotel(id: string): Promise<DashResult<PlatformHotelChange>> {
      return call(() => {
        const h = hotelOf(id);
        if (!h || outOfScope(h.id)) return mockError('NOT_FOUND');
        if (h.status !== 'archived') return mockError('CONFLICT', undefined, { message: E.notArchived });
        if (graceLeft(h.archivedAt ?? h.createdAt) === 0) return mockError('CONFLICT', undefined, { message: C.a8Errors.restoreGraceOver });
        const back = h.statusBeforeArchive;
        h.status = back === 'suspended' || back === 'rejected' ? back : 'active';
        h.statusBeforeArchive = null;
        if (h.status === 'active') {
          h.suspendedAt = null;
          h.suspendReason = null;
          // Sign-in comes back with the hotel (an admin disabled on its own stays out).
          for (const a of admins) if (a.hotelId === h.id && a.status !== 'disabled') clock.onApproved?.({ hotelId: h.id, username: a.username, kind: 'hotel' });
        }
        h.archivedAt = null;
        h.archiveReason = null;
        log('hotel_restored', { hotelId: h.id, groupId: groupOfHotel(h.id)?.id ?? null });
        // Same restoresTo rule as above: suspended keeps its remembered reason; a restore back to rejected leaves access alone.
        if (h.status === 'active' || h.status === 'suspended') {
          clock.onAccessChanged?.({ hotelId: h.id, state: h.status, reason: h.status === 'suspended' ? (h.suspendReason ?? undefined) : undefined });
        }
        const message = h.status === 'active' ? C.archive.restored(h.name) : C.archive.restoredTo(h.name, C.hotelConsole.lifecycle[h.status]);
        return ok({ hotel: hotelView(h), message, note: null });
      });
    },

    /** Group from a 'group' invitation: pending_approval -> active; its admin can sign in. Else CONFLICT. */
    approveGroup(id: string): Promise<DashResult<PlatformGroupChange>> {
      return call(() => {
        if (actor.role === 'group_admin') return mockError('CONFLICT', undefined, { message: E.groupApprovePlatformOnly });
        const g = groupOf(id);
        if (!g) return mockError('NOT_FOUND');
        if (groupStatus(g) !== 'pending_approval') return mockError('CONFLICT', undefined, { message: E.notPendingGroup });
        g.status = 'active';
        g.approvedAt = tick();
        const u = userOf(g.groupAdminUserId ?? null);
        if (u && u.status === 'pending') u.status = 'active';
        if (u && u.status === 'active') clock.onApproved?.({ hotelId: '', username: u.username, kind: 'group' });
        const inv = invitations.find((r) => r.madeGroupId === g.id);
        if (inv) inv.groupId = g.id;
        log('group_approved', { groupId: g.id });
        return ok({ group: groupView(g), message: C.approval.groupApproved(g.name, u?.email ?? g.email ?? ''), note: APPROVAL_EMAIL_NOTE });
      });
    },

    /** pending_approval -> rejected (reason required, VALIDATION_FAILED field: reason); its admin is disabled. */
    rejectGroup(id: string, reason: string): Promise<DashResult<PlatformGroupChange>> {
      return call(() => {
        if (actor.role === 'group_admin') return mockError('CONFLICT', undefined, { message: E.groupApprovePlatformOnly });
        const g = groupOf(id);
        if (!g) return mockError('NOT_FOUND');
        if (groupStatus(g) !== 'pending_approval') return mockError('CONFLICT', undefined, { message: E.notPendingGroup });
        const why = (reason ?? '').trim();
        if (!why) return mockError('VALIDATION_FAILED', { reason: E.required.reason });
        if (why.length > 500) return mockError('VALIDATION_FAILED', { reason: E.reasonLong });
        g.status = 'rejected';
        g.rejectedAt = tick();
        g.rejectReason = why;
        const u = userOf(g.groupAdminUserId ?? null);
        if (u && u.status === 'pending') u.status = 'disabled';
        if (u) clock.onRejected?.({ hotelId: '', username: u.username });
        log('group_rejected', { groupId: g.id }, { reason: why });
        return ok({ group: groupView(g), message: C.approval.groupRejected(g.name), note: null });
      });
    },

    // ------------------------------------------------ hotel admins
    /** groupId: only admins of that group's hotels (Group console). liveOnly (unless includeArchived): only admins of live hotels; counts follow. */
    listHotelAdmins(q: PlatformAdminQuery = {}): Promise<DashResult<PlatformAdminPage>> {
      return call(() => {
        const s = (q.search ?? '').trim().toLowerCase();
        const groupId = scopeGroup(q.groupId);
        const liveOnly = q.liveOnly === true && q.includeArchived !== true;
        const matched = admins
          .filter((a) => !liveOnly || LIVE_STATUSES.includes(hotelOf(a.hotelId)?.status ?? 'archived'))
          .filter((a) => !q.hotelId || a.hotelId === q.hotelId)
          .filter((a) => !groupId || groupOfHotel(a.hotelId)?.id === groupId)
          .filter((a) => !s || allWords(`${a.name} ${a.username} ${a.email} ${a.mobile} ${hotelOf(a.hotelId)?.name ?? ''}`.toLowerCase(), s));
        const counts = {
          all: matched.length,
          active: matched.filter((a) => a.status === 'active').length,
          disabled: matched.filter((a) => a.status === 'disabled').length,
          locked: matched.filter((a) => a.status === 'locked').length,
          pending: matched.filter((a) => a.status === 'pending').length,
        };
        const status = q.status ?? 'all';
        const rows = matched
          .filter((a) => status === 'all' || a.status === status)
          .map(adminView)
          .sort((x, y) => x.hotelName.localeCompare(y.hotelName, 'en') || byName(x, y));
        return ok({ ...paged(rows, q), counts });
      });
    },

    /** New Hotel Admin for a hotel; the temporary password is emailed. VALIDATION_FAILED fields: name, username, email, mobile. */
    addHotelAdmin(hotelId: string, input: PlatformAdminInput): Promise<DashResult<PlatformAdminCreated>> {
      return call(() => {
        const h = hotelOf(hotelId);
        if (!h || outOfScope(h.id)) return mockError('NOT_FOUND');
        if (!isLive(h)) return mockError('CONFLICT', undefined, { message: E.hotelNotLive });
        const f: Record<string, string> = {};
        checkAdmin(input, '', f);
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const a = newAdmin(h.id, input, tick());
        admins.push(a);
        log('admin_created', { hotelId: h.id, adminId: a.id });
        return ok({ admin: adminView(a), tempPasswordNote: TEMP_PASSWORD_NOTE });
      });
    },

    /** Emails a new temporary password (the account stays locked if it was; unlock it separately). */
    resetAdminPassword(adminId: string): Promise<DashResult<PlatformPasswordReset>> {
      return call(() => withAdmin(adminId, (a) => {
        if (a.status === 'disabled') return mockError('CONFLICT', undefined, { message: E.disabledNoReset });
        if (a.status === 'pending') return mockError('CONFLICT', undefined, { message: E.accountPending });
        if (hotelNotLive(a.hotelId)) return mockError('CONFLICT', undefined, { message: E.hotelNotLive });
        log('admin_password_reset', { hotelId: a.hotelId, adminId: a.id });
        return ok({ admin: adminView(a), message: `A temporary password was sent to ${a.email}.`, tempPasswordNote: TEMP_PASSWORD_NOTE });
      }));
    },

    unlockAdmin(adminId: string): Promise<DashResult<PlatformHotelAdmin>> {
      return call(() => withAdmin(adminId, (a) => {
        if (a.status !== 'locked') return mockError('CONFLICT', undefined, { message: E.notLocked });
        if (hotelNotLive(a.hotelId)) return mockError('CONFLICT', undefined, { message: E.hotelNotLive });
        a.status = 'active';
        a.lockedAt = null;
        log('admin_unlocked', { hotelId: a.hotelId, adminId: a.id });
        return ok(adminView(a));
      }));
    },

    disableAdmin(adminId: string): Promise<DashResult<PlatformHotelAdmin>> {
      return call(() => withAdmin(adminId, (a) => {
        if (a.status === 'disabled') return mockError('CONFLICT', undefined, { message: E.alreadyDisabled });
        if (a.status === 'pending') return mockError('CONFLICT', undefined, { message: E.accountPending });
        a.status = 'disabled';
        a.lockedAt = null;
        log('admin_disabled', { hotelId: a.hotelId, adminId: a.id });
        return ok(adminView(a));
      }));
    },

    enableAdmin(adminId: string): Promise<DashResult<PlatformHotelAdmin>> {
      return call(() => withAdmin(adminId, (a) => {
        if (a.status !== 'disabled') return mockError('CONFLICT', undefined, { message: E.notDisabled });
        if (hotelNotLive(a.hotelId)) return mockError('CONFLICT', undefined, { message: E.hotelNotLive });
        a.status = 'active';
        log('admin_enabled', { hotelId: a.hotelId, adminId: a.id });
        return ok(adminView(a));
      }));
    },

    // ------------------------------------------------ groups
    /** Every group by default (pending and rejected ones too: see PlatformGroup.status). */
    listGroups(q: { status?: 'all' | PlatformGroupStatus } = {}): Promise<DashResult<PlatformGroup[]>> {
      return call(() => ok(groups.filter((g) => !q.status || q.status === 'all' || groupStatus(g) === q.status).map(groupView).sort(byName)));
    },

    getGroup(id: string): Promise<DashResult<PlatformGroupDetail>> {
      return call(() => {
        const g = groupOf(id);
        return g ? ok(groupDetail(g)) : mockError('NOT_FOUND');
      });
    },

    /** VALIDATION_FAILED fields: name, hotelIds. */
    createGroup(input: PlatformGroupInput): Promise<DashResult<PlatformGroup>> {
      return call(() => {
        const f: Record<string, string> = {};
        const name = input.name.trim();
        if (!name) f.name = E.required.groupName;
        else if (name.length > 100) f.name = E.nameLong;
        else if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) f.name = E.groupNameTaken;
        const ids = [...new Set(input.hotelIds ?? [])];
        for (const hid of ids) {
          const h = hotelOf(hid);
          const inGroup = groupOfHotel(hid);
          if (!h) f.hotelIds = E.hotelUnknown;
          else if (inGroup) f.hotelIds = E.hotelInGroup(h.name, inGroup.name);
          else if (!isLive(h)) f.hotelIds = E.hotelNotJoinable;
          if (f.hotelIds) break;
        }
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const g: GroupRec = { id: nextId('g'), name, hotelIds: [], groupAdminId: null, createdAt: tick(), status: 'active' };
        groups.push(g);
        log('group_created', { groupId: g.id });
        for (const hid of ids) {
          g.hotelIds.push(hid);
          log('group_hotel_added', { groupId: g.id, hotelId: hid });
        }
        return ok(groupView(g));
      });
    },

    /** A hotel is in at most one group; the group must be active and the hotel live. VALIDATION_FAILED field: hotelId. */
    addHotelToGroup(groupId: string, hotelId: string): Promise<DashResult<PlatformGroupDetail>> {
      return call(() => {
        const g = groupOf(groupId);
        const h = hotelOf(hotelId);
        if (!g || !h) return mockError('NOT_FOUND');
        if (groupStatus(g) !== 'active') return mockError('CONFLICT', undefined, { message: E.groupNotActive });
        const inGroup = groupOfHotel(h.id);
        if (inGroup) return mockError('VALIDATION_FAILED', { hotelId: E.hotelInGroup(h.name, inGroup.name) });
        if (!isLive(h)) return mockError('VALIDATION_FAILED', { hotelId: E.hotelNotJoinable });
        g.hotelIds.push(h.id);
        log('group_hotel_added', { groupId: g.id, hotelId: h.id });
        return ok(groupDetail(g));
      });
    },

    /** UNLINKS the hotel from the group (nothing is deleted; it becomes individual). Also clears the group admin when they belong to it. */
    removeHotelFromGroup(groupId: string, hotelId: string): Promise<DashResult<PlatformGroupDetail>> {
      return call(() => {
        const g = groupOf(groupId);
        if (!g) return mockError('NOT_FOUND');
        if (!g.hotelIds.includes(hotelId)) return mockError('VALIDATION_FAILED', { hotelId: E.hotelNotInGroup });
        g.hotelIds = g.hotelIds.filter((x) => x !== hotelId);
        log('group_hotel_removed', { groupId: g.id, hotelId });
        const ga = adminOf(g.groupAdminId);
        if (!g.groupAdminUserId && ga && ga.hotelId === hotelId) {
          g.groupAdminId = null;
          log('group_admin_cleared', { groupId: g.id, hotelId });
        }
        return ok(groupDetail(g));
      });
    },

    /** adminId = an ACTIVE Hotel Admin of a member hotel (replaces a group-level admin), or null to remove the group admin. VALIDATION_FAILED field: adminId. */
    setGroupAdmin(groupId: string, adminId: string | null): Promise<DashResult<PlatformGroupDetail>> {
      return call(() => {
        const g = groupOf(groupId);
        if (!g) return mockError('NOT_FOUND');
        if (adminId === null) {
          if (g.groupAdminId !== null || g.groupAdminUserId) {
            g.groupAdminId = null;
            g.groupAdminUserId = null;
            log('group_admin_cleared', { groupId: g.id });
          }
          return ok(groupDetail(g));
        }
        const a = adminOf(adminId);
        if (!a || !g.hotelIds.includes(a.hotelId) || a.status !== 'active') return mockError('VALIDATION_FAILED', { adminId: E.adminNotInGroup });
        g.groupAdminId = a.id;
        g.groupAdminUserId = null;
        log('group_admin_set', { groupId: g.id, hotelId: a.hotelId, adminId: a.id });
        return ok(groupDetail(g));
      });
    },

    /** The most hotels the group may have (Super Admin and Platform Admin); null = no limit; never below what it has now (field maxHotels). */
    setGroupMaxHotels(groupId: string, maxHotels: number | null): Promise<DashResult<PlatformGroupDetail>> {
      return call(() => {
        const g = groupOf(groupId);
        if (!g) return mockError('NOT_FOUND');
        if (maxHotels !== null && !(Number.isInteger(maxHotels) && maxHotels >= 0 && maxHotels <= 10000)) return mockError('VALIDATION_FAILED', { maxHotels: 'Enter a whole number from 0 to 10,000, or leave it empty for no limit.' });
        const counted = g.hotelIds.filter((id) => ['pending_approval', 'active', 'suspended'].includes(hotelOf(id)?.status ?? '')).length;
        if (maxHotels !== null && maxHotels < counted) return mockError('VALIDATION_FAILED', { maxHotels: `This group already has ${counted} ${counted === 1 ? 'hotel' : 'hotels'}: the limit cannot be lower than that.` });
        g.maxHotels = maxHotels;
        log('settings_updated', { groupId: g.id }, { reason: `Most hotels: ${maxHotels === null ? 'no limit' : maxHotels}` });
        return ok(groupDetail(g));
      });
    },

    // ------------------------------------------------ invitations
    /** Newest first. groupId: invitations into that group (Group console); type: individual / group / member_hotel. */
    listInvitations(q: PlatformInvitationQuery = {}): Promise<DashResult<PlatformInvitationPage>> {
      return call(() => {
        const s = (q.search ?? '').trim().toLowerCase();
        const inviteGroup = scopeGroup(q.groupId); // a group admin: its own group only (review M7)
        const matched = invitations
          .map(invView)
          .filter((r) => !inviteGroup || r.groupId === inviteGroup)
          .filter((r) => !q.type || q.type === 'all' || r.type === q.type)
          .filter((r) => !s || allWords(`${r.hotelName} ${r.contactName} ${r.email} ${r.groupName ?? ''} ${r.invitedByName}`.toLowerCase(), s));
        const n = (st: PlatformInvitationStatus) => matched.filter((r) => r.status === st).length;
        const counts = { all: matched.length, pending: n('sent') + n('opened'), sent: n('sent'), opened: n('opened'), submitted: n('submitted'), expired: n('expired'), cancelled: n('cancelled') };
        const status = q.status ?? 'all';
        const rows = matched
          .filter((r) => status === 'all' || r.status === status || (status === 'pending' && (r.status === 'sent' || r.status === 'opened')))
          .sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0));
        return ok({ ...paged(rows, q), counts });
      });
    },

    /** MOCK / DEV ONLY (no server route): the link token of every open invitation, for the dev buttons. Call only when dev links are shown. */
    listDevLinks(): Promise<DashResult<PlatformInvitationDevLink[]>> {
      return call(() => ok(invitations.filter((r) => invStatus(r) === 'sent' || invStatus(r) === 'opened').map((r) => ({ id: r.id, token: r.token }))));
    },

    /**
     * Emails an invitation link (valid INVITATION_VALID_HOURS, single use). Platform / Super Admin: types individual and group
     * (groupId not allowed: field error). Group admin: member_hotel into its own group only (CONFLICT otherwise).
     * The link is never shown in the normal UI: devToken (mock only) feeds the dev note via inviteLink.
     */
    sendInvitation(input: PlatformInvitationInput): Promise<DashResult<PlatformInvitationSent>> {
      return call(() => {
        const isGroupAdmin = actor.role === 'group_admin';
        const type: PlatformInvitationType = input.type ?? (isGroupAdmin ? 'member_hotel' : 'individual');
        let groupId: string | null = null;
        const f: Record<string, string> = {};
        if (isGroupAdmin) {
          if (type !== 'member_hotel') return mockError('CONFLICT', undefined, { message: E.inviteGroupAdminMemberOnly });
          const own = actor.groupId ?? MOCK_GROUPADMIN_GROUP_ID;
          if (input.groupId && input.groupId !== own) return mockError('CONFLICT', undefined, { message: E.inviteOwnGroupOnly });
          const g = groupOf(own);
          if (!g || groupStatus(g) !== 'active') return mockError('CONFLICT', undefined, { message: E.groupNotActive });
          groupId = own;
        } else {
          if (type === 'member_hotel') return mockError('CONFLICT', undefined, { message: E.inviteMemberGroupAdminOnly });
          if (input.groupId) f.groupId = E.inviteNoGroupForPlatform;
        }
        const name = (input.hotelName ?? '').trim();
        if (!name) f.hotelName = type === 'group' ? E.required.groupName : E.required.hotelName;
        else if (name.length > 100) f.hotelName = E.nameLong;
        else if (type === 'group' && groups.some((g) => g.name.toLowerCase() === name.toLowerCase() && groupStatus(g) !== 'rejected')) f.hotelName = E.groupNameTaken;
        const contact = (input.contactName ?? '').trim();
        if (!contact) f.contactName = E.required.contactName;
        else if (contact.length > 100) f.contactName = E.nameLong;
        const email = (input.email ?? '').trim().toLowerCase();
        if (!email) f.email = E.required.email;
        else if (!EMAIL_RE.test(email)) f.email = E.emailFormat;
        const clash = openInvitationClash(type, name, f.email ? '' : email, null);
        if (clash.email) f.email = clash.email;
        if (clash.hotelName && !f.hotelName) f.hotelName = clash.hotelName;
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const at = tick();
        let token = newToken();
        while (invitations.some((r) => r.token === token)) token = newToken();
        const r: InvRec = {
          id: nextId('inv'), token, type, hotelName: name, contactName: contact, email, groupId, madeGroupId: null, status: 'sent',
          createdAt: at, expiresAt: new Date(Date.parse(at) + INVITATION_VALID_HOURS * HOUR_MS).toISOString(),
          openedAt: null, submittedAt: null, cancelledAt: null, invitedByName: actor.name, invitedByRole: actor.role, resendCount: 0, hotelId: null,
        };
        invitations.push(r);
        log('invitation_sent', { groupId, invId: r.id });
        return ok({ invitation: invView(r), linkNote: INVITE_LINK_NOTE, devToken: r.token });
      });
    },

    /**
     * Revoke and reissue (RESEARCH MUST 2): the old link stops working, a NEW link is emailed with a fresh INVITATION_VALID_HOURS
     * (also for an expired one). Refused when submitted or cancelled.
     */
    resendInvitation(id: string): Promise<DashResult<PlatformInvitationSent>> {
      return call(() => {
        const r = invOf(id);
        if (!r) return mockError('NOT_FOUND');
        if (notMine(r)) return mockError('CONFLICT', undefined, { message: E.inviteOwnGroupOnly });
        if (r.status === 'submitted' || r.status === 'cancelled') return mockError('CONFLICT', undefined, { message: E.resendNotAllowed });
        // Review M4: reviving an expired one must not give a second live link for the same email or name.
        const clash = openInvitationClash(r.type, r.hotelName, r.email, r.id);
        if (clash.email || clash.hotelName) return mockError('CONFLICT', undefined, { message: E.resendDuplicate });
        if (r.type === 'group' && groups.some((g) => g.name.toLowerCase() === r.hotelName.trim().toLowerCase() && groupStatus(g) !== 'rejected')) {
          return mockError('CONFLICT', undefined, { message: E.groupNameTaken });
        }
        const at = tick();
        r.expiresAt = new Date(Date.parse(at) + INVITATION_VALID_HOURS * HOUR_MS).toISOString();
        let fresh = newToken();
        while (invitations.some((x) => x.token === fresh)) fresh = newToken();
        r.token = fresh;
        r.resendCount += 1;
        log('invitation_resent', { groupId: r.groupId, invId: r.id });
        return ok({ invitation: invView(r), linkNote: INVITE_LINK_NOTE, devToken: r.token });
      });
    },

    /** The link stops working at once. Refused when submitted or already cancelled. */
    cancelInvitation(id: string): Promise<DashResult<PlatformInvitation>> {
      return call(() => {
        const r = invOf(id);
        if (!r) return mockError('NOT_FOUND');
        if (notMine(r)) return mockError('CONFLICT', undefined, { message: E.inviteOwnGroupOnly });
        if (r.status === 'submitted' || r.status === 'cancelled') return mockError('CONFLICT', undefined, { message: E.cancelNotAllowed });
        r.status = 'cancelled';
        r.cancelledAt = tick();
        log('invitation_cancelled', { groupId: r.groupId, invId: r.id });
        return ok(invView(r));
      });
    },

    // ------------------------------------------------ public onboarding (no sign-in)
    /**
     * PUBLIC. Reads an invitation by its link token; the first read marks it 'opened'. Refusals carry details.serverCode:
     * NOT_FOUND (code NOT_FOUND), EXPIRED / ALREADY_SUBMITTED / CANCELLED (code CONFLICT), each with a plain sentence.
     */
    getInvitationByToken(token: string): Promise<DashResult<PlatformPublicInvitation>> {
      return call(() => {
        const r = invitations.find((x) => x.token === (token ?? '').trim());
        const refused = tokenRefusal(r);
        if (refused || !r) return refused ?? mockError('NOT_FOUND');
        if (r.status === 'sent') {
          r.status = 'opened';
          r.openedAt = tick();
          log('invitation_opened', { groupId: r.groupId, invId: r.id }, { actorName: r.contactName });
        }
        const g = invGroup(r);
        return ok({
          type: r.type,
          invitation: { hotelName: r.hotelName, contactName: r.contactName, email: r.email, groupName: g?.name ?? null },
          status: invStatus(r),
          expiresAt: r.expiresAt,
        });
      });
    },

    /**
     * PUBLIC. Sends the onboarding form. kind 'hotel' (individual, member_hotel) creates the hotel as pending_approval with its
     * first and only user, its Hotel Admin (status pending). kind 'group' creates a pending group with its Group Hotel Admin
     * (pending). The invitation becomes 'submitted'. The password is checked and then dropped: never stored, never returned.
     */
    submitOnboarding(token: string, form: PlatformOnboardingForm): Promise<DashResult<PlatformOnboardingResult>> {
      return call(() => {
        const r = invitations.find((x) => x.token === (token ?? '').trim());
        const refused = tokenRefusal(r);
        if (refused || !r) return refused ?? mockError('NOT_FOUND');
        if ((r.type === 'group') !== (form.kind === 'group')) return mockError('CONFLICT', undefined, { message: E.formMismatch });
        const g0 = r.type === 'member_hotel' ? groupOf(r.groupId) : undefined;
        if (r.type === 'member_hotel' && (!g0 || groupStatus(g0) !== 'active')) return mockError('CONFLICT', undefined, { message: E.groupNotActive });
        const f: Record<string, string> = {};
        if (form.kind === 'hotel') checkOnboardingHotel(form.hotel, f);
        else checkOnboardingGroup(form.group, f);
        checkOnboardingAdmin(form.admin, f);
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const ad = form.admin;
        const adminName = ad.name.trim();
        const adminUsername = ad.username.trim().toLowerCase();
        const adminEmail = ad.email.trim().toLowerCase();
        const adminMobile = normaliseMobile(ad.mobile) ?? ad.mobile.trim();
        // Ids first, so the auth-mock hook knows where the admin will live. The password goes to the hook only; it is not kept here.
        const newHotelId = form.kind === 'hotel' ? nextId('h') : '';
        const newUserId = form.kind === 'group' ? nextId('gu') : '';
        const newGroupId = form.kind === 'group' ? nextId('g') : '';
        const hooked = clock.onAdminSubmitted?.({
          hotelId: newHotelId,
          hotelName: form.kind === 'hotel' ? form.hotel.name.trim() : form.group.name.trim(),
          kind: form.kind,
          ...(form.kind === 'group' ? { groupId: newGroupId } : {}),
          admin: { name: adminName, username: adminUsername, email: adminEmail, mobile: adminMobile, password: ad.password ?? '' },
        });
        if (hooked && !hooked.ok) return mockError('VALIDATION_FAILED', { 'admin.username': E.usernameTaken });
        const at = tick();
        r.status = 'submitted';
        r.submittedAt = at;
        if (form.kind === 'hotel') {
          const fh = form.hotel;
          const name = fh.name.trim();
          const h: HotelRec = {
            id: newHotelId, name, slug: slugFor(name), city: fh.city.trim(), state: fh.state.trim(), gstin: fh.gstin.trim().toUpperCase(),
            timeZone: PLATFORM_DEFAULT_TIME_ZONE, status: g0 ? 'active' : 'pending_approval', createdAt: at, suspendedAt: null, suspendReason: null, gstDefaults: { ...GST5 },
            submittedAt: at, invitationId: r.id,
            onboarding: {
              invitationId: r.id, contactName: r.contactName, address: fh.address.trim(), city: fh.city.trim(), state: fh.state.trim(), pin: fh.pin.trim(),
              gstin: fh.gstin.trim().toUpperCase(), phone: fh.phone.trim(), email: fh.email.trim().toLowerCase(), logoName: fh.logoName || null, submittedAt: at,
              adminName, adminUsername, adminEmail, adminMobile,
              // Review L14: the optional answers are kept for the approval panel (not refused, never required).
              legalName: fh.legalName?.trim() || null, tradeName: fh.tradeName?.trim() || null, gstType: fh.gstType || null,
              roomCount: fh.roomCount && fh.roomCount > 0 ? fh.roomCount : null, checkInTime: fh.checkInTime || null, checkOutTime: fh.checkOutTime || null,
            },
          };
          hotels.push(h);
          if (g0) g0.hotelIds.push(h.id);
          // A hotel invited by its group is approved at once (MJ, 18 Oct 2026; the server does the same): active, its admin can sign in.
          admins.push({ id: nextId('a'), hotelId: h.id, name: adminName, username: adminUsername, email: adminEmail, mobile: adminMobile, status: g0 ? 'active' : 'pending', lastSignInAt: null, lockedAt: null, createdAt: at });
          r.hotelId = h.id;
          log('hotel_submitted', { hotelId: h.id, groupId: g0?.id ?? null, invId: r.id }, { actorName: r.contactName });
          return ok<PlatformOnboardingResult>({
            kind: 'hotel',
            hotel: { id: h.id, name: h.name, city: h.city, state: h.state, groupName: g0?.name ?? null, status: h.status },
            group: null,
            message: g0 ? C.onboarding.readyTitle : C.onboarding.waitingTitle,
          });
        }
        const fg = form.group;
        const u: UserRec = {
          id: newUserId, name: adminName, username: adminUsername, email: adminEmail, mobile: adminMobile, level: 'group_admin',
          hotelId: null, groupId: null, status: 'pending', lastSignInAt: null, lockedAt: null, createdAt: at,
        };
        const g: GroupRec = {
          id: newGroupId, name: fg.name.trim(), hotelIds: [], groupAdminId: null, groupAdminUserId: u.id, createdAt: at, status: 'pending_approval',
          legalName: fg.legalName.trim(), gstin: fg.gstin.trim().toUpperCase(), address: fg.address.trim(), city: fg.city?.trim() || null,
          state: fg.state?.trim() || null, pin: fg.pin?.trim() || null, phone: fg.phone.trim(), email: fg.email.trim().toLowerCase(),
          invitationId: r.id, submittedAt: at,
        };
        u.groupId = g.id;
        users.push(u);
        groups.push(g);
        r.madeGroupId = g.id;
        log('group_submitted', { groupId: g.id, invId: r.id }, { actorName: r.contactName });
        return ok<PlatformOnboardingResult>({ kind: 'group', hotel: null, group: { id: g.id, name: g.name, status: groupStatus(g) }, message: C.onboarding.waitingTitle });
      });
    },

    // ------------------------------------------------ users (every level)
    /** Every account: Super / Platform Admins, Group Hotel Admins, Hotel Admins, Hotel Users. Account metadata only. */
    listUsers(q: PlatformUserQuery = {}): Promise<DashResult<PlatformUserPage>> {
      return call(() => {
        const s = (q.search ?? '').trim().toLowerCase();
        const base = allUsers()
          .filter((u) => !q.hotelId || u.hotelId === q.hotelId)
          .filter((u) => !q.groupId || u.groupId === q.groupId)
          .filter((u) => !s || allWords(`${u.name} ${u.username} ${u.email} ${u.mobile} ${u.hotelName ?? ''} ${u.groupName ?? ''}`.toLowerCase(), s));
        const level = q.level ?? 'all';
        const status = q.status ?? 'all';
        const byStatus = base.filter((u) => status === 'all' || u.status === status);
        const byLevel = base.filter((u) => level === 'all' || u.level === level);
        const levels = { all: byStatus.length } as Record<'all' | PlatformUserLevel, number>;
        for (const l of LEVEL_ORDER) levels[l] = byStatus.filter((u) => u.level === l).length;
        const statuses = { all: byLevel.length } as Record<'all' | PlatformUserStatus, number>;
        for (const st of ['active', 'disabled', 'locked', 'pending'] as const) statuses[st] = byLevel.filter((u) => u.status === st).length;
        const rows = byStatus
          .filter((u) => level === 'all' || u.level === level)
          .sort((x, y) => LEVEL_ORDER.indexOf(x.level) - LEVEL_ORDER.indexOf(y.level) || (x.hotelName ?? '').localeCompare(y.hotelName ?? '', 'en') || byName(x, y));
        return ok({ ...paged(rows, q), counts: { levels, statuses } });
      });
    },

    /** Audited. Refused for a waiting account, an already disabled one, and the last active Super Admin. */
    disableUser(id: string): Promise<DashResult<PlatformUser>> {
      return call(() => {
        const x = anyUserOf(id);
        if (!x) return mockError('NOT_FOUND');
        const no = refuseStaffTarget('user_disabled', x);
        if (no) return no;
        if (x.rec.status === 'pending') return mockError('CONFLICT', undefined, { message: E.accountPending });
        if (x.rec.status === 'disabled') return mockError('CONFLICT', undefined, { message: E.alreadyDisabled });
        if (x.kind === 'user' && x.rec.level === 'super_admin' && users.filter((u) => u.level === 'super_admin' && u.status === 'active').length <= 1) {
          logUser('user_disabled', x, { reason: E.lastSuperAdmin, refused: true });
          return mockError('CONFLICT', undefined, { message: E.lastSuperAdmin });
        }
        x.rec.status = 'disabled';
        x.rec.lockedAt = null;
        logUser('user_disabled', x);
        return ok(viewOfAny(x));
      });
    },

    enableUser(id: string): Promise<DashResult<PlatformUser>> {
      return call(() => {
        const x = anyUserOf(id);
        if (!x) return mockError('NOT_FOUND');
        const no = refuseStaffTarget('user_enabled', x);
        if (no) return no;
        if (x.rec.status !== 'disabled') return mockError('CONFLICT', undefined, { message: E.notDisabled });
        x.rec.status = 'active';
        logUser('user_enabled', x);
        return ok(viewOfAny(x));
      });
    },

    unlockUser(id: string): Promise<DashResult<PlatformUser>> {
      return call(() => {
        const x = anyUserOf(id);
        if (!x) return mockError('NOT_FOUND');
        const no = refuseStaffTarget('user_unlocked', x);
        if (no) return no;
        if (x.rec.status !== 'locked') return mockError('CONFLICT', undefined, { message: E.notLocked });
        x.rec.status = 'active';
        x.rec.lockedAt = null;
        logUser('user_unlocked', x);
        return ok(viewOfAny(x));
      });
    },

    /** Emails a temporary password (never returned). */
    resetUserPassword(id: string): Promise<DashResult<PlatformUserReset>> {
      return call(() => {
        const x = anyUserOf(id);
        if (!x) return mockError('NOT_FOUND');
        const no = refuseStaffTarget('user_password_reset', x);
        if (no) return no;
        if (x.rec.status === 'pending') return mockError('CONFLICT', undefined, { message: E.accountPending });
        if (x.rec.status === 'disabled') return mockError('CONFLICT', undefined, { message: E.disabledNoReset });
        logUser('user_password_reset', x);
        return ok({ user: viewOfAny(x), message: C.users.resetSent(x.rec.email), tempPasswordNote: TEMP_PASSWORD_NOTE });
      });
    },

    // ------------------------------------------------ audit log and sign-in history
    /** Every platform action, newest first (for the Super Admin's Audit log later; filters by hotel or group). */
    listActivity(q: { hotelId?: string; groupId?: string; search?: string; page?: number; pageSize?: number } = {}): Promise<DashResult<Page<PlatformActivity>>> {
      return call(() => {
        // A group admin sees only its own group's entries and its member hotels' entries (review M7).
        const groupId = scopeGroup(q.groupId);
        const inGroup = (x: PlatformActivity) => x.groupId === groupId || (isGroupAdmin() && !!x.hotelId && !outOfScope(x.hotelId));
        const words = (q.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const rows = newestFirst(activity.filter((x) => (!q.hotelId || x.hotelId === q.hotelId) && (!groupId || inGroup(x)) && words.every((w) => `${x.actorName} ${x.text} ${x.hotelName ?? ''} ${x.groupName ?? ''}`.toLowerCase().includes(w))));
        return ok(paged(rows, q));
      });
    },

    /**
     * The audit log (same store as listActivity, plus the refused attempts) with who / role / action / target / result / reason / IP / browser.
     * from / to: IST dates, inclusive. Append-only: there is no call that edits or deletes an entry.
     */
    listAudit(q: PlatformAuditQuery = {}): Promise<DashResult<PlatformAuditPage>> {
      return call(() => {
        const s = (q.search ?? '').trim().toLowerCase();
        const all = newestFirst([...activity, ...refused]);
        // Inside hotel: from a staff member's Enter hotel to their leaving it (both included), in that hotel.
        const openIn = new Map<string, string>();
        const inside = new Set<string>();
        for (const x of [...all].reverse()) {
          if (x.action === 'hotel_entered' && x.hotelId) {
            openIn.set(x.actorName, x.hotelId);
            inside.add(x.id);
            continue;
          }
          if (x.hotelId && openIn.get(x.actorName) === x.hotelId) inside.add(x.id);
          if (x.action === 'hotel_exited') openIn.delete(x.actorName);
        }
        const outsideActions: readonly PlatformActivityAction[] = ['invitation_opened', 'hotel_submitted', 'group_submitted'];
        const roleOf = (x: PlatformActivity): PlatformUserLevel | null => {
          if (x.actorName === 'System' || outsideActions.includes(x.action)) return null;
          if (x.actorName === PA) return 'platform_admin';
          const u = users.find((r) => r.name === x.actorName);
          if (u) return u.level;
          if (admins.some((a) => a.name === x.actorName)) return 'hotel_admin';
          return x.actorName === actor.name ? actor.role : null;
        };
        const whereOf = (x: PlatformActivity): [string, string] => {
          if (x.actorName === 'System') return ['', ''];
          const username = x.actorName === PA ? 'platform' : (users.find((r) => r.name === x.actorName)?.username ?? admins.find((a) => a.name === x.actorName)?.username);
          const seen = username ? [...seedSignIns].reverse().find((r) => r[1] === username && r[2] === 'success') : undefined;
          if (seen) return [seen[4], seen[5]];
          // An invited person, or somebody with no sign-in on record: a steady mock address made from the name.
          let n = 7;
          for (const ch of x.actorName) n = (n * 31 + ch.charCodeAt(0)) % 65_521;
          return [`103.48.${n % 250}.${((n >> 3) % 250) + 1}`, CH];
        };
        const rows: PlatformAuditEntry[] = all
          .filter((x) => !q.action || q.action === 'all' || x.action === q.action)
          .filter((x) => !q.hotelId || x.hotelId === q.hotelId)
          .filter((x) => !q.actor || x.actorName === q.actor)
          .filter((x) => !q.from || istDate(x.at) >= q.from)
          .filter((x) => !q.to || istDate(x.at) <= q.to)
          .map((x) => {
            const [ip, browser] = whereOf(x);
            return {
              id: x.id, at: x.at, actorName: x.actorName, action: x.action, actionLabel: C.audit.actions[x.action], target: targets.get(x.id) ?? '',
              hotelId: x.hotelId, hotelName: x.hotelName, groupId: x.groupId, groupName: x.groupName, text: x.text,
              actorRole: roleOf(x), insideHotel: inside.has(x.id), result: refused.includes(x) ? ('failed' as const) : ('success' as const),
              reason: auditReasons.get(x.id) ?? null, ip, browser,
            };
          })
          .filter((x) => !s || allWords(`${x.actorName} ${x.actionLabel} ${x.target} ${x.hotelName ?? ''} ${x.groupName ?? ''} ${x.text} ${x.reason ?? ''} ${x.ip}`.toLowerCase(), s));
        const actors = [...new Set(all.map((x) => x.actorName))].sort((x, y) => x.localeCompare(y, 'en'));
        return ok({ ...paged(rows, q), actors });
      });
    },

    /** Sign-ins across the platform, newest first. */
    listSignIns(q: PlatformSignInQuery = {}): Promise<DashResult<PlatformSignInPage>> {
      return call(() => {
        const s = (q.search ?? '').trim().toLowerCase();
        const matched = signIns.filter((x) => !s || allWords(`${x.username} ${x.name ?? ''} ${x.hotelName ?? ''} ${x.ip} ${x.device} ${x.reason ?? ''}`.toLowerCase(), s));
        const n = (r: PlatformSignInResult) => matched.filter((x) => x.result === r).length;
        const counts = { all: matched.length, success: n('success'), failed: n('failed'), locked: n('locked') };
        const result = q.result ?? 'all';
        const rows = matched.filter((x) => result === 'all' || x.result === result);
        return ok({ ...paged(rows, q), counts });
      });
    },

    // ------------------------------------------------ A8: platform staff (Super Admin only)
    /** Platform Admins only (a Super Admin is added by the platform owner, never here). FORBIDDEN for anyone but the Super Admin. */
    listPlatformStaff(q: PlatformStaffQuery = {}): Promise<DashResult<PlatformStaffPage>> {
      return call(() => {
        if (!isSuper()) return mockError('FORBIDDEN', undefined, { message: C.a8Errors.superOnly });
        const s = (q.search ?? '').trim().toLowerCase();
        const matched = users
          .filter((u) => u.level === 'platform_admin')
          .map(staffView)
          .filter((u) => !s || allWords(`${u.name} ${u.username} ${u.email} ${u.mobile}`.toLowerCase(), s));
        const n = (st: PlatformStaffStatus) => matched.filter((u) => u.status === st).length;
        const counts = { all: matched.length, active: n('active'), locked: n('locked'), disabled: n('disabled') };
        const status = q.status ?? 'all';
        const rows = matched.filter((u) => status === 'all' || u.status === status).sort(byName);
        return ok({ ...paged(rows, q), counts, superAdminCount: users.filter((u) => u.level === 'super_admin' && u.status === 'active').length });
      });
    },

    /** What this Platform Admin may do when entering hotels (Super Admin only). An account never set answers the default: view, all hotels. */
    getPlatformStaffHotelAccess(id: string): Promise<DashResult<PlatformAdminHotelAccess>> {
      return call(() => {
        if (!isSuper()) return mockError('FORBIDDEN', undefined, { message: C.a8Errors.superOnly });
        const u = staffOf(id);
        if (!u) return mockError('NOT_FOUND');
        return ok({ ...accessRow(u) });
      });
    },

    /** Sets it (Super Admin only; audited). VALIDATION_FAILED fields: reason (5 to 500 characters), hotelIds (at least one when not all hotels). A visit under way keeps its access. */
    setPlatformStaffHotelAccess(id: string, input: PlatformAdminHotelAccessInput): Promise<DashResult<PlatformAdminHotelAccess>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('platform_admin_access_changed', { userId: id });
        const u = staffOf(id);
        if (!u) return mockError('NOT_FOUND');
        const reason = (input.reason ?? '').trim();
        const hotelIds = input.allHotels ? [] : [...new Set(input.hotelIds ?? [])];
        const f: Record<string, string> = {};
        if (Array.from(reason).length < 5) f.reason = E.reasonShort;
        else if (Array.from(reason).length > 500) f.reason = E.reasonLong;
        if (!input.allHotels && input.level !== 'none' && hotelIds.length === 0) f.hotelIds = 'Choose at least one hotel, or allow all hotels.';
        if (hotelIds.some((h) => !hotelOf(h))) f.hotelIds = 'A chosen hotel does not exist.';
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const row: PlatformAdminHotelAccess = { userId: u.id, level: input.level, allHotels: input.allHotels, hotelIds, reason, updatedBy: actor.name, updatedAt: tick() };
        hotelAccessOf.set(u.id, row);
        log('platform_admin_access_changed', { userId: u.id }, { reason });
        return ok({ ...row });
      });
    },

    /** New Platform Admin (the role is fixed: nobody raises rights here). VALIDATION_FAILED fields: name, username, email, mobile. */
    createPlatformStaff(input: PlatformAdminInput): Promise<DashResult<PlatformStaffCreated>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('staff_created', {});
        const f: Record<string, string> = {};
        checkAdmin(input, '', f);
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const at = tick();
        const u: UserRec = {
          id: nextId('u'), name: input.name.trim(), username: input.username.trim().toLowerCase(), email: input.email.trim().toLowerCase(),
          mobile: normaliseMobile(input.mobile) ?? input.mobile.trim(), level: 'platform_admin', hotelId: null, groupId: null,
          status: 'active', lastSignInAt: null, lockedAt: null, createdAt: at,
        };
        users.push(u);
        log('staff_created', { userId: u.id }, { at });
        return ok({ staff: staffView(u), tempPasswordNote: TEMP_PASSWORD_NOTE });
      });
    },

    disablePlatformStaff(id: string): Promise<DashResult<PlatformStaff>> {
      return call(() => {
        const u = staffOf(id);
        if (!u) return mockError('NOT_FOUND', undefined, { message: C.a8Errors.notStaff });
        if (!isSuper()) return refuseNotSuper('user_disabled', { userId: u.id });
        if (u.status === 'disabled') return mockError('CONFLICT', undefined, { message: E.alreadyDisabled });
        u.status = 'disabled';
        u.lockedAt = null;
        log('user_disabled', { userId: u.id });
        return ok(staffView(u));
      });
    },

    enablePlatformStaff(id: string): Promise<DashResult<PlatformStaff>> {
      return call(() => {
        const u = staffOf(id);
        if (!u) return mockError('NOT_FOUND', undefined, { message: C.a8Errors.notStaff });
        if (!isSuper()) return refuseNotSuper('user_enabled', { userId: u.id });
        if (u.status !== 'disabled') return mockError('CONFLICT', undefined, { message: E.notDisabled });
        u.status = 'active';
        log('user_enabled', { userId: u.id });
        return ok(staffView(u));
      });
    },

    /** Emails a temporary password (never returned). The account stays locked if it was; unlock it separately. */
    resetPlatformStaffPassword(id: string): Promise<DashResult<PlatformStaffReset>> {
      return call(() => {
        const u = staffOf(id);
        if (!u) return mockError('NOT_FOUND', undefined, { message: C.a8Errors.notStaff });
        if (!isSuper()) return refuseNotSuper('user_password_reset', { userId: u.id });
        if (u.status === 'disabled') return mockError('CONFLICT', undefined, { message: E.disabledNoReset });
        log('user_password_reset', { userId: u.id });
        return ok({ staff: staffView(u), message: C.users.resetSent(u.email), tempPasswordNote: TEMP_PASSWORD_NOTE });
      });
    },

    unlockPlatformStaff(id: string): Promise<DashResult<PlatformStaff>> {
      return call(() => {
        const u = staffOf(id);
        if (!u) return mockError('NOT_FOUND', undefined, { message: C.a8Errors.notStaff });
        if (!isSuper()) return refuseNotSuper('user_unlocked', { userId: u.id });
        if (u.status !== 'locked') return mockError('CONFLICT', undefined, { message: E.notLocked });
        u.status = 'active';
        u.lockedAt = null;
        log('user_unlocked', { userId: u.id });
        return ok(staffView(u));
      });
    },

    // ------------------------------------------------ A8: platform health
    /** Every live hotel (active or suspended). Platform metadata only: no business data. */
    getPlatformHealth(): Promise<DashResult<PlatformHealth>> {
      return call(() => ok(healthView()));
    },

    /** Mock: checks again (only the time moves on; the sample states stay). Audited. */
    runHealthCheck(): Promise<DashResult<PlatformHealth>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('health_checked', {});
        healthCheckedAt = tick();
        const v = healthView();
        log('health_checked', {}, { at: healthCheckedAt, reason: C.platformHealth.summary(v.tiles.healthy, v.tiles.attention) });
        return ok(v);
      });
    },

    /** Where Amazon SES receiving hands received mail to HMS (mock: a sample address). */
    getInboundMail(): Promise<DashResult<PlatformInboundMail>> {
      return call(() => {
        if (!isSuper()) return mockError('FORBIDDEN', undefined, { message: C.a8Errors.superOnly });
        return ok({ address: 'https://www.easyhotelsolutions.in/api/v1/public/mail-inbound/the-secret-key-is-shown-on-the-real-server', topicSet: true });
      });
    },

    // ------------------------------------------------ Hotel mail: a hotel's own Amazon SES and Google (Super Admin only)
    listHotelMail(): Promise<DashResult<PlatformHotelMailSummary[]>> {
      return call(() => {
        if (!isSuper()) return mockError('FORBIDDEN', undefined, { message: C.a8Errors.superOnly });
        return ok(hotels.filter((h) => h.status === 'active' || h.status === 'suspended').map((h) => ({ hotelId: h.id, name: h.name, city: h.city, status: h.status, ses: hotelMailOf(h.id).sesUser !== '', gmail: hotelMailOf(h.id).gmailUser !== '', pause: hotelMailOf(h.id).pause ?? null })).sort((a, b) => a.name.localeCompare(b.name)));
      });
    },
    getHotelMail(hotelId: string): Promise<DashResult<PlatformHotelMail>> {
      return call(() => {
        if (!isSuper()) return mockError('FORBIDDEN', undefined, { message: C.a8Errors.superOnly });
        if (!hotels.some((h) => h.id === hotelId)) return mockError('NOT_FOUND', undefined, { message: C.hotelMail.errors.hotelUnknown });
        return ok(hotelMailView(hotelId));
      });
    },
    saveHotelMail(hotelId: string, input: PlatformHotelMailInput): Promise<DashResult<PlatformHotelMail>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('settings_updated', {});
        const hotel = hotels.find((h) => h.id === hotelId);
        if (!hotel) return mockError('NOT_FOUND', undefined, { message: C.hotelMail.errors.hotelUnknown });
        const X = C.hotelMail.errors;
        const cur = { ...hotelMailOf(hotelId) };
        const f: Record<string, string> = {};
        const ses = input.ses;
        const gm = input.gmail;
        if (ses?.clear) Object.assign(cur, { sesRegion: 'ap-south-1', sesUser: '', sesFrom: '', sesPass: false, sesTest: null });
        else if (ses) {
          const user = (ses.user ?? cur.sesUser).trim();
          const from = (ses.from ?? cur.sesFrom).trim().toLowerCase();
          const region = (ses.region || cur.sesRegion).trim().toLowerCase();
          const typed = (ses.password ?? '').replace(/\s+/g, '') !== '';
          if (!user) f.sesUser = X.sesUser;
          if (!from || !EMAIL_RE.test(from)) f.sesFrom = X.sesFrom;
          if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) f.sesRegion = X.sesRegion;
          if (!typed && (!cur.sesPass || user !== cur.sesUser)) f.sesPassword = X.sesPasswordRequired;
          if (!f.sesUser && !f.sesFrom && !f.sesRegion && !f.sesPassword) Object.assign(cur, { sesUser: user, sesFrom: from, sesRegion: region, sesPass: true, sesTest: null });
        }
        if (gm?.clear) Object.assign(cur, { gmailUser: '', gmailPass: false, gmailTest: null });
        else if (gm) {
          const user = (gm.user ?? cur.gmailUser).trim().toLowerCase();
          const typed = (gm.password ?? '').replace(/\s+/g, '') !== '';
          if (!user || !EMAIL_RE.test(user)) f.gmailUser = X.gmailUser;
          if (!typed && (!cur.gmailPass || user !== cur.gmailUser)) f.gmailPassword = X.gmailPasswordRequired;
          if (!f.gmailUser && !f.gmailPassword) Object.assign(cur, { gmailUser: user, gmailPass: true, gmailTest: null });
        }
        if (input.fromName !== undefined) {
          if (input.fromName.trim().length > 100) f.fromName = X.fromName;
          else cur.fromName = input.fromName.trim();
        }
        if (input.replyTo !== undefined) {
          const r = input.replyTo.trim().toLowerCase();
          if (r && !EMAIL_RE.test(r)) f.replyTo = X.replyTo;
          else cur.replyTo = r;
        }
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        hotelMails.set(hotelId, cur);
        log('settings_updated', { hotelId }, { at: tick(), reason: `Hotel mail: ${hotel.name}` });
        return ok(hotelMailView(hotelId));
      });
    },
    testHotelMail(hotelId: string, which: 'ses' | 'gmail', to: string): Promise<DashResult<PlatformSmtpTestResult>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('settings_updated', {});
        const X = C.hotelMail.errors;
        if (!EMAIL_RE.test(to.trim().toLowerCase())) return mockError('VALIDATION_FAILED', { to: X.to });
        const m = hotelMailOf(hotelId);
        if (which === 'ses' ? !m.sesUser : !m.gmailUser) return mockError('VALIDATION_FAILED', { to: which === 'ses' ? X.sesNotSet : X.gmailNotSet });
        const bad = (which === 'ses' ? m.sesUser : m.gmailUser).startsWith('bad');
        const result: PlatformSmtpTestResult = bad ? { at: tick(), ok: false, message: 'EAUTH 535 Authentication credentials invalid', hint: 'The login was refused. Check the user name and password.' } : { at: tick(), ok: true, message: C.hotelMail.test.ok };
        hotelMails.set(hotelId, { ...m, ...(which === 'ses' ? { sesTest: result } : { gmailTest: result }) });
        return ok(result);
      });
    },
    // ------------------------------------------------ Group mail: a group's own Amazon SES and Google (Super Admin only)
    listGroupMail(): Promise<DashResult<PlatformGroupMailSummary[]>> {
      return call(() => {
        if (!isSuper()) return mockError('FORBIDDEN', undefined, { message: C.a8Errors.superOnly });
        return ok(groups.filter((g) => (g.status ?? 'active') === 'active').map((g) => ({ groupId: g.id, name: g.name, hotels: g.hotelIds.length, hotelIds: [...g.hotelIds], status: g.status ?? 'active', ses: groupMailOf(g.id).sesUser !== '', gmail: groupMailOf(g.id).gmailUser !== '', pause: groupMailOf(g.id).pause ?? null })).sort((a, b) => a.name.localeCompare(b.name)));
      });
    },
    getGroupMail(groupId: string): Promise<DashResult<PlatformGroupMail>> {
      return call(() => {
        if (!isSuper()) return mockError('FORBIDDEN', undefined, { message: C.a8Errors.superOnly });
        if (!groups.some((g) => g.id === groupId)) return mockError('NOT_FOUND', undefined, { message: C.hotelMail.errors.groupUnknown });
        return ok(groupMailView(groupId));
      });
    },
    saveGroupMail(groupId: string, input: PlatformHotelMailInput): Promise<DashResult<PlatformGroupMail>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('settings_updated', {});
        const group = groups.find((g) => g.id === groupId);
        if (!group) return mockError('NOT_FOUND', undefined, { message: C.hotelMail.errors.groupUnknown });
        const X = C.hotelMail.errors;
        const cur = { ...groupMailOf(groupId) };
        const f: Record<string, string> = {};
        const ses = input.ses;
        const gm = input.gmail;
        if (ses?.clear) Object.assign(cur, { sesRegion: 'ap-south-1', sesUser: '', sesFrom: '', sesPass: false, sesTest: null });
        else if (ses) {
          const user = (ses.user ?? cur.sesUser).trim();
          const from = (ses.from ?? cur.sesFrom).trim().toLowerCase();
          const region = (ses.region || cur.sesRegion).trim().toLowerCase();
          const typed = (ses.password ?? '').replace(/\s+/g, '') !== '';
          if (!user) f.sesUser = X.sesUser;
          if (!from || !EMAIL_RE.test(from)) f.sesFrom = X.sesFrom;
          if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) f.sesRegion = X.sesRegion;
          if (!typed && (!cur.sesPass || user !== cur.sesUser)) f.sesPassword = X.sesPasswordRequired;
          if (!f.sesUser && !f.sesFrom && !f.sesRegion && !f.sesPassword) Object.assign(cur, { sesUser: user, sesFrom: from, sesRegion: region, sesPass: true, sesTest: null });
        }
        if (gm?.clear) Object.assign(cur, { gmailUser: '', gmailPass: false, gmailTest: null });
        else if (gm) {
          const user = (gm.user ?? cur.gmailUser).trim().toLowerCase();
          const typed = (gm.password ?? '').replace(/\s+/g, '') !== '';
          if (!user || !EMAIL_RE.test(user)) f.gmailUser = X.gmailUser;
          if (!typed && (!cur.gmailPass || user !== cur.gmailUser)) f.gmailPassword = X.gmailPasswordRequired;
          if (!f.gmailUser && !f.gmailPassword) Object.assign(cur, { gmailUser: user, gmailPass: true, gmailTest: null });
        }
        if (input.fromName !== undefined) {
          if (input.fromName.trim().length > 100) f.fromName = X.fromName;
          else cur.fromName = input.fromName.trim();
        }
        if (input.replyTo !== undefined) {
          const r = input.replyTo.trim().toLowerCase();
          if (r && !EMAIL_RE.test(r)) f.replyTo = X.replyTo;
          else cur.replyTo = r;
        }
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        groupMails.set(groupId, cur);
        log('settings_updated', { groupId }, { at: tick(), reason: `Group mail: ${group.name}` });
        return ok(groupMailView(groupId));
      });
    },
    testGroupMail(groupId: string, which: 'ses' | 'gmail', to: string): Promise<DashResult<PlatformSmtpTestResult>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('settings_updated', {});
        const X = C.hotelMail.errors;
        if (!EMAIL_RE.test(to.trim().toLowerCase())) return mockError('VALIDATION_FAILED', { to: X.to });
        const m = groupMailOf(groupId);
        if (which === 'ses' ? !m.sesUser : !m.gmailUser) return mockError('VALIDATION_FAILED', { to: which === 'ses' ? X.groupSesNotSet : X.groupGmailNotSet });
        const bad = (which === 'ses' ? m.sesUser : m.gmailUser).startsWith('bad');
        const result: PlatformSmtpTestResult = bad ? { at: tick(), ok: false, message: 'EAUTH 535 Authentication credentials invalid', hint: 'The login was refused. Check the user name and password.' } : { at: tick(), ok: true, message: C.hotelMail.test.ok };
        groupMails.set(groupId, { ...m, ...(which === 'ses' ? { sesTest: result } : { gmailTest: result }) });
        return ok(result);
      });
    },
    /** Pauses or resumes a hotel's mail (the reason is kept; the demo only remembers it). */
    setHotelMailPause(hotelId: string, input: PlatformMailPauseInput): Promise<DashResult<PlatformHotelMail>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('settings_updated', {});
        const hotel = hotels.find((h) => h.id === hotelId);
        if (!hotel) return mockError('NOT_FOUND', undefined, { message: C.hotelMail.errors.hotelUnknown });
        const X = C.hotelMail.errors;
        const cur = { ...hotelMailOf(hotelId) };
        const reason = (input.reason ?? '').trim();
        if (input.paused && (reason.length < 3 || reason.length > 200)) return mockError('VALIDATION_FAILED', { reason: X.pauseReason });
        if (input.paused === (cur.pause != null)) return mockError('CONFLICT', undefined, { message: input.paused ? X.alreadyPaused : X.notPaused });
        cur.pause = input.paused ? { at: tick(), by: 'Super Admin', reason, scope: 'all' } : null;
        hotelMails.set(hotelId, cur);
        log('settings_updated', { hotelId }, { at: tick(), reason: `Hotel mail: ${input.paused ? 'paused' : 'resumed'}: ${hotel.name}` });
        return ok(hotelMailView(hotelId));
      });
    },
    /** Pauses or resumes a group's mail: scope "all" stops its hotels too, "one" only skips the group's own accounts. */
    setGroupMailPause(groupId: string, input: PlatformMailPauseInput): Promise<DashResult<PlatformGroupMail>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('settings_updated', {});
        const group = groups.find((g) => g.id === groupId);
        if (!group) return mockError('NOT_FOUND', undefined, { message: C.hotelMail.errors.groupUnknown });
        const X = C.hotelMail.errors;
        const cur = { ...groupMailOf(groupId) };
        const reason = (input.reason ?? '').trim();
        if (input.paused && (reason.length < 3 || reason.length > 200)) return mockError('VALIDATION_FAILED', { reason: X.pauseReason });
        if (input.paused === (cur.pause != null)) return mockError('CONFLICT', undefined, { message: input.paused ? X.alreadyPaused : X.notPaused });
        cur.pause = input.paused ? { at: tick(), by: 'Super Admin', reason, scope: input.scope === 'one' ? 'one' : 'all' } : null;
        groupMails.set(groupId, cur);
        log('settings_updated', { groupId }, { at: tick(), reason: `Group mail: ${input.paused ? 'paused' : 'resumed'}: ${group.name}` });
        return ok(groupMailView(groupId));
      });
    },
    // ------------------------------------------------ P4: announcements to the hotels
    listAnnouncements(): Promise<DashResult<PlatformAnnouncement[]>> {
      return call(() => {
        if (!isSuper()) return mockError('FORBIDDEN', undefined, { message: C.a8Errors.superOnly });
        return ok(announcements.map(announcementView));
      });
    },
    createAnnouncement(input: PlatformAnnouncementInput): Promise<DashResult<PlatformAnnouncement>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('announcement_created', {});
        const X = C.announcements.errors;
        const f: Record<string, string> = {};
        const title = input.title.trim();
        const body = input.body.trim();
        if (!title) f.title = X.titleRequired;
        else if (title.length > 120) f.title = X.titleLong;
        if (!body) f.body = X.bodyRequired;
        else if (body.length > 2000) f.body = X.bodyLong;
        const endsOn = (input.endsOn ?? '').trim();
        if (endsOn && endsOn < nowIso().slice(0, 10)) f.endsOn = X.endsOnPast;
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const at = tick();
        const a = { id: nextId('ann'), title, body, audience: input.audience, important: input.important === true, startsAt: at, endsAt: endsOn ? `${endsOn}T18:29:59.000Z` : null, endedAt: null, createdBy: actor.name, createdAt: at, reads: 0 };
        announcements.unshift(a);
        log('announcement_created', {}, { at, reason: title });
        return ok(announcementView(a));
      });
    },
    endAnnouncement(id: string): Promise<DashResult<PlatformAnnouncement>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('announcement_ended', {});
        const a = announcements.find((x) => x.id === id);
        if (!a) return mockError('NOT_FOUND');
        if (announcementView(a).state === 'over') return mockError('CONFLICT', undefined, { message: C.announcements.errors.over });
        const at = tick();
        a.endedAt = at;
        log('announcement_ended', {}, { at, reason: a.title });
        return ok(announcementView(a));
      });
    },

    // ------------------------------------------------ A8: platform settings
    /** Mails sent per hotel in a month, and today (mock numbers that depend on the month). Super Admin only. */
    getMailUsage(month?: string): Promise<DashResult<PlatformMailUsage>> {
      return call(() => {
        if (!isSuper()) return mockError('FORBIDDEN');
        const m = month ?? tick().slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return mockError('VALIDATION_FAILED', { month: 'Enter the month as YYYY-MM.' });
        const usage = hotels.map((h, i) => ({ hotelId: h.id, name: h.name, slug: h.slug, sentThisMonth: (i * 137 + Number(m.slice(5))) % 900, sentToday: i % 4 === 0 ? 12 : 0, dailyCap: mailCaps.get(h.id) ?? null })).sort((a, b) => b.sentThisMonth - a.sentThisMonth);
        const platformSent = 240;
        return ok({ month: m, days: new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate(), platformSent, totalSent: platformSent + usage.reduce((a, h) => a + h.sentThisMonth, 0), hotels: usage });
      });
    },

    /** Sets (null removes) the Super Admin's daily mail cap for a hotel. */
    setHotelMailCap(hotelId: string, input: PlatformMailCapInput): Promise<DashResult<PlatformMailUsageHotel>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('settings_updated', { hotelId });
        const hotel = hotelOf(hotelId);
        if (!hotel) return mockError('NOT_FOUND');
        if (input.dailyCap !== null && !(Number.isInteger(input.dailyCap) && input.dailyCap >= 0)) return mockError('VALIDATION_FAILED', { dailyCap: 'Enter a whole number of mails a day, or leave it empty for no cap.' });
        if (input.dailyCap === null) mailCaps.delete(hotelId);
        else mailCaps.set(hotelId, input.dailyCap);
        return ok({ hotelId, name: hotel.name, slug: hotel.slug, sentThisMonth: 0, sentToday: 0, dailyCap: input.dailyCap });
      });
    },

    /** Every sender identity: the platform's sending domain (when set) and the hotels' own domains (mock: none until a hotel adds one). */
    listMailIdentities(): Promise<DashResult<MailSenderIdentity[]>> {
      return call(() => {
        if (!isSuper()) return mockError('FORBIDDEN');
        const out: MailSenderIdentity[] = [];
        if (settings.mailSendingDomain) out.push(mockIdentityView('platform', settings.mailSendingDomain, null));
        for (const [scope, rec] of mockIdentities) if (scope !== 'platform') out.push(mockIdentityView(scope, rec.domain, hotelOf(scope)?.name ?? null));
        return ok(out);
      });
    },

    /** Saves the three DKIM names SES showed and/or that the domain exists in SES. */
    saveMailIdentity(scope: string, input: MailSenderIdentityInput): Promise<DashResult<MailSenderIdentity>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('settings_updated', {});
        const domain = scope === 'platform' ? settings.mailSendingDomain : (mockIdentities.get(scope)?.domain ?? '');
        if (!domain) return mockError('NOT_FOUND');
        if (input.dkimTokens && input.dkimTokens.length !== 0 && (input.dkimTokens.length !== 3 || !input.dkimTokens.every((t) => /^[a-z0-9]{10,64}$/.test(t.trim().toLowerCase())))) return mockError('VALIDATION_FAILED', { dkimTokens: 'Paste the three DKIM names Amazon SES shows (letters and digits only, three different ones).' });
        const rec = mockIdentities.get(scope) ?? { tokens: [], sesConfirmed: false, checked: null, fromAddress: null, domain };
        if (input.dkimTokens) { rec.tokens = input.dkimTokens.map((t) => t.trim().toLowerCase()); rec.checked = null; }
        if (input.sesConfirmed !== undefined) rec.sesConfirmed = input.sesConfirmed;
        mockIdentities.set(scope, rec);
        return ok(mockIdentityView(scope, domain, scope === 'platform' ? null : (hotelOf(scope)?.name ?? null)));
      });
    },

    /** The DNS check (mock: every DKIM record is found once the names are saved). */
    checkMailIdentity(scope: string): Promise<DashResult<MailSenderIdentity>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('settings_updated', {});
        const domain = scope === 'platform' ? settings.mailSendingDomain : (mockIdentities.get(scope)?.domain ?? '');
        if (!domain) return mockError('NOT_FOUND');
        const rec = mockIdentities.get(scope) ?? { tokens: [], sesConfirmed: false, checked: null, fromAddress: null, domain };
        rec.checked = tick();
        mockIdentities.set(scope, rec);
        return ok(mockIdentityView(scope, domain, scope === 'platform' ? null : (hotelOf(scope)?.name ?? null)));
      });
    },

    getPlatformSettings(): Promise<DashResult<PlatformSettings>> {
      return call(() => ok(settingsView()));
    },

    /**
     * Saves the given parts only. VALIDATION_FAILED fields: roleKeys, defaultGstPercent, defaultTimeZone, mailFromName, mailFromEmail.
     * The 2-step rule for platform roles and the invitation validity are fixed (not inputs). Audited with what changed.
     */
    updatePlatformSettings(input: PlatformSettingsInput): Promise<DashResult<PlatformSettings>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('settings_updated', {});
        const f: Record<string, string> = {};
        const X = C.a8Errors;
        if (input.roleKeys !== undefined && input.roleKeys.some((k) => !A8_HOTEL_ROLES.some((r) => r.key === k))) f.roleKeys = X.rolesUnknown;
        if (input.defaultGstPercent !== undefined && !(PLATFORM_GST_RATES as readonly number[]).includes(input.defaultGstPercent)) f.defaultGstPercent = X.gstRate;
        if (input.defaultTimeZone !== undefined && !(PLATFORM_TIME_ZONES as readonly string[]).includes(input.defaultTimeZone)) f.defaultTimeZone = E.timeZoneUnknown;
        if (input.mailFromName !== undefined) {
          const n = input.mailFromName.trim();
          if (!n) f.mailFromName = X.fromNameRequired;
          else if (n.length > 100) f.mailFromName = E.nameLong;
        }
        if (input.mailFromEmail !== undefined) {
          const e = input.mailFromEmail.trim().toLowerCase();
          if (!e) f.mailFromEmail = E.required.email;
          else if (!EMAIL_RE.test(e)) f.mailFromEmail = E.emailFormat;
        }
        if (input.mailFilesKeepHours !== undefined && !validMailFilesKeepHours(input.mailFilesKeepHours)) f.mailFilesKeepHours = mailFilesKeepHoursProblem;
        const S = C.platformSettings.smtp.errors;
        const sm = input.smtp;
        if (input.mailSendingDomain !== undefined && input.mailSendingDomain.trim() !== '' && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(input.mailSendingDomain.trim().toLowerCase())) f.mailSendingDomain = mailProviderCopy.errors.sendingDomain;
        if (sm) {
          const pv = sm.provider ?? settings.smtp.provider;
          const PE = mailProviderCopy.errors;
          if (sm.user !== undefined && sm.user.trim() !== '' && pv === 'gmail' && !EMAIL_RE.test(sm.user.trim().toLowerCase())) f.smtpUser = S.user;
          if (pv === 'smtp' && sm.host !== undefined && sm.host.trim() !== '' && !/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(sm.host.trim())) f.smtpHost = PE.host;
          if (sm.port !== undefined && !(Number.isInteger(sm.port) && sm.port >= 1 && sm.port <= 65535)) f.smtpPort = PE.port;
          if (sm.dailyLimit !== undefined && sm.dailyLimit !== null && !(Number.isInteger(sm.dailyLimit) && sm.dailyLimit >= 0)) f.smtpDailyLimit = PE.dailyLimit;
          if (pv !== 'gmail' && (sm.user ?? settings.smtp.user).trim() !== '' && !(input.mailFromEmail ?? settings.mailFromEmail).trim()) f.mailFromEmail = PE.fromAddress;
          if (sm.provider !== undefined && sm.provider !== settings.smtp.provider && settings.smtp.user !== '' && !sm.password && !sm.clearPassword) f.smtpPassword = PE.passwordNew;
          if (sm.password !== undefined && sm.password.replace(/\s+/g, '').length > 500) f.smtpPassword = S.password;
          if (sm.replyTo !== undefined && sm.replyTo.trim() !== '' && !EMAIL_RE.test(sm.replyTo.trim().toLowerCase())) f.smtpReplyTo = S.replyTo;
          const user = sm.user !== undefined ? sm.user.trim() : settings.smtp.user;
          const hasPassword = sm.clearPassword ? false : sm.password ? true : settings.smtp.passwordSet;
          if (user !== '' && !hasPassword && !f.smtpPassword) f.smtpPassword = S.passwordRequired;
          const bk = sm.backup;
          if (bk) {
            const bUser = bk.user !== undefined ? bk.user.trim().toLowerCase() : settings.backup.user;
            if (bk.user !== undefined && bUser !== '' && !EMAIL_RE.test(bUser)) f.backupUser = S.backupUser;
            const bHas = bk.clearPassword ? false : bk.password ? true : settings.backup.passwordSet;
            if (bUser !== '' && !bHas && !f.backupUser) f.backupPassword = S.passwordRequired;
            if (bUser !== '' && bUser !== settings.backup.user && settings.backup.user !== '' && !bk.password && !f.backupUser) f.backupPassword = mailProviderCopy.errors.passwordNew;
          }
          if (sm.failover?.returnMinutes !== undefined && !(Number.isInteger(sm.failover.returnMinutes) && sm.failover.returnMinutes >= 1 && sm.failover.returnMinutes <= 1440)) f.failoverMinutes = S.failoverMinutes;
        }        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const W = C.platformSettings.changed;
        const changed: string[] = [];
        if (input.roleKeys !== undefined) {
          const keys = A8_HOTEL_ROLES.filter((r) => r.locked || input.roleKeys?.includes(r.key)).map((r) => r.key);
          if (keys.join() !== settings.roleKeys.join()) changed.push(W.roles);
          settings.roleKeys = keys;
        }
        if (input.defaultGstPercent !== undefined && input.defaultGstPercent !== settings.defaultGstPercent) {
          settings.defaultGstPercent = input.defaultGstPercent;
          changed.push(W.gst);
        }
        if (input.defaultTimeZone !== undefined && input.defaultTimeZone !== settings.defaultTimeZone) {
          settings.defaultTimeZone = input.defaultTimeZone;
          changed.push(W.timeZone);
        }
        if (input.mailFilesKeepHours !== undefined && input.mailFilesKeepHours !== settings.mailFilesKeepHours) {
          settings.mailFilesKeepHours = input.mailFilesKeepHours;
          changed.push(`Email files are kept ${input.mailFilesKeepHours} hour${input.mailFilesKeepHours === 1 ? '' : 's'} after the send`);
        }
        const name = input.mailFromName?.trim();
        const email = input.mailFromEmail?.trim().toLowerCase();
        if ((name !== undefined && name !== settings.mailFromName) || (email !== undefined && email !== settings.mailFromEmail)) {
          if (name !== undefined) settings.mailFromName = name;
          if (email !== undefined) settings.mailFromEmail = email;
          changed.push(W.mail);
        }
        if (input.mailSendingDomain !== undefined && input.mailSendingDomain.trim().toLowerCase() !== settings.mailSendingDomain) {
          settings.mailSendingDomain = input.mailSendingDomain.trim().toLowerCase();
          changed.push(W.mail);
        }
        if (sm) {
          const before = JSON.stringify(settings.smtp);
          if (sm.provider !== undefined) settings.smtp.provider = sm.provider;
          if (sm.dailyLimit !== undefined) settings.smtp.dailyLimit = sm.dailyLimit === null || sm.dailyLimit === 0 ? null : sm.dailyLimit;
          if (sm.user !== undefined || sm.provider !== undefined) {
            const c = mockConnection(settings.smtp.provider, sm);
            settings.smtp.host = c.host; settings.smtp.port = c.port; settings.smtp.security = c.security; settings.smtp.region = c.region;
          }
          if (sm.user !== undefined) {
            // kept as typed: an SES user name is case sensitive (only a Gmail address is lower-cased)
            settings.smtp.user = settings.smtp.provider === 'gmail' ? sm.user.trim().toLowerCase() : sm.user.trim();
            if (settings.smtp.user === '') settings.smtp.passwordSet = false;
            settings.smtp.otherHost = '';
          }
          if (sm.replyTo !== undefined) settings.smtp.replyTo = sm.replyTo.trim().toLowerCase();
          if (sm.clearPassword) settings.smtp.passwordSet = false;
          if (sm.password) settings.smtp.passwordSet = true;          if (JSON.stringify(settings.smtp) !== before) changed.push(W.smtp);
          const beforeBackup = JSON.stringify([settings.backup, settings.failover.enabled, settings.failover.returnMinutes]);
          if (sm.backup) {
            if (sm.backup.user !== undefined) {
              settings.backup.user = sm.backup.user.trim().toLowerCase();
              if (settings.backup.user === '') settings.backup.passwordSet = false;
            }
            if (sm.backup.clearPassword) settings.backup.passwordSet = false;
            if (sm.backup.password) settings.backup.passwordSet = true;
            settings.backup.lastTest = null;
          }
          if (sm.failover?.enabled !== undefined) settings.failover.enabled = sm.failover.enabled;
          if (sm.failover?.returnMinutes !== undefined) settings.failover.returnMinutes = sm.failover.returnMinutes;
          if (JSON.stringify([settings.backup, settings.failover.enabled, settings.failover.returnMinutes]) !== beforeBackup) changed.push(W.backup);
        }
        if (changed.length) {
          settings.updatedAt = tick();
          settings.updatedBy = actor.name;
          log('settings_updated', {}, { at: settings.updatedAt, reason: changed.join(', ') });
        }
        return ok(settingsView());
      });
    },

    /** Sends a test email with the saved mail server settings (mock: no mail leaves; a host that starts with "bad" is refused so the failure shows). */
    sendPlatformTestEmail(to: string, which: 'primary' | 'backup' = 'primary'): Promise<DashResult<PlatformSmtpTestResult>> {
      return call(() => {
        if (!isSuper()) return refuseNotSuper('settings_updated', {});
        const S = C.platformSettings.smtp.errors;
        if (!EMAIL_RE.test(to.trim().toLowerCase())) return mockError('VALIDATION_FAILED', { to: S.to });
        if (which === 'backup') {
          if (!settings.backup.user || !settings.backup.passwordSet) return mockError('VALIDATION_FAILED', { to: S.backupNotSet });
          const result: PlatformSmtpTestResult = { at: tick(), ok: true, message: C.platformSettings.smtp.test.ok };
          settings.backup.lastTest = result;
          return ok(result);
        }
        if (!settings.smtp.user || !settings.smtp.passwordSet) return mockError('VALIDATION_FAILED', { to: S.notSet });
        const bad = settings.smtp.user.startsWith('bad');
        const result: PlatformSmtpTestResult = bad ? { at: tick(), ok: false, message: 'EAUTH 535-5.7.8 Username and Password not accepted', hint: 'Gmail refused the login. Use a Google APP PASSWORD (16 letters), not the normal Google password, and check that 2-step verification is switched on for that Google account.' } : { at: tick(), ok: true, message: C.platformSettings.smtp.test.ok };        settings.smtp.lastTest = result;
        return ok(result);
      });
    },

    // ------------------------------------------------ A8: archived hotels, export, permanent delete
    /** Archived hotels, newest archive first, with the 90-day grace period (ARCHIVE_GRACE_DAYS) and the export state. */
    listArchivedHotels(q: { search?: string } = {}): Promise<DashResult<PlatformArchivedHotel[]>> {
      return call(() => {
        const s = (q.search ?? '').trim().toLowerCase();
        return ok(
          hotels
            .filter((h) => h.status === 'archived')
            .map(archivedView)
            .filter((h) => !s || allWords(`${h.name} ${h.slug} ${h.city} ${h.state} ${h.reason ?? ''} ${h.archivedBy}`.toLowerCase(), s))
            .sort((x, y) => (x.archivedAt < y.archivedAt ? 1 : x.archivedAt > y.archivedAt ? -1 : 0)),
        );
      });
    },

    /** Mock: prepares an export of a hotel (any status: offered before archiving, and again before a permanent delete). Audited. */
    exportHotelData(id: string): Promise<DashResult<PlatformHotelExport>> {
      return call(() => {
        const h = hotelOf(id);
        if (!h) return mockError('NOT_FOUND');
        const at = tick();
        const fileName = `${h.slug}-export-${istDate(at)}.zip`;
        exportsOf.set(h.id, { at, fileName });
        log('hotel_exported', { hotelId: h.id }, { at, reason: fileName });
        return ok({ hotelId: h.id, fileName, exportedAt: at, message: C.archivedHotels.exportDone, note: C.archivedHotels.exportMockNote });
      });
    },

    /**
     * Super Admin only, archived, grace period over, exported, and `confirmSlug` typed exactly (VALIDATION_FAILED field: confirmSlug).
     * Removes the hotel, its accounts and its group link; the audit row is written first and kept.
     */
    deleteHotelPermanently(id: string, confirmSlug: string): Promise<DashResult<PlatformHotelDeleted>> {
      return call(() => {
        const h = hotelOf(id);
        if (!h) return mockError('NOT_FOUND');
        if (!isSuper()) return refuseNotSuper('hotel_deleted', { hotelId: h.id });
        const X = C.a8Errors;
        if (h.status !== 'archived') return mockError('CONFLICT', undefined, { message: X.deleteNotArchived });
        const left = graceLeft(h.archivedAt ?? h.createdAt);
        if (left > 0) return mockError('CONFLICT', undefined, { message: X.deleteInGrace(left) });
        if (!exportsOf.has(h.id)) return mockError('CONFLICT', undefined, { message: X.deleteNeedsExport });
        if ((confirmSlug ?? '').trim() !== h.slug) return mockError('VALIDATION_FAILED', { confirmSlug: C.archivedHotels.deleteSlugMismatch });
        log('hotel_deleted', { hotelId: h.id });
        for (const g of groups) g.hotelIds = g.hotelIds.filter((x) => x !== h.id);
        for (let i = admins.length - 1; i >= 0; i--) if (admins[i].hotelId === h.id) admins.splice(i, 1);
        for (let i = users.length - 1; i >= 0; i--) if (users[i].hotelId === h.id) users.splice(i, 1);
        hotels.splice(hotels.indexOf(h), 1);
        exportsOf.delete(h.id);
        health.delete(h.id);
        return ok({ hotelId: h.id, name: h.name, message: C.archivedHotels.deleted(h.name) });
      });
    },
  };
}

const A8_LATEST_MIGRATION = 42;
const A8_HEALTH_CHECKED_AT = '2026-10-05T05:45:00.000Z';
/** Six live hotels: Somnath Sagar Inn has a pending migration, Harbour Court's mail fails, Blue Lagoon has no backup yet. */
const A8_SEED_HEALTH: A8HealthSeed[] = [
  { hotelId: 'h-1', migrationsApplied: 42, migrationsPending: 0, database: 'ok', databaseMs: 38, mail: 'ok', lastBackupAt: '2026-10-04T20:30:00.000Z' },
  { hotelId: 'h-2', migrationsApplied: 42, migrationsPending: 0, database: 'ok', databaseMs: 41, mail: 'ok', lastBackupAt: '2026-10-04T20:32:00.000Z' },
  { hotelId: 'h-3', migrationsApplied: 41, migrationsPending: 1, database: 'ok', databaseMs: 45, mail: 'ok', lastBackupAt: '2026-10-04T20:34:00.000Z' },
  { hotelId: 'h-4', migrationsApplied: 42, migrationsPending: 0, database: 'ok', databaseMs: 52, mail: 'ok', lastBackupAt: '2026-10-04T20:36:00.000Z' },
  { hotelId: 'h-5', migrationsApplied: 42, migrationsPending: 0, database: 'ok', databaseMs: 47, mail: 'failing', lastBackupAt: '2026-10-04T20:38:00.000Z' },
  { hotelId: 'h-8', migrationsApplied: 42, migrationsPending: 0, database: 'ok', databaseMs: 36, mail: 'ok', lastBackupAt: null },
];

/** The permission roles a new hotel can start with (as the Hotel dashboard's Roles: Super Admin is always created). */
const A8_HOTEL_ROLES: readonly Omit<PlatformRoleDefault, 'enabled'>[] = [
  { key: 'super_admin', label: 'Super Admin', description: 'Owner access to everything, including users and system.', locked: true },
  { key: 'admin', label: 'Admin', description: 'Runs the hotel day to day. Can manage users and settings.', locked: false },
  { key: 'editor', label: 'Editor', description: 'Front desk and accounts staff who add and change entries.', locked: false },
  { key: 'viewer', label: 'Viewer', description: 'Can look at reports and records but not change them.', locked: false },
];

const A8_SEED_SETTINGS: A8SettingsRec = {
  roleKeys: ['super_admin', 'admin', 'editor', 'viewer'],
  defaultGstPercent: 5,
  defaultTimeZone: PLATFORM_DEFAULT_TIME_ZONE,
  mailFromName: 'EasyHotelSolutions',
  mailFromEmail: 'no-reply@hms.example.in',
  mailFilesKeepHours: MAIL_FILES_KEEP_HOURS_DEFAULT,
  mailSendingDomain: '',
  smtp: { provider: 'ses', host: 'email-smtp.ap-south-1.amazonaws.com', port: 587, security: 'starttls', region: 'ap-south-1', dailyLimit: null, user: '', passwordSet: false, replyTo: '', otherHost: '', lastTest: null },
  backup: { user: '', passwordSet: false, lastTest: null },
  failover: { enabled: true, returnMinutes: 15, active: 'primary', since: null, events: [] },
  updatedAt: null,
  updatedBy: null,
};

/** Two more Platform Admins: one disabled, one locked (Neha Kapoor and Arjun Menon are in seedUsers). */
const A8_SEED_STAFF: UserRec[] = [
  { id: 'u-platform3', name: 'Sneha Iyer', username: 'sneha.iyer', email: 'sneha.iyer@hms.example.in', mobile: '9811000004', level: 'platform_admin', hotelId: null, groupId: null, status: 'disabled', lastSignInAt: '2026-08-28T07:40:00.000Z', lockedAt: null, createdAt: '2026-04-15T05:00:00.000Z' },
  { id: 'u-platform4', name: 'Rahul Verma', username: 'rahul.verma', email: 'rahul.verma@hms.example.in', mobile: '9811000005', level: 'platform_admin', hotelId: null, groupId: null, status: 'locked', lastSignInAt: '2026-10-02T10:05:00.000Z', lockedAt: '2026-10-04T12:10:00.000Z', createdAt: '2026-07-01T05:00:00.000Z' },
];

/** A second archived hotel whose 90-day grace period is over (Gir Forest Lodge, h-7, is still inside it). */
const A8_SEED_HOTELS: HotelRec[] = [
  {
    id: 'h-10', name: 'Palm Court Inn', slug: 'palm-court-inn', city: 'Mahabaleshwar', state: 'Maharashtra', gstin: '27AAKFP4410C1Z9', timeZone: 'Asia/Kolkata',
    status: 'archived', createdAt: '2025-11-18T06:00:00.000Z', suspendedAt: null, suspendReason: null, gstDefaults: GST5,
    archivedAt: '2026-06-25T08:15:00.000Z', archiveReason: 'Hotel sold; the new owner uses another system.',
  },
];

const A8_SEED_ADMINS: AdminRec[] = [
  { id: 'a-91', hotelId: 'h-10', name: 'Sameer Kulkarni', username: 'sameer.kulkarni', email: 'sameer@palmcourtinn.in', mobile: '9822567012', status: 'active', lastSignInAt: '2026-06-24T09:10:00.000Z', lockedAt: null, createdAt: '2025-11-18T06:00:00.000Z' },
];

/** [at, actor, action, hotelId, userId, reason] */
const A8_SEED_ACTIVITY: [string, string, PlatformActivityAction, string | null, string | null, string | null][] = [
  ['2025-11-18T06:00:00.000Z', PA, 'hotel_created', 'h-10', null, null],
  ['2026-04-15T05:00:00.000Z', SUPER, 'staff_created', null, 'u-platform3', null],
  ['2026-06-25T08:15:00.000Z', SUPER, 'hotel_archived', 'h-10', null, 'Hotel sold; the new owner uses another system.'],
  ['2026-07-01T05:00:00.000Z', SUPER, 'staff_created', null, 'u-platform4', null],
  ['2026-09-01T06:30:00.000Z', SUPER, 'user_disabled', null, 'u-platform3', null],
  ['2026-10-04T12:10:00.000Z', 'System', 'admin_locked', null, 'u-platform4', null],
];

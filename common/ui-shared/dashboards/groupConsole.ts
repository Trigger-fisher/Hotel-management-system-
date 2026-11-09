// The Group Hotel Admin console: the contract (types + routes) and the mock, so Frontend 1 (screens), Frontend 2 (invite pieces) and Backend
// (group-scoped routes) build against ONE definition. Plan task 7 (docs/plans/PLAN-COMPLETE-PROJECT.md).
//
// A Group Hotel Admin sees ONLY its own group: its member hotels, the invitations it sent into that group, the Hotel Admins of those hotels.
// Everything else answers 404 (a hotel/invitation/admin outside the group is "not found", never "forbidden": the group admin must not learn it exists).
// It can NOT: create or approve a hotel or group, invite an 'individual' or 'group', change platform staff, archive, restore, export or delete.
// Every write is an audit entry (actorRole 'group_admin'); a visit into a member hotel is read-only and lasts 60 minutes, like Platform Admin's.
//
// Types are the platform console's own (PlatformHotel, PlatformInvitation, PlatformHotelAdmin ...): the same rows, the same pages, so the Hotels list,
// the Invitations list and the Invite form are REUSED by the group console with their scope fixed (see "Reuse" at the end).
import type { DashResult, ListQuery } from './common';
import type { PlatformActivity, PlatformAdminPage, PlatformAdminQuery, PlatformEnterResult, PlatformGroup, PlatformHotel, PlatformHotelAdmin, PlatformHotelChange, PlatformHotelDetail, PlatformHotelPage, PlatformHotelQuery, PlatformInvitation, PlatformInvitationPage, PlatformInvitationQuery, PlatformInvitationSent, PlatformPasswordReset } from './platform';

// ---------------------------------------------------------------- server routes (Backend builds these; all need the signed-in user's level 'group_admin')

/**
 * The route table, one line per api method. {id} = hotel / invitation / admin id. The group is NEVER in the URL: the server takes it from the
 * session, so a group admin cannot name another group. Page sizes 10/25/50/100 like every list.
 */
export const GROUP_CONSOLE_ROUTES = {
  groupOverview: 'GET /group/overview',
  myHotels: 'GET /group/hotels',
  getMyHotel: 'GET /group/hotels/{id}',
  inviteHotelToMyGroup: 'POST /group/invitations',
  myInvitations: 'GET /group/invitations',
  resendInvitation: 'POST /group/invitations/{id}/resend',
  cancelInvitation: 'POST /group/invitations/{id}/cancel',
  unlinkHotel: 'POST /group/hotels/{id}/unlink',
  archiveMemberHotel: 'POST /group/hotels/{id}/archive',
  myHotelAdmins: 'GET /group/hotel-admins',
  resetAdminPassword: 'POST /group/hotel-admins/{id}/reset-password',
  unlockAdmin: 'POST /group/hotel-admins/{id}/unlock',
  disableAdmin: 'POST /group/hotel-admins/{id}/disable',
  enableAdmin: 'POST /group/hotel-admins/{id}/enable',
  enterMemberHotel: 'POST /group/hotels/{id}/enter',
  exitMemberHotel: 'POST /group/hotels/{id}/exit',
  extendMemberHotel: 'POST /group/hotels/{id}/extend',
  myActivity: 'GET /group/activity',
} as const;

// ---------------------------------------------------------------- types

/** What the console's home shows. */
export interface GroupOverview {
  group: Pick<PlatformGroup, 'id' | 'name' | 'status' | 'createdAt' | 'legalName' | 'gstin' | 'city' | 'state' | 'phone' | 'email' | 'maxHotels'> & {
    /**
     * Whether the signed-in account is the group's PRIMARY Group Hotel Admin (hotel_groups.admin_user_id), the only one who may invite a hotel (POST /group/invitations is 403 for
     * anyone else). The server admits only that account to the group console at all, so today this is true in every answer; the Invite button should still read it (hide when false),
     * and the 403 stays as the backstop.
     */
    isPrimaryAdmin: boolean;
  };
  tiles: {
    /** Member hotels in any live status (active or suspended); archived and rejected are not counted. */
    hotels: number;
    hotelsActive: number;
    hotelsSuspended: number;
    /** member_hotel invitations still open (sent or opened). */
    invitationsOpen: number;
    /** Hotel Admin accounts of member hotels (waiting accounts left out). */
    hotelAdmins: number;
    lockedAccounts: number;
    /** The hotels that count toward the group's limit (waiting, active, suspended): "N of M hotels" with group.maxHotels (groupConsoleCopy.groupHotel.count). */
    hotelsCounted: number;
  };
  /** The five newest member hotels. */
  recentHotels: PlatformHotel[];
  /** The five newest activity entries of the group (invitations, unlinks, visits, admin resets). */
  recentActivity: PlatformActivity[];
  /**
   * What the "Set up your group" checklist needs that the tiles do not carry. Optional while the server does not send it yet: the checklist then
   * works from the tiles and the hotels list, and shows group mail and online payments as "Set up by the Super Admin" without a state.
   */
  setup?: GroupSetupFacts;
}

/** A service the Super Admin sets up for the group (Set-up centre): the group only sees its state. */
export type GroupServiceState = 'not_set_up' | 'working' | 'needs_attention';

export interface GroupSetupFacts {
  /** Active member hotels that have no Hotel Admin account yet. */
  hotelsWithoutAdmin: number;
  /** The group's own mail (sending as the group). reason: one plain sentence when it needs attention. */
  mail: { state: GroupServiceState; reason: string | null };
  /** Active member hotels whose online payments are switched on, of all active ones. */
  payments: { ready: number; of: number };
}

export type GroupSetupStepId = 'details' | 'firstHotel' | 'admins' | 'mail' | 'payments';
export type GroupSetupStepState = 'done' | 'todo' | 'platform' | 'attention' | 'unknown';

export interface GroupSetupStep {
  id: GroupSetupStepId;
  state: GroupSetupStepState;
  /** True for a step only the Super Admin can do (mail, payments): status only, no button but a look. */
  platformOnly: boolean;
  /** For details: the facts still missing; for payments: ready / of; for mail: the reason. */
  missing?: string[];
  ready?: number;
  of?: number;
  reason?: string | null;
}

/** The group details that make the group "complete" for its guests and the platform (GSTIN is optional). */
const DETAIL_KEYS = ['legalName', 'city', 'email', 'phone'] as const;

/**
 * The checklist on the group home, from the overview alone (server and screen use the same rule). `hotelsWithoutAdmin` is the fallback when the
 * overview has no `setup` (counted by the screen from the hotels list; null when that list could not be read).
 */
export function groupSetupSteps(o: GroupOverview, hotelsWithoutAdmin: number | null = null): GroupSetupStep[] {
  const g = o.group;
  const missing = DETAIL_KEYS.filter((k) => !String(g[k] ?? '').trim());
  const hasHotel = o.tiles.hotelsCounted > 0 || o.tiles.hotels > 0;
  const noAdmin = o.setup ? o.setup.hotelsWithoutAdmin : hotelsWithoutAdmin;
  const admins: GroupSetupStepState = !hasHotel || o.tiles.hotelsActive === 0 ? 'todo' : noAdmin === null ? 'unknown' : noAdmin === 0 && o.tiles.hotelAdmins > 0 ? 'done' : 'todo';
  const service = (s: GroupServiceState | undefined): GroupSetupStepState => (s === 'working' ? 'done' : s === 'needs_attention' ? 'attention' : s === 'not_set_up' ? 'platform' : 'unknown');
  const pay = o.setup?.payments;
  return [
    { id: 'details', state: missing.length ? 'todo' : 'done', platformOnly: false, missing: [...missing] },
    { id: 'firstHotel', state: hasHotel ? 'done' : 'todo', platformOnly: false },
    { id: 'admins', state: admins, platformOnly: false, ready: noAdmin ?? undefined },
    { id: 'mail', state: service(o.setup?.mail.state), platformOnly: true, reason: o.setup?.mail.reason ?? null },
    {
      id: 'payments',
      state: !pay ? 'unknown' : pay.of > 0 && pay.ready >= pay.of ? 'done' : 'platform',
      platformOnly: true,
      ready: pay?.ready,
      of: pay?.of,
    },
  ];
}

/** The checklist is shown until every step is done (a step the screen cannot know keeps it open, so nothing is hidden by mistake). */
export const groupSetupDone = (steps: GroupSetupStep[]): boolean => steps.every((s) => s.state === 'done');

/** Hotels list query: the group is the session's, so there is no groupId; kind is not offered (all are 'group'). */
export interface GroupHotelQuery extends Pick<PlatformHotelQuery, 'search' | 'page' | 'pageSize' | 'status'> {
  createdMonth?: string;
}

/** A Group Hotel Admin invites a hotel into ITS group: type is always 'member_hotel' and groupId is the session's. Field errors: hotelName, contactName, email. */
export interface GroupInviteInput {
  hotelName: string;
  contactName: string;
  email: string;
}

export type GroupInvitationQuery = Omit<PlatformInvitationQuery, 'groupId' | 'type'>;
export type GroupAdminQuery = Omit<PlatformAdminQuery, 'groupId'>;

/** The answer of unlinkHotel: the hotel as it is now (kind 'individual', groupId null). Nothing is deleted. */
export interface GroupUnlinked {
  hotel: PlatformHotel;
  message: string;
}

// ---------------------------------------------------------------- the api (the real adapter and the mock both implement this)

export interface GroupConsoleApi {
  groupOverview(): Promise<DashResult<GroupOverview>>;

  // ---- member hotels
  /** Status 'all' leaves archived ones out, as the platform list does. Answers PlatformHotelPage (counts + kindCounts). */
  myHotels(q?: GroupHotelQuery): Promise<DashResult<PlatformHotelPage>>;
  /** 404 for a hotel outside the group. The detail's `admins`, `settings` and `activity` are the same as the platform's. */
  getMyHotel(hotelId: string): Promise<DashResult<PlatformHotelDetail>>;
  /** Remove the hotel from the group; it keeps its data and becomes an individual hotel. 404 outside the group, 409 if the group admin's own account belongs to that hotel. */
  unlinkHotel(hotelId: string): Promise<DashResult<GroupUnlinked>>;
  /** Archiving a hotel is Super Admin only (MJ, 5 Nov 2026): the group console offers no Archive; the route stays and answers 403 with groupConsoleCopy.archiveSuperOnly. */
  archiveMemberHotel(hotelId: string, reason?: string): Promise<DashResult<PlatformHotelChange>>;

  // ---- invitations (member_hotel only)
  inviteHotelToMyGroup(input: GroupInviteInput): Promise<DashResult<PlatformInvitationSent>>;
  /** Only this group's member_hotel invitations. Answers PlatformInvitationPage (counts). */
  myInvitations(q?: GroupInvitationQuery): Promise<DashResult<PlatformInvitationPage>>;
  /** 404 outside the group; 409 when not open (submitted / cancelled). */
  resendInvitation(id: string): Promise<DashResult<PlatformInvitationSent>>;
  cancelInvitation(id: string): Promise<DashResult<PlatformInvitation>>;

  // ---- Hotel Admins of the member hotels
  myHotelAdmins(q?: GroupAdminQuery): Promise<DashResult<PlatformAdminPage>>;
  /** Answers the one-time new password (shown once) like the platform's reset. */
  resetAdminPassword(adminId: string): Promise<DashResult<PlatformPasswordReset>>;
  unlockAdmin(adminId: string): Promise<DashResult<PlatformHotelAdmin>>;
  disableAdmin(adminId: string): Promise<DashResult<PlatformHotelAdmin>>;
  enableAdmin(adminId: string): Promise<DashResult<PlatformHotelAdmin>>;

  // ---- read-only visit
  /** reason 5-500 chars (VALIDATION_FAILED field reason); a live (active / suspended) member hotel only. Same answer as the platform's enterHotel. */
  enterMemberHotel(hotelId: string, reason: string): Promise<DashResult<PlatformEnterResult>>;
  exitMemberHotel(hotelId: string): Promise<DashResult<PlatformEnterResult>>;
  /** "Extend 60 minutes" on the banner: a new 60-minute visit, still read only for a group admin. */
  extendMemberHotel(hotelId: string): Promise<DashResult<PlatformEnterResult>>;

  myActivity(q?: Pick<ListQuery, 'page' | 'pageSize'>): Promise<DashResult<{ items: PlatformActivity[]; total: number; page: number; pageSize: number }>>;
}

/** Words that only the group console shows (everything else is the platform console's own copy). */
export const groupConsoleCopy = {
  groupHotel: {
    created: (hotel: string, email: string) => `${hotel} is ready. Its admin was sent an email at ${email} with a temporary password.`,
    waiting: (hotel: string) => `${hotel} was created but building it did not finish. The platform will complete it; you will see it as active then.`,
    atLimit: (max: number) => `Your group can have at most ${max} ${max === 1 ? 'hotel' : 'hotels'}. Ask the platform to raise the limit.`,
    /** The places taken (hotelsCounted): the group's hotels and, apart, the open invitations, so the number matches the Hotels list. */
    count: (n: number, max: number | null, invited = 0) => {
      const hotels = Math.max(0, n - invited);
      const words = `${hotels} ${hotels === 1 ? 'hotel' : 'hotels'}${invited > 0 ? ` and ${invited} ${invited === 1 ? 'invitation' : 'invitations'}` : ''}`;
      return max === null ? words : `${words} (${n} of ${max} allowed)`;
    },
    /** The note under the Overview's hotel count (open and suspended): the hotels waiting for approval and the open invitations, which count toward the limit but are not open yet, then the limit. */
    note: (open: number, counted: number, max: number | null, invited = 0) => {
      const waiting = Math.max(0, counted - open - invited);
      const parts = [waiting > 0 ? `${waiting} waiting for approval` : '', invited > 0 ? `${invited} invited` : '', max === null ? '' : `${counted} of ${max} allowed`].filter(Boolean);
      return parts.length ? parts.join(' · ') : 'Open and suspended';
    },
  },
  unlink: 'Unlink from group',
  unlinkTitle: (hotel: string) => `Unlink ${hotel} from your group?`,
  unlinkBody: 'The hotel keeps all its data and its own admins and becomes an individual hotel. Only the platform can add it to a group again.',
  unlinkConfirm: 'Unlink hotel',
  unlinked: (hotel: string) => `${hotel} is no longer in your group.`,
  /** Why Suspend / Reactivate / Add admin / Approve / Restore / Export are not offered to a group admin. */
  platformOnly: 'This is done by the platform team.',
  archiveSuperOnly: 'Only the Super Admin can archive a hotel. To take a hotel out of your group, use Remove from group.',
} as const;

/*
 * Reuse (Frontend 1 and 2 build the screens from the platform console's pieces; the scope is fixed by props, never by a URL the user can edit):
 *  - Hotels list / Hotel details:   groups/platform/Hotels.tsx and HotelDetails.tsx take their data from an api prop (platformApi today).
 *                                   The group console passes a PlatformApi-shaped adapter built from GroupConsoleApi (myHotels -> listHotels ...).
 *                                   Approve / reject / suspend / restore / export / delete buttons stay hidden (the user is not platform staff).
 *  - Invite form:                   groups/platform/InviteForm.tsx, prop `locked={{ type: 'member_hotel', groupName }}` (no type step, no group field);
 *                                   its submit calls the `send` prop, which is inviteHotelToMyGroup here.
 *  - Invitations list:              groups/platform/Invitations.tsx, prop `scope="group"`: no Approve / Reject, no type filter, rows are member_hotel only.
 */

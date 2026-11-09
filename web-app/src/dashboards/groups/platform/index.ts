// Platform console screens (mock): dashboard, hotels, hotel details (a hotel is invited, never created here: Invitations). Groups, hotel admins and profile are added by Frontend 1.
import type { ScreenMap } from '../../types';
import { PlatformDashboard } from './Dashboard';
import { PlatformHotelDetails } from './HotelDetails';
import { PlatformHotels } from './Hotels';
import { PlatformAdmins } from './Admins';
import { PlatformGroupDetails } from './GroupDetails';
import { PlatformGroups } from './Groups';
import { PlatformProfile } from './PlatformProfile';
import { PlatformUsers } from './Users';
import { PlatformAudit } from './Audit';
import { PlatformSignIns } from './SignIns';
import { PlatformInvitations } from './Invitations';
import { PlatformStaffScreen } from './PlatformStaff';
import { PlatformHealthScreen } from './Health';
import { PlatformSettingsScreen } from './PlatformSettings';
import { PlatformArchivedScreen } from './Archived';
import { PlatformAnnouncementsScreen } from './Announcements';
import { PlatformCentral, PlatformCentralDuplicates } from './Central';
import { PlatformDemoRequests } from './DemoRequests';
import { PlatformVault } from './Vault';
import { PlatformSetupCentre, setupAlias } from './SetupCentre';

export const screens: ScreenMap = {
  // Invitations (Frontend 2, A3).
  'platform.invitations': PlatformInvitations,
  // Super Admin extras part 1 (Frontend 2, A7).
  'platform.users': PlatformUsers,
  'platform.audit': PlatformAudit,
  'platform.signins': PlatformSignIns,
  'platform.overview': PlatformDashboard,
  'platform.hotels': PlatformHotels,
  'platform.hotel': PlatformHotelDetails,
  // Frontend 1: groups, group details, hotel admins, my profile.
  'platform.groups': PlatformGroups,
  'platform.group': PlatformGroupDetails,
  'platform.admins': PlatformAdmins,
  'platform.profile': PlatformProfile,
  // Super Admin extras part 2 (Frontend 1, A8).
  'platform.staff': PlatformStaffScreen,
  'platform.health': PlatformHealthScreen,
  'platform.settings': PlatformSettingsScreen,
  'platform.archived': PlatformArchivedScreen,
  // P4: announcements to the hotels.
  'platform.announcements': PlatformAnnouncementsScreen,
  // moved into the Set-up centre (Email > Each hotel and group); the old address opens that step
  'platform.hotelMail': setupAlias('mail', 'hotels'),
  // Possible duplicates of the common guest and company profiles (Super Admin).
  'platform.duplicates': PlatformCentralDuplicates,
  // Central (read only): the logins, guest and company profiles, GST records and lookups (Platform Admin and Super Admin).
  'platform.central': PlatformCentral,
  // The website's demo requests (platform 0169).
  'platform.demoRequests': PlatformDemoRequests,
  'platform.vault': PlatformVault,
  // The Set-up centre: every outside service and its wizard (Super Admin only; MJ, 5 Nov 2026).
  'platform.setup': PlatformSetupCentre,
};

// The Group Hotel Admin console reuses these (group-scoped by the signed-in user's group): see ui-shared/dashboards/groupConsole.ts.
export { GroupInvitations, GroupInviteHotel } from './Invitations';
export { PlatformInviteForm } from './InviteForm';

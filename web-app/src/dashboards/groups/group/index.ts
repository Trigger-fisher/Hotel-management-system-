// The Group Hotel Admin console (docs/plans/PLAN-COMPLETE-PROJECT.md, task 7): its group's hotels only. Contract + mock: ui-shared/dashboards/groupConsole.ts.
import type { ScreenMap } from '../../types';
import { GroupAdmins } from './GroupAdmins';
import { GroupDashboard } from './GroupDashboard';
import { GroupHotelDetails } from './GroupHotelDetails';
import { GroupHotels } from './GroupHotels';
import { GroupInvitations, GroupInviteHotel } from './GroupInvitations';
import { GroupPayments } from './GroupPayments';
import { GroupProfile } from './GroupProfile';

export const screens: ScreenMap = {
  'group.overview': GroupDashboard,
  'group.hotels': GroupHotels,
  'group.hotel': GroupHotelDetails,
  'group.hotels.invite': GroupInviteHotel,
  'group.payments': GroupPayments,
  'group.invitations': GroupInvitations,
  'group.admins': GroupAdmins,
  'group.profile': GroupProfile,
};

// Administration screens: users, roles, master data, settings, online payments, system health and my profile.
import type { ScreenMap } from '../../types';
import { Masters } from './Masters';
import { Payments } from './Payments';
import { CompanyPortal, GuestPortal } from './PortalPreview';
import { Profile } from './Profile';
import { Roles } from './Roles';
import { Settings } from './Settings';
import { SystemHealth } from './SystemHealth';
import { ForceLog, SystemLog } from './SystemLog';
import { Users } from './Users';

export const screens: ScreenMap = {
  'hotel.admin.users': Users,
  'hotel.admin.roles': Roles,
  'hotel.admin.masters': Masters,
  'hotel.admin.settings': Settings,
  'hotel.admin.payments': Payments,
  'hotel.admin.guestPortal': GuestPortal,
  'hotel.admin.companyPortal': CompanyPortal,
  'hotel.admin.system': SystemHealth,
  'hotel.admin.log': SystemLog,
  'hotel.admin.forceLog': ForceLog,
  'hotel.admin.profile': Profile,
};

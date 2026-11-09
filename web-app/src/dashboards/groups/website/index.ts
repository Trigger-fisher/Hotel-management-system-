// Website screens: overview, enquiries (list, detail), rooms (list, form), rates, calendar, gallery, content, services/policies/nearby, settings.
import type { ScreenMap } from '../../types';
import { WebsiteCalendar } from './Calendar';
import { WebsiteContentScreen } from './Content';
import { WebsiteEnquiries, WebsiteEnquiryDetail } from './Enquiries';
import { WebsiteGallery } from './Gallery';
import { WebsiteNearby, WebsitePolicies, WebsiteServices } from './Lists';
import { WebsiteOverview } from './Overview';
import { WebsiteRates } from './Rates';
import { WebsiteSettings } from './Settings';
import { WebsiteRoomForm } from './RoomForm';
import { WebsiteRooms } from './Rooms';

export const screens: ScreenMap = {
  'hotel.web.overview': WebsiteOverview,
  'hotel.web.enquiries': WebsiteEnquiries,
  'hotel.web.enquiry': WebsiteEnquiryDetail,
  'hotel.web.rooms': WebsiteRooms,
  'hotel.web.roomForm': WebsiteRoomForm,
  'hotel.web.rates': WebsiteRates,
  'hotel.web.calendar': WebsiteCalendar,
  'hotel.web.gallery': WebsiteGallery,
  'hotel.web.content': WebsiteContentScreen,
  'hotel.web.services': WebsiteServices,
  'hotel.web.policies': WebsitePolicies,
  'hotel.web.nearby': WebsiteNearby,
  'hotel.web.settings': WebsiteSettings,
};

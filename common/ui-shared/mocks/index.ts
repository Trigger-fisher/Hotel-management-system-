// Every in-memory mock of ui-shared, in one module: the mock api factories (dashboards/*.mock.ts, auth-pallav/mock.ts), their store helpers
// and the `?data=s08` demo fixtures. The web app loads it ONLY through web-app/src/lib/api/mockLoader.ts (a dynamic import that a normal
// production build drops), so none of this ships to production. Tests import the *.mock.ts files directly.
export { createAdminApi } from '../dashboards/admin.mock';
export { withPortalDemo } from '../dashboards/portalState.mock';
export { createBillingApi } from '../dashboards/billing.mock';
export { createCashApi } from '../dashboards/cash.mock';
export { createCompaniesApi } from '../dashboards/companies.mock';
export { createCorporateApi } from '../dashboards/corporate.mock';
export { createFrontOfficeApi, loadFrontOfficeStore, resetFrontOfficeMock } from '../dashboards/frontOffice.mock';
export { createGroupConsoleMock } from '../dashboards/groupConsole.mock';
export { createGuestApi } from '../dashboards/guest.mock';
export { createGuestHotelsMock, createPortalHotelsMock } from '../dashboards/portalHotels.mock';
export { setMockUnreachableHotels } from '../dashboards/portalCursor.mock';
export { createRoomServiceMock } from '../dashboards/roomService.mock';
export { createSupportMock } from '../dashboards/supportRequests.mock';
export { createGuestAccountMock } from '../dashboards/guestAccount.mock';
export { createNotificationsMock, createNotificationsStore, createPortalNotificationsMock } from '../dashboards/notifications.mock';
export { createOverviewApi } from '../dashboards/overview.mock';
export { createPayrollCoreApi, createPayrollMocks } from '../dashboards/payrollCore.mock';
export { createPayrollPayApi } from '../dashboards/payrollPay.mock';
export { createPlatformApi, PLATFORM_KEEP_KEY } from '../dashboards/platform.mock';
export { createPreferencesApi } from '../dashboards/preferences.mock';
export { createRoomMenuMockApi } from '../dashboards/roomMenu.mock';
export { createSearchApi } from '../dashboards/search.mock';
export { createSystemAdminMock } from '../dashboards/adminSystem.mock';
export { createWebsiteApi } from '../dashboards/website.mock';
export {
  createPallavMockAuthApi, PALLAV_DEMO_ACCOUNTS, PALLAV_DEMO_CODE, PALLAV_DEMO_PASSWORD, PALLAV_DEMO_TITLE, PALLAV_QUICK_USERS,
} from '../auth-pallav/mock';
export * from './s08';
export { createConversationsMock, createPlatformMailboxMock } from '../dashboards/conversations.mock';
export { createMessagesSettingsMock, createWhatsAppSettingsMock } from '../dashboards/whatsapp.mock';
export { createGuestPortalMock, createRestaurantMock } from '../dashboards/guestPortal.mock';
export { createPayProblemsMock } from '../dashboards/payProblems.mock';
export { createGroupPaymentsMock } from '../dashboards/groupPayments.mock';

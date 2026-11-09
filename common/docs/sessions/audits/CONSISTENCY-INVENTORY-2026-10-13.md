# Consistency inventory of the dashboard screens (13 Oct 2026)

Made by `node scripts/consistency-inventory.mjs --md` (web-app). What each screen file uses of the kit (docs/UI.md §13) and what it still writes itself. The plan's rules D1 to D4 (docs/plans/PRODUCT-IMPROVEMENT-PLAN-2026-10-13.md) are closed when every row has PageHead + sentence, Kpi instead of raw tiles, EmptyState, ListSearch, Pager server where the list is server-paged, and no raw head, button, table or hex.

| Screen file | lines | PageHead | raw head | sentence | Kpi | raw tiles | EmptyState | ListSearch | other search | Pager server | Pager client | loading parts | raw <button> | raw <table> | hex |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| admin/Masters.tsx | 388 |  | yes |  |  |  | yes |  |  |  |  | yes |  |  |  |
| admin/Payments.tsx | 186 |  | yes | yes | yes |  | yes | yes |  | yes |  |  |  |  |  |
| admin/PortalPreview.tsx | 91 |  | yes | yes |  |  | yes |  |  |  |  |  |  |  |  |
| admin/Profile.tsx | 524 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| admin/Roles.tsx | 480 |  | yes | yes |  |  |  | yes |  |  |  |  | yes |  | yes |
| admin/Settings.tsx | 331 |  | yes | yes |  |  | yes | yes |  |  |  |  |  |  | yes |
| admin/SystemHealth.tsx | 587 |  | yes | yes |  | yes |  | yes |  | yes |  |  |  |  |  |
| admin/SystemLog.tsx | 368 |  | yes | yes | yes |  | yes |  | yes | yes |  |  |  |  |  |
| admin/Users.tsx | 779 |  |  |  |  | yes |  |  | yes |  |  |  | yes |  |  |
| billing/AdvancesScreen.tsx | 256 | yes |  | yes | yes |  | yes |  | yes |  | yes | yes |  |  |  |
| billing/BillsScreen.tsx | 369 | yes |  | yes | yes |  | yes |  | yes |  | yes | yes |  |  |  |
| cash/ExpensesScreen.tsx | 455 |  | yes |  | yes |  | yes | yes |  |  | yes | yes | yes |  |  |
| cash/HandoverScreen.tsx | 405 |  | yes |  | yes |  | yes | yes |  |  | yes | yes | yes |  | yes |
| cash/RevenueScreen.tsx | 283 |  | yes |  | yes |  | yes | yes |  |  | yes | yes |  |  |  |
| companies/CrmScreen.tsx | 187 |  |  |  |  |  |  |  | yes |  |  |  |  |  |  |
| companies/CustomersScreen.tsx | 218 |  |  |  |  |  | yes |  | yes | yes |  |  |  |  |  |
| companies/LeadScreen.tsx | 251 |  |  |  |  |  |  |  |  |  |  | yes | yes |  |  |
| companies/LedgerScreen.tsx | 169 |  |  |  |  |  | yes |  | yes | yes |  |  |  |  |  |
| companies/ProfilesScreen.tsx | 261 |  |  |  |  |  | yes |  | yes | yes |  |  |  |  |  |
| companies/StatementScreen.tsx | 408 |  | yes | yes |  | yes | yes |  | yes | yes |  |  |  |  |  |
| corporate/BillScreen.tsx | 177 |  |  |  |  |  | yes |  |  |  |  |  |  |  |  |
| corporate/DashboardScreen.tsx | 138 | yes |  | yes | yes |  |  |  |  |  |  |  | yes |  |  |
| corporate/DueBillsScreen.tsx | 69 |  |  |  | yes |  |  |  |  |  |  |  |  |  |  |
| corporate/LedgerAccountScreen.tsx | 72 |  |  |  | yes |  |  |  |  |  |  |  |  |  |  |
| corporate/PaymentHistoryScreen.tsx | 55 |  |  |  | yes |  |  |  |  |  |  |  |  |  |  |
| corporate/ProfileScreen.tsx | 190 | yes |  | yes |  |  |  |  |  |  |  |  |  |  |  |
| frontOffice/Board.tsx | 156 | yes |  | yes | yes |  | yes |  |  |  |  | yes |  |  |  |
| frontOffice/CheckInScreen.tsx | 183 | yes |  | yes |  |  | yes |  |  |  |  |  |  |  |  |
| frontOffice/InHouseScreen.tsx | 87 | yes |  | yes |  |  | yes | yes |  |  | yes | yes |  |  |  |
| frontOffice/PathikScreen.tsx | 214 | yes |  | yes | yes |  | yes | yes |  |  | yes | yes |  |  |  |
| frontOffice/ReservationFormScreen.tsx | 174 | yes |  | yes |  |  | yes |  |  |  |  |  |  |  |  |
| frontOffice/ReservationScreen.tsx | 200 | yes |  | yes |  |  | yes |  |  |  |  | yes |  |  |  |
| frontOffice/ReservationsScreen.tsx | 82 | yes |  | yes |  |  | yes |  | yes | yes |  | yes |  |  |  |
| frontOffice/Rooms.tsx | 266 | yes |  | yes |  |  | yes |  | yes |  |  | yes |  |  |  |
| frontOffice/StayScreen.tsx | 310 | yes |  | yes |  |  | yes |  |  |  |  | yes |  |  |  |
| group/GroupAdmins.tsx | 215 | yes |  | yes |  |  | yes |  | yes | yes |  |  |  |  |  |
| group/GroupDashboard.tsx | 125 | yes |  | yes | yes |  |  |  |  |  |  |  |  |  |  |
| group/GroupHotelDetails.tsx | 238 | yes |  | yes |  |  | yes |  |  |  |  |  |  |  |  |
| group/GroupHotels.tsx | 163 | yes |  | yes |  |  | yes |  | yes | yes |  |  |  |  |  |
| group/GroupInvitations.tsx | 260 | yes |  | yes |  |  | yes |  | yes | yes |  |  |  |  |  |
| group/GroupProfile.tsx | 11 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| guest/Bill.tsx | 234 |  |  |  |  |  | yes |  |  |  |  |  |  | yes |  |
| guest/Bills.tsx | 105 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| guest/History.tsx | 47 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| guest/Home.tsx | 115 |  |  |  |  | yes | yes |  |  |  |  |  |  |  |  |
| guest/Order.tsx | 299 |  |  |  |  |  | yes | yes |  |  |  |  | yes |  |  |
| guest/Profile.tsx | 152 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| overview/BooksScreen.tsx | 220 | yes |  | yes | yes |  |  | yes |  |  |  | yes |  |  |  |
| overview/DailyReportScreen.tsx | 391 |  |  |  |  |  |  |  |  |  |  | yes |  |  |  |
| overview/DashboardScreen.tsx | 391 | yes |  | yes | yes |  |  |  |  |  |  | yes | yes |  |  |
| overview/FoodPlanScreen.tsx | 289 |  |  |  |  |  |  |  |  |  | yes | yes |  |  |  |
| payrollCore/Attendance.tsx | 503 |  |  |  |  |  | yes |  | yes |  |  | yes |  |  |  |
| payrollCore/Companies.tsx | 376 |  |  |  |  | yes | yes |  | yes |  | yes |  |  |  |  |
| payrollCore/Dashboard.tsx | 165 |  |  |  |  | yes |  |  |  |  |  | yes |  |  |  |
| payrollCore/Deductions.tsx | 219 |  |  |  |  |  | yes |  | yes |  |  |  |  |  |  |
| payrollCore/Staff.tsx | 353 |  |  |  |  |  | yes |  | yes |  | yes |  |  |  |  |
| payrollCore/StaffEmails.tsx | 514 |  |  |  |  |  | yes |  | yes | yes |  |  |  |  |  |
| payrollCore/Statuses.tsx | 302 |  |  |  |  |  | yes |  | yes |  |  |  |  |  | yes |
| payrollPay/Advances.tsx | 208 |  |  |  |  | yes | yes |  | yes | yes |  |  |  |  |  |
| payrollPay/Bonus.tsx | 198 |  |  |  |  | yes | yes |  | yes | yes |  |  |  |  |  |
| payrollPay/Letters.tsx | 511 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| payrollPay/Log.tsx | 353 |  |  |  |  | yes | yes |  | yes | yes |  |  |  |  |  |
| payrollPay/Master.tsx | 312 |  |  |  |  |  | yes |  | yes |  |  |  |  |  |  |
| payrollPay/MealPrice.tsx | 285 |  |  |  |  | yes | yes |  | yes |  |  |  |  |  |  |
| payrollPay/Meals.tsx | 469 |  |  |  |  | yes | yes | yes |  |  |  |  |  |  |  |
| payrollPay/Payments.tsx | 460 |  |  |  |  | yes | yes |  |  | yes |  |  |  |  |  |
| payrollPay/Reports.tsx | 422 |  |  |  |  |  | yes |  |  |  |  |  |  |  |  |
| payrollPay/Resignations.tsx | 366 |  |  |  |  |  | yes |  | yes | yes |  |  |  |  |  |
| payrollPay/SalaryUpdate.tsx | 296 |  |  |  |  | yes | yes |  | yes |  | yes |  |  |  |  |
| payrollPay/Slips.tsx | 135 |  |  |  |  |  | yes |  | yes | yes |  |  |  |  |  |
| platform/Admins.tsx | 415 | yes |  | yes |  |  | yes |  | yes | yes |  |  |  |  |  |
| platform/Archived.tsx | 259 | yes |  | yes |  |  | yes |  | yes |  |  |  |  |  |  |
| platform/Audit.tsx | 324 | yes |  | yes |  |  | yes |  | yes | yes |  |  |  |  |  |
| platform/Dashboard.tsx | 262 | yes |  | yes | yes |  |  |  |  |  |  |  |  |  |  |
| platform/GroupDetails.tsx | 588 |  | yes | yes |  |  | yes |  |  |  | yes | yes |  |  |  |
| platform/Groups.tsx | 227 | yes |  | yes |  |  | yes |  | yes |  | yes |  |  |  |  |
| platform/Health.tsx | 147 | yes |  | yes | yes |  | yes |  |  |  |  |  |  |  |  |
| platform/HotelDetails.tsx | 1020 |  | yes | yes | yes |  | yes | yes |  | yes |  | yes |  |  |  |
| platform/Hotels.tsx | 361 | yes |  | yes |  |  | yes |  | yes | yes |  |  |  |  |  |
| platform/Invitations.tsx | 520 | yes |  | yes |  |  | yes |  | yes | yes |  |  |  |  |  |
| platform/NewHotel.tsx | 429 | yes |  | yes |  |  | yes |  |  |  |  |  |  |  |  |
| platform/PlatformProfile.tsx | 12 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| platform/PlatformSettings.tsx | 273 | yes |  | yes |  |  |  |  |  |  |  |  |  |  |  |
| platform/PlatformStaff.tsx | 353 | yes |  | yes |  |  | yes |  | yes | yes |  |  |  |  |  |
| platform/SignIns.tsx | 164 | yes |  | yes |  |  | yes |  | yes | yes |  |  |  |  |  |
| platform/Users.tsx | 242 | yes |  | yes |  |  | yes |  | yes | yes |  |  |  |  |  |
| website/Calendar.tsx | 448 |  | yes | yes |  |  | yes |  |  |  |  | yes | yes |  |  |
| website/Content.tsx | 192 |  | yes | yes |  |  |  |  |  |  |  | yes |  |  |  |
| website/Enquiries.tsx | 422 |  | yes | yes |  | yes | yes |  | yes | yes |  | yes |  |  |  |
| website/Gallery.tsx | 203 |  | yes | yes |  |  | yes | yes |  |  |  | yes |  |  |  |
| website/Lists.tsx | 344 |  | yes | yes |  |  | yes | yes |  |  |  | yes |  |  |  |
| website/Overview.tsx | 237 |  | yes | yes |  | yes |  |  |  |  |  | yes |  |  |  |
| website/Rates.tsx | 252 |  | yes | yes |  |  | yes | yes |  |  |  | yes |  |  |  |
| website/RoomForm.tsx | 181 |  | yes | yes |  |  |  |  |  |  |  | yes |  |  |  |
| website/Rooms.tsx | 126 |  | yes | yes |  |  | yes | yes |  |  |  | yes |  |  |  |
| website/Settings.tsx | 315 |  | yes | yes |  |  |  |  |  |  |  | yes |  |  |  |

96 screens. PageHead 33, raw head 23, with a sentence 52, Kpi 19, raw tiles 15, EmptyState 67, ListSearch 17, other search 38, Pager server 27, Pager client 13, loading parts 32, raw <button> 9, raw <table> 1, hex 4

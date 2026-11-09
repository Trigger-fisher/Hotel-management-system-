// Overview screens: hotel dashboard, reports (daily report, food plan report; Pallav has no report chooser) and accounting-year books.
import type { ScreenMap } from '../../types';
import { BooksScreen } from './BooksScreen';
import { DailyReportScreen } from './DailyReportScreen';
import { DashboardScreen } from './DashboardScreen';
import { FoodPlanScreen } from './FoodPlanScreen';
import { GstScreen } from './GstScreen';
import { OccupancyScreen } from './OccupancyScreen';

export const screens: ScreenMap = {
  'hotel.dashboard': DashboardScreen,
  'hotel.reports.daily': DailyReportScreen,
  'hotel.reports.foodPlan': FoodPlanScreen,
  'hotel.reports.occupancy': OccupancyScreen,
  'hotel.reports.gst': GstScreen,
  'hotel.books': BooksScreen,
};
